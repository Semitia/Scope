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

Lists, tuples, nested mappings, dataclasses, named tuples, generators, complex
numbers, and array/tensor objects with `tolist()` or `to_list()` are expanded
into dot-separated scalar channels automatically:

```python
scope.frame({
    "error.distance": err_dist,
    "psi": psi_array,          # NumPy/PyTorch vector -> psi.0 ...
    "limit": limit_status,     # list[bool]
    "matrix": matrix,          # -> matrix.0.0 ...
})

# A single container is also sent as one frame.
scope("psi", psi_array)
```

NumPy is optional; DebugScope does not add it as a dependency. NumPy scalar
signedness and `float32`/`float64` precision are retained on the wire. Expanded
values all share the frame timestamp.

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
