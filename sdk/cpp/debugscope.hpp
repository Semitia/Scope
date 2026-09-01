#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <type_traits>

namespace debugscope {

namespace detail {
template <typename Sink, typename T>
bool send_numeric(Sink &sink, const char *key, T value);
}

struct ScopeOptions {
    std::optional<std::string> host;
    std::optional<std::uint16_t> port;
    bool enabled = true;
};

class Frame;

class Scope {
public:
    explicit Scope(std::string source_name, ScopeOptions options = {});
    Scope(std::string source_name, 
          std::string host, 
          std::uint16_t port = 4711,
          bool enabled = true);
    ~Scope();

    Scope(const Scope &) = delete;
    Scope &operator=(const Scope &) = delete;
    Scope(Scope &&) = delete;
    Scope &operator=(Scope &&) = delete;

    template <typename T>
    bool operator()(const char *key, T value)
    {
        return detail::send_numeric(*this, key, value);
    }

    bool boolean(const char *key, bool value);
    bool i32(const char *key, std::int32_t value);
    bool u32(const char *key, std::uint32_t value);
    bool i64(const char *key, std::int64_t value);
    bool u64(const char *key, std::uint64_t value);
    bool f32(const char *key, float value);
    bool f64(const char *key, double value);

    [[nodiscard]] Frame frame();
    void close();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;

    friend class Frame;
};

class Frame {
public:
    ~Frame();

    Frame(const Frame &) = delete;
    Frame &operator=(const Frame &) = delete;
    Frame(Frame &&) noexcept;
    Frame &operator=(Frame &&) noexcept;

    template <typename T>
    bool operator()(const char *key, T value)
    {
        return detail::send_numeric(*this, key, value);
    }

    bool boolean(const char *key, bool value);
    bool i32(const char *key, std::int32_t value);
    bool u32(const char *key, std::uint32_t value);
    bool i64(const char *key, std::int64_t value);
    bool u64(const char *key, std::uint64_t value);
    bool f32(const char *key, float value);
    bool f64(const char *key, double value);

    std::size_t send();

private:
    struct Impl;
    explicit Frame(Scope &scope);
    std::unique_ptr<Impl> impl_;

    friend class Scope;
};

namespace detail {

template <typename Sink, typename T>
bool send_numeric(Sink &sink, const char *key, T value)
{
    using value_t = typename std::decay<T>::type;
    static_assert(std::is_arithmetic<value_t>::value,
                  "DebugScope values must be numeric or bool");

    if constexpr (std::is_same<value_t, bool>::value) {
        return sink.boolean(key, value);
    } else if constexpr (std::is_floating_point<value_t>::value) {
        if constexpr (sizeof(value_t) <= sizeof(float)) {
            return sink.f32(key, static_cast<float>(value));
        }
        return sink.f64(key, static_cast<double>(value));
    } else if constexpr (std::is_signed<value_t>::value) {
        if constexpr (sizeof(value_t) <= sizeof(std::int32_t)) {
            return sink.i32(key, static_cast<std::int32_t>(value));
        }
        return sink.i64(key, static_cast<std::int64_t>(value));
    } else {
        if constexpr (sizeof(value_t) <= sizeof(std::uint32_t)) {
            return sink.u32(key, static_cast<std::uint32_t>(value));
        }
        return sink.u64(key, static_cast<std::uint64_t>(value));
    }
}

} // namespace detail

} // namespace debugscope
