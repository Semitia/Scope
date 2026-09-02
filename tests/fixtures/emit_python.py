from debugscope import Scope

from dataclasses import dataclass


@dataclass
class Point:
    x: float
    y: float


scope = Scope("python-smoke")
scope("enabled", True)
scope("iterations", 44)
scope.f32("speed", 125.5)
scope("direct", [7, 8])
scope.frame(
    {
        "target": 152.25,
        "error": -29,
        "psi": [1.0, 2.0, 3.0],
        "limits": (True, False),
        "matrix": [[1, 2], [3, 4]],
        "point": Point(5.0, 6.0),
        "impedance": complex(4.0, -2.0),
    }
)
scope.close()
