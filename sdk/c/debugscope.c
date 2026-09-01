#if !defined(_WIN32)
#define _POSIX_C_SOURCE 200809L
#endif

#include "debugscope.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#pragma comment(lib, "ws2_32.lib")
typedef SOCKET ds_socket_handle;
#define DS_INVALID_SOCKET_HANDLE INVALID_SOCKET
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
typedef int ds_socket_handle;
#define DS_INVALID_SOCKET_HANDLE (-1)
#endif

enum {
    DS_HEADER_SIZE = 24,
    DS_MAX_PAYLOAD_SIZE = DS_MAX_DATAGRAM_SIZE - DS_HEADER_SIZE,
    DS_MESSAGE_HELLO = 1,
    DS_MESSAGE_SAMPLE = 2,
    DS_MESSAGE_FRAME = 3
};

typedef struct ds_state {
    ds_socket_handle socket_handle;
    struct sockaddr_in destination;
    char endpoint_address[16];
    uint16_t endpoint_port;
    char source_name[DS_MAX_KEY_BYTES + 1u];
    uint32_t source_id;
    uint32_t sequence;
    uint64_t last_hello_ns;
    bool hello_sent;
    bool endpoint_configured;
    bool init_attempted;
    bool ready;
    bool cleanup_registered;
#if defined(_WIN32)
    LARGE_INTEGER qpc_start;
    LARGE_INTEGER qpc_frequency;
    bool winsock_started;
#else
    uint64_t monotonic_start_ns;
#endif
} ds_state;

static ds_state g_ds = {
    DS_INVALID_SOCKET_HANDLE,
    {0},
    "127.0.0.1",
    DS_DEFAULT_UDP_PORT,
    "",
    0u,
    0u,
    0u,
    false,
    false,
    false,
    false,
    false,
#if defined(_WIN32)
    {0},
    {0},
    false
#else
    0u
#endif
};

static void ds_write_u16_le(uint8_t *output, uint16_t value)
{
    output[0] = (uint8_t)(value & 0xffu);
    output[1] = (uint8_t)((value >> 8u) & 0xffu);
}

static void ds_write_u32_le(uint8_t *output, uint32_t value)
{
    output[0] = (uint8_t)(value & 0xffu);
    output[1] = (uint8_t)((value >> 8u) & 0xffu);
    output[2] = (uint8_t)((value >> 16u) & 0xffu);
    output[3] = (uint8_t)((value >> 24u) & 0xffu);
}

static void ds_write_u64_le(uint8_t *output, uint64_t value)
{
    unsigned int index;
    for (index = 0u; index < 8u; ++index) {
        output[index] = (uint8_t)((value >> (index * 8u)) & 0xffu);
    }
}

static uint64_t ds_absolute_monotonic_ns(void)
{
#if defined(_WIN32)
    LARGE_INTEGER counter;
    uint64_t seconds;
    uint64_t remainder;
    QueryPerformanceCounter(&counter);
    if (g_ds.qpc_frequency.QuadPart == 0) {
        QueryPerformanceFrequency(&g_ds.qpc_frequency);
    }
    seconds = (uint64_t)(counter.QuadPart / g_ds.qpc_frequency.QuadPart);
    remainder = (uint64_t)(counter.QuadPart % g_ds.qpc_frequency.QuadPart);
    return seconds * 1000000000ull +
           (remainder * 1000000000ull) / (uint64_t)g_ds.qpc_frequency.QuadPart;
#else
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
        return 0u;
    }
    return ((uint64_t)now.tv_sec * 1000000000ull) + (uint64_t)now.tv_nsec;
#endif
}

