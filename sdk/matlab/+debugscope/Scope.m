classdef Scope < handle
    %SCOPE Best-effort DSCP/1 producer for live DebugScope telemetry.

    properties (SetAccess = private)
        SourceName
        Host
        Port
        Enabled
    end

    properties (Access = private)
        Socket = []
        SocketKind = ''
        DestinationAddress = []
        SourceId
        Sequence = uint32(0)
        Started
        LastHelloSeconds = 0
        HelloSent = false
    end

    methods
        function obj = Scope(sourceName, varargin)
            if nargin < 1 || isempty(sourceName)
                error('debugscope:SourceNameRequired', ...
                    'A non-empty source name is required.');
            end

            defaultHost = getenv('DEBUGSCOPE_UDP_HOST');
            if isempty(defaultHost)
                defaultHost = '127.0.0.1';
            end
            defaultPort = str2double(getenv('DEBUGSCOPE_UDP_PORT'));
            if ~isfinite(defaultPort) || defaultPort < 1 || defaultPort > 65535 || fix(defaultPort) ~= defaultPort
                defaultPort = 4711;
            end

            parser = inputParser;
            addParameter(parser, 'Host', defaultHost);
            addParameter(parser, 'Port', defaultPort);
            addParameter(parser, 'Enabled', true);
            parse(parser, varargin{:});

            sourceName = string(sourceName);
            if ~isscalar(sourceName) || strlength(sourceName) == 0
                error('debugscope:InvalidSourceName', ...
                    'Source name must be a non-empty string scalar.');
            end
            host = string(parser.Results.Host);
            if ~isscalar(host) || strlength(host) == 0
                host = string(defaultHost);
            end
            port = parser.Results.Port;
            if ~isnumeric(port) || ~isscalar(port) || ~isreal(port) || ...
                    ~isfinite(port) || port < 1 || port > 65535 || fix(port) ~= port
                port = defaultPort;
            end
            enabled = parser.Results.Enabled;

            obj.SourceName = char(sourceName);
            obj.Host = char(host);
            obj.Port = double(port);
            obj.Enabled = isscalar(enabled) && (islogical(enabled) || isnumeric(enabled)) ...
                && logical(enabled);
            obj.SourceId = uint32(randi([1, double(intmax('uint32'))]));
            obj.Started = tic;
        end

        function accepted = sample(obj, key, value)
            item = debugscope.Scope.encodeAutoItem(key, value);
            accepted = ~isempty(item);
            if ~accepted
                return
            end
            timestampNs = obj.timestampNs();
            obj.maybeSendHello(timestampNs);
            obj.sendPacket(uint8(2), timestampNs, item);
        end

        function accepted = bool(obj, key, value)
            accepted = obj.sendTyped(key, uint8(1), uint8(logical(value)));
        end

        function accepted = i32(obj, key, value)
            accepted = obj.sendTyped(key, uint8(2), debugscope.Scope.numericBytes(value, 'int32'));
        end

        function accepted = u32(obj, key, value)
            accepted = obj.sendTyped(key, uint8(3), debugscope.Scope.numericBytes(value, 'uint32'));
        end

        function accepted = i64(obj, key, value)
            accepted = obj.sendTyped(key, uint8(4), debugscope.Scope.numericBytes(value, 'int64'));
        end

        function accepted = u64(obj, key, value)
            accepted = obj.sendTyped(key, uint8(5), debugscope.Scope.numericBytes(value, 'uint64'));
        end

        function accepted = f32(obj, key, value)
            accepted = obj.sendTyped(key, uint8(6), debugscope.Scope.numericBytes(value, 'single'));
        end

        function accepted = f64(obj, key, value)
            accepted = obj.sendTyped(key, uint8(7), debugscope.Scope.numericBytes(value, 'double'));
        end

        function count = frame(obj, values)
            %FRAME Send an N-by-2 cell array, scalar struct, or containers.Map.
            items = {};
            if iscell(values) && size(values, 2) == 2
                for index = 1:size(values, 1)
                    item = debugscope.Scope.encodeAutoItem(values{index, 1}, values{index, 2});
                    if ~isempty(item) && numel(item) + 2 <= 1176
                        items{end + 1} = item; %#ok<AGROW>
                    end
                end
            elseif isstruct(values) && isscalar(values)
                names = fieldnames(values);
                for index = 1:numel(names)
                    item = debugscope.Scope.encodeAutoItem(names{index}, values.(names{index}));
                    if ~isempty(item) && numel(item) + 2 <= 1176
                        items{end + 1} = item; %#ok<AGROW>
                    end
                end
            elseif isa(values, 'containers.Map')
                names = keys(values);
                for index = 1:numel(names)
                    item = debugscope.Scope.encodeAutoItem(names{index}, values(names{index}));
                    if ~isempty(item) && numel(item) + 2 <= 1176
                        items{end + 1} = item; %#ok<AGROW>
                    end
                end
            end

            count = numel(items);
            if count == 0
                return
            end

            timestampNs = obj.timestampNs();
            obj.maybeSendHello(timestampNs);
            packetItems = {};
            packetSize = 2;
            for index = 1:count
                item = items{index};
                if ~isempty(packetItems) && packetSize + numel(item) > 1176
                    obj.sendFramePacket(timestampNs, packetItems, packetSize);
                    packetItems = {};
                    packetSize = 2;
                end
                packetItems{end + 1} = item; %#ok<AGROW>
                packetSize = packetSize + numel(item);
            end
            if ~isempty(packetItems)
                obj.sendFramePacket(timestampNs, packetItems, packetSize);
            end
        end

        function close(obj)
            if isempty(obj.Socket)
                return
            end
            try
                if strcmp(obj.SocketKind, 'java')
                    obj.Socket.close();
                else
                    delete(obj.Socket);
                end
            catch
            end
            obj.Socket = [];
            obj.SocketKind = '';
            obj.DestinationAddress = [];
            obj.HelloSent = false;
        end

        function delete(obj)
            obj.close();
        end
    end

    methods (Access = private)
        function accepted = sendTyped(obj, key, valueType, valueBytes)
            expectedSizes = [1, 4, 4, 8, 8, 4, 8];
            typeIndex = double(valueType);
            if typeIndex < 1 || typeIndex > numel(expectedSizes) || ...
                    numel(valueBytes) ~= expectedSizes(typeIndex)
                accepted = false;
                return
            end
            item = debugscope.Scope.makeItem(key, valueType, valueBytes);
            accepted = ~isempty(item);
            if ~accepted
                return
            end
            timestampNs = obj.timestampNs();
            obj.maybeSendHello(timestampNs);
            obj.sendPacket(uint8(2), timestampNs, item);
        end

        function timestamp = timestampNs(obj)
            timestamp = uint64(max(0, toc(obj.Started)) * 1e9);
        end

        function maybeSendHello(obj, timestampNs)
            seconds = double(timestampNs) / 1e9;
            if obj.HelloSent && seconds - obj.LastHelloSeconds < 5
                return
            end

            sourceBytes = debugscope.Scope.limitedUtf8(obj.SourceName, 255);
            sdkBytes = uint8('matlab/0.1');
            payload = [ ...
                debugscope.Scope.numericBytes(debugscope.Scope.processId(), 'uint32'), ...
                debugscope.Scope.numericBytes(numel(sourceBytes), 'uint16'), ...
                sourceBytes, ...
                uint8(numel(sdkBytes)), ...
                sdkBytes];
            obj.sendPacket(uint8(1), timestampNs, payload);
            obj.LastHelloSeconds = seconds;
            obj.HelloSent = true;
        end

        function sendFramePacket(obj, timestampNs, items, packetSize)
            payload = zeros(1, packetSize, 'uint8');
            payload(1:2) = debugscope.Scope.numericBytes(numel(items), 'uint16');
            offset = 3;
            for index = 1:numel(items)
                item = items{index};
                payload(offset:offset + numel(item) - 1) = item;
                offset = offset + numel(item);
            end
            obj.sendPacket(uint8(3), timestampNs, payload);
        end

        function sendPacket(obj, messageType, timestampNs, payload)
            if numel(payload) > 1176 || ~obj.ensureSocket()
                return
            end

            header = [ ...
                uint8('DSCP'), ...
                uint8(1), ...
                messageType, ...
                debugscope.Scope.numericBytes(numel(payload), 'uint16'), ...
                debugscope.Scope.numericBytes(obj.SourceId, 'uint32'), ...
                debugscope.Scope.numericBytes(obj.Sequence, 'uint32'), ...
                debugscope.Scope.numericBytes(timestampNs, 'uint64')];
            packet = [header, reshape(uint8(payload), 1, [])];
            if obj.Sequence == intmax('uint32')
                obj.Sequence = uint32(0);
            else
                obj.Sequence = obj.Sequence + uint32(1);
            end

            try
                if strcmp(obj.SocketKind, 'udpport')
                    write(obj.Socket, packet, 'uint8', obj.Host, obj.Port);
                else
                    signedPacket = typecast(packet, 'int8');
                    datagram = javaObject( ...
                        'java.net.DatagramPacket', signedPacket, int32(numel(signedPacket)), ...
                        obj.DestinationAddress, int32(obj.Port));
                    obj.Socket.send(datagram);
                end
            catch
                % Telemetry must never interrupt the instrumented application.
            end
        end

        function ready = ensureSocket(obj)
            ready = obj.Enabled && ~isempty(obj.Host) && obj.Port >= 1 && obj.Port <= 65535;
            if ~ready || ~isempty(obj.Socket)
                return
            end

            try
                if exist('udpport', 'file') == 2 || exist('udpport', 'builtin') == 5
                    obj.Socket = udpport('datagram', 'IPV4', 'OutputDatagramSize', 1200);
                    obj.SocketKind = 'udpport';
                    return
                end
            catch
                obj.Socket = [];
            end

            try
                obj.DestinationAddress = javaMethod( ...
                    'getByName', 'java.net.InetAddress', obj.Host);
                obj.Socket = javaObject('java.net.DatagramSocket');
                obj.SocketKind = 'java';
            catch
                obj.Socket = [];
                obj.SocketKind = '';
                obj.DestinationAddress = [];
                ready = false;
            end
        end
    end

    methods (Static, Access = private)
        function item = encodeAutoItem(key, value)
            if ~isscalar(value) || ~isreal(value)
                item = uint8([]);
                return
            end
            switch class(value)
                case 'logical'
                    valueType = uint8(1);
                    valueBytes = uint8(value);
                case {'int8', 'int16', 'int32'}
                    valueType = uint8(2);
                    valueBytes = debugscope.Scope.numericBytes(value, 'int32');
                case {'uint8', 'uint16', 'uint32'}
                    valueType = uint8(3);
                    valueBytes = debugscope.Scope.numericBytes(value, 'uint32');
                case 'int64'
                    valueType = uint8(4);
                    valueBytes = debugscope.Scope.numericBytes(value, 'int64');
                case 'uint64'
                    valueType = uint8(5);
                    valueBytes = debugscope.Scope.numericBytes(value, 'uint64');
                case 'single'
                    valueType = uint8(6);
                    valueBytes = debugscope.Scope.numericBytes(value, 'single');
                case 'double'
                    valueType = uint8(7);
                    valueBytes = debugscope.Scope.numericBytes(value, 'double');
                otherwise
                    item = uint8([]);
                    return
            end
            item = debugscope.Scope.makeItem(key, valueType, valueBytes);
        end

        function item = makeItem(key, valueType, valueBytes)
            if isempty(valueBytes)
                item = uint8([]);
                return
            end
            try
                keyBytes = unicode2native(char(string(key)), 'UTF-8');
            catch
                item = uint8([]);
                return
            end
            keyBytes = reshape(uint8(keyBytes), 1, []);
            if isempty(keyBytes) || numel(keyBytes) > 255
                item = uint8([]);
                return
            end
            item = [ ...
                debugscope.Scope.numericBytes(numel(keyBytes), 'uint16'), ...
                keyBytes, uint8(valueType), reshape(uint8(valueBytes), 1, [])];
        end

        function bytes = numericBytes(value, typeName)
            try
                value = cast(value, typeName);
                if computer('endian') == 'B' && numel(typecast(value, 'uint8')) > 1
                    value = swapbytes(value);
                end
                bytes = reshape(typecast(value, 'uint8'), 1, []);
            catch
                bytes = uint8([]);
            end
        end

        function bytes = limitedUtf8(text, maximum)
            text = char(string(text));
            bytes = unicode2native(text, 'UTF-8');
            while numel(bytes) > maximum && ~isempty(text)
                text(end) = [];
                bytes = unicode2native(text, 'UTF-8');
            end
            if isempty(bytes)
                bytes = uint8('matlab');
            else
                bytes = reshape(uint8(bytes), 1, []);
            end
        end

        function pid = processId()
            try
                pid = uint32(feature('getpid'));
            catch
                pid = uint32(0);
            end
        end
    end
end
