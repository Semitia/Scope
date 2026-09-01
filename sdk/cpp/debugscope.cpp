#include "debugscope.hpp"

#include <array>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <random>
#include <stdexcept>
#include <utility>
#include <vector>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#pragma comment(lib, "ws2_32.lib")
using SocketHandle = SOCKET;
constexpr SocketHandle invalid_socket = INVALID_SOCKET;
static bool start_network() { WSADATA data{}; return WSAStartup(MAKEWORD(2, 2), &data) == 0; }
static void stop_network() { WSACleanup(); }
static void close_socket(SocketHandle socket) { closesocket(socket); }
static void make_nonblocking(SocketHandle socket) { u_long enabled = 1; (void)ioctlsocket(socket, FIONBIO, &enabled); }
static std::uint32_t process_id() { return static_cast<std::uint32_t>(GetCurrentProcessId()); }
static void send_bytes(SocketHandle socket, const sockaddr_in &destination,
                       const std::uint8_t *data, std::size_t size)
{
    (void)::sendto(socket, reinterpret_cast<const char *>(data), static_cast<int>(size), 0,
                   reinterpret_cast<const sockaddr *>(&destination), sizeof(destination));
}
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>
using SocketHandle = int;
constexpr SocketHandle invalid_socket = -1;
static bool start_network() { return true; }
static void stop_network() {}
static void close_socket(SocketHandle socket) { ::close(socket); }
static void make_nonblocking(SocketHandle socket)
{
    const int flags = fcntl(socket, F_GETFL, 0);
    if (flags >= 0) (void)fcntl(socket, F_SETFL, flags | O_NONBLOCK);
}
static std::uint32_t process_id() { return static_cast<std::uint32_t>(getpid()); }
static void send_bytes(SocketHandle socket, const sockaddr_in &destination,
                       const std::uint8_t *data, std::size_t size)
{
    (void)::sendto(socket, data, size, 0,
                   reinterpret_cast<const sockaddr *>(&destination), sizeof(destination));
}
#endif

namespace debugscope {
namespace {

constexpr std::size_t header_size = 24;
constexpr std::size_t max_datagram_size = 1200;
constexpr std::size_t max_payload_size = max_datagram_size - header_size;
constexpr std::size_t max_key_bytes = 255;
constexpr std::uint16_t default_port = 4711;
constexpr std::uint64_t hello_period_ns = 5'000'000'000ULL;

constexpr std::uint8_t message_hello = 1;
constexpr std::uint8_t message_sample = 2;
constexpr std::uint8_t message_frame = 3;

enum class ValueType : std::uint8_t {
    boolean = 1,
    int32 = 2,
    uint32 = 3,
    int64 = 4,
    uint64 = 5,
    float32 = 6,
    float64 = 7,
};

using Bytes = std::vector<std::uint8_t>;

template <typename Integer>
void append_le(Bytes &output, Integer value)
{
    using unsigned_t = typename std::make_unsigned<Integer>::type;
    const auto bits = static_cast<unsigned_t>(value);
    for (std::size_t index = 0; index < sizeof(Integer); ++index) {
        output.push_back(static_cast<std::uint8_t>((bits >> (index * 8)) & 0xff));
    }
}

std::size_t bounded_length(const char *text, std::size_t maximum)
{
    if (text == nullptr) return 0;
    std::size_t length = 0;
    while (length <= maximum && text[length] != '\0') ++length;
    return length;
}

template <typename T>
Bytes encode_item(const char *key, ValueType type, T value)
{
    const auto key_length = bounded_length(key, max_key_bytes);
    if (key_length == 0 || key_length > max_key_bytes) return {};

    Bytes item;
    item.reserve(2 + key_length + 1 + sizeof(T));
    append_le(item, static_cast<std::uint16_t>(key_length));
    item.insert(item.end(), key, key + key_length);
    item.push_back(static_cast<std::uint8_t>(type));

    if constexpr (std::is_same<T, bool>::value) {
        item.push_back(value ? 1 : 0);
    } else if constexpr (std::is_floating_point<T>::value) {
        using bits_t = typename std::conditional<sizeof(T) == 4, std::uint32_t, std::uint64_t>::type;
        bits_t bits{};
        std::memcpy(&bits, &value, sizeof(value));
        append_le(item, bits);
    } else {
        append_le(item, value);
    }
    return item;
}

std::string environment(const char *name)
{
    const char *value = std::getenv(name);
    return value == nullptr ? std::string{} : std::string{value};
}

std::uint16_t environment_port()
{
    const auto text = environment("DEBUGSCOPE_UDP_PORT");
    if (text.empty()) return default_port;
    try {
        const auto value = std::stoul(text);
        return value > 0 && value <= 65535 ? static_cast<std::uint16_t>(value) : default_port;
    } catch (...) {
        return default_port;
    }
}

std::uint32_t make_source_id()
{
    std::random_device random;
    auto id = static_cast<std::uint32_t>(random())
        ^ static_cast<std::uint32_t>(std::chrono::steady_clock::now().time_since_epoch().count());
    return id == 0 ? 1 : id;
}

} // namespace

struct Scope::Impl {
    explicit Impl(std::string name, ScopeOptions options)
        : source_name(std::move(name)),
          host(options.host ? std::move(*options.host) : environment("DEBUGSCOPE_UDP_HOST")),
          port(options.port.value_or(environment_port())),
          enabled(options.enabled),
          source_id(make_source_id()),
          started(std::chrono::steady_clock::now())
    {
        if (source_name.empty()) throw std::invalid_argument("DebugScope source name is required");
        if (source_name.size() > max_key_bytes) {
            throw std::invalid_argument("DebugScope source name exceeds 255 bytes");
        }
        if (host.empty()) host = "127.0.0.1";
    }

