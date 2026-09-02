# DebugScope Development Plan

> - **Status:** Working v0.1 browser application + initial VS Code companion preview
> - **Target:** browser application first + compact VS Code Bottom Panel
> - **Producer languages:** C / C++ / Python / Rust / MATLAB
> - **Transport:** UDP on localhost
> - **UI transport:** WebSocket
> - **Primary goal:** one-line instrumentation, beautiful live waveform visualization, zero debugger dependency

---

## 0. Current Implementation Snapshot

The repository now contains the complete browser-first vertical slice that this plan set out to validate:

- frozen DSCP/1 `HELLO`, `SAMPLE`, and `FRAME` packets;
- a local TypeScript Hub with source/channel discovery, bounded recent history, memory limits, WebSocket snapshots/deltas, and static browser serving;
- stable program identity based on the producer name, with PID retained only as current-run metadata;
- independent C and C++ SDKs plus Python, Rust, and MATLAB SDKs;
- a responsive light/dark browser workbench with source deletion, multiple independent Scope panels, per-Scope channel binding and Y ranges, Auto Y, zoom/pan, pause/clear, cursor readout, channel colors and line styles, and persistent per-program layouts/settings;
- sample-time and real-time timeline modes, including disconnected blank regions across real input gaps;
- a shared React/uPlot UI core plus an initial VS Code Bottom Panel with Hub discovery/start, source and channel selection, compact waveform monitoring, pause/clear, history windows, and Open in Browser;
- Hub, protocol, SDK compatibility, browser interaction, timeline, and live end-to-end tests.

Still deferred:

- automated VS Code Extension Host coverage, Remote SSH/WSL/Dev Container support, and Marketplace publishing;
- freeform/resizable panel layout, record/replay, export, advanced cursors, and additional plot types;
- automated MATLAB runtime coverage and a broader cross-platform CI matrix;
- public package publishing and formal v0.1 release packaging.

The remaining sections preserve the product decisions and longer roadmap. Where an older milestone description is broader than the current implementation, this snapshot is the authoritative status summary.

---

## 1. Project Summary

**DebugScope** is a lightweight local telemetry and waveform visualization tool for software development.

The application under test explicitly emits numeric values:

```cpp
scope("speed", speed);
scope("target", target);
scope("error", error);
```

or:

```python
scope("loss", loss)
scope("accuracy", accuracy)
```

DebugScope receives those values over localhost UDP and visualizes them as live time-series waveforms.

The project deliberately does **not** depend on GDB, LLDB, debugpy, VS Code Debug Adapter Protocol, breakpoint state, or runtime variable inspection.

The browser interface is the primary product surface. It must feel like a polished engineering instrument, not an administrative dashboard with a chart embedded in it.

The same producer code works regardless of whether the user views the data in:

- the **VS Code Bottom Panel**, or
- the **Browser Full UI**.

The producer API and wire protocol are independent of the frontend.

---

# 2. Product Definition

DebugScope should feel like:

> A tiny software oscilloscope for program variables.

The core experience is:

```text
scope("x", x)
      ↓
run program
      ↓
see x move
```

The user should not need to configure connections, sessions, dashboards, schemas, or debugger-specific integrations.

---

# 3. Core Product Shape

DebugScope consists of four layers:

```text
┌───────────────────────────────────────────────┐
│ Application                                   │
│                                               │
│ C / C++ / Python / Rust / MATLAB             │
│ scope("speed", speed)                        │
└───────────────────┬───────────────────────────┘
                    │
                    │ DebugScope UDP Protocol
                    ▼
┌───────────────────────────────────────────────┐
│ DebugScope Hub                                │
│                                               │
│ UDP Receiver                                  │
│ Protocol Decoder                              │
│ Source Registry                               │
│ Channel Registry                              │
│ Ring Buffers                                  │
│ Session State                                 │
│ HTTP Server                                   │
│ WebSocket Server                              │
└───────────────────┬───────────────────────────┘
                    │
                    │ WebSocket / HTTP
           ┌────────┴─────────┐
           │                  │
           ▼                  ▼
┌───────────────────┐  ┌──────────────────────┐
│ VS Code Extension │  │ Browser Application  │
│                   │  │                      │
│ Bottom Panel      │  │ Full Scope UI        │
└───────────────────┘  └──────────────────────┘
```

The **Hub owns the data**.

The frontends only visualize and interact with that shared state.

---

# 4. Final UI Decision

## 4.1 VS Code

If a VS Code companion is shipped, its default integration is a **Bottom Panel View**.

Example:

```text
┌──────────────────────────────────────────────────────────┐
│                          CODE                            │
│                                                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ Problems  Output  Debug Console  Terminal  DebugScope    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ target ────────────────────────────────────────────────   │
│          ╭──────╮        ╭────────╮                      │
│ speed ───╯      ╰────────╯        ╰──────────────         │
│                                                          │
│ ☑ speed   ☑ target   ☑ error     10 s   ⏸   Clear   ↗   │
└──────────────────────────────────────────────────────────┘
```

Rationale:

- waveforms benefit from horizontal space;
- the editor remains dedicated to code;
- the Panel is already where developers expect terminal/debug/output tooling;
- users can collapse it while coding;
- it works naturally as a quick live monitor.

The VS Code companion is useful, but it is not a v0.1 release blocker. Browser quality must not be reduced or delayed to keep feature parity with the embedded panel.

### Explicitly not planned

- no Editor Tab scope;
- no dedicated floating-window implementation;
- no custom floating window feature.

If VS Code itself allows users to move a View using native layout controls, that is fine, but DebugScope will not build or depend on a separate floating-view experience.

---

## 4.2 Browser

The browser application is the **primary product and full analysis interface**.

It is intended for:

- full-screen waveform viewing;
- second-monitor workflows;
- multiple scopes;
- many channels;
- detailed zoom/pan;
- cursors;
- measurements;
- future XY plots / histogram / array views.

Example:

