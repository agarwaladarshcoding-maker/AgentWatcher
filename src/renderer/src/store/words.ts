import { create } from "zustand";
import type { AgentState, FeedEvent } from "../../../shared/types";

/**
 * The renderer store for "the words" (architecture doc §10). State changes and
 * feed events are low-frequency and safe to keep in React state — unlike raw
 * terminal output, which must never enter React (§18) and lives only in xterm.
 */
interface WordsStore {
  state: AgentState;
  events: FeedEvent[];
  setState: (state: AgentState) => void;
  addEvent: (event: FeedEvent) => void;
  reset: () => void;
}

const MAX_EVENTS = 200;

export const useWords = create<WordsStore>((set) => ({
  state: "idle",
  events: [],
  setState: (state) => set({ state }),
  addEvent: (event) =>
    set((prev) => ({ events: [event, ...prev.events].slice(0, MAX_EVENTS) })),
  reset: () => set({ state: "idle", events: [] }),
}));
