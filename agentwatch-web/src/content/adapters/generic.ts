import { genericInjectReply, type AgentSiteAdapter } from "./types";

/**
 * Generic fallback adapter (spec §9.2). Pure mutation quiescence: no busy
 * signal, just "the page stopped changing for quietMs → done". Used for any
 * host without a dedicated adapter, and as the safety net when a real adapter's
 * busy selector drifts. Less precise, never broken.
 */
export const generic: AgentSiteAdapter = {
  id: "generic",
  label: "AI agent",
  match: [],
  streamRoot: () => document.querySelector("main") ?? document.body,
  quietMs: 1500,
  lastMessageText: () => null,
  jumpTarget: () => null,
  injectReply: (text) =>
    genericInjectReply('div[contenteditable="true"], textarea', text),
};