```text
┌───────────────────────────────────────────────────────────────┐
│ DebugScope                                         ● LIVE     │
├────────────┬──────────────────────────────────────────────────┤
│ Sources    │                                                  │
│            │                    Scope 1                       │
│ app        │                                                  │
│            │  target ─────────────────────────────────────    │
│ Channels   │            ╭────────╮                            │
│            │  speed ─────╯        ╰───────────────────────    │
│ ☑ speed    │                                                  │
│ ☑ target   ├──────────────────────────────────────────────────┤
│ ☑ error    │                    Scope 2                       │
│            │                                                  │
│            │  error ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~     │
│            │                                                  │
└────────────┴──────────────────────────────────────────────────┘
```

The browser frontend is not an alternative protocol.

It is another client of the same DebugScope Hub.

Its quality bar is comparable to a dedicated waveform tool such as VOFA+: fast to read, dense without feeling cramped, comfortable during long debugging sessions, and immediately credible when opened full-screen. DebugScope should learn from that professional instrument/workbench feeling without copying a desktop application's chrome or serial-port configuration workflow.

---

# 5. UX Roles

| Frontend | Primary role |
|---|---|
| Browser Full UI | primary monitoring, detailed waveform inspection, and analysis |
| VS Code Bottom Panel | optional quick monitor while coding/debugging |

The VS Code panel, when present, should have an **Open in Browser** button.

Primary workflow:

```text
run program
  ↓
open DebugScope in browser
  ↓
monitor and inspect full-size waveforms
```

Optional VS Code companion workflow:

```text
code
  ↓
watch compact waveform in VS Code
  ↓
notice something interesting
  ↓
click "Open in Browser"
  ↓
inspect full-size waveform
```

---

# 6. Non-Goals

The first versions explicitly do not aim to become:

- a debugger;
- a profiler;
- distributed tracing;
- OpenTelemetry;
- Grafana;
- a database;
- a production observability platform;
- a hard real-time acquisition system.

v0.1 does not include:

- GDB integration;
- LLDB integration;
- debugpy integration;
- automatic variable discovery from process memory;
- breakpoint-based sampling;
- Shared Memory;
- ZeroMQ;
- TCP producer transport;
- remote internet telemetry;
- cloud services;
- persistent historical database;
- FFT;
- signal processing pipeline;
- arbitrary object serialization;
- structs/classes visualization;
- strings as waveform values;
- custom floating windows;
- VS Code Editor Webview.

---

# 7. Design Principles

## 7.1 Producer integration must be trivial

C++:

```cpp
scope("speed", speed);
```

Python:

```python
scope("loss", loss)
```

C:

```c
ds_f32("speed", speed);
```

The instrumentation call should be the primary user-facing abstraction.

---

## 7.2 No third-party SDK dependencies

C:

```text
libc + OS socket API
```

C++:

```text
C++ standard library + OS socket API
```

The C and C++ SDKs are self-contained siblings. Neither SDK links to or includes the other.

Python:

```text
stdlib socket
```

No mandatory:

- Boost;
- ZeroMQ;
- protobuf;
- FlatBuffers;
- gRPC;
- JSON library;
- ASIO.

---

## 7.3 Receiver absence must not affect the application

The producer must not require DebugScope to be running.

```text
DebugScope closed
      ↓
UDP packet discarded
      ↓
application continues normally
```

No:

- connection state machine;
- reconnect logic;
- waiting for receivers;
- blocking send queues;
- mandatory background threads.

---

## 7.4 Telemetry may be lossy

DebugScope is a visualization tool.

Occasional UDP packet loss is acceptable.

```text
100
101
102
[loss]
104
105
```

Loss is preferable to pausing or blocking the program.

---

## 7.5 History belongs in the Hub

Producer:

```text
current sample
     ↓
send
```

Hub:

```text
receive
  ↓
ring buffer
  ↓
recent history
```

Frontends:

```text
request snapshot
   +
receive live deltas
```

The producer does not maintain historical buffers.

---

## 7.6 Input rate and render rate are independent

Example:

```text
producer input: 20,000 samples/s
                  ↓
               Hub buffer
                  ↓
WebSocket/UI update: 30–60 Hz
                  ↓
                plot
```

Never redraw once per UDP packet.

---

# 8. Network Architecture

## 8.1 Producer → Hub

Default:

```text
UDP IPv4
127.0.0.1:4711
```

The Hub is the only process that owns the UDP listening port.

VS Code and Browser must **not** separately listen to the producer UDP port.

This prevents:

- port conflicts;
- duplicate receiver complexity;
- platform-specific `SO_REUSEPORT` behavior;
- inconsistent sample delivery.

---

## 8.2 Hub → UI

Use:

```text
HTTP + WebSocket
```

Suggested defaults:

```text
UDP     127.0.0.1:4711
HTTP    127.0.0.1:4712
WS      ws://127.0.0.1:4712/api/ws
Browser http://127.0.0.1:4712/
```

Exact ports may remain configurable.

---

# 9. Why Not Use the Same Wire Protocol Everywhere?

Producer requirements:

- very small implementation;
- C friendly;
- binary;
- low overhead;
- non-blocking;
- UDP friendly.

Frontend requirements:

- browser compatible;
- structured;
- easy to debug;
- easy to evolve;
- bidirectional control.

Therefore:

```text
Producer
  ↓
DSCP binary protocol over UDP
  ↓
Hub
  ↓
WebSocket protocol
  ↓
UI
```

The **data model is shared**, but the wire encodings do not need to be identical.

This separation is intentional.

---

# 10. Hub Responsibilities

The Hub is the central runtime component.

It owns:

- UDP listener;
- protocol parsing;
- source discovery;
- channel discovery;
- timestamps;
- packet-loss statistics;
- recent history;
- memory limits;
- browser static assets;
- WebSocket clients;
- snapshot generation;
- live update fan-out.

The Hub is not conceptually a VS Code component.

It is an independent DebugScope Core service.

---

# 11. Hub Lifecycle

Every frontend follows:

```text
try connect to Hub
        ↓
     connected?
      /      \
    yes       no
    │         │
 attach   attempt Hub start
```

### VS Code

When DebugScope starts:

