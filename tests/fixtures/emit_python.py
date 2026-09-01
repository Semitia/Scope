from debugscope import Scope


scope = Scope("python-smoke")
scope("enabled", True)
scope("iterations", 44)
scope.f32("speed", 125.5)
scope.frame({"target": 152.25, "error": -29})
scope.close()
