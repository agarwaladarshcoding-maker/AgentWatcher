# Requirements Document

## Introduction

This spec covers two bundled bodies of work for AgentWatch:

1. **State-detection stability (bug fix).** Today the interpreted agent state flickers between
   `completed` and `working` whenever the user switches focus away from the app (to VS Code or
   another application) and back. The root cause is that focus changes trigger PTY resizes
   (SIGWINCH), full-screen agent TUIs repaint their entire UI on resize, and the interpreter — which
   infers state purely from output *activity* — reads each repaint as new work. This also re-fires
   "ready" notifications and visibly churns the UI state pills.

2. **Browser bonding (new feature).** Per the AgentWatch Web plan §20 ("Desktop bonding & integrated
   mode") and item 27, a Chrome MV3 extension ("AgentWatch Web") watches browser-based AI agents
   standalone, and — when the desktop app is running — connects to it over a local bridge so the
   desktop app shows a live "Chrome section" mirroring every watched tab, with click-to-jump and an
   opt-in reply-back. Bonding is strictly **additive**: the extension works fully standalone, the
   Chrome section appears only when connected, and neither ever changes how a site or a CLI agent
   behaves.

The golden rule is preserved throughout: AgentWatch observes; it does not drive. The single sanctioned
write beyond "scroll on jump-back" is the explicit, user-initiated, bonded-mode-only reply-back.

### Scope notes

- The desktop app is Electron + React + node-pty (existing). The bridge plugs into the existing
  `SessionManager` / `SessionSink` fan-out and follows the `IpcServer` socket-server pattern.
- The extension is a separate Manifest V3 + TypeScript sub-project (`agentwatch-web/`).
- Out of scope: auto-answering prompts without user initiation; Firefox MV3; any remote server or
  data egress.

## Glossary

- **CLI session** — an agent running in a PTY, tracked by the existing desktop app (keyed by session id / PID).
- **Watched tab** — a browser tab running an AI agent, tracked by the extension (keyed by Chrome `tabId`).
- **Bridge** — the local, server-less channel (native messaging preferred, loopback WebSocket fallback) between the extension and the desktop app.
- **Bonded mode** — the extension is connected to a running desktop app. **Standalone mode** — no app; the extension works entirely inside Chrome.
- **Busy→idle edge** — the transition from generating to finished; the only moment a completion is reported.
- **Repaint** — bytes a full-screen agent TUI emits to redraw itself after a PTY resize (SIGWINCH), as opposed to genuine agent activity.
- **Adapter** — a tiny per-site config (selectors + strategy); the web analog of a desktop agent profile.
- **Quiescence** — a period of no DOM mutations used as the generic "it finished" signal.

## Requirements

### Requirement 1: State stays stable across focus changes (flicker fix)

**User Story:** As a user multitasking between AgentWatch and other apps (VS Code, browser), I want
each agent's status to reflect only the agent's real activity, so that switching windows never makes
the status bounce between "working" and "completed".

#### Acceptance Criteria

1. WHEN the application window gains or loses OS focus THE SYSTEM SHALL NOT change the interpreted state of any session solely as a result of that focus change.
2. WHEN a PTY is resized (SIGWINCH) for any reason THE SYSTEM SHALL treat output produced as a direct consequence of that resize as a non-meaningful repaint and SHALL NOT transition an `idle` or `completed` session into `working` because of it.
3. WHERE a resize-induced repaint occurs while a session is already `working`, THE SYSTEM SHALL NOT extend or reset the work burst such that it delays the `working → completed` transition.
4. WHILE a session is genuinely generating output (not a repaint) THE SYSTEM SHALL still detect activity and report `working`, and SHALL report `completed` on the real busy→idle edge — i.e. the fix must not suppress true activity detection.
5. WHEN the user switches focus away and back repeatedly with no agent activity THE SYSTEM SHALL keep the session's state constant (e.g. remains `completed` or `idle`) with zero spurious transitions.

---

### Requirement 2: PTY size is not perturbed by mere focus

**User Story:** As a user, I want my terminal layout to stay put when I tab away, so that agent TUIs
don't repaint and my session view doesn't jump.

#### Acceptance Criteria

1. WHEN the window blurs THE SYSTEM SHALL NOT reduce the authoritative PTY size to a smaller fallback purely because the GUI is no longer the size authority.
2. WHEN the window regains focus THE SYSTEM SHALL only re-issue a resize if the target size actually differs from the current PTY size.
3. WHERE multiple viewers are attached (GUI + native relay) THE SYSTEM SHALL keep the negotiated PTY size stable across focus transitions and SHALL change it only when a viewer's real dimensions change.
4. WHEN a focus-triggered refit computes a size identical to the current size THE SYSTEM SHALL skip the resize call entirely (no-op).

---

### Requirement 3: UI state indicators do not glitch

**User Story:** As a user, I want the status pills/dots and the event feed to be calm and accurate,
so that the UI doesn't flash or churn when nothing real is happening.

#### Acceptance Criteria

1. WHEN no real state transition occurs THE SYSTEM SHALL NOT re-render the state pill in a way that produces a visible flash or flicker.
2. WHEN the agent state genuinely changes THE SYSTEM SHALL update the corresponding pill, dot, and feed entry exactly once per transition.
3. THE SYSTEM SHALL NOT append duplicate or repeated `state_change` feed entries for a single underlying transition.
4. WHEN a `completed` state is reported while the window is unfocused THE SYSTEM SHALL fire at most one "ready" notification per genuine busy→idle edge, and SHALL NOT re-fire it for repaint-induced churn.

---

### Requirement 4: Local bridge server in the desktop app

**User Story:** As the desktop app, I want to accept a local connection from the Chrome extension
with no remote server, so that the two products can bond privately and offline.

#### Acceptance Criteria

1. WHEN the desktop app starts THE SYSTEM SHALL stand up a local bridge endpoint (native-messaging host, with a loopback WebSocket fallback on `127.0.0.1`) without contacting any remote server.
2. WHEN the extension connects and sends `bridge:hello` (version + adapter registry) THE SYSTEM SHALL complete a handshake by replying with its capabilities.
3. IF the connection is the loopback WebSocket fallback THEN THE SYSTEM SHALL require an origin allowlist and a pairing token/code before accepting bridge messages.
4. WHEN the extension reconnects after a drop (e.g. MV3 service-worker restart) THE SYSTEM SHALL accept a fresh handshake and rebuild the live picture from the extension's re-announced state.
5. WHEN the app is shutting down (`before-quit` / `window-all-closed`) THE SYSTEM SHALL close the bridge endpoint and release its resources cleanly.
6. THE SYSTEM SHALL transmit no project code, secrets, or user data to any third party over the bridge; all traffic stays on the local machine.

---

### Requirement 5: Bridge messaging contract

**User Story:** As both products, we want a small, explicit message set, so that the integration
stays robust and easy to maintain.

#### Acceptance Criteria

1. THE SYSTEM SHALL support these extension→app messages: `bridge:hello` {version, adapters}, `bridge:agents` (TrackedAgent[]), `agent:state` {tabId, state}, `agent:completed` {tabId, label, snippet, output?}.
2. THE SYSTEM SHALL support these app→extension messages: `focusTab` {tabId}, `scrollToLatest` {tabId}, `injectReply` {tabId, text}.
3. WHEN the app receives `bridge:agents` THE SYSTEM SHALL replace its snapshot of watched tabs with the received list.
4. WHEN the app receives `agent:state` THE SYSTEM SHALL update the live state of the matching tab (matched by `tabId`) without disturbing CLI sessions.
5. WHEN a message arrives that is malformed or of an unknown type THE SYSTEM SHALL ignore it without crashing or affecting CLI sessions.

---

### Requirement 6: The "Chrome section" in the desktop app

**User Story:** As a user, I want to see every watched Chrome tab inside the desktop app, so that I
have one place to watch both my CLI agents and my browser agents.

#### Acceptance Criteria

1. WHERE the extension is connected THE SYSTEM SHALL render a "Chrome" section listing every watched tab as a card with favicon, site label, and a live state pill (`working` / `done` / `idle`).
2. WHERE the extension is not connected THE SYSTEM SHALL hide the Chrome section entirely and SHALL leave the existing CLI dashboard unchanged.
3. WHEN a watched tab's state changes THE SYSTEM SHALL update its card's state pill live, using the same busy→idle-edge semantics as CLI sessions.
4. WHEN a tab completes THE SYSTEM SHALL show a `Done ✓` badge on its card and display the answer snippet (and, when provided, the fuller latest-message text) inline.
5. WHEN the user clicks a tab card THE SYSTEM SHALL send `focusTab` (and `scrollToLatest`) over the bridge so Chrome focuses that window+tab and scrolls to the latest answer.
6. THE SYSTEM SHALL reuse the existing visual token system (Iris accent, semantic working=amber / done=green / idle=neutral) so the Chrome section matches the CLI dashboard.

---

### Requirement 7: Opt-in reply-back (the single sanctioned write)

**User Story:** As a user, I want to optionally reply to a finished browser agent from the desktop
app, so that I can keep a conversation moving without switching to Chrome — but never automatically.

#### Acceptance Criteria

1. WHERE a tab is `done` AND the user is in bonded mode THE SYSTEM SHALL offer a clearly-labeled reply box on that tab's card.
2. WHEN the user submits a reply THE SYSTEM SHALL send `injectReply` {tabId, text} so the content script types the text into that site's composer and submits it.
3. THE SYSTEM SHALL NOT send any reply, prompt, click, or answer automatically; reply-back is always explicit and user-initiated.
4. WHERE the extension is in standalone mode (no app) THE SYSTEM SHALL remain strictly read-only with no reply affordance.
5. THE SYSTEM SHALL label the reply affordance so it is obvious this is a write action into the page.

---

### Requirement 8: Standalone extension: watch, notify, jump

**User Story:** As a Chrome user, I want the extension to tell me when a browser agent finishes and
jump me back to it, even with no desktop app installed, so that it is useful on its own.

#### Acceptance Criteria

1. WHEN an agent tab is generating THE SYSTEM SHALL detect `working` via the per-site adapter's busy signal (e.g. the Stop control) or, as a fallback, mutation quiescence.
2. WHEN generation finishes (busy→idle edge, or `quietMs` of no mutations) THE SYSTEM SHALL fire exactly one completion per generation and SHALL NOT fire on the user's own message.
3. WHEN a completion fires THE SYSTEM SHALL show a `chrome.notifications` basic notification titled "<Agent> finished" with the answer snippet.
4. WHEN the user clicks the notification THE SYSTEM SHALL focus the correct Chrome window and tab (even across windows) and message the content script to scroll the latest answer into view.
5. WHERE no desktop app is present THE SYSTEM SHALL provide a popup dashboard listing every tracked tab with its live state and a "go to" button.
6. WHEN the MV3 service worker sleeps and restarts THE SYSTEM SHALL rebuild live state from content-script heartbeats and SHALL NOT hold critical state only in worker memory.
7. THE content script SHALL only read the page (the sole allowed write is scrolling on jump-back), and a failing or stale adapter SHALL degrade to generic quiescence without affecting the host page.

---

### Requirement 9: Site adapters & registry

**User Story:** As a maintainer, I want each site encapsulated in a tiny adapter with a generic
fallback, so that DOM drift degrades to "less precise," never "broken."

#### Acceptance Criteria

1. THE SYSTEM SHALL define an adapter shape (id, label, host match globs, optional busy selector, stream-root resolver, optional quietMs, optional snippet getter, optional jump target).
2. THE SYSTEM SHALL ship a Claude reference adapter first and a generic quiescence fallback adapter for any unregistered host.
3. WHEN a site is a single-page app and its route changes (`pushState`/`replaceState`) THE SYSTEM SHALL re-resolve the stream root so watching survives in-app navigation.
4. WHERE two tabs run the same site THE SYSTEM SHALL track them independently by `tabId` and SHALL NOT collapse them.
5. THE SYSTEM SHALL include Tier-1 adapters (Claude, ChatGPT, Gemini, Perplexity, Copilot, Grok) for the v1 milestone, with Tier 2–3 deferred to a later phase.

---

### Requirement 10: Install/download through the app & least privilege

**User Story:** As a user, I want one click in the desktop app to add the extension and authorize the
connection, while the extension requests only the permissions it truly needs.

#### Acceptance Criteria

1. WHERE the desktop app exposes an "Add the Chrome extension" flow THE SYSTEM SHALL either open the Web Store listing or load the unpacked build shipped in the app's resources, and SHALL install the native-messaging host manifest so Chrome is authorized to talk to the app.
2. THE extension SHALL request `host_permissions` only for registry domains (never `<all_urls>`) and only the `notifications`, `tabs`, and `storage` permissions needed for v1.
3. THE SYSTEM SHALL bundle all adapters locally and SHALL load no remote code (MV3 requirement).
4. THE SYSTEM SHALL keep all snippets and state in `chrome.storage` with no analytics and no data egress in v1.
5. WHERE OS/browser notifications are disabled THE SYSTEM SHALL degrade gracefully to a toolbar badge count plus the popup dashboard.

---

## Non-functional & invariants

1. **Additive bonding.** WHEN the desktop app is closed or absent THE extension SHALL continue to work fully standalone in Chrome.
2. **Read-only by default.** Observation SHALL stay strictly read-only; the only writes permitted are scroll-on-jump and the opt-in bonded reply-back.
3. **No service-worker-only state.** The extension SHALL persist state to `chrome.storage` and rebuild from heartbeats after worker restarts.
4. **`chrome.tabs` placement.** Tab/window control SHALL run only in the service worker/popup, never the content script.
5. **Local-only.** Neither product SHALL transmit code, secrets, or user data off the machine.
6. **No regressions.** The flicker fix SHALL NOT degrade genuine activity detection, permission-prompt detection, or session-end notifications.
