import math
import time

from debugscope import Scope

scope = Scope("python-example")

response = 0.0

for step in range(500):
    current_time = step * 0.02
    target = 1000.0 + 250.0 * math.sin(current_time * 1.3)
    response += (target - response) * 0.08

    scope.frame(
        {
            "motor.target": target,
            "motor.speed": response,
            "motor.error": target - response,
        }
    )
    time.sleep(0.02)

print("Python example finished")
