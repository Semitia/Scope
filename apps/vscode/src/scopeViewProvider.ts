import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { HubManager } from './hubManager';

export class ScopeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'debugscope.scope';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly hubManager: HubManager,
  ) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    const webviewRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message.type === 'openBrowser') void this.openBrowser();
      if (message.type === 'restartHub') void this.restartHub();
    });

    try {
      await this.hubManager.ensureStarted();
      void view.webview.postMessage({ type: 'hubReady' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void view.webview.postMessage({ type: 'hubError', detail });
    }
  }

  reveal(): void {
    this.view?.show?.(true);
  }

  async openBrowser(): Promise<void> {
    await this.hubManager.ensureStarted();
    await vscode.env.openExternal(vscode.Uri.parse(this.hubManager.browserUrl));
  }

  async restartHub(): Promise<void> {
    await this.hubManager.restart();
    void this.view?.webview.postMessage({ type: 'hubReady' });
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js'),
    );
    const stylePath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.css');
    const styles = readFileSync(stylePath.fsPath, 'utf8');
    const nonce = createNonce();
    const websocketUrl = this.hubManager.websocketUrl;

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${websocketUrl};">
    <style nonce="${nonce}">${styles}</style>
    <title>DebugScope</title>
  </head>
  <body data-hub-url="${websocketUrl}">
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