    ~Impl() { close(); }

    std::uint64_t timestamp_ns() const
    {
        return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now() - started).count());
    }

    bool open_socket()
    {
        if (!enabled) return false;
        if (socket != invalid_socket) return true;
        if (!network_started) {
            network_started = start_network();
            if (!network_started) return false;
        }

        addrinfo hints{};
        hints.ai_family = AF_INET;
        hints.ai_socktype = SOCK_DGRAM;
        hints.ai_protocol = IPPROTO_UDP;
        addrinfo *addresses = nullptr;
        const auto service = std::to_string(port);
        if (getaddrinfo(host.c_str(), service.c_str(), &hints, &addresses) != 0 || addresses == nullptr) {
            return false;
        }

        socket = ::socket(addresses->ai_family, addresses->ai_socktype, addresses->ai_protocol);
        if (socket != invalid_socket) {
            std::memcpy(&destination, addresses->ai_addr, sizeof(destination));
            make_nonblocking(socket);
        }
        freeaddrinfo(addresses);
        return socket != invalid_socket;
    }

    void close()
    {
        std::lock_guard<std::recursive_mutex> guard(mutex);
        if (socket != invalid_socket) {
            close_socket(socket);
            socket = invalid_socket;
        }
        if (network_started) {
            stop_network();
            network_started = false;
        }
        hello_sent = false;
    }

    void send_packet(std::uint8_t type, std::uint64_t timestamp, const Bytes &payload)
    {
        if (payload.size() > max_payload_size || !open_socket()) return;
        Bytes packet;
        packet.reserve(header_size + payload.size());
        packet.insert(packet.end(), {'D', 'S', 'C', 'P'});
        packet.push_back(1);
        packet.push_back(type);
        append_le(packet, static_cast<std::uint16_t>(payload.size()));
        append_le(packet, source_id);
        append_le(packet, sequence++);
        append_le(packet, timestamp);
        packet.insert(packet.end(), payload.begin(), payload.end());
        send_bytes(socket, destination, packet.data(), packet.size());
    }

    void send_hello(std::uint64_t timestamp)
    {
        Bytes payload;
        append_le(payload, process_id());
        append_le(payload, static_cast<std::uint16_t>(source_name.size()));
        payload.insert(payload.end(), source_name.begin(), source_name.end());
        constexpr char sdk_name[] = "cpp/0.1";
        payload.push_back(static_cast<std::uint8_t>(sizeof(sdk_name) - 1));
        payload.insert(payload.end(), sdk_name, sdk_name + sizeof(sdk_name) - 1);
        send_packet(message_hello, timestamp, payload);
        last_hello_ns = timestamp;
        hello_sent = socket != invalid_socket;
    }

    void ensure_hello(std::uint64_t timestamp)
    {
        if (!hello_sent || timestamp - last_hello_ns >= hello_period_ns) send_hello(timestamp);
    }

    bool send_value(Bytes item)
    {
        if (item.empty()) return false;
        std::lock_guard<std::recursive_mutex> guard(mutex);
        const auto timestamp = timestamp_ns();
        ensure_hello(timestamp);
        send_packet(message_sample, timestamp, item);
        return true;
    }

    std::size_t send_frame(std::uint64_t timestamp, const std::vector<Bytes> &items)
    {
        if (items.empty()) return 0;
        std::lock_guard<std::recursive_mutex> guard(mutex);
        ensure_hello(timestamp);

        Bytes payload(2, 0);
        std::uint16_t count = 0;
        const auto flush = [&] {
            if (count == 0) return;
            payload[0] = static_cast<std::uint8_t>(count & 0xff);
            payload[1] = static_cast<std::uint8_t>((count >> 8) & 0xff);
            send_packet(message_frame, timestamp, payload);
            payload.assign(2, 0);
            count = 0;
        };
        for (const auto &item : items) {
            if (count > 0 && payload.size() + item.size() > max_payload_size) flush();
            payload.insert(payload.end(), item.begin(), item.end());
            ++count;
        }
        flush();
        return items.size();
    }

    std::string source_name;
    std::string host;
    std::uint16_t port;
    bool enabled;
    SocketHandle socket = invalid_socket;
    sockaddr_in destination{};
    bool network_started = false;
    std::uint32_t source_id;
    std::uint32_t sequence = 0;
    std::chrono::steady_clock::time_point started;
    std::uint64_t last_hello_ns = 0;
    bool hello_sent = false;
    std::recursive_mutex mutex;
};

