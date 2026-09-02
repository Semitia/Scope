#include <debugscope.hpp>

#include <array>
#include <complex>
#include <map>
#include <vector>

struct TestMatrix {
    std::size_t rows() const { return 2; }
    std::size_t cols() const { return 2; }
    float operator()(std::size_t row, std::size_t col) const
    {
        return data[row][col];
    }
    float data[2][2]{{1.0f, 2.0f}, {3.0f, 4.0f}};
};

struct TestVector {
    std::size_t rows() const { return 3; }
    std::size_t cols() const { return 1; }
    float operator()(std::size_t row, std::size_t) const { return data[row]; }
    float data[3]{1.0f, 2.0f, 3.0f};
};

int main()
{
    debugscope::Scope scope("cpp-smoke");
    scope("enabled", true);
    scope("iterations", 43);
    scope("speed", 124.5f);
    scope("direct", std::array<int, 2>{7, 8});

    auto frame = scope.frame();
    frame("target", 151.25);
    frame("ticks", 9000000000ull);
    frame("psi", TestVector{});
    frame("limits", std::vector<bool>{true, false});
    frame("matrix", TestMatrix{});
    frame("impedance", std::complex<double>{4.0, -2.0});
    frame("point", std::map<std::string, float>{{"x", 5.0f}, {"y", 6.0f}});
    frame.send();
    scope.close();
}
