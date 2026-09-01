#include "debugscope.h"

int main(void)
{
    ds_frame frame;
    ds_init("c-smoke");
    ds_bool("enabled", true);
    DSCOPE("iterations", 42);
    ds_f32("speed", 123.5f);

    ds_frame_begin(&frame);
    (void)ds_frame_f64(&frame, "target", 150.25);
    (void)ds_frame_i64(&frame, "error", -27);
    ds_frame_end(&frame);
    ds_shutdown();
    return 0;
}