static uint64_t ds_timestamp_ns(void)
{
#if defined(_WIN32)
    LARGE_INTEGER counter;
    uint64_t elapsed;
    uint64_t seconds;
    uint64_t remainder;
    QueryPerformanceCounter(&counter);
    if (g_ds.qpc_frequency.QuadPart == 0) {
        return 0u;
    }
    elapsed = (uint64_t)(counter.QuadPart - g_ds.qpc_start.QuadPart);
    seconds = elapsed / (uint64_t)g_ds.qpc_frequency.QuadPart;
    remainder = elapsed % (uint64_t)g_ds.qpc_frequency.QuadPart;
    return seconds * 1000000000ull +
           (remainder * 1000000000ull) / (uint64_t)g_ds.qpc_frequency.QuadPart;
#else
    const uint64_t now = ds_absolute_monotonic_ns();
    return now >= g_ds.monotonic_start_ns ? now - g_ds.monotonic_start_ns : 0u;
#endif
}

static uint64_t ds_mix64(uint64_t value)
{
    value ^= value >> 30u;
    value *= 0xbf58476d1ce4e5b9ull;
    value ^= value >> 27u;
    value *= 0x94d049bb133111ebull;
    value ^= value >> 31u;
    return value;
}

static uint32_t ds_process_id(void)
{
#if defined(_WIN32)
    return (uint32_t)GetCurrentProcessId();
#else
    return (uint32_t)getpid();
#endif
}

static uint32_t ds_make_source_id(void)
{
    uint64_t seed = ds_absolute_monotonic_ns();
    seed ^= ((uint64_t)ds_process_id() << 32u);
    seed ^= (uint64_t)(uintptr_t)&g_ds;
    seed = ds_mix64(seed);
    {
        uint32_t result = (uint32_t)(seed ^ (seed >> 32u));
        return result == 0u ? 1u : result;
    }
}

static size_t ds_bounded_string_length(const char *text, size_t maximum)
{
    size_t length = 0u;
    if (text == NULL) {
        return 0u;
    }
    while (length <= maximum && text[length] != '\0') {
        ++length;
    }
    return length;
}

static uint16_t ds_environment_port(void)
{
    const char *text = getenv("DEBUGSCOPE_UDP_PORT");
    char *end = NULL;
    unsigned long value;
    if (text == NULL || text[0] == '\0') {
        return 0u;
    }
    errno = 0;
    value = strtoul(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || value == 0u || value > 65535u) {
        return 0u;
    }
    return (uint16_t)value;
}

static void ds_send_packet(uint8_t message_type, uint64_t timestamp_ns,
                           const uint8_t *payload, size_t payload_size)
{
    uint8_t datagram[DS_MAX_DATAGRAM_SIZE];
    size_t datagram_size;
    if (!g_ds.ready || payload_size > DS_MAX_PAYLOAD_SIZE) {
        return;
    }

    datagram[0] = 'D';
    datagram[1] = 'S';
    datagram[2] = 'C';
    datagram[3] = 'P';
    datagram[4] = DS_PROTOCOL_VERSION;
    datagram[5] = message_type;
    ds_write_u16_le(datagram + 6, (uint16_t)payload_size);
    ds_write_u32_le(datagram + 8, g_ds.source_id);
    ds_write_u32_le(datagram + 12, g_ds.sequence++);
    ds_write_u64_le(datagram + 16, timestamp_ns);
    if (payload_size > 0u) {
        memcpy(datagram + DS_HEADER_SIZE, payload, payload_size);
    }
    datagram_size = DS_HEADER_SIZE + payload_size;

#if defined(_WIN32)
    (void)sendto(g_ds.socket_handle, (const char *)datagram, (int)datagram_size, 0,
                 (const struct sockaddr *)&g_ds.destination, (int)sizeof(g_ds.destination));
#else
    (void)sendto(g_ds.socket_handle, datagram, datagram_size, 0,
                 (const struct sockaddr *)&g_ds.destination, sizeof(g_ds.destination));
#endif
}

