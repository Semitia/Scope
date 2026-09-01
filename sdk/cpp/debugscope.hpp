#ifndef DEBUGSCOPE_HPP
#define DEBUGSCOPE_HPP

#include "detail/transport.hpp"

#include <cstdint>
#include <type_traits>

namespace debugscope {

namespace detail {

template <typename T>
using clean_t = typename std::decay<T>::type;

template <typename T>
inline void send_value(const char *key, T value)
{
#if DEBUGSCOPE_ENABLED
    using value_t = clean_t<T>;
    static_assert(std::is_arithmetic<value_t>::value, "DebugScope values must be numeric or bool");

    if constexpr (std::is_same<value_t, bool>::value) {
        ds_bool(key, value);
    } else if constexpr (std::is_floating_point<value_t>::value && sizeof(value_t) <= sizeof(float)) {
        ds_f32(key, static_cast<float>(value));
    } else if constexpr (std::is_floating_point<value_t>::value) {
        ds_f64(key, static_cast<double>(value));
    } else if constexpr (std::is_signed<value_t>::value && sizeof(value_t) <= sizeof(std::int32_t)) {
        ds_i32(key, static_cast<std::int32_t>(value));
    } else if constexpr (std::is_signed<value_t>::value) {
        ds_i64(key, static_cast<std::int64_t>(value));
    } else if constexpr (sizeof(value_t) <= sizeof(std::uint32_t)) {
        ds_u32(key, static_cast<std::uint32_t>(value));
    } else {
        ds_u64(key, static_cast<std::uint64_t>(value));
    }
#else
    (void)key;
    (void)value;
#endif
}

template <typename T>
inline bool add_frame_value(ds_frame *frame, const char *key, T value)
{
#if DEBUGSCOPE_ENABLED
    using value_t = clean_t<T>;
    static_assert(std::is_arithmetic<value_t>::value, "DebugScope values must be numeric or bool");

    if constexpr (std::is_same<value_t, bool>::value) {
        return ds_frame_bool(frame, key, value);
    } else if constexpr (std::is_floating_point<value_t>::value && sizeof(value_t) <= sizeof(float)) {
        return ds_frame_f32(frame, key, static_cast<float>(value));
    } else if constexpr (std::is_floating_point<value_t>::value) {
        return ds_frame_f64(frame, key, static_cast<double>(value));
    } else if constexpr (std::is_signed<value_t>::value && sizeof(value_t) <= sizeof(std::int32_t)) {
        return ds_frame_i32(frame, key, static_cast<std::int32_t>(value));
    } else if constexpr (std::is_signed<value_t>::value) {
        return ds_frame_i64(frame, key, static_cast<std::int64_t>(value));
    } else if constexpr (sizeof(value_t) <= sizeof(std::uint32_t)) {
        return ds_frame_u32(frame, key, static_cast<std::uint32_t>(value));
    } else {
        return ds_frame_u64(frame, key, static_cast<std::uint64_t>(value));
    }
#else
    (void)frame;
    (void)key;
    (void)value;
    return false;
#endif
}

} // namespace detail

class Frame {
public:
    Frame()
    {
#if DEBUGSCOPE_ENABLED
        detail::ds_frame_begin(&frame_);
#endif
    }

    Frame(const Frame &) = delete;
    Frame &operator=(const Frame &) = delete;
    Frame(Frame &&) = delete;
    Frame &operator=(Frame &&) = delete;

    template <typename T>
    bool operator()(const char *key, T value)
    {
        return !sent_ && detail::add_frame_value(&frame_, key, value);
    }

    void send()
    {
        if (!sent_) {
#if DEBUGSCOPE_ENABLED
            detail::ds_frame_end(&frame_);
#endif
            sent_ = true;
        }
    }

private:
    detail::ds_frame frame_{};
    bool sent_ = false;
};

class Scope {
public:
    explicit Scope(const char *source_name = "app")
    {
#if DEBUGSCOPE_ENABLED
        detail::ds_init(source_name);
#else
        (void)source_name;
#endif
    }

    template <typename T>
    void operator()(const char *key, T value) const
    {
        detail::send_value(key, value);
    }

    [[nodiscard]] Frame frame() const
    {
        return Frame{};
    }

    static void endpoint(const char *ipv4_address, std::uint16_t port = DS_DEFAULT_UDP_PORT)
    {
        detail::ds_set_endpoint(ipv4_address, port);
    }

    static void shutdown()
    {
        detail::ds_shutdown();
    }
};

template <typename T>
inline void plot(const char *key, T value)
{
    detail::send_value(key, value);
}

} // namespace debugscope

#endif
