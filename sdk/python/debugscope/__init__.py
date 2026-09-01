from .scope import Scope

__all__ = ["Scope", "scope"]
__version__ = "0.1.0"

# Process-wide convenience instance. The socket remains unopened until the
# first value is emitted.
scope = Scope()
