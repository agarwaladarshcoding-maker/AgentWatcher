# AgentWatch Web — Chrome Extension

Browser-side companion for AgentWatch. Watch AI agents in Chrome, get notified when they finish, and jump back to completed generations. Works fully **standalone** in Chrome or **bonded** with the desktop app for an integrated view.

---

## Quick Start

### 1. Build the extension

```bash
cd agentwatch-web
npm install
npm run build
```

The built extension will be in `agentwatch-web/dist/`.

### 2. Load unpacked in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `agentwatch-web/dist/` folder
5. The AgentWatch icon should appear in your toolbar

### 3. Test standalone mode (no desktop app)

1. Open any supported AI site (claude.ai, chatgpt.com, gemini.google.com, etc.)
2. Start a conversation with the agent
3. When the agent finishes generating, you'll get a Chrome notification
4. Click the notification to jump back to that tab
5. Open the extension popup to see all tracked tabs

**Standalone mode** works completely independently — no desktop app required.

---

## Bonded Mode (with Desktop App)

When the AgentWatch desktop app is running, the extension connects to it and streams watched-tab state. The desktop app shows a live "Chrome section" mirroring every watched tab.

### Pairing Instructions

1. **Launch the desktop app** — ensure it's running
2. **Open Settings** in the desktop app (⚙️ icon or menu)
3. **Copy the pairing code** shown in the "Chrome Extension" section
4. **Open the extension popup** in Chrome (click the AgentWatch toolbar icon)
5. **Paste the pairing code** and click **Pair**
6. Connection status should show "Connected ✓"

Once paired:
- All watched tabs appear in the desktop app's "Chrome" section
- Click "Go to →" in the desktop app to focus that tab in Chrome
- Use the opt-in reply box to write back into the page (when bonded)

---

## Supported Sites (Tier 1)

The extension ships with adapters for:

- **Claude** (claude.ai)
- **ChatGPT** (chatgpt.com)
- **Gemini** (gemini.google.com)
- **Perplexity** (perplexity.ai)
- **GitHub Copilot** (copilot.microsoft.com)
- **Grok** (x.com)

Sites not in the registry fall back to **generic quiescence detection** (watches for DOM mutations to stop).

---

## Selector Verification & Maintenance

⚠️ **IMPORTANT:** The selectors in each adapter are **illustrative guesses** based on common patterns. They may not work on the current version of each site. After loading the extension, you **must** verify and update selectors for any site you plan to use.

### How to Verify & Update Selectors

1. **Test on the live site:**
   - Open the site (e.g., claude.ai)
   - Start a generation
   - Check if the extension detects "working" and "done" states correctly
   - Check if the notification fires when generation completes

2. **If detection fails, inspect the DOM:**
   - Open Chrome DevTools (F12 or Cmd+Option+I)
   - **Find the Stop button** (while agent is generating):
     - Right-click the Stop button → Inspect
     - Look at its attributes (aria-label, data-testid, class, etc.)
     - Update `busySelector` in the adapter file
   
   - **Find the message container:**
     - Inspect the latest assistant message
     - Look for stable identifiers (data-testid, role="article", etc.)
     - Update `lastMessageText()` and `jumpTarget()` selectors
   
   - **Find the input field:**
     - Inspect the text composer/input area
     - Note the selector (contenteditable div, textarea, etc.)
     - Update `injectReply()` if needed

3. **Update the adapter file:**
   - Open `agentwatch-web/src/content/adapters/<site>.ts`
   - Update the selectors based on your inspection
   - Save the file

4. **Rebuild and reload:**
   ```bash
   npm run build
   ```
   - Go to `chrome://extensions`
   - Click the reload icon ↻ on the AgentWatch card
   - Test again

### Example: Updating Claude Adapter

**Before (illustrative):**
```typescript
busySelector: 'button[aria-label="Stop response"]',
```

**After inspecting live site, found it's now:**
```typescript
busySelector: 'button[data-action="stop-generation"]',
```

Update the file, rebuild, reload the extension, and test.

---

## Adapter File Locations