1. try connecting to the Hub;
2. if unavailable, launch it;
3. connect via WebSocket;
4. show the Bottom Panel.

### Browser CLI / standalone launch

A future command:

```bash
debugscope
```

may:

1. detect an existing Hub;
2. otherwise start one;
3. open the browser UI.

Multiple browser tabs and VS Code can attach to the same Hub.

---

# 12. Producer Protocol v1

Working protocol name:

```text
DSCP/1
```

The first release should favor robustness over maximum bandwidth efficiency.

## 12.1 Key principle

Packets are **self-describing**.

Do not require one-time channel definition packets in v1.

Reason:

```text
DEFINE packet lost
      ↓
future channel-id packets become undecodable
```

Channel ID compression can be added later.

---

# 13. Packet Header

Proposed logical fields:

```text
magic
version
message_type
payload_length
source_id
sequence
timestamp
```

Example conceptual layout:

```text
Offset   Size   Field
0        4      Magic "DSCP"
4        1      Version
5        1      Message Type
6        2      Payload Length
8        4      Source ID
12       4      Sequence
16       8      Timestamp
```

Exact byte layout must be frozen in `protocol.md` before SDK implementations are finalized.

All multi-byte field endianness must be explicitly specified.

Recommended:

```text
little-endian
```

because producers are overwhelmingly local CPU processes and implementation simplicity matters more than network interoperability.

---

# 14. Message Types

v1:

```text
HELLO
SAMPLE
FRAME
```

No ACK/request-response mechanism is required.

---

# 15. HELLO

Purpose:

- display source name;
- provide PID;
- optionally provide SDK/language metadata.

Example logical content:

```text
source_id
source_name
pid
```

HELLO is **not required for decoding samples**.

If it is lost, the Hub may show:

```text
Unknown Source 0x12AB34CD
```

The producer should resend HELLO periodically, e.g. every few seconds.

---

# 16. SAMPLE

Represents one value:

```text
key = value
```

Payload:

```text
key_length
key UTF-8 bytes
value_type
value bytes
```

Example:

```text
motor.speed = 123.45
```

---

# 17. FRAME

Represents several values with one timestamp.

Example:

```text
timestamp = T

speed  = 100
target = 120
error  = 20
```

Useful for:

- controllers;
- simulations;
- model iteration;
- physics;
- optimization;
- related measurements that should share a time coordinate.

---

# 18. Supported Value Types

v0.1:

```text
BOOL
INT32
UINT32
INT64
UINT64
FLOAT32
FLOAT64
```

Waveform rendering uses JavaScript numeric representation.

Values beyond JS safe integer range should trigger a warning or documented precision loss in v0.1.

No strings/objects/structs in the waveform protocol initially.

---

# 19. Keys

Keys are UTF-8 strings:

```text
speed
target
motor.speed
motor.current
controller.pid.error
simulation.position.x
```

Dot notation is recommended for organization, but has no language semantics.

The UI may visually group:

```text
motor
 ├─ speed
 └─ current
```

The underlying key remains a plain string.

---

# 20. Source Identification

Every producer instance gets:

```text
source_id: uint32
```

Recommended:

- random on process startup;
- combined with source metadata;
- never assume PID alone uniquely identifies a session.

Unique channel identity:

```text
(source_id, key)
```

not:

```text
key
```

---

# 21. Sequence Numbers

Each source increments:

```text
sequence: uint32
```

The Hub can estimate packet loss:

```text
received
expected
missing
drop percentage
```

No retransmission is performed.

---

# 22. Timestamp

Producer timestamp should use a monotonic clock.

C++:

```cpp
std::chrono::steady_clock
```

Python:

```python
time.perf_counter_ns()
```

C:

platform monotonic clock abstraction.

Recommended representation:

```text
nanoseconds since producer initialization
```

Avoid wall-clock timestamps in normal sample packets.

---

# 23. Cross-Process Time Alignment

Different sources have unrelated monotonic clock origins.

v0.1 may estimate source offset using receive time:

```text
hub_receive_time - producer_timestamp
```

This provides approximate visual alignment only.

DebugScope v0.1 must not promise high-precision cross-process synchronization.

---

# 24. Datagram Size

Avoid IP fragmentation.

Recommended application-level maximum:

```text
~1200 bytes/datagram
```

Large FRAME messages should be split into independently decodable datagrams.

Do not implement custom fragmentation/reassembly in v0.1.

---

# 25. C SDK

Preferred distribution:

```text
debugscope.h
debugscope.c
```

Copying those two files directly into a project must always remain supported.

Example:

```c
#include "debugscope.h"

int main(void)
{
    ds_init();

    while (running) {
        ds_f32("speed", speed);
        ds_f32("error", error);
    }
}
```

Batch:

```c
ds_frame_begin();

ds_frame_f32("speed", speed);
ds_frame_f32("target", target);
ds_frame_f32("error", error);

ds_frame_end();
```

---

# 26. C++ SDK

The C++ API should remain thin while using its own self-contained C++ transport.

Example:

```cpp
#include <debugscope.hpp>

int main()
{
    debugscope::Scope scope;

    while (running) {
        scope("speed", speed);
        scope("error", error);
    }
}
```

Optional global helper:

```cpp
debugscope::plot("speed", speed);
```

Batch API may be:

```cpp
auto frame = scope.frame();
frame("speed", speed);
frame("target", target);
frame("error", error);
frame.send();
```

Avoid overly clever RAII semantics until the simplest API is proven.

---

# 27. Python SDK

Example:

```python
from debugscope import scope

scope("loss", loss)
scope("accuracy", accuracy)
```

Batch:

```python
scope.frame({
    "loss": loss,
    "accuracy": accuracy,
    "learning_rate": lr,
})
```

Use only the standard library for transport.

---

# 28. Producer Failure Semantics

Telemetry errors must not normally crash the application.

Default behavior:

```text
receiver missing     → ignore
send buffer full     → drop
temporary socket err → ignore/drop
oversized frame      → split or drop safely
```

C++ should not throw by default.

Python should not interrupt user code because the visualization receiver is unavailable.

Optional strict/debug diagnostics may be added later.

