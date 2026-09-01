//! Dependency-free DebugScope DSCP/1 producer.
//!
//! Sending is best-effort: socket and transport errors never escape into the
//! instrumented application.

use std::env;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::process;
use std::sync::{Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const HEADER_SIZE: usize = 24;
const MAX_DATAGRAM_SIZE: usize = 1200;
const MAX_PAYLOAD_SIZE: usize = MAX_DATAGRAM_SIZE - HEADER_SIZE;
const MAX_KEY_BYTES: usize = 255;
const DEFAULT_PORT: u16 = 4711;
const HELLO_PERIOD_NS: u64 = 5_000_000_000;

const MESSAGE_HELLO: u8 = 1;
const MESSAGE_SAMPLE: u8 = 2;
const MESSAGE_FRAME: u8 = 3;

const VALUE_BOOL: u8 = 1;
const VALUE_INT32: u8 = 2;
const VALUE_UINT32: u8 = 3;
const VALUE_INT64: u8 = 4;
const VALUE_UINT64: u8 = 5;
const VALUE_FLOAT32: u8 = 6;
const VALUE_FLOAT64: u8 = 7;

/// A value representable by DSCP/1.
#[derive(Clone, Copy, Debug)]
pub enum Value {
    Bool(bool),
    I32(i32),
    U32(u32),
    I64(i64),
    U64(u64),
    F32(f32),
    F64(f64),
}

impl Value {
    fn encode(self, output: &mut Vec<u8>) {
        match self {
            Self::Bool(value) => {
                output.push(VALUE_BOOL);
                output.push(u8::from(value));
            }
            Self::I32(value) => {
                output.push(VALUE_INT32);
                output.extend_from_slice(&value.to_le_bytes());
            }
            Self::U32(value) => {
                output.push(VALUE_UINT32);
                output.extend_from_slice(&value.to_le_bytes());
            }
            Self::I64(value) => {
                output.push(VALUE_INT64);
                output.extend_from_slice(&value.to_le_bytes());
            }
            Self::U64(value) => {
                output.push(VALUE_UINT64);
                output.extend_from_slice(&value.to_le_bytes());
            }
            Self::F32(value) => {
                output.push(VALUE_FLOAT32);
                output.extend_from_slice(&value.to_le_bytes());
            }
            Self::F64(value) => {
                output.push(VALUE_FLOAT64);
                output.extend_from_slice(&value.to_le_bytes());
            }
        }
    }
}

macro_rules! value_from {
    ($variant:ident, $target:ty: $($source:ty),+ $(,)?) => {
        $(
            impl From<$source> for Value {
                fn from(value: $source) -> Self {
                    Self::$variant(value as $target)
                }
            }
        )+
    };
}

impl From<bool> for Value {
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}

value_from!(I32, i32: i8, i16, i32);
value_from!(U32, u32: u8, u16, u32);
value_from!(I64, i64: i64, isize);
value_from!(U64, u64: u64, usize);
value_from!(F32, f32: f32);
value_from!(F64, f64: f64);

struct State {
    socket: Option<UdpSocket>,
    destination: SocketAddr,
    source_name: Vec<u8>,
    source_id: u32,
    sequence: u32,
    started: Instant,
    last_hello_ns: u64,
    hello_sent: bool,
}

/// A process-local DebugScope producer.
pub struct Scope {
    state: Mutex<State>,
}

impl Scope {
    /// Creates a producer using `DEBUGSCOPE_UDP_HOST` and
    /// `DEBUGSCOPE_UDP_PORT`, or `127.0.0.1:4711` when unset.
    pub fn new(source_name: impl AsRef<str>) -> Self {
        let host = env::var("DEBUGSCOPE_UDP_HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let port = env::var("DEBUGSCOPE_UDP_PORT")
            .ok()
            .and_then(|text| text.parse::<u16>().ok())
            .filter(|port| *port != 0)
            .unwrap_or(DEFAULT_PORT);
        Self::with_endpoint(source_name, &host, port)
    }

    /// Creates a producer with an explicit IPv4 endpoint.
    pub fn with_endpoint(source_name: impl AsRef<str>, host: &str, port: u16) -> Self {
        let address = host.parse::<Ipv4Addr>().ok();
        let destination = SocketAddr::V4(SocketAddrV4::new(
            address.unwrap_or(Ipv4Addr::LOCALHOST),
            port,
        ));
        let socket = if address.is_some() && port != 0 {
            UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()
        } else {
            None
        };
        if let Some(socket) = &socket {
            let _ = socket.set_nonblocking(true);
        }

        Self {
            state: Mutex::new(State {
                socket,
                destination,
                source_name: limited_utf8(source_name.as_ref(), MAX_KEY_BYTES),
                source_id: make_source_id(),
                sequence: 0,
                started: Instant::now(),
                last_hello_ns: 0,
                hello_sent: false,
            }),
        }
    }

    /// Sends one scalar sample. Returns `false` only when the key is invalid.
    pub fn sample<V: Into<Value>>(&self, key: &str, value: V) -> bool {
        let Some(item) = encode_item(key, value.into()) else {
            return false;
        };
        let mut state = self.lock_state();
        let timestamp_ns = timestamp_ns(&state);
        maybe_send_hello(&mut state, timestamp_ns);
        send_packet(&mut state, MESSAGE_SAMPLE, timestamp_ns, &item);
        true
    }

    pub fn bool(&self, key: &str, value: bool) -> bool {
        self.sample(key, Value::Bool(value))
    }

    pub fn i32(&self, key: &str, value: i32) -> bool {
        self.sample(key, Value::I32(value))
    }

    pub fn u32(&self, key: &str, value: u32) -> bool {
        self.sample(key, Value::U32(value))
    }

    pub fn i64(&self, key: &str, value: i64) -> bool {
        self.sample(key, Value::I64(value))
    }

    pub fn u64(&self, key: &str, value: u64) -> bool {
        self.sample(key, Value::U64(value))
    }

    pub fn f32(&self, key: &str, value: f32) -> bool {
        self.sample(key, Value::F32(value))
    }

    pub fn f64(&self, key: &str, value: f64) -> bool {
        self.sample(key, Value::F64(value))
    }

    /// Starts a logical frame whose items share one timestamp.
    #[must_use]
    pub fn frame(&self) -> Frame<'_> {
        let timestamp_ns = {
            let state = self.lock_state();
            timestamp_ns(&state)
        };
        Frame {
            scope: self,
            timestamp_ns,
            items: Vec::new(),
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn send_frame(&self, timestamp_ns: u64, items: &[Vec<u8>]) -> usize {
        if items.is_empty() {
            return 0;
        }
        let mut state = self.lock_state();
        maybe_send_hello(&mut state, timestamp_ns);

        let mut packet_items: Vec<&[u8]> = Vec::new();
        let mut packet_size = 2usize;
        for item in items {
            if !packet_items.is_empty() && packet_size + item.len() > MAX_PAYLOAD_SIZE {
                send_frame_packet(&mut state, timestamp_ns, &packet_items, packet_size);
                packet_items.clear();
                packet_size = 2;
            }
            packet_size += item.len();
            packet_items.push(item);
        }
        if !packet_items.is_empty() {
            send_frame_packet(&mut state, timestamp_ns, &packet_items, packet_size);
        }
        items.len()
    }
}

/// A collection of related values sent with one timestamp.
///
/// Dropping a frame does not send it; call [`Frame::send`] explicitly.
pub struct Frame<'a> {
    scope: &'a Scope,
    timestamp_ns: u64,
    items: Vec<Vec<u8>>,
}

impl Frame<'_> {
    /// Adds a scalar value. Invalid or individually oversized items are skipped.
    pub fn add<V: Into<Value>>(&mut self, key: &str, value: V) -> bool {
        let Some(item) = encode_item(key, value.into()) else {
            return false;
        };
        if item.len() + 2 > MAX_PAYLOAD_SIZE {
            return false;
        }
        self.items.push(item);
        true
    }

    /// Sends the frame and returns the number of accepted items.
    pub fn send(self) -> usize {
        self.scope.send_frame(self.timestamp_ns, &self.items)
    }
}

fn encode_item(key: &str, value: Value) -> Option<Vec<u8>> {
    let key = key.as_bytes();
    if key.is_empty() || key.len() > MAX_KEY_BYTES {
        return None;
    }
    let mut item = Vec::with_capacity(2 + key.len() + 9);
    item.extend_from_slice(&(key.len() as u16).to_le_bytes());
    item.extend_from_slice(key);
    value.encode(&mut item);
    Some(item)
}

fn send_frame_packet(
    state: &mut State,
    timestamp_ns: u64,
    items: &[&[u8]],
    packet_size: usize,
) {
    let mut payload = Vec::with_capacity(packet_size);
    payload.extend_from_slice(&(items.len() as u16).to_le_bytes());
    for item in items {
        payload.extend_from_slice(item);
    }
    send_packet(state, MESSAGE_FRAME, timestamp_ns, &payload);
}

fn maybe_send_hello(state: &mut State, timestamp_ns: u64) {
    if !state.hello_sent || timestamp_ns.saturating_sub(state.last_hello_ns) >= HELLO_PERIOD_NS {
        let sdk_name = b"rust/0.1";
        let mut payload = Vec::with_capacity(7 + state.source_name.len() + sdk_name.len());
        payload.extend_from_slice(&process::id().to_le_bytes());
        payload.extend_from_slice(&(state.source_name.len() as u16).to_le_bytes());
        payload.extend_from_slice(&state.source_name);
        payload.push(sdk_name.len() as u8);
        payload.extend_from_slice(sdk_name);
        send_packet(state, MESSAGE_HELLO, timestamp_ns, &payload);
        state.last_hello_ns = timestamp_ns;
        state.hello_sent = true;
    }
}

fn send_packet(state: &mut State, message_type: u8, timestamp_ns: u64, payload: &[u8]) {
    if payload.len() > MAX_PAYLOAD_SIZE {
        return;
    }
    let mut packet = Vec::with_capacity(HEADER_SIZE + payload.len());
    packet.extend_from_slice(b"DSCP");
    packet.push(1);
    packet.push(message_type);
    packet.extend_from_slice(&(payload.len() as u16).to_le_bytes());
    packet.extend_from_slice(&state.source_id.to_le_bytes());
    packet.extend_from_slice(&state.sequence.to_le_bytes());
    packet.extend_from_slice(&timestamp_ns.to_le_bytes());
    packet.extend_from_slice(payload);
    state.sequence = state.sequence.wrapping_add(1);
    if let Some(socket) = &state.socket {
        let _ = socket.send_to(&packet, state.destination);
    }
}

fn timestamp_ns(state: &State) -> u64 {
    state.started.elapsed().as_nanos().min(u64::MAX as u128) as u64
}

fn limited_utf8(text: &str, maximum: usize) -> Vec<u8> {
    if text.is_empty() {
        return b"app".to_vec();
    }
    let mut end = text.len().min(maximum);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.as_bytes()[..end].to_vec()
}

fn make_source_id() -> u32 {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0);
    let mut value = time ^ ((process::id() as u64) << 32);
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^= value >> 31;
    let result = (value ^ (value >> 32)) as u32;
    if result == 0 { 1 } else { result }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_little_endian_values() {
        assert_eq!(
            encode_item("x", Value::I32(0x0102_0304)).unwrap(),
            vec![1, 0, b'x', VALUE_INT32, 4, 3, 2, 1]
        );
    }

    #[test]
    fn rejects_invalid_keys() {
        assert!(encode_item("", Value::Bool(true)).is_none());
        assert!(encode_item(&"x".repeat(256), Value::Bool(true)).is_none());
    }

    #[test]
    fn truncates_source_at_utf8_boundary() {
        let source = "x".repeat(254) + "界";
        let encoded = limited_utf8(&source, MAX_KEY_BYTES);
        assert_eq!(encoded.len(), 254);
        assert!(std::str::from_utf8(&encoded).is_ok());
    }
}
