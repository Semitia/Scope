# DebugScope Rust SDK

The Rust 1.70+ SDK has no third-party dependencies and uses a non-blocking UDP
socket. Add it to an existing project as a path dependency:

```toml
[dependencies]
debugscope = { path = "../Scope/sdk/rust" }
```

Send scalar values:

```rust
use debugscope::Scope;

let scope = Scope::new("controller");
scope.sample("motor.speed", speed);
scope.f32("motor.target", target);
```

Rust primitive types retain their natural DSCP wire type: `f32` is FLOAT32,
`f64` is FLOAT64, and signed/unsigned integers are encoded by width.

Send related values with one timestamp:

```rust
let mut frame = scope.frame();
frame.add("target", target);
frame.add("speed", speed);
frame.add("error", target - speed);
frame.send();
```

Frames are explicit: dropping one does not send a partially constructed frame.
Large frames are split into independently decodable datagrams with the same
timestamp. Invalid keys and UDP errors are silently ignored.

Run the included example:

```bash
cargo run --manifest-path sdk/rust/Cargo.toml --example basic
```

Endpoint overrides:

```text
DEBUGSCOPE_UDP_HOST=127.0.0.1
DEBUGSCOPE_UDP_PORT=4711
```

An explicit endpoint can also be selected with
`Scope::with_endpoint("controller", "127.0.0.1", 4711)`.
