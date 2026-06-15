import { pickAdapter } from "./adapters/registry";
import { startWatcher } from "./watcher";
import type { ContentMsg, WorkerToContentMsg } from "../shared/types";

/**
 * Content-script entry (spec §B7, §8). Picks the adapter for this host, boots
 * the watcher, and forwards state + completion to the service worker. It also
 * handles the two SW→content messages: scrollToLatest (the one allowed write,
 * besides reply) and injectReply (the opt-in bonded reply, user-initiated in
 * the desktop app).
 *
 * Strictly read-only otherwise: it never sends prompts or clicks on its own.
 */
const adapter = pickAdapter(location.host);

console.debug(`[AgentWatch] watching ${location.host} via "${adapter.id}" adapter`);

const send = (msg: ContentMsg): void => {
  try {
    chrome.runtime.sendMessage(msg);
  } catch {
    // SW may be asleep; it rebuilds from the next heartbeat.
  }
};

// Re-announce current state on load so the ephemeral SW can rebuild its picture
// after a restart (spec §8.6 / Non-functional 3).
send({ type: "agent:state", adapterId: adapter.id, label: adapter.label, state: "idle" });

const stop = startWatcher(adapter, {
  state: (state) =>
    send({ type: "agent:state", adapterId: adapter.id, label: adapter.label, state }),
  completed: (snippet, output) =>
    send({
      type: "agent:completed",
      adapterId: adapter.id,
      label: adapter.label,
      snippet,
      output,
    }),
});

chrome.runtime.onMessage.addListener((msg: WorkerToContentMsg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "scrollToLatest") {
    adapter.jumpTarget?.()?.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (msg.type === "injectReply") {
    // The single sanctioned write: only ever arrives from an explicit user
    // reply in the bonded desktop app.
    adapter.injectReply?.(msg.text);
  }
});

window.addEventListener("pagehide", () => stop(), { once: true });
