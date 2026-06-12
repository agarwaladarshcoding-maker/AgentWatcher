import { create } from "zustand";
import type {
  AgentState,
  FeedEvent,
  SessionInfo,
  PendingPermission,
  Verdict,
} from "../../../shared/types";

/** A resolved permission kept for the Responded tab. */
export interface RespondedItem {
  permission: PendingPermission;
  verdict: Verdict;
}

/**
 * Multi-session renderer store. Holds session metadata, the active selection,
 * per-session interpreted state, event feeds, and the permission control plane
 * (pending + responded). Terminal OUTPUT is NOT here — it lives only in xterm
 * via the imperative TerminalManager (§18).
 */
interface SessionsStore {
  sessions: SessionInfo[];
  activeId: string | null;
  states: Record<string, AgentState>;
  events: Record<string, FeedEvent[]>;
  pending: Record<string, PendingPermission[]>;
  responded: Record<string, RespondedItem[]>;

  setSessions: (list: SessionInfo[]) => void;
  setActive: (id: string) => void;
  applyState: (id: string, state: AgentState) => void;
  addEvent: (id: string, event: FeedEvent) => void;
  addPermission: (id: string, permission: PendingPermission) => void;
  resolvePermission: (id: string, verdict: Verdict) => void;
  applyExit: (id: string, code: number) => void;
}

const MAX_EVENTS = 300;
const MAX_RESPONDED = 100;

export const useSessions = create<SessionsStore>((set) => ({
  sessions: [],
  activeId: null,
  states: {},
  events: {},
  pending: {},
  responded: {},

  setSessions: (list) =>
    set((prev) => {
      const exists = prev.activeId && list.some((s) => s.id === prev.activeId);
      const activeId = exists
        ? prev.activeId
        : (list[list.length - 1]?.id ?? null);
      return { sessions: list, activeId };
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

  addPermission: (id, permission) =>
    set((prev) => {
      const list = prev.pending[id] ?? [];
      if (list.some((p) => p.id === permission.id)) return {};
      return { pending: { ...prev.pending, [id]: [...list, permission] } };
    }),

  resolvePermission: (id, verdict) =>
    set((prev) => {
      const pend = prev.pending[id] ?? [];
      const match = pend.find((p) => p.id === verdict.permissionId);
      const nextPend = pend.filter((p) => p.id !== verdict.permissionId);
      const resp = prev.responded[id] ?? [];
      const item: RespondedItem = {
        permission: match ?? {
          id: verdict.permissionId,
          ts: verdict.ts,
          title: "Permission",
          source: "",
          rawPrompt: "",
          allowInput: "",
          denyInput: "",
        },
        verdict,
      };
      return {
        pending: { ...prev.pending, [id]: nextPend },
        responded: {
          ...prev.responded,
          [id]: [item, ...resp].slice(0, MAX_RESPONDED),
        },
      };
    }),

  applyExit: (id, code) =>
    set((prev) => ({
      states: { ...prev.states, [id]: "done" },
      pending: { ...prev.pending, [id]: [] },
      sessions: prev.sessions.map((s) =>
        s.id === id ? { ...s, ended: true, exitCode: code } : s,
      ),
    })),
}));
