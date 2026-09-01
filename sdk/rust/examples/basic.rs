use debugscope::Scope;
use std::thread;
use std::time::Duration;

fn main() {
    let scope = Scope::new("rust-example");

    for tick in 0..300 {
        let target = 150.0_f32;
        let speed = 125.0_f32 + ((tick as f32) * 0.05).sin() * 10.0;
        scope.sample("motor.speed", speed);

        let mut frame = scope.frame();
        frame.add("motor.target", target);
        frame.add("motor.speed", speed);
        frame.add("motor.error", target - speed);
        frame.send();

        thread::sleep(Duration::from_millis(16));
    }
}
