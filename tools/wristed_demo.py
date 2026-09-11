"""Run with PYTHONPATH=sdk/python python3 tools/wristed_demo.py (Ctrl-C to stop)."""
import math
import time

from debugscope import Scope

scope = Scope("wristed-instrument")
started = time.monotonic()
try:
    while True:
        t = time.monotonic() - started
        psi = [160 + 10 * math.sin(t * 0.3), 0.3 * math.sin(t * 0.25),
               0.8 + 0.35 * math.sin(t * 0.7), 0.5 * math.sin(t * 0.4),
               0.5 * math.sin(t), 0.4 * math.cos(t * 0.8)]
        scope.frame({"instrument": dict(zip(
            ("l", "phi", "theta1", "delta1", "beta1", "beta2", "alpha"),
            [*psi, 0.5 + 0.4 * math.sin(t * 1.3)],
        ))})
        time.sleep(1 / 60)
except KeyboardInterrupt:
    pass
finally:
    scope.close()
