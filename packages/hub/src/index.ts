import { DebugScopeHub, type HubOptions } from './service.js';

export { DebugScopeHub, type HubOptions } from './service.js';

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

main().catch((error) => {
  console.error(`[DebugScope] Failed to start: ${(error as Error).message}`);
  process.exitCode = 1;
});