static void ds_send_hello(uint64_t timestamp_ns)
{
    static const char sdk_name[] = "c/0.1";
    uint8_t payload[4u + 2u + DS_MAX_KEY_BYTES + 1u + sizeof(sdk_name) - 1u];
    const size_t source_length = ds_bounded_string_length(g_ds.source_name, DS_MAX_KEY_BYTES);
    const size_t sdk_length = sizeof(sdk_name) - 1u;
    size_t offset = 0u;

    ds_write_u32_le(payload + offset, ds_process_id());
    offset += 4u;
    ds_write_u16_le(payload + offset, (uint16_t)source_length);
    offset += 2u;
    memcpy(payload + offset, g_ds.source_name, source_length);
    offset += source_length;
    payload[offset++] = (uint8_t)sdk_length;
    memcpy(payload + offset, sdk_name, sdk_length);
    offset += sdk_length;

    ds_send_packet(DS_MESSAGE_HELLO, timestamp_ns, payload, offset);
    g_ds.last_hello_ns = timestamp_ns;
    g_ds.hello_sent = true;
}

static void ds_maybe_send_hello(uint64_t timestamp_ns)
{
    const uint64_t hello_period_ns = 5000000000ull;
    if (!g_ds.hello_sent || timestamp_ns - g_ds.last_hello_ns >= hello_period_ns) {
        ds_send_hello(timestamp_ns);
    }
}

void ds_shutdown(void)
{
    if (g_ds.socket_handle != DS_INVALID_SOCKET_HANDLE) {
#if defined(_WIN32)
        closesocket(g_ds.socket_handle);
#else
        close(g_ds.socket_handle);
#endif
    }
    g_ds.socket_handle = DS_INVALID_SOCKET_HANDLE;
    g_ds.ready = false;
    g_ds.init_attempted = false;
    g_ds.hello_sent = false;
#if defined(_WIN32)
    if (g_ds.winsock_started) {
        WSACleanup();
        g_ds.winsock_started = false;
    }
#endif
}

void ds_set_endpoint(const char *ipv4_address, uint16_t port)
{
    const size_t address_length = ds_bounded_string_length(ipv4_address, 15u);
    if (address_length == 0u || address_length > 15u) {
        return;
    }
    if (g_ds.init_attempted) {
        ds_shutdown();
    }
    memcpy(g_ds.endpoint_address, ipv4_address, address_length);
    g_ds.endpoint_address[address_length] = '\0';
    g_ds.endpoint_port = port == 0u ? DS_DEFAULT_UDP_PORT : port;
    g_ds.endpoint_configured = true;
}

void ds_init(const char *source_name)
{
    size_t source_length;
    uint16_t environment_port;
    const char *environment_address;

    if (g_ds.init_attempted) {
        return;
    }

    source_length = ds_bounded_string_length(source_name, DS_MAX_KEY_BYTES);
    if (source_length == 0u || source_length > DS_MAX_KEY_BYTES) {
        return;
    }
    g_ds.init_attempted = true;
    memcpy(g_ds.source_name, source_name, source_length);
    g_ds.source_name[source_length] = '\0';

    if (!g_ds.endpoint_configured) {
        environment_address = getenv("DEBUGSCOPE_UDP_HOST");
        if (environment_address != NULL && environment_address[0] != '\0') {
            const size_t address_length = ds_bounded_string_length(environment_address, 15u);
            if (address_length > 0u && address_length <= 15u) {
                memcpy(g_ds.endpoint_address, environment_address, address_length);
                g_ds.endpoint_address[address_length] = '\0';
            }
        }
        environment_port = ds_environment_port();
        if (environment_port != 0u) {
            g_ds.endpoint_port = environment_port;
        }
    }

#if defined(_WIN32)
    {
        WSADATA winsock_data;
        u_long non_blocking = 1u;
        if (WSAStartup(MAKEWORD(2, 2), &winsock_data) != 0) {
            return;
        }
        g_ds.winsock_started = true;
        QueryPerformanceFrequency(&g_ds.qpc_frequency);
        QueryPerformanceCounter(&g_ds.qpc_start);
        g_ds.socket_handle = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (g_ds.socket_handle == DS_INVALID_SOCKET_HANDLE) {
            ds_shutdown();
            g_ds.init_attempted = true;
            return;
        }
        (void)ioctlsocket(g_ds.socket_handle, FIONBIO, &non_blocking);
    }
#else
    g_ds.monotonic_start_ns = ds_absolute_monotonic_ns();
    g_ds.socket_handle = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (g_ds.socket_handle == DS_INVALID_SOCKET_HANDLE) {
        return;
    }
    {
        const int current_flags = fcntl(g_ds.socket_handle, F_GETFL, 0);
        if (current_flags >= 0) {
            (void)fcntl(g_ds.socket_handle, F_SETFL, current_flags | O_NONBLOCK);
        }
    }
#endif

    memset(&g_ds.destination, 0, sizeof(g_ds.destination));
    g_ds.destination.sin_family = AF_INET;
    g_ds.destination.sin_port = htons(g_ds.endpoint_port);
    if (inet_pton(AF_INET, g_ds.endpoint_address, &g_ds.destination.sin_addr) != 1) {
        ds_shutdown();
        g_ds.init_attempted = true;
        return;
    }

    g_ds.source_id = ds_make_source_id();
    g_ds.sequence = 0u;
    g_ds.last_hello_ns = 0u;
    g_ds.hello_sent = false;
    g_ds.ready = true;
    if (!g_ds.cleanup_registered) {
        (void)atexit(ds_shutdown);
        g_ds.cleanup_registered = true;
    }
    ds_maybe_send_hello(ds_timestamp_ns());
}