---

# 29. Non-Blocking Behavior

The producer socket should be non-blocking.

Instrumentation path:

```text
encode
  ↓
sendto
  ↓
return
```

If sending would block:

```text
drop packet
```

No waiting.

---

# 30. No Background Thread by Default

v0.1 SDK should create no mandatory worker thread.

Reasons:

- predictable overhead;
- no shutdown coordination;
- fewer synchronization bugs;
- suitable for numerical/control code;
- easier use inside existing applications.

Buffered asynchronous sending can be an optional future mode if required.

---

# 31. Compile-Out Support

C/C++ instrumentation should be removable at compile time.

Example:

```cpp
#if DEBUGSCOPE_ENABLED
#define DSCOPE(name, value) ...
#else
#define DSCOPE(name, value) ((void)0)
#endif
```

This allows instrumentation to remain in source code without affecting release builds.

---

# 32. Hub Data Model

## Source

```ts
interface Source {
    id: number;
    name?: string;
    pid?: number;

    firstSeen: number;
    lastSeen: number;

    receivedPackets: number;
    missingPackets: number;
}
```

## Channel

```ts
interface Channel {
    sourceId: number;
    key: string;
    valueType: ValueType;

    lastValue: number;
    lastSeen: number;

    buffer: TimeSeriesBuffer;
}
```

---

# 33. Ring Buffers

History must be bounded.

Do not append forever to JavaScript arrays.

Preferred representation:

```ts
class TimeSeriesBuffer {
    timestamps: Float64Array;
    values: Float64Array;

    head: number;
    size: number;
}
```

Each channel keeps a circular buffer.

---

# 34. History Window

Default:

```text
10 seconds
```

Suggested choices:

```text
1 s
5 s
10 s
30 s
60 s
Custom
```

Retention must also obey an absolute sample/memory cap.

---

# 35. Global Memory Limit

Example configuration:

```text
debugscope.maxMemoryMB = 128
```

When exceeded:

```text
drop oldest history
```

Never allow unlimited telemetry to crash the Hub.

---

# 36. High Sample Rates

The Hub may receive substantially faster than the UI can render.

Pipeline:

```text
UDP receive
     ↓
decode
     ↓
ring buffers
     ↓
UI update scheduler
     ↓
WebSocket batch
     ↓
render
```

Recommended UI update target:

```text
30 Hz initially
```

60 Hz may be optional.

---

# 37. UI Downsampling

If a plot is only 1000 pixels wide, sending 100,000 visible samples is wasteful.

Initial safe limits may simply cap rendered points.

Long-term preferred downsampling:

```text
min/max bucket per pixel region
```

This preserves spikes better than naive averaging.

---

# 38. Hub → UI Protocol

WebSocket messages may initially use JSON.

Example:

```json
{
  "type": "samples",
  "sourceId": 123,
  "channel": "speed",
  "samples": [
    [10.01, 120.4],
    [10.02, 121.0],
    [10.03, 119.8]
  ]
}
```

This protocol can later switch to binary frames if profiling proves JSON serialization to be a bottleneck.

Do not optimize this prematurely.

---

# 39. UI Connection Flow

When a frontend connects:

```text
connect WebSocket
      ↓
receive current source/channel snapshot
      ↓
receive recent history
      ↓
subscribe to live deltas
```

This means opening a browser after the program has already been running still shows recent waveform history.

---

# 40. VS Code Bottom Panel (Optional Companion)

The VS Code extension should contribute a DebugScope view to the Panel.

Primary features in v0.1:

- connection status;
- source selector;
- discovered channels;
- channel visibility toggles;
- one waveform area;
- pause;
- clear;
- history window;
- Open in Browser.

Do not overfill the panel.

This scope is intentionally secondary. The first browser release should stand on its own without requiring the extension.

## 40.1 Implemented preview baseline

The repository now contains `apps/vscode`, which contributes a single Webview View to a dedicated Bottom Panel container. It reuses `packages/ui-core` for telemetry state, timeline preparation, and uPlot rendering. The extension attaches to an existing local Hub or starts an owned Hub in the Extension Host, serves the packaged browser workbench from that Hub, and exposes concise source, channel, Pause/Clear, history-window, and Open in Browser controls.

This preview intentionally targets local desktop use. Extension Host automation, Remote SSH/WSL/Dev Container lifecycle semantics, Marketplace metadata, and release signing remain before a public extension release.

---

# 41. Responsive VS Code Layout

The panel must adapt to height and width.

Suggested modes:

```text
height < ~180 px
    ↓
minimal waveform

~180–350 px
    ↓
compact controls + waveform

> ~350 px
    ↓
expanded panel layout
```

When narrow, controls may collapse into menus.

The waveform remains the dominant visual element.

---

# 42. Browser Full UI

The browser version owns the richer analysis experience.

v0.1 may still remain simple, but architecture should allow:

- multiple scopes;
- resizable panes;
- many channels;
- source tree;
- waveform legend;
- zoom/pan;
- pause;
- clear;
- time window;
- cursor readout.

Later:

- XY plot;
- histogram;
- array plot;
- measurements;
- session record/replay.

## 42.0 Implemented panel baseline

The browser now uses a minimal extensible panel model. A workspace may contain up to eight independently rendered Scope panels. Each Scope owns a stable ID, title, and channel-key set; the layout is saved under the producer's stable program identity, so restarting a process does not create or select a new layout.

The current layout is intentionally constrained to a vertical stack. A single Scope fills the available workspace, while multiple Scopes keep a readable minimum height and scroll as needed. The active Scope is visually identified, the sidebar edits only that Scope, and every Scope also exposes a local channel picker. Other widget types, drag/drop placement, resizing, renaming, and arbitrary grids remain later refinements rather than prerequisites for validating the data-binding model.

## 42.1 Product quality bar

Visual quality is a product requirement, not a final polish task.

The browser UI should match dedicated waveform tools such as VOFA+ in the areas that matter:

- waveform-first screen usage;
- high information density;
- clear multi-channel identity;
- immediate live-state feedback;
- efficient zoom, pan, autoscale, and cursor inspection;
- an interface that remains comfortable for hours.

