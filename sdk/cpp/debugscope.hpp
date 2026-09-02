#pragma once

#include <cstddef>
#include <cstdint>
#include <complex>
#include <iterator>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <utility>

namespace debugscope {

namespace detail {
template <typename Sink, typename T>
bool send_value(Sink &sink, const char *key, const T &value);
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
    bool operator()(const char *key, const T &value);

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
    bool operator()(const char *key, const T &value);

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

template <typename...>
struct always_false : std::false_type {};

template <typename T>
struct is_complex : std::false_type {};

template <typename T>
struct is_complex<std::complex<T>> : std::true_type {};

template <typename T, typename = void>
struct is_tuple_like : std::false_type {};

template <typename T>
struct is_tuple_like<T, std::void_t<decltype(std::tuple_size<T>::value)>> : std::true_type {};

template <typename T, typename = void>
struct is_matrix_like : std::false_type {};

template <typename T>
struct is_matrix_like<T, std::void_t<
    decltype(std::declval<const T &>().rows()),
    decltype(std::declval<const T &>().cols()),
    decltype(std::declval<const T &>()(std::size_t{}, std::size_t{}))>> : std::true_type {};

template <typename T, typename = void>
struct is_range : std::false_type {};

template <typename T>
struct is_range<T, std::void_t<
    decltype(std::begin(std::declval<const T &>())),
    decltype(std::end(std::declval<const T &>()))>> : std::true_type {};

template <typename T, typename = void>
struct has_bool_value_type : std::false_type {};

template <typename T>
struct has_bool_value_type<T, std::void_t<typename T::value_type>>
    : std::is_same<typename T::value_type, bool> {};

template <typename T, typename = void>
struct is_mapping : std::false_type {};

template <typename T>
struct is_mapping<T, std::void_t<typename T::key_type, typename T::mapped_type>>
    : std::true_type {};

inline std::string indexed_key(const char *key, std::size_t index)
{
    if (key == nullptr) return {};
    return std::string(key) + "." + std::to_string(index);
}

template <typename Key>
std::string mapped_key(const char *key, const Key &component)
{
    using key_t = typename std::decay<Key>::type;
    std::string suffix;
    if constexpr (std::is_convertible<key_t, std::string_view>::value) {
        suffix = std::string(std::string_view(component));
    } else if constexpr (std::is_enum<key_t>::value) {
        suffix = std::to_string(static_cast<typename std::underlying_type<key_t>::type>(component));
    } else if constexpr (std::is_arithmetic<key_t>::value) {
        suffix = std::to_string(component);
    } else {
        static_assert(always_false<key_t>::value,
                      "DebugScope mapping keys must be strings, numbers, or enums");
    }
    return std::string(key == nullptr ? "" : key) + "." + suffix;
}

template <typename Sink, typename Tuple, std::size_t... Indices>
bool send_tuple(Sink &sink, const char *key, const Tuple &value,
                std::index_sequence<Indices...>)
{
    bool any = false;
    bool result = true;
    const auto send_one = [&](auto index, const auto &item) {
        const auto child_key = indexed_key(key, index);
        any = true;
        result = send_value(sink, child_key.c_str(), item) && result;
    };
    (send_one(Indices, std::get<Indices>(value)), ...);
    return any && result;
}

template <typename Sink, typename T>
bool send_value(Sink &sink, const char *key, const T &value)
{
    using value_t = typename std::decay<T>::type;

    if constexpr (std::is_same<value_t, bool>::value) {
        return sink.boolean(key, value);
    } else if constexpr (std::is_enum<value_t>::value) {
        using underlying_t = typename std::underlying_type<value_t>::type;
        return send_value(sink, key, static_cast<underlying_t>(value));
    } else if constexpr (std::is_floating_point<value_t>::value) {
        if constexpr (sizeof(value_t) <= sizeof(float)) {
            return sink.f32(key, static_cast<float>(value));
        }
        return sink.f64(key, static_cast<double>(value));
    } else if constexpr (std::is_integral<value_t>::value && std::is_signed<value_t>::value) {
        if constexpr (sizeof(value_t) <= sizeof(std::int32_t)) {
            return sink.i32(key, static_cast<std::int32_t>(value));
        }
        return sink.i64(key, static_cast<std::int64_t>(value));
    } else if constexpr (std::is_integral<value_t>::value) {
        if constexpr (sizeof(value_t) <= sizeof(std::uint32_t)) {
            return sink.u32(key, static_cast<std::uint32_t>(value));
        }
        return sink.u64(key, static_cast<std::uint64_t>(value));
    } else if constexpr (is_complex<value_t>::value) {
        const auto real_key = std::string(key == nullptr ? "" : key) + ".real";
        const auto imag_key = std::string(key == nullptr ? "" : key) + ".imag";
        return send_value(sink, real_key.c_str(), value.real())
            && send_value(sink, imag_key.c_str(), value.imag());
    } else if constexpr (is_matrix_like<value_t>::value) {
        const auto rows = static_cast<std::size_t>(value.rows());
        const auto cols = static_cast<std::size_t>(value.cols());
        if (rows == 0 || cols == 0) return false;

        bool result = true;
        if (rows == 1 || cols == 1) {
            const auto size = rows == 1 ? cols : rows;
            for (std::size_t index = 0; index < size; ++index) {
                const auto child_key = indexed_key(key, index);
                result = send_value(sink, child_key.c_str(),
                                    rows == 1 ? value(0, index) : value(index, 0)) && result;
            }
        } else {
            for (std::size_t row = 0; row < rows; ++row) {
                const auto row_key = indexed_key(key, row);
                for (std::size_t col = 0; col < cols; ++col) {
                    const auto child_key = indexed_key(row_key.c_str(), col);
                    result = send_value(sink, child_key.c_str(), value(row, col)) && result;
                }
            }
        }
        return result;
    } else if constexpr (is_mapping<value_t>::value) {
        bool any = false;
        bool result = true;
        for (const auto &item : value) {
            const auto child_key = mapped_key(key, item.first);
            any = true;
            result = send_value(sink, child_key.c_str(), item.second) && result;
        }
        return any && result;
    } else if constexpr (is_tuple_like<value_t>::value) {
        return send_tuple(sink, key, value,
                          std::make_index_sequence<std::tuple_size<value_t>::value>{});
    } else if constexpr (is_range<value_t>::value) {
        bool any = false;
        bool result = true;
        std::size_t index = 0;
        for (const auto &item : value) {
            const auto child_key = indexed_key(key, index++);
            any = true;
            if constexpr (has_bool_value_type<value_t>::value) {
                result = send_value(sink, child_key.c_str(), static_cast<bool>(item)) && result;
            } else {
                result = send_value(sink, child_key.c_str(), item) && result;
            }
        }
        return any && result;
    } else {
        static_assert(always_false<value_t>::value,
                      "DebugScope values must be numeric, enum, complex, tuple-like, "
                      "matrix-like, or an iterable numeric container");
    }
}

} // namespace detail

template <typename T>
bool Scope::operator()(const char *key, const T &value)
{
    using value_t = typename std::decay<T>::type;
    if constexpr (std::is_arithmetic<value_t>::value || std::is_enum<value_t>::value) {
        return detail::send_value(*this, key, value);
    } else {
        auto output = frame();
        const bool encoded = detail::send_value(output, key, value);
        return encoded && output.send() > 0;
    }
}

template <typename T>
bool Frame::operator()(const char *key, const T &value)
{
    return detail::send_value(*this, key, value);
}

} // namespace debugscope
