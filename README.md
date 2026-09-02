# DebugScope

DebugScope is a browser-first software oscilloscope for live program variables. C, C++, Python, Rust, and MATLAB applications emit small DSCP/1 UDP packets; the local Hub keeps recent history and streams it to the browser or the VS Code Bottom Panel over WebSocket.

The repository currently contains a working v0.1 preview: the Hub, polished browser workbench, five producer SDKs, protocol documentation, and automated tests are all usable. An initial VS Code companion is also available for local development.

```text
C / C++ / Python / Rust / MATLAB SDK  →  UDP :4711  →  DebugScope Hub  →  Browser / VS Code
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
from debugscope import Scope

scope = Scope("controller")

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

Every SDK requires an explicit, non-empty source name. The name passed to
`ds_init(...)`, `debugscope::Scope(...)`, Rust/MATLAB/Python `Scope(...)` is the
stable program identity. Re-running a program with the same name updates the
existing source instead of creating another sidebar entry; PID is shown only as
current-run information. Use different names when simultaneous instances must
stay separate.

## Browser controls

- add waveform, Value Bars, and Indicators panels; each panel keeps independent channel bindings and configuration;
- prepare and persist the workspace even before a producer connects, then inherit it for newly discovered programs;
- export or import a portable Workspace JSON containing panel types, grid positions, channel bindings, ranges, and indicator state colors;
- drag panels on a 12-column desktop grid, resize them from the lower-right corner, and arrange side-by-side columns without overlap;
- bind Value Bars to individual channels or a numbered channel group; click either endpoint value to set that bar's manual range, then use its center icon to restore/relearn the automatic history range;
- bind Indicators to individual channels or numbered channel groups such as `limit.0..N`, with customizable colors and labels for boolean/enumerated states;
- double-click a panel title to rename it; click outside any open picker/editor to dismiss it;
- click a Scope to make it active, then toggle that Scope's channels in the left sidebar or use its channel picker;
- keep a separate channel set, Auto Y mode, automatically calculated Y range, and visible time window for every waveform Scope;
- save the Scope layout per stable program identity across browser reloads;
- select a source and browse its channels in the left sidebar;
- collapse sidebar channel groups independently for each program; filtering temporarily expands matching groups without discarding the saved state;
- add remote Hub addresses manually and browse programs from multiple Hubs in one workbench;
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

Use the `+` button beside **PROGRAMS** to add another Hub. Addresses such as
`192.168.1.20:4713`, `http://192.168.1.20:4713`, and a complete WebSocket URL
are accepted and saved in the browser. The Browser connects to the Hub's
WebSocket endpoint; UDP producers still send to that Hub's UDP address and port.

Panels use a persistent 12-column desktop grid. Drag the grip in a panel header to move it, double-click its title to rename it, and use the lower-right handle to resize it; panels snap to the grid and push colliding panels downward. Narrow browser windows automatically switch to a readable single-column layout while preserving the saved desktop arrangement.

Open **Settings → Workspace** to export the current program layout or offline template as a `.workspace.json` file. Importing a file replaces the current workspace after validating its schema and panel definitions; it does not change the telemetry protocol or require a connected producer.

## VS Code preview

Build the repository, then launch an Extension Development Host from the repository root:

```bash
npm run build
code --extensionDevelopmentPath="$PWD/apps/vscode"
```

Open **DebugScope** in the Bottom Panel. The extension attaches to an existing local Hub or starts one using the `debugscope.udpPort` and `debugscope.httpPort` settings. The compact panel provides source selection, channel toggles, Pause, Clear, history-window selection, and **Open in Browser**. The richer multi-Scope and channel-style controls remain browser-only.

The current extension preview targets local desktop extension hosts. Remote SSH, WSL, Dev Containers, automated Extension Host coverage, and Marketplace publishing remain follow-up work.

### Timeline behavior

The default **sample-time** mode treats an input pause as a paused clock. When the producer resumes, new samples continue immediately after the previous batch without an artificial time gap.

Enable **Continue scrolling when idle** in Settings to use real time instead. The axis keeps moving while the producer is idle, and resumed data starts after a blank, disconnected gap rather than drawing a misleading line across missing time.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/browser` | React/Vite waveform workbench |
| `apps/vscode` | VS Code Bottom Panel extension and compact React webview |
| `packages/hub` | UDP receiver, history store, HTTP server, and WebSocket bridge |
| `packages/ui-core` | Shared telemetry model, Hub client, timeline, and waveform plot |
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