DebugScope should improve on the browser experience through clearer hierarchy, calmer typography, consistent controls, responsive layout, and fewer modal dialogs.

The target character is:

```text
professional instrument
+
modern developer tool
+
quiet, precise visual language
```

Avoid making it look like:

- a generic SaaS analytics dashboard;
- a collection of rounded cards;
- a neon gaming interface;
- a terminal imitation;
- a direct clone of VOFA+ or a hardware oscilloscope bezel.

## 42.2 Default desktop layout

At `1440 × 900` and above, use a stable four-region workbench:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ App bar: project/source, capture state, global actions, status      │
├───────────────┬───────────────────────────────────┬──────────────────┤
│ Source /      │                                   │ Inspector /      │
│ channel tree  │        waveform workspace         │ measurements      │
│               │                                   │ (collapsible)     │
├───────────────┴───────────────────────────────────┴──────────────────┤
│ Status bar: time window, sample rate, packets, memory, connection   │
└──────────────────────────────────────────────────────────────────────┘
```

Recommended dimensions:

- app bar: 48 px;
- source/channel sidebar: 240–280 px, resizable and collapsible;
- inspector: 280–320 px, hidden until needed;
- status bar: 26–30 px;
- waveform workspace: all remaining space, normally at least 70% of the window.

The waveform workspace must remain visually dominant. Side panels use borders and tone changes rather than large gaps or floating-card shadows.

## 42.3 Waveform workspace

Each scope viewport contains:

- a compact title/toolbar row;
- a high-contrast plotting surface;
- subtle major and minor grids;
- Y-axis labels inside or immediately adjacent to the plot;
- a compact live legend with latest values and units;
- an optional overview/range scrubber only when it materially helps navigation.

Default rendering behavior:

- traces are crisp at device pixel ratio and remain legible on high-DPI displays;
- grid lines stay quieter than traces and text;
- selected or hovered channels gain emphasis while others fade slightly;
- missing samples create an honest gap when detectable rather than a misleading interpolated line;
- paused state is obvious through both a status badge and frozen live-tail behavior;
- the right edge keeps a small breathing margin so the newest sample is not glued to the frame.

Support two display modes in the design, even if stacked mode lands after v0.1:

```text
Overlay  — related signals share one Y plot
Stacked  — channels receive aligned individual lanes
```

## 42.4 Core mouse and keyboard interactions

Interaction should feel instrument-like and require little discovery:

| Input | Result |
|---|---|
| wheel / trackpad scroll over plot | zoom time axis around pointer |
| drag plot | pan time axis |
| double-click plot | fit visible data / return to live tail |
| hover | crosshair and nearest sample readout |
| click channel in legend/tree | select and emphasize channel |
| click visibility control | show/hide channel without deleting it |
| `Space` | pause/resume view |
| `F` | fit/autoscale visible data |
| `L` | return to live tail |
| `Esc` | clear transient selection/cursor operation |

Browser-native page scrolling must not fight plot zooming. Keyboard shortcuts must be ignored while focus is in a text field.

The UI should visibly expose the common actions; shortcuts are accelerators, not the only way to operate the product.

## 42.5 Cursors and readouts

Cursor inspection is a first-class browser interaction, not a decorative future extra.

Minimum target:

- one hover crosshair in v0.1;
- two lockable vertical cursors as the next browser analysis feature;
- cursor readout for `t1`, `t2`, `Δt`, per-channel values, and `Δy` for the selected channel;
- snap-to-nearest-sample when useful, with a modifier to inspect freely;
- readouts positioned so they do not obscure the waveform being measured.

## 42.6 Channel tree and legend

The channel browser should support real debugging workloads:

- hierarchical groups derived from dot-separated keys;
- search/filter for channel name;
- color swatch, visibility, live value, and unit in a compact row;
- selected, hidden, stale, and disconnected states that are distinguishable without relying only on color;
- explicit picker or active-scope sidebar action to add a channel to a Scope;
- stable channel colors across reconnects and browser reloads.

Do not auto-enable hundreds of channels. Preserve the suggested first-four behavior and make bulk enable/disable easy.

## 42.7 Visual system

Use design tokens from the first prototype. The initial dark palette should be neutral and low-glare:

```css
--bg-canvas:       #080b10;
--bg-workspace:    #0c1118;
--bg-panel:        #111822;
--bg-elevated:     #17202c;
--border-subtle:   #233041;
--text-primary:    #e7edf5;
--text-secondary:  #93a4b8;
--text-muted:      #617286;
--accent:          #45a3ff;
--live:            #3ddc97;
--warning:         #f3b44e;
--danger:          #ff647c;
```

These are direction-setting tokens, not immutable brand colors. Validate the finished palette on real plots before freezing it.

Trace colors require a separate palette optimized against the plot background. Start with a color-blind-aware sequence and vary line dash/weight or lane placement when color alone is insufficient.

Initial dark-theme trace candidates:

```text
cyan    #4cc9f0
yellow  #f9c74f
pink    #f15bb5
green   #56e39f
orange  #ff8c42
violet  #a78bfa
red     #ff647c
blue    #60a5fa
```

Test adjacent traces, thin lines, selection dimming, and common forms of color-vision deficiency before freezing this sequence.

Typography:

- UI: `Inter`, falling back to the system sans-serif stack;
- numeric values, timestamps, and measurements: `JetBrains Mono`, falling back to the system monospace stack;
- use tabular numerals for changing values;
- default UI text 13–14 px, with smaller labels used sparingly;
- bundle fonts or use reliable fallbacks; the local tool must not depend on a public font CDN.

Geometry:

- 4 px base spacing grid;
- compact control heights of 28–32 px;
- 6–8 px corner radii;
- shadows only for menus, popovers, and true overlays;
- icons use one consistent outlined family and always have accessible labels/tooltips.

## 42.8 Motion and feedback

Motion should explain state, never compete with changing data:

- control transitions: approximately 120–180 ms;
- panel open/close may animate, waveform data does not use decorative easing;
- reconnecting, live, paused, and stale states are always visible in text as well as color;
- avoid pulsing glows around the plotting area;
- honor `prefers-reduced-motion`.

## 42.9 Responsive behavior

Desktop and second-monitor use are primary, but the UI must degrade deliberately:

```text
≥ 1280 px  full sidebar + workspace + optional inspector
900–1279 px collapsible sidebar, inspector becomes a drawer
< 900 px   channel drawer + waveform-first single-column layout
```

Mobile editing is not a v0.1 goal. At small widths, preserve monitoring and cursor readout rather than attempting to expose every configuration control.

## 42.10 Browser visual acceptance criteria

The browser milestone is not complete until all of the following are true:

- no layout shift when live values change width;
- no clipping at `1280 × 720`, `1440 × 900`, and `1920 × 1080`;
- dark and light themes meet WCAG AA contrast for normal text and interactive chrome;
- 4, 10, and 50-channel demo states remain understandable;
- empty, connecting, live, paused, stale, disconnected, and error states are intentionally designed;
- keyboard focus is visible and essential actions are usable without a mouse;
- the plot remains smooth while side panels are opened, resized, or filtered;
- screenshots at the three reference sizes pass a human visual review before release;
- a first-time user can identify source, active channels, live status, latest values, time window, and pause control within ten seconds.

---

# 43. Shared UI Core

Do not build separate VS Code and Browser plotting implementations.

Recommended frontend architecture:

```text
packages/ui-core
    │
    ├── Plot
    ├── Channel model
    ├── Legend
    ├── formatting
    ├── WebSocket client
    ├── zoom/pan
    ├── downsampling
    └── theme abstraction
