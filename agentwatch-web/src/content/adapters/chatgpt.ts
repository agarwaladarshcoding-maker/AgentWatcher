import { genericInjectReply, type AgentSiteAdapter } from "./types";

/** ChatGPT (chatgpt.com / chat.openai.com). SELECTORS ILLUSTRATIVE — verify live. */
export const chatgpt: AgentSiteAdapter = {
  id: "chatgpt",
  label: "ChatGPT",
  match: ["chatgpt.com", "chat.openai.com"],
  busySelector: 'button[data-testid="stop-button"], button[aria-label="Stop generating"]',
  streamRoot: () => document.querySelector("main") ?? document.body,
  quietMs: 1200,
  lastMessageText: () => {
    const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
    return nodes.length ? (nodes[nodes.length - 1].textContent ?? null) : null;
  },
  jumpTarget: () => {
    const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
    return nodes.length ? nodes[nodes.length - 1] : null;
  },
  injectReply: (text) => genericInjectReply("#prompt-textarea, textarea", text),
};
