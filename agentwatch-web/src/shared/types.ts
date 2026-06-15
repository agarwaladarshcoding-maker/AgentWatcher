/**
 * Shared types & constants for AgentWatch Web (spec: browser-bonding §B7).
 *
 * Two contracts live here:
 *   1. The IN-EXTENSION messages between content scripts, the service worker,
 *      and the popup (§12 of the web plan).
 *   2. The BRIDGE contract to the desktop app (mirror of the desktop
 *      src/shared/bridge.ts) — kept as a local copy because the extension is a
 *      separate build tree with no remote code.
 */

export type AgentState = "idle" | "working" | "done";

/** One watched browser tab, keyed by Chrome tabId. */
export interface TrackedAgent {
  tabId: number;
  windowId?: number;
  adapterId: string;
  label: string;
  url?: string;
  favIconUrl?: string;
  state: AgentState;
  lastChange: number;
  snippet?: string;
  output?: string;
}

/** content → service worker. */
export type ContentMsg =
  | { type: "agent:state"; adapterId: string; label: string; state: AgentState }
  | {
      type: "agent:completed";
      adapterId: string;
      label: string;
      snippet?: string;
      output?: string;
    };

/** service worker → content. */
export type WorkerToContentMsg =
  | { type: "scrollToLatest" }
  | { type: "injectReply"; text: string };

/** popup → service worker. */
export type PopupQuery =
  | { type: "dashboard:query" }
  | { type: "focusAgent"; tabId: number }
  | { type: "bridge:setCode"; code: string }
  | { type: "bridge:getStatus" };

/** service worker → popup (responses). */
export interface DashboardSnapshot {
  agents: TrackedAgent[];
  bridge: { connected: boolean; code: string };
}

// ── Bridge contract (mirror of desktop src/shared/bridge.ts) ──
export const BRIDGE_PROTOCOL_VERSION = "1";
export const BRIDGE_DEFAULT_PORT = 8731;
export const BRIDGE_PORT_RANGE = 10;

export type BridgeOutbound =
  | { type: "bridge:hello"; version: string; adapters: string[]; token?: string }
  | { type: "bridge:agents"; agents: TrackedAgent[] }
  | { type: "agent:state"; tabId: number; state: AgentState }
  | {
      type: "agent:completed";
      tabId: number;
      label: string;
      snippet?: string;
      output?: string;
    };

export type BridgeInbound =
  | { type: "bridge:hello-ack"; version: string; capabilities: string[] }
  | { type: "bridge:denied"; reason: string }
  | { type: "focusTab"; tabId: number }
  | { type: "scrollToLatest"; tabId: number }
  | { type: "injectReply"; tabId: number; text: string };

/** Default quiescence debounce (ms) for adapters without a busy signal. */
export const DEFAULT_QUIET_MS = 1200;
