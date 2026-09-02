from __future__ import annotations

import atexit
import dataclasses
import numbers
import os
import secrets
import socket
import struct
import threading
import time
from collections.abc import Iterable, Mapping
from typing import Final, Iterator

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

    # NumPy scalar types do not consistently register with numbers.Integral or
    # numbers.Real. Inspecting dtype keeps this SDK dependency-free while also
    # preserving signedness and float32 precision on the wire.
    dtype = getattr(value, "dtype", None)
    dtype_kind = getattr(dtype, "kind", None)
    dtype_size = getattr(dtype, "itemsize", None)
    is_array_scalar = getattr(value, "ndim", 0) == 0
    dtype_name = str(getattr(dtype, "name", dtype)).rsplit(".", 1)[-1].lower()
    scalar_value = value
    item_method = getattr(value, "item", None)
    if is_array_scalar and callable(item_method):
        try:
            scalar_value = item_method()
        except (TypeError, ValueError, RuntimeError, OverflowError):
            scalar_value = value
    if dtype_kind == "b" and is_array_scalar:
        return _BOOL, bytes((1 if bool(scalar_value) else 0,))
    if dtype_kind in ("i", "u") and is_array_scalar:
        integer = int(scalar_value)
        try:
            if dtype_kind == "u":
                if dtype_size is not None and dtype_size <= 4:
                    return _UINT32, struct.pack("<I", integer)
                return _UINT64, struct.pack("<Q", integer)
            if dtype_size is not None and dtype_size <= 4:
                return _INT32, struct.pack("<i", integer)
            return _INT64, struct.pack("<q", integer)
        except (struct.error, TypeError, OverflowError, ValueError):
            return None
    if dtype_kind == "f" and is_array_scalar:
        try:
            if dtype_size is not None and dtype_size <= 4:
                return _FLOAT32, struct.pack("<f", float(scalar_value))
            return _FLOAT64, struct.pack("<d", float(scalar_value))
        except (struct.error, TypeError, OverflowError, ValueError):
            return None

    # PyTorch and a few other libraries expose named dtypes without NumPy's
    # ``kind``/``itemsize`` attributes.
    if is_array_scalar and dtype_kind is None:
        try:
            if dtype_name in ("bool", "boolean"):
                return _BOOL, bytes((1 if bool(scalar_value) else 0,))
            if dtype_name.startswith("uint"):
                bits = int(dtype_name[4:] or "64")
                wire_type, pattern = (_UINT32, "<I") if bits <= 32 else (_UINT64, "<Q")
                return wire_type, struct.pack(pattern, int(scalar_value))
            if dtype_name.startswith("int"):
                bits = int(dtype_name[3:] or "64")
                wire_type, pattern = (_INT32, "<i") if bits <= 32 else (_INT64, "<q")
                return wire_type, struct.pack(pattern, int(scalar_value))
            if dtype_name in ("float16", "bfloat16", "float32", "half"):
                return _FLOAT32, struct.pack("<f", float(scalar_value))
            if dtype_name in ("float64", "double"):
                return _FLOAT64, struct.pack("<d", float(scalar_value))
        except (struct.error, TypeError, OverflowError, ValueError):
            return None

    if isinstance(value, numbers.Integral):
        value = int(value)
        if -(2**31) <= value < 2**31:
            return _INT32, struct.pack("<i", value)
        if -(2**63) <= value < 2**63:
            return _INT64, struct.pack("<q", value)
        if 0 <= value < 2**64:
            return _UINT64, struct.pack("<Q", value)
        return None
    if isinstance(value, numbers.Real):
        try:
            return _FLOAT64, struct.pack("<d", float(value))
        except (struct.error, TypeError, OverflowError, ValueError):
            return None
    return None


def _child_key(key: str, component: object) -> str:
    return f"{key}.{component}"


