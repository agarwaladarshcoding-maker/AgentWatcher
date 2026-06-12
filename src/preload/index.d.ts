import type { AgentWatchApi } from "./index";

/**
 * Ambient declaration so the renderer (React) sees the typed bridge that the
 * preload exposes on `window.agentwatch`.
 */
declare global {
  interface Window {
    agentwatch: AgentWatchApi;
  }
}

export {};
