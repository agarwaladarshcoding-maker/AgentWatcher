/**
 * The AgentWatch ⇄ AgentWatch Web bridge contract (spec: browser-bonding §B3).
 *
 * A small, explicit, transport-agnostic message set spoken over a local,
 * server-less channel (loopback WebSocket in v1; native messaging later). Both
 * sides exchange JSON text frames shaped by the unions below. Keep this file
 * dependency-free so it can be imported by main, preload, renderer, AND the
 * Chrome extension (which copies it into its own tree).
 */
import type { BrowserAgentState, TrackedTab } from "./types";

/** Protocol version; bumped on breaking contract changes. */
export const BRIDGE_PROTOCOL_VERSION = "1";

/** Default loopback port + a small fallback range the extension probes. */
export const BRIDGE_DEFAULT_PORT = 8731;
export const BRIDGE_PORT_RANGE = 10; // probes 8731..8740

/** Extension → app messages. */
export type BridgeInbound =
  | {
      type: "bridge:hello";
      version: string;
      adapters: string[];
      /** Pairing token (the code shown by the desktop app). */
      token?: string;
    }
  | { type: "bridge:agents"; agents: TrackedTab[] }
  | { type: "agent:state"; tabId: number; state: BrowserAgentState }
  | {
      type: "agent:completed";
      tabId: number;
      label: string;
      snippet?: string;
      output?: string;
    };

/** App → extension messages. */
export type BridgeOutbound =
  | { type: "bridge:hello-ack"; version: string; capabilities: string[] }
  | { type: "bridge:denied"; reason: string }
  | { type: "focusTab"; tabId: number }
  | { type: "scrollToLatest"; tabId: number }
  | { type: "injectReply"; tabId: number; text: string };

/** Narrow an unknown parsed value to a BridgeInbound, or return null. */
export function parseInbound(raw: unknown): BridgeInbound | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case "bridge:hello":
      if (typeof m.version !== "string" || !Array.isArray(m.adapters)) return null;
      return {
        type: "bridge:hello",
        version: m.version,
        adapters: m.adapters.filter((a): a is string => typeof a === "string"),
        token: typeof m.token === "string" ? m.token : undefined,
      };
    case "bridge:agents":
      if (!Array.isArray(m.agents)) return null;
      return { type: "bridge:agents", agents: m.agents as TrackedTab[] };
    case "agent:state":
      if (typeof m.tabId !== "number" || typeof m.state !== "string") return null;
      return {
        type: "agent:state",
        tabId: m.tabId,
        state: m.state as BrowserAgentState,
      };
    case "agent:completed":
      if (typeof m.tabId !== "number" || typeof m.label !== "string") return null;
      return {
        type: "agent:completed",
        tabId: m.tabId,
        label: m.label,
        snippet: typeof m.snippet === "string" ? m.snippet : undefined,
        output: typeof m.output === "string" ? m.output : undefined,
      };
    default:
      return null;
  }
}
