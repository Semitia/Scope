#ifndef DEBUGSCOPE_CPP_DETAIL_TRANSPORT_HPP
#define DEBUGSCOPE_CPP_DETAIL_TRANSPORT_HPP

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef DEBUGSCOPE_ENABLED
#define DEBUGSCOPE_ENABLED 1
#endif

#define DS_PROTOCOL_VERSION 1u
#define DS_MAX_DATAGRAM_SIZE 1200u
#define DS_MAX_KEY_BYTES 255u
#define DS_DEFAULT_UDP_PORT 4711u

namespace debugscope {
namespace detail {

typedef enum ds_value_type {
    DS_VALUE_BOOL = 1,
    DS_VALUE_INT32 = 2,
    DS_VALUE_UINT32 = 3,
    DS_VALUE_INT64 = 4,
    DS_VALUE_UINT64 = 5,
    DS_VALUE_FLOAT32 = 6,
    DS_VALUE_FLOAT64 = 7
} ds_value_type;

typedef struct ds_frame {
    uint8_t payload[DS_MAX_DATAGRAM_SIZE - 24u];
    size_t payload_size;
    uint16_t item_count;
    uint64_t timestamp_ns;
    bool active;
} ds_frame;

/*
 * Initializes the process-wide SDK state. Calling this function is optional;
 * the first sample lazily initializes a source named "app".
 */
void ds_init(const char *source_name);

/* Overrides the IPv4 endpoint. Call before ds_init or the first sample. */
void ds_set_endpoint(const char *ipv4_address, uint16_t port);

/* Closes the process-wide UDP socket. It is safe to call more than once. */
void ds_shutdown(void);

void ds_bool(const char *key, bool value);
void ds_i32(const char *key, int32_t value);
void ds_u32(const char *key, uint32_t value);
void ds_i64(const char *key, int64_t value);
void ds_u64(const char *key, uint64_t value);
void ds_f32(const char *key, float value);
void ds_f64(const char *key, double value);

void ds_frame_begin(ds_frame *frame);
bool ds_frame_bool(ds_frame *frame, const char *key, bool value);
bool ds_frame_i32(ds_frame *frame, const char *key, int32_t value);
bool ds_frame_u32(ds_frame *frame, const char *key, uint32_t value);
bool ds_frame_i64(ds_frame *frame, const char *key, int64_t value);
bool ds_frame_u64(ds_frame *frame, const char *key, uint64_t value);
bool ds_frame_f32(ds_frame *frame, const char *key, float value);
bool ds_frame_f64(ds_frame *frame, const char *key, double value);
void ds_frame_end(ds_frame *frame);

} // namespace detail
} // namespace debugscope

#endif
