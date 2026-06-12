import { create } from "zustand";
import type { AgentState, FeedEvent, SessionInfo } from "../../../shared/types";

/**
 * Multi-session renderer store. Holds session metadata, the active selection,
 * per-session interpreted state, and per-session event feeds. Terminal OUTPUT
 * is NOT here — it lives only in xterm via the imperative TerminalManager (§18).
 */
interface SessionsStore {
  sessions: SessionInfo[];
  activeId: string | null;
  states: Record<string, AgentState>;
  events: Record<string, FeedEvent[]>;

  setSessions: (list: SessionInfo[]) => void;
  setActive: (id: string) => void;
  applyState: (id: string, state: AgentState) => void;
  addEvent: (id: string, event: FeedEvent) => void;
  applyExit: (id: string, code: number) => void;
}

const MAX_EVENTS = 300;

export const useSessions = create<SessionsStore>((set) => ({
  sessions: [],
  activeId: null,
  states: {},
  events: {},

  setSessions: (list) =>
    set((prev) => {
      const exists = prev.activeId && list.some((s) => s.id === prev.activeId);
      const activeId = exists ? prev.activeId : (list[list.length - 1]?.id ?? null);
      return { sessions: list, activeId };
    }),

  setActive: (id) => set({ activeId: id }),

  applyState: (id, state) =>
    set((prev) => ({ states: { ...prev.states, [id]: state } })),

  addEvent: (id, event) =>
    set((prev) => {
      const list = prev.events[id] ?? [];
      return { events: { ...prev.events, [id]: [event, ...list].slice(0, MAX_EVENTS) } };
    }),

  applyExit: (id, code) =>
    set((prev) => ({
      states: { ...prev.states, [id]: "done" },
      sessions: prev.sessions.map((s) =>
        s.id === id ? { ...s, ended: true, exitCode: code } : s,
      ),
    })),
}));
