#!/usr/bin/env python3
"""Small DSCP/1 packet decoder and UDP inspection tool."""

from __future__ import annotations

import argparse
import json
import socket
import struct
import time
from dataclasses import asdict, dataclass
from typing import Any, Final

_HEADER: Final = struct.Struct("<4sBBHIIQ")
_VALUE_FORMATS: Final = {
    1: ("BOOL", "<?"),
    2: ("INT32", "<i"),
    3: ("UINT32", "<I"),
    4: ("INT64", "<q"),
    5: ("UINT64", "<Q"),
    6: ("FLOAT32", "<f"),
    7: ("FLOAT64", "<d"),
}
_MESSAGE_NAMES: Final = {1: "HELLO", 2: "SAMPLE", 3: "FRAME"}


class ProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class DecodedItem:
    key: str
    value_type: str
    value: bool | int | float


@dataclass(frozen=True)
class DecodedPacket:
    message_type: str
    source_id: int
    sequence: int
    timestamp_ns: int
    payload: dict[str, Any]


def _read_item(payload: bytes, offset: int) -> tuple[DecodedItem, int]:
    if offset + 2 > len(payload):
        raise ProtocolError("truncated item key length")
    key_length = struct.unpack_from("<H", payload, offset)[0]
    offset += 2
    if key_length == 0 or offset + key_length + 1 > len(payload):
        raise ProtocolError("invalid item key length")
    try:
        key = payload[offset : offset + key_length].decode("utf-8")
    except UnicodeDecodeError as error:
        raise ProtocolError("item key is not UTF-8") from error
    offset += key_length
    value_type = payload[offset]
    offset += 1
    value_info = _VALUE_FORMATS.get(value_type)
    if value_info is None:
        raise ProtocolError(f"unknown value type {value_type}")
    type_name, value_format = value_info
    value_size = struct.calcsize(value_format)
    if offset + value_size > len(payload):
        raise ProtocolError("truncated item value")
    value = struct.unpack_from(value_format, payload, offset)[0]
    return DecodedItem(key, type_name, value), offset + value_size


def decode_packet(datagram: bytes) -> DecodedPacket:
    if len(datagram) < _HEADER.size:
        raise ProtocolError("datagram is smaller than the DSCP header")
    magic, version, message_type, payload_length, source_id, sequence, timestamp_ns = _HEADER.unpack_from(datagram)
    if magic != b"DSCP":
        raise ProtocolError("invalid magic")
    if version != 1:
        raise ProtocolError(f"unsupported version {version}")
    if message_type not in _MESSAGE_NAMES:
        raise ProtocolError(f"unknown message type {message_type}")
    if payload_length != len(datagram) - _HEADER.size:
        raise ProtocolError("payload length does not match datagram size")
    payload = datagram[_HEADER.size :]

    if message_type == 1:
        if len(payload) < 7:
            raise ProtocolError("truncated HELLO payload")
        process_id, name_length = struct.unpack_from("<IH", payload)
        offset = 6
        if offset + name_length + 1 > len(payload):
            raise ProtocolError("invalid HELLO source-name length")
        try:
            source_name = payload[offset : offset + name_length].decode("utf-8")
        except UnicodeDecodeError as error:
            raise ProtocolError("HELLO source name is not UTF-8") from error
        offset += name_length
        sdk_length = payload[offset]
        offset += 1
        if offset + sdk_length != len(payload):
            raise ProtocolError("invalid HELLO SDK-name length")
        try:
            sdk_name = payload[offset : offset + sdk_length].decode("utf-8")
        except UnicodeDecodeError as error:
            raise ProtocolError("HELLO SDK name is not UTF-8") from error
        decoded_payload: dict[str, Any] = {
            "process_id": process_id,
            "source_name": source_name,
            "sdk_name": sdk_name,
        }
    elif message_type == 2:
        item, offset = _read_item(payload, 0)
        if offset != len(payload):
            raise ProtocolError("trailing bytes in SAMPLE")
        decoded_payload = {"items": [asdict(item)]}
    else:
        if len(payload) < 2:
            raise ProtocolError("truncated FRAME item count")
        item_count = struct.unpack_from("<H", payload)[0]
        offset = 2
        items: list[dict[str, Any]] = []
        for _ in range(item_count):
            item, offset = _read_item(payload, offset)
            items.append(asdict(item))
        if offset != len(payload):
            raise ProtocolError("trailing bytes in FRAME")
        decoded_payload = {"items": items}

    return DecodedPacket(
        message_type=_MESSAGE_NAMES[message_type],
        source_id=source_id,
        sequence=sequence,
        timestamp_ns=timestamp_ns,
        payload=decoded_payload,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Listen for and decode DebugScope DSCP/1 UDP packets")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4711)
    parser.add_argument("--count", type=int, default=0, help="exit after N packets; zero means run until interrupted")
    parser.add_argument("--timeout", type=float, default=0.0, help="exit after this many idle seconds; zero disables")
    arguments = parser.parse_args()

    receiver = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    receiver.bind((arguments.host, arguments.port))
    if arguments.timeout > 0:
        receiver.settimeout(arguments.timeout)

    print(f"Listening for DSCP/1 on udp://{arguments.host}:{arguments.port}", flush=True)
    received = 0
    try:
        while arguments.count <= 0 or received < arguments.count:
            try:
                datagram, address = receiver.recvfrom(2048)
            except TimeoutError:
                break
            try:
                packet = decode_packet(datagram)
            except ProtocolError as error:
                print(json.dumps({"from": address[0], "error": str(error)}), flush=True)
                continue
            output = asdict(packet)
            output["from"] = f"{address[0]}:{address[1]}"
            print(json.dumps(output, ensure_ascii=False), flush=True)
            received += 1
    except KeyboardInterrupt:
        pass
    finally:
        receiver.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