static size_t ds_value_size(ds_value_type type)
{
    switch (type) {
    case DS_VALUE_BOOL:
        return 1u;
    case DS_VALUE_INT32:
    case DS_VALUE_UINT32:
    case DS_VALUE_FLOAT32:
        return 4u;
    case DS_VALUE_INT64:
    case DS_VALUE_UINT64:
    case DS_VALUE_FLOAT64:
        return 8u;
    default:
        return 0u;
    }
}

static void ds_encode_value(uint8_t *output, ds_value_type type, const void *value)
{
    uint32_t bits32;
    uint64_t bits64;
    switch (type) {
    case DS_VALUE_BOOL:
        output[0] = *(const bool *)value ? 1u : 0u;
        break;
    case DS_VALUE_INT32:
        ds_write_u32_le(output, (uint32_t)*(const int32_t *)value);
        break;
    case DS_VALUE_UINT32:
        ds_write_u32_le(output, *(const uint32_t *)value);
        break;
    case DS_VALUE_INT64:
        ds_write_u64_le(output, (uint64_t)*(const int64_t *)value);
        break;
    case DS_VALUE_UINT64:
        ds_write_u64_le(output, *(const uint64_t *)value);
        break;
    case DS_VALUE_FLOAT32:
        memcpy(&bits32, value, sizeof(bits32));
        ds_write_u32_le(output, bits32);
        break;
    case DS_VALUE_FLOAT64:
        memcpy(&bits64, value, sizeof(bits64));
        ds_write_u64_le(output, bits64);
        break;
    default:
        break;
    }
}

static void ds_send_sample(const char *key, ds_value_type type, const void *value)
{
    uint8_t payload[DS_MAX_PAYLOAD_SIZE];
    size_t key_length;
    size_t value_size;
    size_t offset;
    uint64_t timestamp_ns;

    if (!g_ds.ready) {
        return;
    }
    key_length = ds_bounded_string_length(key, DS_MAX_KEY_BYTES);
    value_size = ds_value_size(type);
    if (key_length == 0u || key_length > DS_MAX_KEY_BYTES || value_size == 0u) {
        return;
    }

    timestamp_ns = ds_timestamp_ns();
    ds_maybe_send_hello(timestamp_ns);
    ds_write_u16_le(payload, (uint16_t)key_length);
    memcpy(payload + 2u, key, key_length);
    offset = 2u + key_length;
    payload[offset++] = (uint8_t)type;
    ds_encode_value(payload + offset, type, value);
    offset += value_size;
    ds_send_packet(DS_MESSAGE_SAMPLE, timestamp_ns, payload, offset);
}

