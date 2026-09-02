# DebugScope C++ SDK

The C++17 SDK is self-contained and does not depend on the C SDK. Add
`debugscope.hpp` and `debugscope.cpp` to the project.

```cpp
#include <debugscope.hpp>

int main()
{
    debugscope::Scope scope("controller");

    while (running) {
        scope("motor.speed", speed);
        scope("motor.target", target);
    }
}
```

Send related values with one timestamp:

```cpp
auto frame = scope.frame();
frame("target", target);
frame("speed", speed);
frame("error", target - speed);
frame.send();
```

Containers are expanded into dot-separated scalar channels automatically. This
works with C arrays, `std::array`, iterable standard containers, maps, tuples,
pairs, `std::complex`, and matrix types that provide `rows()`, `cols()`, and
`operator()(row, col)` (including Eigen dense vectors and matrices):

```cpp
auto frame = scope.frame();
frame("error.distance", err_dist);       // scalar
frame("psi", psi_get);                  // Eigen::Vector6f -> psi.0 ... psi.5
frame("limit", limit_status);            // std::array<bool, 6>
frame("mc", mc);                        // Eigen vector
frame("jacobian", jacobian);            // matrix -> jacobian.0.0 ...
frame.send();
```

Nested containers are expanded recursively. A vector is named `key.0`,
`key.1`, and so on; a matrix is named `key.row.column`. All expanded values
added to a `Frame` retain their own scalar wire type and use the frame's one
timestamp. Passing a container directly to `Scope`, such as
`scope("psi", psi_get)`, also creates and sends one frame automatically.

The frame is intentionally explicit: destroying it does not send it. This prevents partially constructed frames from being emitted during error handling.

The `Scope` constructor name is the stable program identity used by the Hub. Repeated runs with the same name reuse one program entry; use different names for simultaneous instances that should remain separate.
The name is required; there is no unnamed/default `Scope`.

To select a non-default Hub endpoint, pass it directly when creating the scope:

```cpp
debugscope::Scope scope("controller", "192.168.1.20", 4711);
```

For named configuration, use `ScopeOptions`:

```cpp
debugscope::ScopeOptions options;
options.host = "192.168.1.20";
options.port = 4711;
options.enabled = true;

debugscope::Scope scope("controller", options);
```

Every `Scope` owns its socket, sequence, clock, and source identity. Multiple
instances in one process are independent and close themselves automatically.

When the address is omitted, the SDK uses `DEBUGSCOPE_UDP_HOST` and
`DEBUGSCOPE_UDP_PORT`, then falls back to `127.0.0.1:4711`.

Compile the SDK and application with a C++17 compiler:

```bash
c++ -std=c++17 app.cpp debugscope.cpp -I. -o app
```

```bash
cmake -S sdk/cpp -B build/cpp -G Ninja
cmake --build build/cpp
./build/cpp/debugscope_cpp_example
```
