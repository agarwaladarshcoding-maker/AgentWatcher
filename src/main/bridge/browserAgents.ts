import type { BrowserAgentState, TrackedTab } from "../../shared/types";

/**
 * BrowserAgentRegistry — the browser analog of SessionManager, but read-only
 * with respect to the tabs (spec: browser-bonding §B2). It holds the live set
 * of watched Chrome tabs reported by the extension over the bridge, keyed by
 * `tabId`, and notifies a sink on every change so the main process can fan the
 * update out to the renderer "Chrome section" and fire completion toasts.
 *
 * It owns NO transport and NO PTYs — it is pure state. The bridge feeds it; the
 * main process subscribes to it. When the bridge disconnects, `clear()` empties
 * it so the Chrome section hides entirely (additive-bonding invariant).
 */
export interface BrowserAgentSink {
  /** The full set changed (snapshot replace, single update, add, or clear). */
  onListChanged(tabs: TrackedTab[]): void;
  /** A tab transitioned to "done" with output — fire a notification. */
  onCompleted(tab: TrackedTab): void;
}

export class BrowserAgentRegistry {
  private readonly tabs = new Map<number, TrackedTab>();

  constructor(private readonly sink: BrowserAgentSink) {}

  list(): TrackedTab[] {
    return [...this.tabs.values()].sort((a, b) => a.tabId - b.tabId);
  }

  has(tabId: number): boolean {
    return this.tabs.has(tabId);
  }

  /** Replace the whole snapshot (extension `bridge:agents`). */
  replaceSnapshot(agents: TrackedTab[]): void {
    this.tabs.clear();
    for (const a of agents) {
      if (typeof a?.tabId === "number") {
        this.tabs.set(a.tabId, { ...a, lastChange: a.lastChange || Date.now() });
      }
    }
    this.sink.onListChanged(this.list());
  }

  /** Apply a live per-tab state change (extension `agent:state`). */
  applyState(tabId: number, state: BrowserAgentState): void {
    const t = this.tabs.get(tabId);
    if (!t) return; // unknown tab — ignore safely (R5.5)
    if (t.state === state) return;
    t.state = state;
    t.lastChange = Date.now();
    this.sink.onListChanged(this.list());
  }

  /** Apply a completion (extension `agent:completed`). */
  applyCompleted(
    tabId: number,
    label: string,
    snippet?: string,
    output?: string,
  ): void {
    let t = this.tabs.get(tabId);
    if (!t) {
      // The completion may arrive before a snapshot; create a minimal entry.
      t = {
        tabId,
        adapterId: "unknown",
        label,
        state: "done",
        lastChange: Date.now(),
      };
      this.tabs.set(tabId, t);
    }
    t.state = "done";
    t.label = label || t.label;
    t.snippet = snippet;
    t.output = output;
    t.lastChange = Date.now();
    this.sink.onListChanged(this.list());
    this.sink.onCompleted({ ...t });
  }

  /** Drop a single tab (e.g. the tab closed). */
  remove(tabId: number): void {
    if (this.tabs.delete(tabId)) this.sink.onListChanged(this.list());
  }

  /** Empty the registry (bridge disconnected) so the Chrome section hides. */
  clear(): void {
    if (this.tabs.size === 0) return;
    this.tabs.clear();
    this.sink.onListChanged(this.list());
  }
}
