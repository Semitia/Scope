# DebugScope Python SDK

Install the local package:

```bash
python -m pip install ./sdk/python
```

Send scalar values:

```python
from debugscope import scope

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

The convenience instance opens its socket lazily. Importing the package does not start a thread or open a connection.

Explicit typed methods are available when the wire type matters:

```python
scope.f32("temperature", temperature)
scope.i32("state", state)
scope.u64("ticks", ticks)
```

Create an isolated producer or change the endpoint in code:

```python
from debugscope import Scope

scope = Scope("training", host="127.0.0.1", port=4711)
```

An explicit `Scope` name is the stable program identity used by the Hub. Repeated runs with the same name reuse one program entry; use different names for simultaneous instances that should remain separate. The process-wide convenience instance defaults to the Python entry-point filename.

Transport and encoding failures return `False` or zero; they do not interrupt the instrumented application.
