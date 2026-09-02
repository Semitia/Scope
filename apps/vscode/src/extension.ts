import * as vscode from 'vscode';
import { HubManager } from './hubManager';
import { ScopeViewProvider } from './scopeViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DebugScope');
  const hubManager = new HubManager(context.extensionUri, output);
  const provider = new ScopeViewProvider(context.extensionUri, hubManager);

  context.subscriptions.push(
    hubManager,
    vscode.window.registerWebviewViewProvider(ScopeViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('debugscope.openBrowser', () => provider.openBrowser()),
    vscode.commands.registerCommand('debugscope.restartHub', () => provider.restartHub()),
  );
}

export function deactivate(): void {}
