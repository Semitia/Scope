import { get } from 'node:http';
import * as vscode from 'vscode';
import { DebugScopeHub } from '../../../packages/hub/src/service';

const BIND_ADDRESS = '127.0.0.1';

function configuredPort(name: 'udpPort' | 'httpPort', fallback: number): number {
  const value = vscode.workspace.getConfiguration('debugscope').get<number>(name, fallback);
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback;
}

function isHubAvailable(httpPort: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const request = get(`http://${BIND_ADDRESS}:${httpPort}/health`, (response) => {
      response.resume();
      resolvePromise(response.statusCode === 200);
    });
    request.setTimeout(450, () => request.destroy());
    request.once('error', () => resolvePromise(false));
  });
}

export class HubManager implements vscode.Disposable {
  private ownedHub: DebugScopeHub | undefined;
  private starting: Promise<void> | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
  ) {}

  get httpPort(): number {
    return configuredPort('httpPort', 4712);
  }

  get websocketUrl(): string {
    return `ws://${BIND_ADDRESS}:${this.httpPort}/api/ws`;
  }

  get browserUrl(): string {
    return `http://${BIND_ADDRESS}:${this.httpPort}/`;
  }

  ensureStarted(): Promise<void> {
    if (!this.starting) {
      this.starting = this.startOrAttach().finally(() => { this.starting = undefined; });
    }
    return this.starting;
  }

  async restart(): Promise<void> {
    if (!this.ownedHub) {
      if (await isHubAvailable(this.httpPort)) {
        void vscode.window.showInformationMessage('DebugScope is attached to an externally managed Hub.');
        return;
      }
    } else {
      await this.ownedHub.close();
      this.ownedHub = undefined;
    }
    await this.ensureStarted();
  }

  async dispose(): Promise<void> {
    const hub = this.ownedHub;
    this.ownedHub = undefined;
    if (hub) await hub.close();
    this.output.dispose();
  }

  private async startOrAttach(): Promise<void> {
    const httpPort = this.httpPort;
    if (await isHubAvailable(httpPort)) {
      this.output.appendLine(`Attached to DebugScope Hub at ${this.browserUrl}`);
      return;
    }

    const udpPort = configuredPort('udpPort', 4711);
    const staticDirectory = vscode.Uri.joinPath(this.extensionUri, 'dist', 'browser').fsPath;
    const hub = new DebugScopeHub({
      bindAddress: BIND_ADDRESS,
      udpPort,
      httpPort,
      staticDirectory,
      quiet: true,
    });

    try {
      await hub.start();
      this.ownedHub = hub;
      this.output.appendLine(`Started DebugScope Hub (UDP ${udpPort}, HTTP ${httpPort})`);
    } catch (error) {
      await hub.close().catch(() => undefined);
      if (await isHubAvailable(httpPort)) {
        this.output.appendLine(`Attached to DebugScope Hub after a concurrent start at ${this.browserUrl}`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`Failed to start DebugScope Hub: ${message}`);
      throw error;
    }
  }
}
