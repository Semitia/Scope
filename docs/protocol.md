# DSCP/1 Wire Protocol

DSCP/1 is the producer-to-Hub protocol used by the DebugScope SDKs. It is a small, self-describing binary protocol sent over non-blocking IPv4 UDP.

Default endpoint:

```text
127.0.0.1:4711
```

All multi-byte integers and floating-point values use little-endian byte order. Floating-point values use IEEE 754 representation.

## Datagram limit

An SDK must not emit a datagram larger than 1200 bytes, including the 24-byte header. A FRAME that exceeds this size is emitted as multiple independently decodable FRAME datagrams with the same timestamp.

## Header

Every datagram starts with this 24-byte header:

| Offset | Size | Type | Field |
|---:|---:|---|---|
| 0 | 4 | bytes | ASCII magic `DSCP` |
| 4 | 1 | `uint8` | version, currently `1` |
| 5 | 1 | `uint8` | message type |
| 6 | 2 | `uint16` | payload length |
| 8 | 4 | `uint32` | random process source ID |
| 12 | 4 | `uint32` | source sequence number |
| 16 | 8 | `uint64` | monotonic nanoseconds since SDK initialization |

The payload length must equal the received datagram length minus 24.

## Message types

| Value | Name |
|---:|---|
| 1 | `HELLO` |
| 2 | `SAMPLE` |
| 3 | `FRAME` |

## Value types

| Value | Name | Encoded size |
|---:|---|---:|
| 1 | `BOOL` | 1 byte, `0` or `1` |
| 2 | `INT32` | 4 bytes |
| 3 | `UINT32` | 4 bytes |
| 4 | `INT64` | 8 bytes |
| 5 | `UINT64` | 8 bytes |
| 6 | `FLOAT32` | 4 bytes |
| 7 | `FLOAT64` | 8 bytes |

## HELLO payload

| Size | Field |
|---:|---|
| 4 | process ID, `uint32` |
| 2 | source-name byte length, `uint16` |
| N | UTF-8 source name |
| 1 | SDK-name byte length, `uint8` |
| M | UTF-8 SDK name such as `c/0.1` |

The SDK sends HELLO during initialization and repeats it approximately every five seconds. Losing HELLO never prevents SAMPLE or FRAME decoding.

`source_id` identifies one transport/process run and remains random. The Hub uses the HELLO `source_name` as the stable program key: later runs with the same non-empty name are folded into the same logical program and keep its channel/history view. PID is display metadata only and is never used as identity. Applications that must appear separately should use distinct source names.

## SAMPLE payload

| Size | Field |
|---:|---|
| 2 | key byte length, `uint16` |
| N | UTF-8 key |
| 1 | value type |
| 1, 4, or 8 | encoded numeric value |

Keys must be non-empty valid UTF-8 and at most 255 bytes in the v1 SDKs.

## FRAME payload

| Size | Field |
|---:|---|
| 2 | item count, `uint16` |
| variable | repeated SAMPLE items without a packet header |

Each repeated item is encoded as:

```text
uint16 key_length
key_length bytes UTF-8 key
uint8 value_type
value bytes
```

All items in one logical frame use the same monotonic timestamp, including automatically split FRAME datagrams.

## Failure behavior

Sending is best-effort. SDKs must silently drop telemetry when:

- no receiver is running;
- the local UDP send buffer is full;
- a key or item cannot be encoded safely;
- a temporary socket error occurs.

Telemetry failure must not stop or throw from the instrumented application under default settings.
