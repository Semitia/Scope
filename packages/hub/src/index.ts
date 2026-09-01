import dgram from 'node:dgram';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { decodeDatagram, ProtocolError } from './protocol.js';
import { TelemetryStore, type SamplePoint } from './store.js';

interface HubOptions {
  bindAddress: string;
  udpPort: number;
  httpPort: number;
  staticDirectory?: string;
  quiet?: boolean;
}

interface PendingBatch {
  sourceId: number;
  key: string;
  valueType: string;
  samples: SamplePoint[];
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function nowSeconds(): number {
  return performance.now() / 1000;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

export class DebugScopeHub {
  readonly store = new TelemetryStore();
  readonly udpSocket = dgram.createSocket('udp4');
  readonly httpServer = createServer((request, response) => this.handleHttp(request, response));
  readonly webSocketServer = new WebSocketServer({ noServer: true });

  private readonly pendingBatches = new Map<string, PendingBatch>();
  private flushTimer?: NodeJS.Timeout;
  private catalogDirty = true;
  private lastCatalogAt = 0;
  private samplesSinceRateUpdate = 0;
  private rateUpdatedAt = nowSeconds();
  private sampleRate = 0;
  private startedAt = nowSeconds();
  private closed = false;

  constructor(readonly options: HubOptions) {
    this.udpSocket.on('message', (datagram) => this.handleDatagram(datagram));
    this.udpSocket.on('error', (error) => this.log(`UDP error: ${error.message}`));

    this.httpServer.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname !== '/api/ws') {
        socket.destroy();
        return;
      }
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
        this.webSocketServer.emit('connection', client, request);
      });
    });

    this.webSocketServer.on('connection', (client) => {
      this.send(client, {
        type: 'snapshot',
        ...this.store.snapshot(nowSeconds()),
        stats: this.stats(),
      });
      client.on('message', (rawMessage) => this.handleClientMessage(client, rawMessage.toString()));
    });
  }

  async start(): Promise<void> {
    this.startedAt = nowSeconds();
    await Promise.all([
      new Promise<void>((resolvePromise, rejectPromise) => {
        const onError = (error: Error) => rejectPromise(error);
        this.udpSocket.once('error', onError);
        this.udpSocket.bind(this.options.udpPort, this.options.bindAddress, () => {
          this.udpSocket.off('error', onError);
          resolvePromise();
        });
      }),
      new Promise<void>((resolvePromise, rejectPromise) => {
        const onError = (error: Error) => rejectPromise(error);
        this.httpServer.once('error', onError);
        this.httpServer.listen(this.options.httpPort, this.options.bindAddress, () => {
          this.httpServer.off('error', onError);
          resolvePromise();
        });
      }),
    ]);

    this.flushTimer = setInterval(() => this.flush(), 1000 / 30);
    this.flushTimer.unref();
    this.log(`UDP listening on ${this.options.bindAddress}:${this.options.udpPort}`);
    this.log(`HTTP/WebSocket listening on http://${this.options.bindAddress}:${this.options.httpPort}`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    for (const client of this.webSocketServer.clients) client.close();
    this.webSocketServer.close();
    await Promise.all([
      new Promise<void>((resolvePromise) => this.udpSocket.close(() => resolvePromise())),
      new Promise<void>((resolvePromise) => this.httpServer.close(() => resolvePromise())),
    ]);
  }

  private handleDatagram(datagram: Buffer): void {
    try {
      const packet = decodeDatagram(datagram);
      const result = this.store.ingest(packet, nowSeconds());
      if (result.catalogChanged) this.catalogDirty = true;
      for (const batch of result.batches) {
        const batchKey = `${batch.sourceId}:${batch.key}`;
        let pending = this.pendingBatches.get(batchKey);
        if (!pending) {
          pending = { ...batch, samples: [] };
          this.pendingBatches.set(batchKey, pending);
        }
        pending.valueType = batch.valueType;
        pending.samples.push(...batch.samples);
        this.samplesSinceRateUpdate += batch.samples.length;
      }
    } catch (error) {
      this.store.malformedPackets += 1;
      if (!(error instanceof ProtocolError)) this.log(`Packet error: ${(error as Error).message}`);
    }
  }

  private flush(): void {
    const currentTime = nowSeconds();
    const rateElapsed = currentTime - this.rateUpdatedAt;
    if (rateElapsed >= 1) {
      this.sampleRate = Math.round(this.samplesSinceRateUpdate / rateElapsed);
      this.samplesSinceRateUpdate = 0;
      this.rateUpdatedAt = currentTime;
    }

    if (this.catalogDirty || currentTime - this.lastCatalogAt >= 1) {
      this.broadcast({ type: 'catalog', sources: this.store.catalog(currentTime), stats: this.stats() });
      this.catalogDirty = false;
      this.lastCatalogAt = currentTime;
    }

    if (this.pendingBatches.size > 0) {
      this.broadcast({
        type: 'samples',
        batches: [...this.pendingBatches.values()],
        stats: this.stats(),
      });
      this.pendingBatches.clear();
    }
  }

  private handleClientMessage(client: WebSocket, rawMessage: string): void {
    try {
      const message = JSON.parse(rawMessage) as { type?: string; sourceId?: number };
      if (message.type === 'clear') {
        this.store.clear();
        this.pendingBatches.clear();
        this.broadcast({ type: 'cleared' });
      } else if (message.type === 'snapshot') {
        this.send(client, {
          type: 'snapshot',
          ...this.store.snapshot(nowSeconds()),
          stats: this.stats(),
        });
      } else if (
        message.type === 'deleteSource' &&
        Number.isInteger(message.sourceId) &&
        message.sourceId !== undefined &&
        this.store.deleteSource(message.sourceId)
      ) {
        for (const key of this.pendingBatches.keys()) {
          if (key.startsWith(`${message.sourceId}:`)) this.pendingBatches.delete(key);
        }
        this.catalogDirty = true;
      }
    } catch {
      // Control messages are untrusted; malformed input is ignored.
    }
  }

  private handleHttp(request: IncomingMessage, response: ServerResponse): void {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    if (requestUrl.pathname === '/health') {
      sendJson(response, 200, { ok: true, ...this.stats() });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'method not allowed' });
      return;
    }

    if (!this.options.staticDirectory) {
      sendJson(response, 200, {
        name: 'DebugScope Hub',
        websocket: '/api/ws',
        udpPort: this.options.udpPort,
      });
      return;
    }

    const staticRoot = resolve(this.options.staticDirectory);
    let pathname: string;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      sendJson(response, 400, { error: 'invalid path' });
      return;
    }

    const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    let filePath = resolve(staticRoot, requestedPath);
    if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${sep}`)) {
      sendJson(response, 403, { error: 'forbidden' });
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = resolve(staticRoot, 'index.html');
    if (!existsSync(filePath)) {
      sendJson(response, 404, { error: 'browser build not found; run npm run build' });
      return;
    }

    const fileSize = statSync(filePath).size;
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': fileSize,
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  }

  private stats(): Record<string, number> {
    return {
      nowSeconds: nowSeconds(),
      uptimeSeconds: Math.max(0, nowSeconds() - this.startedAt),
      sampleRate: this.sampleRate,
      memoryBytes: this.store.memoryBytes(),
      sourceCount: this.store.sources.size,
      clientCount: this.webSocketServer.clients.size,
      malformedPackets: this.store.malformedPackets,
    };
  }

  private broadcast(value: unknown): void {
    const encoded = JSON.stringify(value);
    for (const client of this.webSocketServer.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(encoded);
    }
  }

  private send(client: WebSocket, value: unknown): void {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value));
  }

  private log(message: string): void {
    if (!this.options.quiet) console.log(`[DebugScope] ${message}`);
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function optionsFromArguments(): HubOptions {
  return {
    bindAddress: readArgument('--bind') ?? process.env.DEBUGSCOPE_BIND ?? '127.0.0.1',
    udpPort: parsePort(readArgument('--udp-port') ?? process.env.DEBUGSCOPE_UDP_PORT, 4711),
    httpPort: parsePort(readArgument('--http-port') ?? process.env.DEBUGSCOPE_HTTP_PORT, 4712),
    staticDirectory: readArgument('--static'),
    quiet: process.argv.includes('--quiet'),
  };
}

async function main(): Promise<void> {
  const hub = new DebugScopeHub(optionsFromArguments());
  await hub.start();

  const shutDown = async () => {
    await hub.close();
    process.exit(0);
  };
  process.once('SIGINT', shutDown);
  process.once('SIGTERM', shutDown);
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main().catch((error) => {
    console.error(`[DebugScope] Failed to start: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
