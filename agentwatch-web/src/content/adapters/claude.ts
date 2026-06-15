import { genericInjectReply, type AgentSiteAdapter } from "./types";

/**
 * Claude (claude.ai) — the reference adapter (spec §9.2).
 * SELECTORS ARE ILLUSTRATIVE; verify live and keep tiny so drift degrades to
 * the generic quiescence fallback rather than breaking the page.
 */
export const claude: AgentSiteAdapter = {
  id: "claude",
  label: "Claude",
  match: ["claude.ai"],
  busySelector: 'button[aria-label="Stop response"]',
  streamRoot: () =>
    document.querySelector('[data-testid="conversation"]') ??
    document.querySelector("main") ??
    document.body,
  quietMs: 1200,
  lastMessageText: () => {
    const nodes = document.querySelectorAll('[data-testid="assistant-message"]');
    return nodes.length ? (nodes[nodes.length - 1].textContent ?? null) : null;
  },
  jumpTarget: () => {
    const nodes = document.querySelectorAll('[data-testid="assistant-message"]');
    return nodes.length ? nodes[nodes.length - 1] : null;
  },
  injectReply: (text) =>
    genericInjectReply('div[contenteditable="true"], textarea', text),
};
