addpath(fileparts(mfilename('fullpath')));

scope = debugscope.Scope('matlab-example');
cleanup = onCleanup(@() scope.close());

for tick = 1:300
    target = single(150);
    speed = single(125 + sin(double(tick) * 0.05) * 10);

    scope.sample('motor.speed', speed);
    scope.frame({ ...
        'motor.target', target; ...
        'motor.speed',  speed; ...
        'motor.error',  target - speed});
    pause(0.016);
end
