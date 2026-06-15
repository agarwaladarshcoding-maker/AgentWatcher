import { genericInjectReply, type AgentSiteAdapter } from "./types";

/** Microsoft Copilot (copilot.microsoft.com). SELECTORS ILLUSTRATIVE — verify live. */
export const copilot: AgentSiteAdapter = {
  id: "copilot",
  label: "Copilot",
  match: ["copilot.microsoft.com"],
  busySelector: 'button[aria-label="Stop"], button[title="Stop"]',
  streamRoot: () => document.querySelector("main") ?? document.body,
  quietMs: 1400,
  lastMessageText: () => {
    const nodes = document.querySelectorAll('[data-content="ai-message"], .ac-textBlock');
    return nodes.length ? (nodes[nodes.length - 1].textContent ?? null) : null;
  },
  jumpTarget: () => {
    const nodes = document.querySelectorAll('[data-content="ai-message"], .ac-textBlock');
    return nodes.length ? nodes[nodes.length - 1] : null;
  },
  injectReply: (text) => genericInjectReply('textarea, div[contenteditable="true"]', text),
};