```

Then:

```text
VS Code Panel
   ↓
Compact layout shell

Browser
   ↓
Full layout shell
```

Shared core, different composition.

The initial shared core is now implemented in `packages/ui-core`. Browser-specific workbench composition remains in `apps/browser`; the compact VS Code composition remains in `apps/vscode/webview`.

---

# 44. Theming

## VS Code

Use VS Code theme tokens where possible:

```text
--vscode-*
```

The extension should visually belong inside VS Code.

## Browser

Use the same design language with complete light and dark themes. Light is the browser default; the user's explicit theme choice is remembered locally.

Waveform colors should be assigned consistently by channel identity.

Theme tokens must cover plot background, grids, axes, crosshair, selections, trace colors, focus rings, status colors, and ordinary application chrome. A theme is incomplete if only the surrounding controls change color.

---

# 45. Open in Browser

The VS Code Panel toolbar should contain:

```text
Open in Browser
```

which opens:

```text
http://127.0.0.1:<hub-http-port>
```

No extra process should be needed if the Hub is already active.

---

# 46. Browser Access Scope

Default server bind:

```text
127.0.0.1
```

not:

```text
0.0.0.0
```

The initial product is local-only.

Remote/LAN access should require explicit opt-in later.

---

# 47. Security

All incoming UDP data is untrusted.

Validate:

- magic;
- version;
- message type;
- payload length;
- key length;
- UTF-8;
- numeric payload size;
- datagram maximum size.

Malformed packets:

```text
drop
```

Never allow sender-controlled lengths to trigger unbounded allocation.

---

# 48. Source Lifetime

If a source stops sending for several seconds:

```text
active → inactive
```

Keep:

- source metadata;
- channels;
- recent history.

Do not immediately delete anything.

---

# 49. Process Restart

A restarted producer generates a new random transport `source_id`, but the Hub uses the explicit HELLO `source_name` as its stable logical program key.

When a later run uses the same source name:

```text
new transport source_id
new PID
same source name
```

the Hub merges it into the existing program entry and preserves the program's channels and recent history. PID is metadata, not identity. Users choose distinct source names when concurrent instances must remain separate, and may explicitly delete stopped program entries from the UI.

---

# 50. Pause Semantics

Default Pause means:

```text
Hub continues receiving
Hub continues buffering
UI stops following live tail
```

This allows inspection without losing incoming data.

A future "Freeze Capture" mode may stop retaining new samples, but is not needed in v0.1.

---

# 51. Clear Semantics

Clear:

```text
remove waveform history
```

but keep:

```text
sources
channels
channel visibility state
```

Avoid making users rediscover channels after every Clear.

---

# 52. Channel Discovery

New keys are discovered automatically.

Example:

```text
motor.speed
motor.error
motor.current
```

The UI can group by prefix.

If only a few channels appear, enable the first few automatically.

If hundreds appear, do not enable all of them.

Suggested default:

```text
auto-enable first 4 channels
```

---

# 53. Repository Structure

Recommended monorepo:

```text
debugscope/
│
├── README.md
├── PLAN.md
├── LICENSE
├── CHANGELOG.md
│
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── sdk-design.md
│   └── screenshots/
│
├── packages/
│   ├── protocol/
│   │   ├── src/
│   │   └── test-vectors/
│   │
│   ├── hub/
│   │   ├── src/
│   │   │   ├── udp/
│   │   │   ├── protocol/
│   │   │   ├── source/
│   │   │   ├── channel/
│   │   │   ├── buffer/
│   │   │   ├── websocket/
│   │   │   └── http/
│   │   └── test/
│   │
│   ├── ui-core/
│   │   ├── src/
│   │   │   ├── plot/
│   │   │   ├── channels/
│   │   │   ├── client/
│   │   │   ├── formatting/
│   │   │   └── state/
│   │   └── test/
│   │
│   └── web-client/
│       └── src/
│
├── apps/
│   ├── vscode/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── extension.ts
│   │   │   ├── hubManager.ts
│   │   │   └── scopeViewProvider.ts
│   │   └── webview/
│   │
│   └── browser/
│       └── src/
│
├── sdk/
│   ├── c/
│   │   ├── debugscope.h
│   │   ├── debugscope.c
│   │   └── example.c
│   │
│   ├── cpp/
│   │   ├── debugscope.hpp
│   │   └── example.cpp
│   │
│   └── python/
│       ├── pyproject.toml
│       ├── debugscope/
│       └── examples/
│
├── examples/
│   ├── sine-c/
│   ├── sine-cpp/
│   ├── sine-python/
│   └── control-loop/
│
└── tools/
    ├── packet-generator/
    └── benchmark/
