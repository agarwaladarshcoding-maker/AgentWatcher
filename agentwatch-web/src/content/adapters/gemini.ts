import { genericInjectReply, type AgentSiteAdapter } from "./types";

/** Gemini (gemini.google.com). Google SPA — watch route changes. SELECTORS ILLUSTRATIVE. */
export const gemini: AgentSiteAdapter = {
  id: "gemini",
  label: "Gemini",
  match: ["gemini.google.com"],
  busySelector: 'button[aria-label="Stop response"], .stop-icon',
  streamRoot: () =>
    document.querySelector("chat-window") ??
    document.querySelector("main") ??
    document.body,
  quietMs: 1400,
  lastMessageText: () => {
    const nodes = document.querySelectorAll("message-content, .model-response-text");
    return nodes.length ? (nodes[nodes.length - 1].textContent ?? null) : null;
  },
  jumpTarget: () => {
    const nodes = document.querySelectorAll("message-content, .model-response-text");
    return nodes.length ? nodes[nodes.length - 1] : null;
  },
  injectReply: (text) =>
    genericInjectReply('div[contenteditable="true"], textarea, rich-textarea', text),
};
