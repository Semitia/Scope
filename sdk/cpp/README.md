# DebugScope C++ SDK

The C++17 SDK is self-contained and does not depend on the C SDK. Add
`debugscope.hpp`, `detail/transport.hpp`, and `detail/transport.cpp` to the
project.

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

Compile the SDK and application with a C++17 compiler:

```bash
c++ -std=c++17 app.cpp detail/transport.cpp -I. -o app
```

```bash
cmake -S sdk/cpp -B build/cpp -G Ninja
cmake --build build/cpp
./build/cpp/debugscope_cpp_example
```
