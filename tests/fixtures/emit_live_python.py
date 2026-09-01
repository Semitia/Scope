import math
import time

from debugscope import Scope


scope = Scope("live-python")
started = time.monotonic()

for index in range(120):
    elapsed = time.monotonic() - started
    target = 1200.0 + 180.0 * math.sin(elapsed * 3.2)
    speed = target - 75.0 * math.sin(elapsed * 5.4 + 0.7)
    scope.frame(
        {
            "controller.target": target,
            "controller.speed": speed,
            "controller.error": target - speed,
            "power.current": 4.2 + 0.8 * math.sin(elapsed * 4.1),
        }
    )
    time.sleep(0.01)

scope.close()
