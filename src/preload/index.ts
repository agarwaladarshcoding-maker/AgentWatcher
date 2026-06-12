import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC,
  type SessionInfo,
  type SessionDataMsg,
  type SessionStateMsg,
  type SessionEventMsg,
  type SessionSizeMsg,
  type SessionExitMsg,
  type SessionInputMsg,
  type SessionResizeMsg,
  type SessionRespondMsg,
  type SessionRenameMsg,
  type SessionPermissionMsg,
  type SessionVerdictMsg,
  type HistoryFilter,
  type HistoryRow,
  type AppSettings,
} from "../shared/ipc";

/**
 * The preload bridge — the ONLY surface that crosses from main to the renderer
 * (architecture doc §18, §22). contextIsolation on, nodeIntegration off; the
 * renderer never touches Node, the PTYs, or the socket directly.
 *
 * Everything is session-keyed now (multi-agent). Each subscription returns an
 * unsubscribe fn so the renderer never leaks listeners.
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
  // --- sessions ---
  getSessions(): Promise<SessionInfo[]> {
    return ipcRenderer.invoke(IPC.sessionsGet);
  },
  onSessions(callback: (list: SessionInfo[]) => void): () => void {
    return subscribe<SessionInfo[]>(IPC.sessionsList, callback);
  },

  // --- mirror (verbatim output goes straight to xterm, never React state) ---
  onData(callback: (msg: SessionDataMsg) => void): () => void {
    return subscribe<SessionDataMsg>(IPC.sessionData, callback);
  },
  onSize(callback: (msg: SessionSizeMsg) => void): () => void {
    return subscribe<SessionSizeMsg>(IPC.sessionSize, callback);
  },
  onExit(callback: (msg: SessionExitMsg) => void): () => void {
    return subscribe<SessionExitMsg>(IPC.sessionExit, callback);
  },
  sendInput(id: string, data: string): void {
    ipcRenderer.send(IPC.sessionInput, { id, data } satisfies SessionInputMsg);
  },
  resize(id: string, cols: number, rows: number): void {
    ipcRenderer.send(IPC.sessionResize, {
      id,
      cols,
      rows,
    } satisfies SessionResizeMsg);
  },
  close(id: string): void {
    ipcRenderer.send(IPC.sessionClose, id);
  },
  rename(id: string, name: string): void {
    ipcRenderer.send(IPC.sessionRename, { id, name } satisfies SessionRenameMsg);
  },

  // --- permission control plane ---
  onPermission(callback: (msg: SessionPermissionMsg) => void): () => void {
    return subscribe<SessionPermissionMsg>(IPC.sessionPermission, callback);
  },
  onVerdict(callback: (msg: SessionVerdictMsg) => void): () => void {
    return subscribe<SessionVerdictMsg>(IPC.sessionVerdict, callback);
  },
  respond(id: string, permissionId: string, decision: "allow" | "deny"): void {
    ipcRenderer.send(IPC.sessionRespond, {
      id,
      permissionId,
      decision,
    } satisfies SessionRespondMsg);
  },

  // --- audit log + settings (Phase 4) ---
  getHistory(filter: HistoryFilter = {}): Promise<HistoryRow[]> {
    return ipcRenderer.invoke(IPC.historyQuery, filter);
  },
  getSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.settingsGet);
  },
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.settingsSet, patch);
  },

  // --- the words ---
  onState(callback: (msg: SessionStateMsg) => void): () => void {
    return subscribe<SessionStateMsg>(IPC.sessionState, callback);
  },
  onEvent(callback: (msg: SessionEventMsg) => void): () => void {
    return subscribe<SessionEventMsg>(IPC.sessionEvent, callback);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).agentwatch = api;
}
