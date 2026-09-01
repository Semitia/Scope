#include <debugscope.hpp>

int main()
{
    debugscope::Scope scope("cpp-smoke");
    scope("enabled", true);
    scope("iterations", 43);
    scope("speed", 124.5f);

    auto frame = scope.frame();
    frame("target", 151.25);
    frame("ticks", 9000000000ull);
    frame.send();
    debugscope::Scope::shutdown();
}
