#include <debugscope.hpp>

int main()
{
    debugscope::Scope controller("cpp-controller");
    debugscope::Scope estimator("cpp-estimator");

    controller("speed", 120.0f);
    estimator("estimate", 119.5f);
}
