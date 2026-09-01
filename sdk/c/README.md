# DebugScope C SDK

Copy `debugscope.h` and `debugscope.c` into an existing C11 project. The SDK uses only the C runtime and the operating-system socket API.

```c
#include "debugscope.h"

int main(void)
{
    ds_init("controller");

    for (;;) {
        DSCOPE("motor.speed", speed);
        DSCOPE("motor.target", target);
    }
}
```

Typed calls are also available:

```c
ds_f32("speed", speed);
ds_i32("state", state);
ds_bool("enabled", enabled);
```

Related values can share a timestamp:

```c
ds_frame frame;
ds_frame_begin(&frame);
ds_frame_f32(&frame, "target", target);
ds_frame_f32(&frame, "speed", speed);
ds_frame_f32(&frame, "error", target - speed);
ds_frame_end(&frame);
```

Direct compilation on Linux/macOS:

```bash
cc -std=c11 app.c debugscope.c -o app
```

On Windows, compile `debugscope.c` and link `ws2_32.lib`. MSVC does this automatically through the pragma in the implementation.

Environment overrides:

```text
DEBUGSCOPE_UDP_HOST=127.0.0.1
DEBUGSCOPE_UDP_PORT=4711
```

Calling `ds_init` with a non-empty name is required before sending. The name is
the stable program identity used by the Hub. Repeated runs with the same name
reuse one program entry; use different names for simultaneous instances that
should remain separate. Samples sent before successful initialization are
ignored.

Define `DEBUGSCOPE_ENABLED=0` to compile `DSCOPE(...)` calls to no-ops. Explicit `ds_f32`-style calls remain available.

```bash
cmake -S sdk/c -B build/c -G Ninja
cmake --build build/c
./build/c/debugscope_c_example
```
