#!/usr/bin/env python3
"""Builds available compiled SDKs, sends UDP packets, and validates DSCP parity."""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

from dscp_receiver import DecodedPacket, decode_packet

ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str], **kwargs: object) -> None:
    subprocess.run(command, check=True, **kwargs)


def collect_packets(command: list[str], *, python_path: Path | None = None) -> list[DecodedPacket]:
    receiver = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    receiver.bind(("127.0.0.1", 0))
    receiver.settimeout(0.2)
    port = receiver.getsockname()[1]

    environment = os.environ.copy()
    environment["DEBUGSCOPE_UDP_HOST"] = "127.0.0.1"
    environment["DEBUGSCOPE_UDP_PORT"] = str(port)
    if python_path is not None:
        environment["PYTHONPATH"] = str(python_path)

    run(command, cwd=ROOT, env=environment)

    packets: list[DecodedPacket] = []
    while True:
        try:
            datagram, _ = receiver.recvfrom(2048)
        except TimeoutError:
            break
        if len(datagram) > 1200:
            raise AssertionError(f"oversized DSCP datagram: {len(datagram)} bytes")
        packets.append(decode_packet(datagram))
    receiver.close()
    return packets


def assert_receiver_absence_is_safe(command: list[str], *, python_path: Path | None = None) -> None:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    probe.bind(("127.0.0.1", 0))
    unused_port = probe.getsockname()[1]
    probe.close()

    environment = os.environ.copy()
    environment["DEBUGSCOPE_UDP_HOST"] = "127.0.0.1"
    environment["DEBUGSCOPE_UDP_PORT"] = str(unused_port)
    if python_path is not None:
        environment["PYTHONPATH"] = str(python_path)
    run(command, cwd=ROOT, env=environment)


def packet_items(packets: list[DecodedPacket]) -> dict[str, tuple[str, bool | int | float]]:
    result: dict[str, tuple[str, bool | int | float]] = {}
    for packet in packets:
        for item in packet.payload.get("items", []):
            result[item["key"]] = (item["value_type"], item["value"])
    return result


def assert_packets(language: str, packets: list[DecodedPacket], expected_source: str) -> None:
    if not packets:
        raise AssertionError(f"{language}: no UDP packets received")
    if any(packet.sequence != index for index, packet in enumerate(packets)):
        raise AssertionError(f"{language}: sequence numbers are not contiguous")
    if any(packet.source_id != packets[0].source_id for packet in packets):
        raise AssertionError(f"{language}: source ID changed within one process")

    hello_packets = [packet for packet in packets if packet.message_type == "HELLO"]
    if len(hello_packets) != 1:
        raise AssertionError(f"{language}: expected exactly one HELLO, got {len(hello_packets)}")
    if hello_packets[0].payload["source_name"] != expected_source:
        raise AssertionError(f"{language}: wrong source name")
    if not any(packet.message_type == "SAMPLE" for packet in packets):
        raise AssertionError(f"{language}: no SAMPLE packet")
    if not any(packet.message_type == "FRAME" for packet in packets):
        raise AssertionError(f"{language}: no FRAME packet")
    items = packet_items(packets)
    for key in ("enabled", "iterations", "speed", "target"):
        if key not in items:
            raise AssertionError(f"{language}: missing {key}")
    if items["enabled"] != ("BOOL", True):
        raise AssertionError(f"{language}: BOOL mismatch")
    if items["iterations"][0] != "INT32":
        raise AssertionError(f"{language}: integer type mismatch")
    if items["speed"][0] != "FLOAT32":
        raise AssertionError(f"{language}: float type mismatch")

    if language in ("C++", "Python"):
        for key in (
            "direct.0",
            "direct.1",
            "psi.0",
            "psi.1",
            "psi.2",
            "limits.0",
            "limits.1",
            "matrix.0.0",
            "matrix.1.1",
            "impedance.real",
            "impedance.imag",
        ):
            if key not in items:
                raise AssertionError(f"{language}: missing expanded container field {key}")
        if items["limits.0"] != ("BOOL", True):
            raise AssertionError(f"{language}: container BOOL mismatch")
        if "point.x" not in items or "point.y" not in items:
            raise AssertionError(f"{language}: named fields were not expanded")

        expanded_keys = {
            "psi.0",
            "psi.1",
            "psi.2",
            "limits.0",
            "limits.1",
            "matrix.0.0",
            "matrix.1.1",
        }
        expanded_timestamps = {
            packet.timestamp_ns
            for packet in packets
            if any(item["key"] in expanded_keys for item in packet.payload.get("items", []))
        }
        if len(expanded_timestamps) != 1:
            raise AssertionError(f"{language}: one frame did not retain one timestamp")

    print(
        f"{language:6} {len(packets)} packets, "
        f"source=0x{packets[0].source_id:08x}, keys={','.join(sorted(items))}"
    )


