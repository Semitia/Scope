# Drag diagnostics

Enable recording by adding `dragDebug=1` to the browser URL (for example,
`http://127.0.0.1:4712/?demo=1&dragDebug=1`). Alternatively, run this in DevTools
Console; it takes effect on the next drag without reloading:

```js
localStorage.setItem('debugscope.drag-debug', '1')
```

Reproduce the stutter, release the mouse, then look for `[drag-debug] summary`
in the Console. Export the detailed recording with Chrome/Edge DevTools:

```js
copy(JSON.stringify(window.debugscopeDragTraces, null, 2))
```

The recording includes the last five interactions, with at most 2,000 samples
per interaction. Older samples are discarded in batches; `droppedSamples`
reports the count. Samples contain panel IDs, layout geometry, pointer positions,
and timing, with no telemetry values. Everything stays in the page's memory and
is lost on reload. Recording is off by default; it does not print every frame.

- `pointer`: coordinates, event delivery delay (`inputDelayMs`), and whether an
  animation frame was already queued. Queued events are normally coalesced.
- `placement`: pointer offset, resolved layout, current/previous edge locks,
  displaced panel IDs, calculation time, and whether release-time grid snapping
  was requested (`gridSnap`). Grid coordinates use 12 columns and 84px rows;
  horizontal pixels per column equal `workspaceWidth / 12`.
- `preview`: submitted layout and neighbor positions; `pointerAgeMs` measures
  time since the last pointer handler ran.
- `render`: actual viewport rectangle, grid position, scroll offsets, and time
  from the first pending preview to React's layout effect (`renderDelayMs`).
  This measures DOM commit and geometry inspection, not GPU presentation.
- `reflow-topology` / `reflow-accepted`: changes to proposed displacement and
  when the delayed neighbor preview was applied.
- `frame-gap`: animation frame intervals over 34ms, including page visibility.
  Long gaps may also occur when the page is backgrounded.
- `long-task`: main-thread tasks over the browser's long-task threshold, when
  supported. These are correlation evidence, not attribution to a component.
- `finish`: summary and completion reason. `effect-cleanup` during a gesture
  can indicate the interaction effect restarted; `cancel` covers Escape and
  pointer cancellation. Release-time updates may finish before a render sample.

If the pointer moves but the resolved layout stays fixed, inspect `edgeLocks`
and workspace bounds. If layout positions advance but frame gaps, input delay,
or render delay spike, investigate main-thread/rendering work. Instrumentation
itself adds some overhead, especially geometry inspection; compare with it off.

To disable recording, remove `dragDebug=1` from the URL and run:

```js
localStorage.removeItem('debugscope.drag-debug')
```

The setting applies to subsequent interactions. Reloading clears saved traces.
