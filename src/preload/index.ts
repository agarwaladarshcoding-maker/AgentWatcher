import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { LaunchInfo } from "../main/launch";
import {
  IPC,
  type PtySize,
  type PtyStartResult,
  type PtyExitInfo,
  type AgentState,
  type FeedEvent,
} from "../shared/ipc";

/**
 * The preload bridge — the ONLY surface that crosses from main to the renderer
 * (architecture doc §18, §22). contextIsolation is on and nodeIntegration is
 * off, so the renderer never touches Node, the PTY, or SQLite directly; it only
 * sees this typed API on `window.agentwatch`.
 *
 * Phase 1 adds the mirror surface: start the PTY, stream output, send input,
 * resize, and observe exit. Each subscription returns an unsubscribe fn so the
 * renderer can clean up listeners and never leak them across re-mounts.
 */
function subscribe<T>(
  channel: string,
  callback: (payload: T) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void =>
    callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  // what we were launched to watch
  getLaunchInfo(): Promise<LaunchInfo> {
    return ipcRenderer.invoke(IPC.appGetLaunchInfo);
  },

  // --- mirror ---
  /** Spawn the PTY at the given size. Call once xterm has mounted + fitted. */
  startPty(size: PtySize): Promise<PtyStartResult> {
    return ipcRenderer.invoke(IPC.ptyStart, size);
  },
  /** Verbatim PTY output. Push straight into term.write() — never into React state. */
  onData(callback: (chunk: string) => void): () => void {
    return subscribe<string>(IPC.ptyData, callback);
  },
  /** Send keystrokes / paste to the PTY stdin. */
  sendInput(data: string): void {
    ipcRenderer.send(IPC.ptyInput, data);
  },
  /** Keep the PTY size synced to the rendered terminal (honored only when the mirror owns size). */
  resize(cols: number, rows: number): void {
    ipcRenderer.send(IPC.ptyResize, { cols, rows } satisfies PtySize);
  },
  /** Authoritative PTY size changed (e.g. the native terminal resized). */
  onSize(callback: (size: PtySize) => void): () => void {
    return subscribe<PtySize>(IPC.ptySize, callback);
  },
  /** Fires once when the wrapped process exits. */
  onExit(callback: (info: PtyExitInfo) => void): () => void {
    return subscribe<PtyExitInfo>(IPC.ptyExit, callback);
  },

  // --- the words ---
  /** Current interpreted agent state. */
  onState(callback: (state: AgentState) => void): () => void {
    return subscribe<AgentState>(IPC.agentState, callback);
  },
  /** A new entry for the live event feed. */
  onEvent(callback: (event: FeedEvent) => void): () => void {
    return subscribe<FeedEvent>(IPC.feedEvent, callback);
  },
};

export type AgentWatchApi = typeof api;

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("agentwatch", api);
  } catch (error) {
    console.error("[agentwatch] failed to expose preload bridge:", error);
  }
} else {
  // Fallback only used if contextIsolation were ever disabled (it isn't).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).agentwatch = api;
}
