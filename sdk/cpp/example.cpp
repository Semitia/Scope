#include <debugscope.hpp>

#include <chrono>
#include <cmath>
#include <iostream>
#include <thread>
#include <array>

int main()
{
    debugscope::Scope scope("cpp-example");
    double response = 0.0;

    for (int step = 0; step < 500; ++step) {
        const double time = step * 0.02;
        const double target = 1000.0 + 250.0 * std::sin(time * 1.3);
        response += (target - response) * 0.08;

        auto frame = scope.frame();
        frame("motor.target", target);
        frame("motor.speed", response);
        frame("motor.error", target - response);
        frame("motor.state", std::array<double, 2>{response, target - response});
        frame.send();

        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }

    std::cout << "C++ example finished\n";
}