struct Frame::Impl {
    explicit Impl(Scope &owner) : scope(owner), timestamp(owner.impl_->timestamp_ns()) {}
    Scope &scope;
    std::uint64_t timestamp;
    std::vector<Bytes> items;
    bool sent = false;

    bool add(Bytes item)
    {
        if (sent || item.empty() || item.size() + 2 > max_payload_size) return false;
        items.push_back(std::move(item));
        return true;
    }
};

Scope::Scope(std::string source_name, ScopeOptions options)
    : impl_(std::make_unique<Impl>(std::move(source_name), std::move(options))) {}

Scope::Scope(std::string source_name, std::string host, std::uint16_t port, bool enabled)
    : Scope(std::move(source_name), ScopeOptions{std::move(host), port, enabled}) {}

Scope::~Scope() = default;

bool Scope::boolean(const char *key, bool value) { return impl_->send_value(encode_item(key, ValueType::boolean, value)); }
bool Scope::i32(const char *key, std::int32_t value) { return impl_->send_value(encode_item(key, ValueType::int32, value)); }
bool Scope::u32(const char *key, std::uint32_t value) { return impl_->send_value(encode_item(key, ValueType::uint32, value)); }
bool Scope::i64(const char *key, std::int64_t value) { return impl_->send_value(encode_item(key, ValueType::int64, value)); }
bool Scope::u64(const char *key, std::uint64_t value) { return impl_->send_value(encode_item(key, ValueType::uint64, value)); }
bool Scope::f32(const char *key, float value) { return impl_->send_value(encode_item(key, ValueType::float32, value)); }
bool Scope::f64(const char *key, double value) { return impl_->send_value(encode_item(key, ValueType::float64, value)); }
Frame Scope::frame() { return Frame{*this}; }
void Scope::close() { impl_->close(); }

Frame::Frame(Scope &scope) : impl_(std::make_unique<Impl>(scope)) {}
Frame::~Frame() = default;
Frame::Frame(Frame &&) noexcept = default;
Frame &Frame::operator=(Frame &&) noexcept = default;

bool Frame::boolean(const char *key, bool value) { return impl_->add(encode_item(key, ValueType::boolean, value)); }
bool Frame::i32(const char *key, std::int32_t value) { return impl_->add(encode_item(key, ValueType::int32, value)); }
bool Frame::u32(const char *key, std::uint32_t value) { return impl_->add(encode_item(key, ValueType::uint32, value)); }
bool Frame::i64(const char *key, std::int64_t value) { return impl_->add(encode_item(key, ValueType::int64, value)); }
bool Frame::u64(const char *key, std::uint64_t value) { return impl_->add(encode_item(key, ValueType::uint64, value)); }
bool Frame::f32(const char *key, float value) { return impl_->add(encode_item(key, ValueType::float32, value)); }
bool Frame::f64(const char *key, double value) { return impl_->add(encode_item(key, ValueType::float64, value)); }

std::size_t Frame::send()
{
    if (impl_->sent) return 0;
    impl_->sent = true;
    return impl_->scope.impl_->send_frame(impl_->timestamp, impl_->items);
}

} // namespace debugscope
