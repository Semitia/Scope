# DebugScope

DebugScope is a browser-first software oscilloscope for live program variables. C, C++, Python, Rust, and MATLAB applications emit small DSCP/1 UDP packets; the local Hub keeps recent history and streams it to the browser over WebSocket.

The repository currently contains a working v0.1 preview: the Hub, polished browser workbench, five producer SDKs, protocol documentation, and automated tests are all usable. The optional VS Code companion remains future work.

```text
C / C++ / Python / Rust / MATLAB SDK  →  UDP :4711  →  DebugScope Hub  →  WebSocket  →  Browser
```

## Start

Requirements: Node.js 24 LTS and npm.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:4712>. The Hub and browser dev server start together. With no producer, the UI waits and discovers the first source automatically.

For the built production application:

```bash
npm start
```

This builds the Hub and browser, then serves the complete application from the Hub on the same address. The standalone visual demo remains available at <http://127.0.0.1:4712/?demo=1>.

## Producer SDKs

All SDKs are dependency-light, non-blocking, and safe when DebugScope is not running.

| Language | Ready-to-use files | Primary API |
|---|---|---|
| C11 | `sdk/c/debugscope.h` + `sdk/c/debugscope.c` | `DSCOPE("speed", speed)` |
| C++17 | self-contained `sdk/cpp` library | `scope("speed", speed)` |
| Python 3.10+ | installable package in `sdk/python` | `scope("speed", speed)` |
| Rust 1.70+ | dependency-free crate in `sdk/rust` | `scope.sample("speed", speed)` |
| MATLAB | package in `sdk/matlab` | `scope.sample('speed', speed)` |

Python:

```bash
python -m pip install ./sdk/python
python sdk/python/example.py
```

```python
from debugscope import scope

scope("motor.speed", speed)
scope.frame({
    "motor.target": target,
    "motor.speed": speed,
    "motor.error": target - speed,
})
```

C:

```c
#include "debugscope.h"

ds_init("controller");
DSCOPE("motor.speed", speed);
```

C++:

```cpp
#include <debugscope.hpp>

debugscope::Scope scope("controller");
scope("motor.speed", speed);
```

Rust:

```rust
use debugscope::Scope;

let scope = Scope::new("controller");
scope.sample("motor.speed", speed);
```

MATLAB:

```matlab
addpath('sdk/matlab');
scope = debugscope.Scope('controller');
scope.sample('motor.speed', speed);
```

Copy/install details, FRAME examples, build commands, and endpoint options are in the README for each SDK: [`C`](sdk/c/README.md), [`C++`](sdk/cpp/README.md), [`Python`](sdk/python/README.md), [`Rust`](sdk/rust/README.md), and [`MATLAB`](sdk/matlab/README.md). The frozen wire format is documented in [`docs/protocol.md`](docs/protocol.md).

To inspect raw SDK traffic without the Hub:

```bash
python3 tools/dscp_receiver.py
```

Endpoint overrides are available through `DEBUGSCOPE_UDP_HOST` and `DEBUGSCOPE_UDP_PORT`.

The name passed to `ds_init(...)`, `debugscope::Scope(...)`, or Python `Scope(...)` is the stable program identity. Re-running a program with the same name updates the existing source instead of creating another sidebar entry; PID is shown only as current-run information. Use different names when simultaneous instances must stay separate.

## Browser controls

- add and remove independent Scope panels; a new Scope starts empty so its channels can be chosen deliberately;
- click a Scope to make it active, then toggle that Scope's channels in the left sidebar or use its channel picker;
- keep a separate channel set and automatically calculated Y range for every Scope;
- save the Scope layout per stable program identity across browser reloads;
- select a source and browse its channels in the left sidebar;
- delete stopped programs and their in-memory history;
- customize each channel's color, smooth/linear/stepped curve, previewed solid/dashed/dotted/dash-dot stroke, and width;
- use faithful point-to-point Linear curves by default; Smooth and Stepped remain per-channel options;
- keep the default sample-time timeline paused during input gaps, or enable idle scrolling to preserve real-time blank gaps without connecting across them;
- toggle Auto Y; while it is off, use `Shift` + wheel to zoom the Y axis;
- switch between the default light theme and the dark theme;
- pause/resume with the button or `Space`;
- clear the Hub's in-memory history;
- choose a 5, 10, or 30 second window;
- hover for the selected-channel readout;
- wheel to zoom X and drag to pan;
- double-click the plot to return to the live tail.

Multiple Scopes use a waveform-first vertical layout. One Scope fills the workspace; additional Scopes are stacked at a readable minimum height and the workspace scrolls when necessary. Freeform drag/resizing and other panel types are intentionally deferred until this basic panel model has been exercised in real debugging sessions.

### Timeline behavior

The default **sample-time** mode treats an input pause as a paused clock. When the producer resumes, new samples continue immediately after the previous batch without an artificial time gap.

Enable **Continue scrolling when idle** in Settings to use real time instead. The axis keeps moving while the producer is idle, and resumed data starts after a blank, disconnected gap rather than drawing a misleading line across missing time.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/browser` | React/Vite waveform workbench |
| `packages/hub` | UDP receiver, history store, HTTP server, and WebSocket bridge |
| `sdk` | Independent C, C++, Python, Rust, and MATLAB producers |
| `docs/protocol.md` | Frozen DSCP/1 wire format |
| `tests` | Cross-language fixtures and live end-to-end coverage |
| `tools` | Protocol receiver and SDK compatibility smoke tests |
| `PLAN.md` | Product decisions, architecture, and roadmap |

## Verification

Install the Playwright Chromium runtime once before running browser tests:

```bash
npx playwright install chromium
```

```bash
npm run verify
```

Individual checks:

```bash
npm run typecheck
npm run test:hub
npm run test:sdk
npm run test:e2e
npm run test:e2e:live
npm run build
```

The live end-to-end test uses dedicated local test ports, launches a real Python producer, and verifies SDK → UDP → Hub → WebSocket → browser, including idle timeline behavior and malformed-packet resilience.

The SDK smoke test compiles and runs C, C++, and Python fixtures. It also checks Rust when `cargo` and `rustc` are installed. MATLAB runtime validation is manual because MATLAB is not available in the standard test environment.

## License

[MIT](LICENSE)