void ds_bool(const char *key, bool value) { ds_send_sample(key, DS_VALUE_BOOL, &value); }
void ds_i32(const char *key, int32_t value) { ds_send_sample(key, DS_VALUE_INT32, &value); }
void ds_u32(const char *key, uint32_t value) { ds_send_sample(key, DS_VALUE_UINT32, &value); }
void ds_i64(const char *key, int64_t value) { ds_send_sample(key, DS_VALUE_INT64, &value); }
void ds_u64(const char *key, uint64_t value) { ds_send_sample(key, DS_VALUE_UINT64, &value); }
void ds_f32(const char *key, float value) { ds_send_sample(key, DS_VALUE_FLOAT32, &value); }
void ds_f64(const char *key, double value) { ds_send_sample(key, DS_VALUE_FLOAT64, &value); }

static void ds_frame_reset_payload(ds_frame *frame)
{
    frame->payload_size = 2u;
    frame->item_count = 0u;
    frame->payload[0] = 0u;
    frame->payload[1] = 0u;
}

static void ds_frame_flush(ds_frame *frame)
{
    if (frame == NULL || !frame->active || frame->item_count == 0u) {
        return;
    }
    ds_write_u16_le(frame->payload, frame->item_count);
    ds_send_packet(DS_MESSAGE_FRAME, frame->timestamp_ns, frame->payload, frame->payload_size);
    ds_frame_reset_payload(frame);
}

void ds_frame_begin(ds_frame *frame)
{
    if (frame == NULL) {
        return;
    }
    frame->active = g_ds.ready;
    ds_frame_reset_payload(frame);
    if (!frame->active) {
        frame->timestamp_ns = 0u;
        return;
    }
    frame->timestamp_ns = ds_timestamp_ns();
    ds_maybe_send_hello(frame->timestamp_ns);
}

static bool ds_frame_add(ds_frame *frame, const char *key, ds_value_type type, const void *value)
{
    size_t key_length;
    size_t value_size;
    size_t item_size;
    size_t offset;
    if (frame == NULL || !frame->active) {
        return false;
    }
    key_length = ds_bounded_string_length(key, DS_MAX_KEY_BYTES);
    value_size = ds_value_size(type);
    if (key_length == 0u || key_length > DS_MAX_KEY_BYTES || value_size == 0u) {
        return false;
    }
    item_size = 2u + key_length + 1u + value_size;
    if (item_size + 2u > DS_MAX_PAYLOAD_SIZE) {
        return false;
    }
    if (frame->payload_size + item_size > DS_MAX_PAYLOAD_SIZE) {
        ds_frame_flush(frame);
    }

    offset = frame->payload_size;
    ds_write_u16_le(frame->payload + offset, (uint16_t)key_length);
    offset += 2u;
    memcpy(frame->payload + offset, key, key_length);
    offset += key_length;
    frame->payload[offset++] = (uint8_t)type;
    ds_encode_value(frame->payload + offset, type, value);
    offset += value_size;
    frame->payload_size = offset;
    ++frame->item_count;
    return true;
}

bool ds_frame_bool(ds_frame *frame, const char *key, bool value) { return ds_frame_add(frame, key, DS_VALUE_BOOL, &value); }
bool ds_frame_i32(ds_frame *frame, const char *key, int32_t value) { return ds_frame_add(frame, key, DS_VALUE_INT32, &value); }
bool ds_frame_u32(ds_frame *frame, const char *key, uint32_t value) { return ds_frame_add(frame, key, DS_VALUE_UINT32, &value); }
bool ds_frame_i64(ds_frame *frame, const char *key, int64_t value) { return ds_frame_add(frame, key, DS_VALUE_INT64, &value); }
bool ds_frame_u64(ds_frame *frame, const char *key, uint64_t value) { return ds_frame_add(frame, key, DS_VALUE_UINT64, &value); }
bool ds_frame_f32(ds_frame *frame, const char *key, float value) { return ds_frame_add(frame, key, DS_VALUE_FLOAT32, &value); }
bool ds_frame_f64(ds_frame *frame, const char *key, double value) { return ds_frame_add(frame, key, DS_VALUE_FLOAT64, &value); }

void ds_frame_end(ds_frame *frame)
{
    if (frame == NULL || !frame->active) {
        return;
    }
    ds_frame_flush(frame);
    frame->active = false;
}
