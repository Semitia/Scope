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
