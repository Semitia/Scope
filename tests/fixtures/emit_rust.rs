use debugscope::Scope;

fn main() {
    let scope = Scope::new("rust-smoke");
    scope.sample("enabled", true);
    scope.sample("iterations", 45_i32);
    scope.f32("speed", 126.5);

    let mut frame = scope.frame();
    frame.add("target", 153.25_f64);
    frame.add("ticks", 9_000_000_001_u64);
    frame.send();
}
