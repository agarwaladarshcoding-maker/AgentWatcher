import { genericInjectReply, type AgentSiteAdapter } from "./types";

/** Grok (grok.com). SELECTORS ILLUSTRATIVE — verify live. */
export const grok: AgentSiteAdapter = {
  id: "grok",
  label: "Grok",
  match: ["grok.com"],
  busySelector: 'button[aria-label="Stop"], button[aria-label="Stop model response"]',
  streamRoot: () => document.querySelector("main") ?? document.body,
  quietMs: 1300,
  lastMessageText: () => {
    const nodes = document.querySelectorAll('.message-bubble, [class*="response"]');
    return nodes.length ? (nodes[nodes.length - 1].textContent ?? null) : null;
  },
  jumpTarget: () => {
    const nodes = document.querySelectorAll('.message-bubble, [class*="response"]');
    return nodes.length ? nodes[nodes.length - 1] : null;
  },
  injectReply: (text) => genericInjectReply('textarea, div[contenteditable="true"]', text),
};
