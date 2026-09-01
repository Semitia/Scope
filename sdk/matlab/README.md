# DebugScope MATLAB SDK

Add the SDK directory to the MATLAB path and create a producer:

```matlab
addpath('sdk/matlab');
scope = debugscope.Scope('controller');

scope.sample('motor.speed', speed);
scope.f32('motor.target', target);
```

MATLAB scalar types retain their natural DSCP wire type. `double` is FLOAT64,
`single` is FLOAT32, `logical` is BOOL, and MATLAB integer classes map to the
matching signed or unsigned DSCP type. Explicit typed methods (`i32`, `u32`,
`i64`, `u64`, `f32`, and `f64`) are also available.

Send related values with one timestamp using an N-by-2 cell array. Cell arrays
allow channel names such as `motor.speed`, which are not valid struct fields:

```matlab
scope.frame({ ...
    'motor.target', target; ...
    'motor.speed',  speed; ...
    'motor.error',  target - speed});
```

Scalar structs and `containers.Map` instances are accepted as well. Frames
larger than one DSCP datagram are split automatically with a shared timestamp.

The SDK lazily uses `udpport` on MATLAB R2020b+ when it is available and sets
`OutputDatagramSize` to 1200 so MATLAB does not split DSCP packets. If
`udpport` or Instrument Control Toolbox is unavailable, it falls back to the
MATLAB JVM's `DatagramSocket`. Encoding and transport failures are silently
ignored so telemetry cannot stop the instrumented program.

Endpoint overrides:

```text
DEBUGSCOPE_UDP_HOST=127.0.0.1
DEBUGSCOPE_UDP_PORT=4711
```

Or configure the endpoint in code:

```matlab
scope = debugscope.Scope('controller', ...
    'Host', '127.0.0.1', 'Port', 4711, 'Enabled', true);
```

Run `sdk/matlab/example.m` for a small live producer. Call `scope.close()` when
finished; MATLAB also closes the socket when the handle object is destroyed.