```

---

# 54. Technology Choices

Suggested first implementation:

## Hub

```text
Node.js / TypeScript
```

Reasons:

- shared language with VS Code extension;
- built-in UDP support;
- built-in HTTP support;
- easy WebSocket ecosystem;
- simple packaging during early development.

The Hub may later be rewritten as a native binary only if measurements justify it.

---

## VS Code

```text
TypeScript
Webview View
Bottom Panel
```

---

## Browser

Recommended initial stack:

```text
TypeScript
React
uPlot
CSS custom properties
small accessible headless primitives where needed
one consistent SVG icon set
```

React owns composition and state; uPlot owns the hot waveform rendering path. UI components must not cause the plot to re-render on every live value update.

Do not introduce a large UI framework solely for the scope canvas.

---

## Plotting

Initial recommendation:

```text
uPlot
```

Reasons:

- lightweight;
- designed for time-series;
- Canvas based;
- good performance.

A custom renderer can be considered later if necessary.

---

# 55. Protocol Test Vectors

Freeze binary test packets early.

Examples:

```text
hello.bin
sample_bool.bin
sample_i32.bin
sample_f32.bin
sample_f64.bin
frame_3_channels.bin
bad_magic.bin
bad_version.bin
truncated.bin
bad_length.bin
unknown_type.bin
```

All protocol implementations must agree on these exact bytes.

---

# 56. Example Programs

Provide immediately runnable examples.

## C

```text
sin
cos
```

## C++

```text
target
response
error
```

## Python

```text
loss
accuracy
```

The user should be able to clone the repo and see a waveform within minutes.

---

# 57. Logging

Hub and VS Code should expose concise logs.

Example:

```text
DebugScope Hub started
UDP listening on 127.0.0.1:4711
HTTP listening on 127.0.0.1:4712
Source discovered: simulation
Channel discovered: speed
Malformed packet dropped
```

Do not log every sample.

---

# 58. Configuration

Keep v0.1 configuration small.

Suggested:

```text
udpPort
httpPort
historySeconds
maxMemoryMB
uiUpdateHz
autoEnableChannels
```

VS Code settings may mirror Hub defaults.

---

# 59. Performance Targets

These are engineering goals, not hard guarantees.

Initial target:

```text
10–50 channels
~1 kHz/channel typical
10k–50k total samples/s
30 Hz UI updates
```

DebugScope should remain responsive in this range.

Higher rates should degrade by dropping/downsampling, not by blocking the target application.

---

# 60. Benchmark Scenarios

At minimum:

```text
1 channel × 1 kHz
10 channels × 1 kHz
50 channels × 1 kHz
10 channels × 10 kHz
```

Measure:

- producer CPU;
- producer call overhead;
- Hub CPU;
- Hub memory;
- UDP loss;
- WebSocket traffic;
- browser CPU;
- VS Code Extension Host CPU;
- plot FPS.

Only optimize after these measurements exist.

---

# 61. MVP Development Order

## Milestone 0 — Vertical Slice

Build the visual shell and data path together:

```text
deterministic demo data → polished browser workbench shell
Python sine generator → UDP → Hub → WebSocket → same waveform view
```

The demo-data mode allows the complete UI, empty states, pause state, and dense multi-channel state to be designed without waiting for live producers.

Before feature work spreads across many components, review a high-fidelity interactive shell using 4-, 10-, and 50-channel demo scenarios. Treat that review as a real implementation checkpoint, not a disposable marketing mockup.

Success criterion:

```text
stable waveform for several minutes
+
credible full-screen UI at 1440 × 900
```

---

## Milestone 1 — Protocol v1

Implement:

- DSCP header;
- HELLO;
- SAMPLE;
- FRAME;
- source ID;
- sequence;
- monotonic timestamp;
- parser validation;
- test vectors.

---

## Milestone 2 — Hub Core

Implement:

- UDP receiver;
- protocol decoder;
- source registry;
- channel registry;
- ring buffer;
- retention;
- memory cap;
- snapshot API;
- WebSocket deltas.

---

## Milestone 3 — Browser UI

Implement:

- source list;
- channel list;
- waveform;
- enable/disable channels;
- pause;
- clear;
- history window;
- live reconnect.

Also complete the browser visual system and quality baseline:

- final workbench layout;
- dark and light theme tokens;
- designed empty/live/paused/disconnected states;
- hover crosshair and latest-value legend;
- responsive side panels;
- keyboard focus and core shortcuts;
- reference-size screenshot review;

---

## Milestone 4 — VS Code Panel (Optional / Non-blocking)

**Status:** initial local-development preview implemented; extension-host hardening and public packaging remain.

Implement:

- Bottom Panel view;
- Hub discovery/start;
- WebSocket client;
- compact waveform;
- channel toggles;
- Pause/Clear;
- Open in Browser.

This milestone may move after v0.1. It must reuse the Hub and UI core and must not delay the browser quality gate.

---

## Milestone 5 — SDKs

Implement:

- C;
- C++;
- Python;
- Rust;
- MATLAB;
- examples;
- compile-out;
- non-blocking behavior.

---

## Milestone 6 — Performance / Hardening

Implement as required:

- batching;
- WebSocket delta batching;
- typed arrays;
- downsampling;
- memory limit enforcement;
- malformed-input testing;
- better packet-loss stats.

---

## Milestone 7 — v0.1 Release

Add:

- README;
- screenshots/GIF;
- Marketplace package, only if the VS Code companion ships;
- Python package metadata;
- C/C++ integration docs;
- protocol documentation;
- CI;
- changelog;
- license.

---

# 62. v0.1 Definition of Done

## Producer

- [x] C SDK works
- [x] C++ SDK works
- [x] Python SDK works
- [x] Rust SDK implementation and compatibility fixture
- [x] MATLAB SDK implementation and integration documentation
- [ ] automated MATLAB runtime coverage
- [x] no third-party transport dependency
- [x] receiver absence does not break application
- [x] scalar values
- [x] batch/frame values
- [x] non-blocking sending
- [x] source identity
- [x] sequence numbers
- [x] monotonic timestamps

## Hub

- [x] UDP listener
- [x] robust protocol decoder
- [x] source discovery
- [x] channel discovery
- [ ] ring buffers
- [x] memory cap
- [x] recent-history snapshot
- [x] WebSocket live updates
- [x] Browser static server
- [x] malformed packets cannot crash Hub

## VS Code (optional v0.1 stretch goal)

- [ ] DebugScope Bottom Panel
- [ ] compact waveform
- [ ] channel selector
- [ ] source selector
- [ ] pause
- [ ] clear
- [ ] history window
- [ ] Open in Browser
- [ ] automatic Hub connection/start

These items do not block the browser-first v0.1 release.

## Browser

- [x] full-width waveform
- [x] source/channel UI
- [x] polished waveform-first workbench layout
- [x] coherent dark and light themes
- [x] stable channel colors and legible dense states
- [x] hover crosshair and live value readout
- [x] pause
- [x] clear
- [x] history window
- [x] sample-time and real-time idle-gap behavior
- [x] per-channel color, curve, stroke pattern, and width controls
- [x] Auto Y toggle and manual Y zoom
- [x] persistent settings panel
- [x] stable program identity and manual source deletion
- [x] reconnect to existing Hub
- [x] intentional empty/connecting/live/paused/stale/error states
- [x] responsive layouts at reference desktop sizes
- [x] visual and interaction quality gate completed

---

# 63. CI

Recommended initial matrix:

## TypeScript

- lint
- typecheck
- unit tests
- build
- browser smoke test
- reference-viewport screenshot test for unintended visual regressions

## C

- Windows MSVC
- Ubuntu GCC
- Ubuntu Clang
- macOS Clang

## C++

same compiler matrix.

## Python

```text
Python 3.10+
```

Test at least several currently supported versions.

---

# 64. Future v0.2

Likely additions:

- resizable/reorderable Scope panels and saved grid layouts;
- improved channel grouping;
- explicit numeric Y-range controls;
- channel rename/alias;
- two-cursor delta measurements;
- CSV export.

---

# 65. Future v0.3

Candidate visualizations:

## XY Plot

```text
x
y
```

Useful for:

- trajectory;
- phase portrait;
- controller analysis.

## Histogram

Useful for:

- latency;
- distributions.

## Array Plot

Example:

```text
float buffer[1024]
```

Visualized as a spatial array rather than time series.

---

# 66. Record / Replay

A strong later feature:

```text
Hub
  ↓
