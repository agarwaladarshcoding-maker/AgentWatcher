import { contextBridge, ipcRenderer } from "electron";
import type { LaunchInfo } from "../main/launch";

/**
 * The preload bridge — the ONLY surface that crosses from main to the renderer
 * (architecture doc §18, §22). contextIsolation is on and nodeIntegration is
 * off, so the renderer never touches Node, the PTY, or SQLite directly; it only
 * sees this typed API on `window.agentwatch`.
 *
 * Phase 0 exposes just enough to prove the bridge works: fetch the wrapped
 * command. The mirror / words / permission methods land in later phases.
 */
const api = {
  getLaunchInfo(): Promise<LaunchInfo> {
    return ipcRenderer.invoke("app:getLaunchInfo");
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
  // @ts-expect-error -- attach to window in the non-isolated case
  window.agentwatch = api;
}