All adapters are in `agentwatch-web/src/content/adapters/`:

- `claude.ts` — Claude (reference adapter)
- `chatgpt.ts` — ChatGPT
- `gemini.ts` — Gemini
- `perplexity.ts` — Perplexity
- `copilot.ts` — GitHub Copilot
- `grok.ts` — Grok
- `generic.ts` — Generic fallback (quiescence-based)
- `registry.ts` — Adapter selection logic

---

## Adapter Shape

Each adapter exports an `AgentSiteAdapter` object:

```typescript
{
  id: "claude",                          // unique ID
  label: "Claude",                       // display name
  match: ["claude.ai"],                  // host patterns
  busySelector: 'button[...]',           // Stop button selector (optional)
  streamRoot: () => Element,             // container to watch for mutations
  quietMs: 1200,                         // quiescence timeout (ms)
  lastMessageText: () => string | null,  // extract latest answer text
  jumpTarget: () => Element | null,      // element to scroll to
  injectReply: (text) => Promise<void>,  // type & submit reply
}
```

- **`busySelector`**: CSS selector for the Stop button (appears while generating). If found, agent is "working". If not found, falls back to mutation quiescence.
- **`streamRoot`**: The DOM subtree to watch for mutations (e.g., the conversation container).
- **`quietMs`**: How long to wait after last mutation before declaring "done".
- **`lastMessageText`**: Extract the full text of the latest assistant message (for desktop app display).
- **`jumpTarget`**: The element to scroll into view when user clicks "jump back".
- **`injectReply`**: Find the composer, type the text, submit the form (bonded mode only).

---

## Debugging

### Check extension logs:
- Open the extension popup
- Right-click inside the popup → Inspect
- Open Console tab
- Or go to `chrome://extensions`, find AgentWatch, click "service worker" link

### Check content script logs:
- Open the AI site page
- Open DevTools (F12)
- Console tab will show watcher state changes

### Common issues:

**"No state detected"** → Adapter selectors are stale; update them
**"No completion notification"** → Check `busySelector` and `quietMs`
**"Jump doesn't scroll"** → Update `jumpTarget()` selector
**"Reply doesn't inject"** → Update `injectReply()` composer selector

---

## Development

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Build and watch for changes (during development)
npm run dev

# Type check
npx tsc --noEmit
```

---

## Permissions

The extension requests:

- **`host_permissions`**: Only for the specific AI sites in the adapter registry (never `<all_urls>`)
- **`notifications`**: To show completion notifications
- **`tabs`**: To focus tabs when user clicks notifications or "go to" buttons
- **`storage`**: To persist watched-tab state across service worker restarts

**No data egress.** All state stays local. Bonded mode connects only to `127.0.0.1` (your local desktop app).

---

## Architecture Notes

- **Content scripts** (`src/content/`) run on AI site pages, watch DOM, detect busy→idle edges
- **Service worker** (`src/background/`) is the hub: receives completions, fires notifications, manages badge, handles bridge client
- **Bridge client** (`src/background/bridge.ts`) connects to the desktop app via WebSocket on `127.0.0.1:8731-8740` (scanned in order)
- **Popup** (`src/popup/`) shows a minimal dashboard of tracked tabs

State persists to `chrome.storage.session` so the extension survives service-worker restarts (MV3 requirement).

---

## Troubleshooting Pairing

**"Not connected"** in popup:
1. Ensure the desktop app is running
2. Check the app is listening on the bridge port (visible in Settings)
3. Try re-pasting the pairing code
4. Check the service worker console for bridge errors

**"Connection refused"**:
- The desktop app may not have started the bridge server yet
- Restart the desktop app
- Check firewall settings (should allow loopback connections)

**"Invalid token"**:
- The pairing code has expired or is incorrect
- Copy a fresh code from the desktop app Settings

---

## Contributing & Selector Updates

If you update selectors for any adapter to match current site HTML, please consider contributing them back! The adapters are tiny and designed to be community-maintained as sites evolve.

---

## License

See main AgentWatch repository for license details.
