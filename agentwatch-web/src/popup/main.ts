import type { DashboardSnapshot, PopupQuery, TrackedAgent } from "../shared/types";

/**
 * Popup dashboard (spec §B7 task 20, §13). Lists every watched tab with its
 * live state + a "go to" button, shows an empty state, and offers the optional
 * desktop-app pairing field. Kept deliberately minimal.
 */
const listEl = document.getElementById("list") as HTMLDivElement;
const countsEl = document.getElementById("counts") as HTMLSpanElement;
const statusEl = document.getElementById("bridgeStatus") as HTMLSpanElement;
const codeEl = document.getElementById("code") as HTMLInputElement;
const pairEl = document.getElementById("pair") as HTMLButtonElement;

function query<T>(q: PopupQuery): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(q, (r) => resolve(r as T));
  });
}

const STATE_LABEL: Record<TrackedAgent["state"], string> = {
  idle: "Idle",
  working: "Working",
  done: "Done ✓",
};

function render(snap: DashboardSnapshot): void {
  const agents = snap.agents.sort((a, b) => a.tabId - b.tabId);
  const working = agents.filter((a) => a.state === "working").length;
  const done = agents.filter((a) => a.state === "done").length;
  countsEl.textContent = `${working} working · ${done} done`;

  statusEl.textContent = snap.bridge.connected
    ? "Desktop app: connected"
    : "Desktop app: not connected";
  statusEl.classList.toggle("on", snap.bridge.connected);
  if (snap.bridge.code && !codeEl.value) codeEl.value = snap.bridge.code;

  if (agents.length === 0) {
    listEl.innerHTML = `<div class="empty">No agents being watched.</div>`;
    return;
  }
  listEl.innerHTML = "";
  for (const a of agents) {
    const row = document.createElement("div");
    row.className = "row";

    const fav = document.createElement("img");
    fav.className = "fav";
    if (a.favIconUrl) fav.src = a.favIconUrl;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = a.label;
    label.title = a.url ?? "";

    const pill = document.createElement("span");
    pill.className = `pill ${a.state}`;
    pill.textContent = STATE_LABEL[a.state];

    const goto = document.createElement("button");
    goto.className = "goto";
    goto.textContent = "Go to";
    goto.onclick = () => {
      void query({ type: "focusAgent", tabId: a.tabId });
      window.close();
    };

    row.append(fav, label, pill, goto);
    listEl.append(row);
  }
}

async function refresh(): Promise<void> {
  const snap = await query<DashboardSnapshot>({ type: "dashboard:query" });
  if (snap) render(snap);
}

pairEl.onclick = async () => {
  await query({ type: "bridge:setCode", code: codeEl.value });
  void refresh();
};

void refresh();
setInterval(refresh, 1500);