def _flatten_value(
    key: str,
    value: object,
    active_containers: set[int] | None = None,
) -> Iterator[tuple[str, int, bytes]]:
    """Recursively turns common Python containers into scalar DSCP fields."""
    encoded = _encode_auto_value(value)
    if encoded is not None:
        yield key, encoded[0], encoded[1]
        return

    dtype = getattr(value, "dtype", None)
    dtype_kind = getattr(dtype, "kind", None)
    dtype_name = str(getattr(dtype, "name", dtype)).rsplit(".", 1)[-1].lower()
    is_array_scalar = getattr(value, "ndim", 0) == 0
    if (
        isinstance(value, numbers.Complex) and not isinstance(value, numbers.Real)
    ) or ((dtype_kind == "c" or dtype_name.startswith("complex")) and is_array_scalar):
        yield from _flatten_value(_child_key(key, "real"), value.real, active_containers)
        yield from _flatten_value(_child_key(key, "imag"), value.imag, active_containers)
        return

    if active_containers is None:
        active_containers = set()
    identity = id(value)
    if identity in active_containers:
        return
    active_containers.add(identity)
    try:
        if dataclasses.is_dataclass(value) and not isinstance(value, type):
            for field in dataclasses.fields(value):
                yield from _flatten_value(
                    _child_key(key, field.name), getattr(value, field.name), active_containers
                )
            return

        named_fields = getattr(value, "_fields", None)
        if isinstance(named_fields, tuple):
            for field in named_fields:
                yield from _flatten_value(
                    _child_key(key, field), getattr(value, field), active_containers
                )
            return

        if isinstance(value, Mapping):
            for component, item in value.items():
                if not isinstance(component, (str, int)):
                    continue
                yield from _flatten_value(
                    _child_key(key, component), item, active_containers
                )
            return

        # pandas DataFrame/Series objects expose meaningful labels via items().
        items_method = getattr(value, "items", None)
        if type(value).__module__.startswith("pandas") and callable(items_method):
            for component, item in items_method():
                yield from _flatten_value(
                    _child_key(key, component), item, active_containers
                )
            return

        # Iterating array/tensor rows keeps library scalar dtypes intact. A
        # one-element float32 ndarray must not silently become a Python float64.
        ndim = getattr(value, "ndim", None)
        if isinstance(ndim, numbers.Integral) and ndim > 0 and isinstance(value, Iterable):
            for index, item in enumerate(value):
                yield from _flatten_value(_child_key(key, index), item, active_containers)
            return

        # ndarray, Tensor, Series and similar libraries commonly expose one of
        # these conversion methods. They are intentionally optional/duck-typed.
        converted: object | None = None
        to_list = getattr(value, "to_list", None)
        tolist = getattr(value, "tolist", None)
        try:
            if callable(to_list):
                converted = to_list()
            elif callable(tolist):
                converted = tolist()
        except (TypeError, ValueError, RuntimeError, OverflowError):
            converted = None
        if converted is not None and converted is not value:
            yield from _flatten_value(key, converted, active_containers)
            return

        if isinstance(value, Iterable) and not isinstance(value, (str, bytes, bytearray)):
            for index, item in enumerate(value):
                yield from _flatten_value(_child_key(key, index), item, active_containers)
    finally:
        active_containers.remove(identity)


class Scope:
    """Process-local DebugScope UDP producer.

    Transport failures are deliberately swallowed. Encoding methods return
    ``False`` when a key or value cannot be represented by DSCP/1.
    """

    def __init__(
        self,
        source_name: str,
        *,
        host: str | None = None,
        port: int | None = None,
        enabled: bool = True,
    ) -> None:
        if not isinstance(source_name, str) or not source_name:
            raise ValueError("source_name must be a non-empty string")
        self.source_name = source_name
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

    def __call__(self, key: str, value: object) -> bool:
        encoded = _encode_auto_value(value)
        if encoded is not None:
            return self._send_encoded(key, *encoded)
        return self.frame({key: value}) > 0

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

    def frame(self, values: Mapping[str, object]) -> int:
        """Flatten and send related values with one timestamp.

        Nested mappings and iterable containers use dot-separated component
        names, for example ``{"position": [1, 2]}`` becomes
        ``position.0`` and ``position.1``.
        """
        items: list[bytes] = []
        for key, value in values.items():
            if not isinstance(key, str):
                continue
            for flat_key, value_type, value_bytes in _flatten_value(key, value):
                encoded_key = _encode_key(flat_key)
                if encoded_key is None:
                    continue
                item = (
                    struct.pack("<H", len(encoded_key))
                    + encoded_key
                    + bytes((value_type,))
                    + value_bytes
                )
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
