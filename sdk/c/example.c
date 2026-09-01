#if !defined(_WIN32)
#define _POSIX_C_SOURCE 200809L
#endif

#include "debugscope.h"

#include <math.h>
#include <stdio.h>

#if defined(_WIN32)
#include <windows.h>
static void sleep_ms(unsigned int milliseconds) { Sleep(milliseconds); }
#else
#include <time.h>
static void sleep_ms(unsigned int milliseconds)
{
    struct timespec duration;
    duration.tv_sec = (time_t)(milliseconds / 1000u);
    duration.tv_nsec = (long)((milliseconds % 1000u) * 1000000u);
    (void)nanosleep(&duration, NULL);
}
#endif

int main(void)
{
    unsigned int step;
    float response = 0.0f;

    ds_init("c-example");

    for (step = 0u; step < 500u; ++step) {
        const float time = (float)step * 0.02f;
        const float target = 1000.0f + 250.0f * sinf(time * 1.3f);
        ds_frame frame;

        response += (target - response) * 0.08f;

        ds_frame_begin(&frame);
        (void)ds_frame_f32(&frame, "motor.target", target);
        (void)ds_frame_f32(&frame, "motor.speed", response);
        (void)ds_frame_f32(&frame, "motor.error", target - response);
        ds_frame_end(&frame);

        sleep_ms(20u);
    }

    puts("C example finished");
    ds_shutdown();
    return 0;
}
