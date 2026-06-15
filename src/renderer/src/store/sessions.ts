import { create } from "zustand";
import type {
  AgentState,
  FeedEvent,
  PendingPermission,
  RespondedPermission,
  SessionInfo,
} from "../../../shared/types";

/**
 * Multi-session renderer store. Holds session metadata, the active selection,
 * per-session interpreted state, per-session event feeds, and the per-session
 * permission control plane (pending + responded). Terminal OUTPUT is NOT here —
 * it lives only in xterm via the imperative TerminalManager (§18).
 */
interface SessionsStore {
  sessions: SessionInfo[];
  activeId: string | null;
  states: Record<string, AgentState>;
  events: Record<string, FeedEvent[]>;
  pending: Record<string, PendingPermission[]>;
  responded: Record<string, RespondedPermission[]>;

  setSessions: (list: SessionInfo[]) => void;
  setActive: (id: string) => void;
  applyState: (id: string, state: AgentState) => void;
  addEvent: (id: string, event: FeedEvent) => void;
  applyExit: (id: string, code: number) => void;
  addPending: (id: string, permission: PendingPermission) => void;
  removePending: (id: string, permissionId: string) => void;
  addResponded: (id: string, responded: RespondedPermission) => void;
}

const MAX_EVENTS = 300;
const MAX_RESPONDED = 100;

/** Drop store entries for sessions no longer present (e.g. removed/dismissed). */
function prune<T>(map: Record<string, T>, ids: Set<string>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const id of Object.keys(map)) if (ids.has(id)) next[id] = map[id];
  return next;
}

export const useSessions = create<SessionsStore>((set) => ({
  sessions: [],
  activeId: null,
  states: {},
  events: {},
  pending: {},
  responded: {},

  setSessions: (list) =>
    set((prev) => {
      const ids = new Set(list.map((s) => s.id));
      const exists = prev.activeId && ids.has(prev.activeId);
      const activeId = exists
        ? prev.activeId
        : (list[list.length - 1]?.id ?? null);
      return {
        sessions: list,
        activeId,
        states: prune(prev.states, ids),
        events: prune(prev.events, ids),
        pending: prune(prev.pending, ids),
        responded: prune(prev.responded, ids),
      };
    }),

  setActive: (id) => set({ activeId: id }),

  applyState: (id, state) =>
    set((prev) => ({ states: { ...prev.states, [id]: state } })),

  addEvent: (id, event) =>
    set((prev) => {
      const list = prev.events[id] ?? [];
      return {
        events: { ...prev.events, [id]: [event, ...list].slice(0, MAX_EVENTS) },
      };
    }),

  applyExit: (id, code) =>
    set((prev) => ({
      states: { ...prev.states, [id]: "completed" },
      sessions: prev.sessions.map((s) =>
        s.id === id ? { ...s, ended: true, exitCode: code } : s,
      ),
    })),

  addPending: (id, permission) =>
    set((prev) => {
      const list = prev.pending[id] ?? [];
      // De-dupe by id; newest first (the live prompt is on top).
      const next = [permission, ...list.filter((p) => p.id !== permission.id)];
      return { pending: { ...prev.pending, [id]: next } };
    }),

  removePending: (id, permissionId) =>
    set((prev) => {
      const list = prev.pending[id];
      if (!list) return {};
      return {
        pending: {
          ...prev.pending,
          [id]: list.filter((p) => p.id !== permissionId),
        },
      };
    }),

  addResponded: (id, responded) =>
    set((prev) => {
      const list = prev.responded[id] ?? [];
      return {
        responded: {
          ...prev.responded,
          [id]: [responded, ...list.filter((r) => r.id !== responded.id)].slice(
            0,
            MAX_RESPONDED,
          ),
        },
      };
    }),
}));
