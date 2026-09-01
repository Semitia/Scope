from __future__ import annotations

import atexit
import os
import secrets
import socket
import struct
import sys
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Final

_MAGIC: Final = b"DSCP"
_VERSION: Final = 1
_HEADER: Final = struct.Struct("<4sBBHIIQ")
_MAX_DATAGRAM: Final = 1200
_MAX_PAYLOAD: Final = _MAX_DATAGRAM - _HEADER.size
_MAX_KEY_BYTES: Final = 255
_HELLO_PERIOD_NS: Final = 5_000_000_000

_HELLO: Final = 1
_SAMPLE: Final = 2
_FRAME: Final = 3

_BOOL: Final = 1
_INT32: Final = 2
_UINT32: Final = 3
_INT64: Final = 4
_UINT64: Final = 5
_FLOAT32: Final = 6
_FLOAT64: Final = 7


def _default_source_name() -> str:
    if not sys.argv or not sys.argv[0]:
        return "python"
    name = Path(sys.argv[0]).stem
    return name or "python"


def _environment_port() -> int:
    text = os.environ.get("DEBUGSCOPE_UDP_PORT", "4711")
    try:
        value = int(text)
    except ValueError:
        return 4711
    return value if 1 <= value <= 65535 else 4711


def _encode_key(key: str) -> bytes | None:
    if not isinstance(key, str):
        return None
    try:
        encoded = key.encode("utf-8")
    except UnicodeEncodeError:
        return None
    if not encoded or len(encoded) > _MAX_KEY_BYTES:
        return None
    return encoded


def _encode_auto_value(value: object) -> tuple[int, bytes] | None:
    if isinstance(value, bool):
        return _BOOL, bytes((1 if value else 0,))
    if isinstance(value, int):
        if -(2**31) <= value < 2**31:
            return _INT32, struct.pack("<i", value)
        if -(2**63) <= value < 2**63:
            return _INT64, struct.pack("<q", value)
        return None
    if isinstance(value, float):
        return _FLOAT64, struct.pack("<d", value)
    return None