Record session
  ↓
capture.dscope
```

Then:

```text
Open Capture
    ↓
Browser / VS Code
    ↓
replay waveform
```

This is a better use of file storage than polling a live file.

---

# 67. Protocol v2 Possibilities

Only after profiling demonstrates a need:

```text
DEFINE channel
channel_id
compressed sample packets
```

For example:

```text
DEFINE 17 = motor.speed
SAMPLE 17 123.4
```

But v2 must solve definition loss/re-sync correctly.

Do not add this complexity to v1.

---

# 68. Shared Memory

Possible future high-performance transport:

```text
Application
    ↓
Shared Ring Buffer
    ↓
Hub
```

Useful only if UDP becomes measurably insufficient.

Potential complexity:

- Windows/POSIX differences;
- atomics;
- wraparound;
- memory ordering;
- crashes;
- lifecycle;
- native integration.

Not v0.1.

---

# 69. ZeroMQ

Could be an optional future producer transport, but should not be required.

Main reason:

```text
dependency friction
```

DebugScope's adoption advantage should remain:

> add one tiny SDK and start plotting.

---

# 70. Final Architecture Decisions

The following decisions should be considered frozen unless real implementation evidence disproves them.

### 1. Explicit instrumentation

```text
scope("x", x)
```

not debugger variable inspection.

### 2. UDP producer transport

```text
Application → localhost UDP → Hub
```

### 3. One UDP owner

Only the Hub listens to producer packets.

### 4. Independent Hub

The Hub is not owned conceptually by VS Code.

### 5. Browser and VS Code use the same Hub

User instrumentation never changes.

### 6. VS Code default UI is Bottom Panel when shipped

No Editor Tab scope.

### 7. No DebugScope floating-window feature

Browser is the full unrestricted visualization surface.

### 8. Browser is the primary frontend

Not a fallback. It is the v0.1 release surface and owns the highest visual and interaction quality bar.

### 9. Hub owns history

Frontends receive snapshots + live updates.

### 10. Producer SDK stays tiny and non-blocking

No mandatory dependencies or worker thread.

### 11. v1 UDP packets are self-describing

Do not optimize repeated keys prematurely.

### 12. Sampling and rendering are decoupled

High-rate telemetry must not imply high-rate UI redraw.

---

# 71. Recommended First Week

Do not start by implementing every SDK.

Build the complete vertical slice first:

```text
Day 1
TypeScript workspace / Hub skeleton / browser design tokens

Day 2
Python UDP sine sender
+
DSCP SAMPLE packet

Day 3
Hub decoder + WebSocket
+
Browser plot with deterministic demo-data mode

Day 4
Ring buffer + recent-history snapshot

Day 5
Browser workbench shell + source/channel tree + live states

Day 6
multiple channels + Pause/Clear + zoom/pan/crosshair

Day 7
visual review at reference viewport sizes
+
freeze protocol v1 draft
```

At the end of the first week, the critical proof should exist:

```text
scope("sin", sin(t))
        ↓
one UDP protocol
        ↓
one Hub
        ↓
polished Browser UI
```

The VS Code companion can be validated after this browser-first vertical slice is pleasant and stable.

If this feels responsive and pleasant, the architecture is validated.

---

# 72. Product Rule

Whenever a new feature is proposed, ask:

> Does this make it easier to turn a program value into a useful live waveform?

If not, it probably does not belong in the early DebugScope roadmap.

The project should remain centered on one promise:

> **Add one line of code and see the value move.**
