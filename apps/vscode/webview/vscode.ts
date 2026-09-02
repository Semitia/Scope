interface VsCodeApi<State = unknown> {
  getState(): State | undefined;
  setState(state: State): void;
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>;

const previewApi: VsCodeApi = {
  getState: () => undefined,
  setState: () => {},
  postMessage: (message) => console.info('[DebugScope preview]', message),
};

export const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : previewApi;