class Scope:
    """Process-local DebugScope UDP producer.

    Transport failures are deliberately swallowed. Encoding methods return
    ``False`` when a key or value cannot be represented by DSCP/1.
    """

    def __init__(
        self,
        source_name: str | None = None,
        *,
        host: str | None = None,
        port: int | None = None,
        enabled: bool = True,
    ) -> None:
        self.source_name = source_name or _default_source_name()
        self.host = host or os.environ.get("DEBUGSCOPE_UDP_HOST", "127.0.0.1")
        self.port = port if port is not None else _environment_port()
        self.enabled = enabled

        self._source_id = secrets.randbits(32) or 1
        self._sequence = 0
        self._started_ns = time.perf_counter_ns()
        self._last_hello_ns = 0
        self._hello_sent = False
        self._socket: socket.socket | None = None
        self._lock = threading.RLock()
        atexit.register(self.close)

    def _timestamp_ns(self) -> int:
        return max(0, time.perf_counter_ns() - self._started_ns)

    def _ensure_socket(self) -> socket.socket | None:
        if not self.enabled:
            return None
        if self._socket is not None:
            return self._socket
        try:
            producer_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            producer_socket.setblocking(False)
            self._socket = producer_socket
        except OSError:
            self._socket = None
        return self._socket

    def _send_packet(self, message_type: int, timestamp_ns: int, payload: bytes) -> None:
        producer_socket = self._ensure_socket()
        if producer_socket is None or len(payload) > _MAX_PAYLOAD:
            return

        sequence = self._sequence
        self._sequence = (self._sequence + 1) & 0xFFFFFFFF
        packet = _HEADER.pack(
            _MAGIC,
            _VERSION,
            message_type,
            len(payload),
            self._source_id,
            sequence,
            timestamp_ns,
        ) + payload

        try:
            producer_socket.sendto(packet, (self.host, self.port))
        except (BlockingIOError, OSError):
            pass

    def _send_hello(self, timestamp_ns: int) -> None:
        try:
            source_name = self.source_name.encode("utf-8")
            if len(source_name) > _MAX_KEY_BYTES:
                source_name = (
                    source_name[:_MAX_KEY_BYTES]
                    .decode("utf-8", errors="ignore")
                    .encode("utf-8")
                )
        except UnicodeEncodeError:
            source_name = b"python"
        sdk_name = b"python/0.1"
        payload = (
            struct.pack("<IH", os.getpid() & 0xFFFFFFFF, len(source_name))
            + source_name
            + bytes((len(sdk_name),))
            + sdk_name
        )
        self._send_packet(_HELLO, timestamp_ns, payload)
        self._last_hello_ns = timestamp_ns
        self._hello_sent = True

    def _maybe_send_hello(self, timestamp_ns: int) -> None:
        if not self._hello_sent or timestamp_ns - self._last_hello_ns >= _HELLO_PERIOD_NS:
            self._send_hello(timestamp_ns)

    def _send_encoded(self, key: str, value_type: int, encoded_value: bytes) -> bool:
        encoded_key = _encode_key(key)
        if encoded_key is None:
            return False
        payload = struct.pack("<H", len(encoded_key)) + encoded_key + bytes((value_type,)) + encoded_value
        with self._lock:
            timestamp_ns = self._timestamp_ns()
            self._maybe_send_hello(timestamp_ns)
            self._send_packet(_SAMPLE, timestamp_ns, payload)
        return True

    def __call__(self, key: str, value: bool | int | float) -> bool:
        encoded = _encode_auto_value(value)
        if encoded is None:
            return False
        return self._send_encoded(key, *encoded)

    def bool(self, key: str, value: bool) -> bool:
        return self._send_encoded(key, _BOOL, bytes((1 if value else 0,)))

    def i32(self, key: str, value: int) -> bool:
        try:
            encoded = struct.pack("<i", value)
        except (struct.error, TypeError):
            return False
        return self._send_encoded(key, _INT32, encoded)

    def u32(self, key: str, value: int) -> bool:
        try:
            encoded = struct.pack("<I", value)
        except (struct.error, TypeError):
            return False
        return self._send_encoded(key, _UINT32, encoded)

    def i64(self, key: str, value: int) -> bool:
        try:
            encoded = struct.pack("<q", value)
        except (struct.error, TypeError):
            return False
        return self._send_encoded(key, _INT64, encoded)

    def u64(self, key: str, value: int) -> bool:
        try:
            encoded = struct.pack("<Q", value)
        except (struct.error, TypeError):
            return False
        return self._send_encoded(key, _UINT64, encoded)

    def f32(self, key: str, value: float) -> bool:
        try:
            encoded = struct.pack("<f", value)
        except (struct.error, TypeError, OverflowError):
            return False
        return self._send_encoded(key, _FLOAT32, encoded)

    def f64(self, key: str, value: float) -> bool:
        try:
            encoded = struct.pack("<d", value)
        except (struct.error, TypeError, OverflowError):
            return False
        return self._send_encoded(key, _FLOAT64, encoded)

    def frame(self, values: Mapping[str, bool | int | float]) -> int:
        """Sends related values with one timestamp and returns the item count."""
        items: list[bytes] = []
        for key, value in values.items():
            encoded_key = _encode_key(key)
            encoded_value = _encode_auto_value(value)
            if encoded_key is None or encoded_value is None:
                continue
            value_type, value_bytes = encoded_value
            item = struct.pack("<H", len(encoded_key)) + encoded_key + bytes((value_type,)) + value_bytes
            if len(item) + 2 <= _MAX_PAYLOAD:
                items.append(item)

        if not items:
            return 0

        with self._lock:
            timestamp_ns = self._timestamp_ns()
            self._maybe_send_hello(timestamp_ns)
            packet_items: list[bytes] = []
            packet_size = 2
            for item in items:
                if packet_items and packet_size + len(item) > _MAX_PAYLOAD:
                    payload = struct.pack("<H", len(packet_items)) + b"".join(packet_items)
                    self._send_packet(_FRAME, timestamp_ns, payload)
                    packet_items = []
                    packet_size = 2
                packet_items.append(item)
                packet_size += len(item)

            if packet_items:
                payload = struct.pack("<H", len(packet_items)) + b"".join(packet_items)
                self._send_packet(_FRAME, timestamp_ns, payload)

        return len(items)

    def close(self) -> None:
        with self._lock:
            if self._socket is not None:
                try:
                    self._socket.close()
                except OSError:
                    pass
                self._socket = None
            self._hello_sent = False
