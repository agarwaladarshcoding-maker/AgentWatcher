import { create } from "zustand";
import type { BrowserAgentState, TrackedTab } from "../../../shared/types";

/**
 * Renderer store for the Chrome section (spec: browser-bonding §B5). Holds the
 * bridge connection flag, the pairing code, and the live set of watched browser
 * tabs streamed from the desktop app. When `connected` is false the Chrome
 * section is hidden entirely (additive bonding).
 */
interface BrowserAgentsStore {
  connected: boolean;
  pairingCode: string;
  port: number | null;
  tabs: TrackedTab[];

  setBridgeStatus: (s: {
    connected: boolean;
    pairingCode: string;
    port: number | null;
  }) => void;
  setSnapshot: (connected: boolean, tabs: TrackedTab[]) => void;
  applyState: (tabId: number, state: BrowserAgentState) => void;
  applyCompleted: (
    tabId: number,
    label: string,
    snippet?: string,
    output?: string,
  ) => void;
}

export const useBrowserAgents = create<BrowserAgentsStore>((set) => ({
  connected: false,
  pairingCode: "",
  port: null,
  tabs: [],

  setBridgeStatus: (s) =>
    set({ connected: s.connected, pairingCode: s.pairingCode, port: s.port }),

  setSnapshot: (connected, tabs) =>
    set({
      connected,
      tabs: [...tabs].sort((a, b) => a.tabId - b.tabId),
    }),

  applyState: (tabId, state) =>
    set((prev) => ({
      tabs: prev.tabs.map((t) =>
        t.tabId === tabId ? { ...t, state, lastChange: Date.now() } : t,
      ),
    })),

  applyCompleted: (tabId, label, snippet, output) =>
    set((prev) => ({
      tabs: prev.tabs.map((t) =>
        t.tabId === tabId
          ? {
              ...t,
              state: "done" as const,
              label: label || t.label,
              snippet,
              output,
              lastChange: Date.now(),
            }
          : t,
      ),
    })),
}));
