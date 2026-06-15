import { useState } from "react";
import { useBrowserAgents } from "../store/browserAgents";
import type { BrowserAgentState, TrackedTab } from "../../../shared/types";

/**
 * The "Chrome section" (spec: browser-bonding §B5/§B6). A sibling to the CLI
 * dashboard that lists every watched Chrome tab reported by the AgentWatch Web
 * extension over the local bridge. It renders ONLY when the extension is
 * connected; otherwise it returns null and the CLI app is unchanged.
 *
 * Per tab: favicon + label + live state pill, a Done ✓ badge with the answer
 * snippet/output when finished, a "go to" button (jump-to-tab via the bridge),
 * and — for finished tabs only — an opt-in, clearly-labeled reply box (the one
 * sanctioned write, always user-initiated).
 */
const STATE_LABEL: Record<BrowserAgentState, string> = {
  idle: "Idle",
  working: "Working",
  done: "Done",
};

function TabCard({ tab }: { tab: TrackedTab }): JSX.Element {
  const [replyOpen, setReplyOpen] = useState(false);
  const [text, setText] = useState("");

  const goTo = (): void => window.agentwatch.focusBrowserTab(tab.tabId);
  const sendReply = (): void => {
    const t = text.trim();
    if (!t) return;
    window.agentwatch.replyBrowserTab(tab.tabId, t);
    setText("");
    setReplyOpen(false);
  };

  return (
    <div className="chrome-card">
      <div className="chrome-card-head">
        {tab.favIconUrl ? (
          <img className="chrome-favicon" src={tab.favIconUrl} alt="" />
        ) : (
          <span className="chrome-favicon placeholder" aria-hidden="true" />
        )}
        <span className="chrome-label" title={tab.url}>
          {tab.label}
        </span>
        <span className={`state-pill state-browser-${tab.state}`}>
          {tab.state === "done" ? "Done ✓" : STATE_LABEL[tab.state]}
        </span>
        <button className="chrome-goto" onClick={goTo} title="Jump to this tab">
          Go to →
        </button>
      </div>

      {tab.state === "done" && (tab.snippet || tab.output) && (
        <div className="chrome-snippet">{tab.output || tab.snippet}</div>
      )}

      {tab.state === "done" && (
        <div className="chrome-reply">
          {replyOpen ? (
            <>
              <textarea
                className="chrome-reply-input"
                placeholder="Reply — this is typed into the page and submitted"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
              />
              <div className="chrome-reply-actions">
                <span className="chrome-reply-warn" title="Writes into the page">
                  ✎ writes into the page
                </span>
                <button className="chrome-reply-cancel" onClick={() => setReplyOpen(false)}>
                  Cancel
                </button>
                <button
                  className="chrome-reply-send"
                  onClick={sendReply}
                  disabled={!text.trim()}
                >
                  Send reply
                </button>
              </div>
            </>
          ) : (
            <button className="chrome-reply-open" onClick={() => setReplyOpen(true)}>
              Reply…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ChromeSection(): JSX.Element | null {
  const connected = useBrowserAgents((s) => s.connected);
  const tabs = useBrowserAgents((s) => s.tabs);

  // Additive bonding: nothing shows unless the extension is connected.
  if (!connected) return null;

  const working = tabs.filter((t) => t.state === "working").length;
  const done = tabs.filter((t) => t.state === "done").length;

  return (
    <section className="chrome-section" aria-label="Chrome agents">
      <div className="chrome-section-head">
        <span className="chrome-section-title">Chrome</span>
        <span className="chrome-section-counts">
          {working} working · {done} done
        </span>
      </div>
      {tabs.length === 0 ? (
        <p className="chrome-empty">No browser agents being watched.</p>
      ) : (
        <div className="chrome-cards">
          {tabs.map((t) => (
            <TabCard key={t.tabId} tab={t} />
          ))}
        </div>
      )}
    </section>
  );
}
