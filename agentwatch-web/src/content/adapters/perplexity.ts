import { genericInjectReply, type AgentSiteAdapter } from "./types";

/** Perplexity (perplexity.ai). Staged render (answer + sources) → larger quietMs. */
export const perplexity: AgentSiteAdapter = {
  id: "perplexity",
  label: "Perplexity",
  match: ["perplexity.ai"],
  busySelector: 'button[aria-label="Stop"], button[aria-label="Stop generating"]',
  streamRoot: () => document.querySelector("main") ?? document.body,
  quietMs: 1800,
  lastMessageText: () => {
    const nodes = document.querySelectorAll('.prose, [class*="answer"]');
    return nodes.length ? (nodes[nodes.length - 1].textContent ?? null) : null;
  },
  jumpTarget: () => {
    const nodes = document.querySelectorAll('.prose, [class*="answer"]');
    return nodes.length ? nodes[nodes.length - 1] : null;
  },
  injectReply: (text) => genericInjectReply('textarea, div[contenteditable="true"]', text),
};