def assert_cpp_instances(packets: list[DecodedPacket]) -> None:
    hello_packets = [packet for packet in packets if packet.message_type == "HELLO"]
    names = {packet.payload["source_name"] for packet in hello_packets}
    source_ids = {packet.source_id for packet in hello_packets}
    if names != {"cpp-controller", "cpp-estimator"} or len(source_ids) != 2:
        raise AssertionError("C++: Scope instances do not have independent identities")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="debugscope-sdk-") as temporary_directory:
        build_directory = Path(temporary_directory)
        c_object = build_directory / "debugscope.o"
        c_emitter = build_directory / "emit-c"
        cpp_emitter = build_directory / "emit-cpp"
        cpp_multi_emitter = build_directory / "emit-cpp-multi"
        rust_emitter = build_directory / "emit-rust"

        run(
            [
                "cc",
                "-std=c11",
                "-Wall",
                "-Wextra",
                "-Wpedantic",
                "-Werror",
                "-c",
                str(ROOT / "sdk/c/debugscope.c"),
                "-o",
                str(c_object),
            ]
        )
        run(
            [
                "c++",
                "-std=c++17",
                "-Wall",
                "-Wextra",
                "-Wpedantic",
                "-Werror",
                str(ROOT / "tests/fixtures/emit_cpp_multi.cpp"),
                str(ROOT / "sdk/cpp/debugscope.cpp"),
                "-I",
                str(ROOT / "sdk/cpp"),
                "-o",
                str(cpp_multi_emitter),
            ]
        )
        run(
            [
                "cc",
                "-std=c11",
                "-Wall",
                "-Wextra",
                "-Wpedantic",
                "-Werror",
                str(ROOT / "tests/fixtures/emit_c.c"),
                str(c_object),
                "-I",
                str(ROOT / "sdk/c"),
                "-o",
                str(c_emitter),
            ]
        )
        run(
            [
                "c++",
                "-std=c++17",
                "-Wall",
                "-Wextra",
                "-Wpedantic",
                "-Werror",
                str(ROOT / "tests/fixtures/emit_cpp.cpp"),
                str(ROOT / "sdk/cpp/debugscope.cpp"),
                "-I",
                str(ROOT / "sdk/cpp"),
                "-o",
                str(cpp_emitter),
            ]
        )

        cargo = shutil.which("cargo")
        rustc = shutil.which("rustc")
        if cargo is not None and rustc is not None:
            rust_target = build_directory / "rust-target"
            run(
                [
                    cargo,
                    "test",
                    "--quiet",
                    "--manifest-path",
                    str(ROOT / "sdk/rust/Cargo.toml"),
                    "--target-dir",
                    str(rust_target),
                ]
            )
            run(
                [
                    cargo,
                    "build",
                    "--quiet",
                    "--manifest-path",
                    str(ROOT / "sdk/rust/Cargo.toml"),
                    "--target-dir",
                    str(rust_target),
                ]
            )
            run(
                [
                    rustc,
                    "--edition=2021",
                    str(ROOT / "tests/fixtures/emit_rust.rs"),
                    "--extern",
                    f"debugscope={rust_target / 'debug/libdebugscope.rlib'}",
                    "-Dwarnings",
                    "-o",
                    str(rust_emitter),
                ]
            )

        c_packets = collect_packets([str(c_emitter)])
        cpp_packets = collect_packets([str(cpp_emitter)])
        python_packets = collect_packets(
            [sys.executable, str(ROOT / "tests/fixtures/emit_python.py")],
            python_path=ROOT / "sdk/python",
        )
        cpp_multi_packets = collect_packets([str(cpp_multi_emitter)])

        assert_packets("C", c_packets, "c-smoke")
        assert_packets("C++", cpp_packets, "cpp-smoke")
        assert_packets("Python", python_packets, "python-smoke")
        assert_cpp_instances(cpp_multi_packets)
        if cargo is not None and rustc is not None:
            rust_packets = collect_packets([str(rust_emitter)])
            assert_packets("Rust", rust_packets, "rust-smoke")
        else:
            print("Rust   skipped (cargo/rustc not found)")

        assert_receiver_absence_is_safe([str(c_emitter)])
        assert_receiver_absence_is_safe([str(cpp_emitter)])
        assert_receiver_absence_is_safe(
            [sys.executable, str(ROOT / "tests/fixtures/emit_python.py")],
            python_path=ROOT / "sdk/python",
        )
        if cargo is not None and rustc is not None:
            assert_receiver_absence_is_safe([str(rust_emitter)])

    print("All tested SDKs emitted compatible DSCP/1 packets and tolerate receiver absence")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
