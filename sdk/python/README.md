# DebugScope Python SDK

Install the local package:

```bash
python -m pip install ./sdk/python
```

Send scalar values:

```python
from debugscope import Scope

scope = Scope("training")

scope("loss", loss)
scope("accuracy", accuracy)
```

Send related values with one timestamp:

```python
scope.frame({
    "target": target,
    "speed": speed,
    "error": target - speed,
})
```

Every producer has an explicit, required name. Constructing it does not start a
thread; its UDP socket opens lazily on the first send.

Explicit typed methods are available when the wire type matters:

```python
scope.f32("temperature", temperature)
scope.i32("state", state)
scope.u64("ticks", ticks)
```

Change the optional endpoint in code when the Hub is not local:

```python
from debugscope import Scope

scope = Scope("training", host="127.0.0.1", port=4711)
```

The `Scope` name is the stable program identity used by the Hub. Repeated runs
with the same name reuse one program entry; use different names for simultaneous
instances that should remain separate. Empty or omitted names are rejected.

Transport and encoding failures return `False` or zero; they do not interrupt the instrumented application.
