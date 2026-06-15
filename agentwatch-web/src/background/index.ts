import {
  loadAgents,
  saveAgents,
  loadBridgeCode,
  saveBridgeCode,
  type AgentMap,
} from "./store";
import { BridgeClient } from "./bridge";
import { ADAPTER_IDS } from "../content/adapters/registry";
import type {
  ContentMsg,
  DashboardSnapshot,
  PopupQuery,
  TrackedAgent,
} from "../shared/types";

/**
 * Service worker — the hub (spec §B7, §3, §4). It collects per-tab state from
 * content scripts, fires completion notifications, owns jump-to-tab and the
 * toolbar badge, answers popup queries, and (when paired) mirrors everything to
 * the desktop app over the bridge. All `chrome.tabs` use lives here, never in a
 * content script (invariant §15).
 *
 * State is persisted to chrome.storage and rebuilt from heartbeats on wake.
 */
let agents: AgentMap = {};
let bridgeCode = "";

// ── Bridge: stream state to the desktop app when paired. ──
const bridge = new BridgeClient({
  onConnected: () => updateBadge(),
  onDisconnected: () => updateBadge(),
  onFocusTab: (tabId) => focusTab(tabId),
  onScrollToLatest: (tabId) =>
    chrome.tabs.sendMessage(tabId, { type: "scrollToLatest" }).catch(() => {}),
  onInjectReply: (tabId, text) =>
    chrome.tabs.sendMessage(tabId, { type: "injectReply", text }).catch(() => {}),
  snapshot: () => Object.values(agents),
  token: () => bridgeCode,
  adapters: () => ADAPTER_IDS,
});

async function boot(): Promise<void> {
  agents = await loadAgents();
  bridgeCode = await loadBridgeCode();
  updateBadge();
  bridge.start();
}
void boot();

// ── Content-script heartbeats. ──
chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  // Popup queries (no sender.tab) are handled separately below.
  if (!sender.tab || sender.tab.id == null) {
    return handlePopup(raw as PopupQuery, sendResponse);
  }
  const tabId = sender.tab.id;
  const msg = raw as ContentMsg;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "agent:state") {
    upsert(tabId, sender.tab, msg.adapterId, msg.label, msg.state);
    bridge.sendState(tabId, msg.state);
  } else if (msg.type === "agent:completed") {
    const agent = upsert(tabId, sender.tab, msg.adapterId, msg.label, "done");
    agent.snippet = msg.snippet;
    agent.output = msg.output;
    persist();
    notifyCompleted(agent);
    bridge.sendCompleted(agent);
    updateBadge();
  }
  return undefined;
});

function upsert(
  tabId: number,
  tab: chrome.tabs.Tab,
  adapterId: string,
  label: string,
  state: TrackedAgent["state"],
): TrackedAgent {
  const prev = agents[tabId];
  const agent: TrackedAgent = {
    tabId,
    windowId: tab.windowId,
    adapterId,
    label,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    state,
    lastChange: Date.now(),
    snippet: prev?.snippet,
    output: prev?.output,
  };
  agents[tabId] = agent;
  persist();
  updateBadge();
  return agent;
}

function persist(): void {
  void saveAgents(agents);
}

// ── Notifications + jump-to-tab. ──
function notifyCompleted(agent: TrackedAgent): void {
  const id = `tab:${agent.tabId}`;
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `${agent.label} finished`,
    message: agent.snippet?.slice(0, 120) || "Task complete",
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith("tab:")) return;
  const tabId = Number(id.split(":")[1]);
  if (!Number.isNaN(tabId)) focusTab(tabId);
  chrome.notifications.clear(id);
  // Clear the "unseen done" badge once acknowledged.
  const a = agents[tabId];
  if (a && a.state === "done") {
    a.state = "idle";
    persist();
    updateBadge();
  }
});

async function focusTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
    chrome.tabs.sendMessage(tabId, { type: "scrollToLatest" }).catch(() => {});
  } catch {
    // Tab may be gone; drop it.
    delete agents[tabId];
    persist();
    updateBadge();
  }
}

// ── Toolbar badge (spec §10.5 fallback): green count of finished tabs, or an
//    amber working indicator. ──
function updateBadge(): void {
  const list = Object.values(agents);
  const done = list.filter((a) => a.state === "done").length;
  const working = list.filter((a) => a.state === "working").length;
  let text = "";
  let color = "#3fa985"; // green
  if (done > 0) {
    text = String(done);
    color = "#3fa985";
  } else if (working > 0) {
    text = "•";
    color = "#e0913a"; // amber
  }
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

// ── Tab lifecycle: drop closed tabs. ──
chrome.tabs.onRemoved.addListener((tabId) => {
  if (agents[tabId]) {
    delete agents[tabId];
    persist();
    bridge.sendSnapshot();
    updateBadge();
  }
});

// ── Popup queries. ──
function handlePopup(
  q: PopupQuery,
  respond: (r?: unknown) => void,
): boolean | undefined {
  if (!q || typeof q !== "object") return undefined;
  switch (q.type) {
    case "dashboard:query": {
      const snap: DashboardSnapshot = {
        agents: Object.values(agents),
        bridge: { connected: bridge.isConnected(), code: bridgeCode },
      };
      respond(snap);
      return undefined;
    }
    case "focusAgent":
      void focusTab(q.tabId);
      respond({ ok: true });
      return undefined;
    case "bridge:setCode":
      bridgeCode = q.code.trim();
      void saveBridgeCode(bridgeCode);
      bridge.stop();
      bridge.start();
      respond({ ok: true });
      return undefined;
    case "bridge:getStatus":
      respond({ connected: bridge.isConnected(), code: bridgeCode });
      return undefined;
    default:
      return undefined;
  }
}
