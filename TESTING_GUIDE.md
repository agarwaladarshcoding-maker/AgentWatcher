# AgentWatch Browser Bonding — Testing Guide

Complete step-by-step instructions for testing the browser bonding feature and verifying all functionality.

---

## Overview

All code is implemented and ready for testing. This guide covers:

1. **Desktop app verification** (flicker fix + bridge server)
2. **Extension build and load**
3. **Standalone mode testing** (extension works without desktop app)
4. **Bonded mode testing** (extension + desktop app integration)
5. **Selector verification** (updating adapters for current site HTML)

---

## Prerequisites

- macOS with Chrome installed
- Node.js and npm installed
- AgentWatch desktop app source code
- Terminal access

---

## Part 1: Desktop App Verification

### 1.1 Build the desktop app

```bash
# From the project root
npm install
npm run build
```

### 1.2 Run automated tests

```bash
# Self-check (29 checks)
npm run selfcheck

# Notification tests (6 checks)
npm run test:notif

# Flicker regression scenarios (17 scenarios)
npm run test:scenarios

# Bridge integration tests (7 checks)
npm run test:bridge
```

**Expected:** All tests should pass.

### 1.3 Start the desktop app

```bash
npm run dev
```

Or use your preferred method to launch the app.

### 1.4 Verify the flicker fix

**Test: Focus changes should NOT flip agent state**

1. Open the app, start a CLI agent session (any TUI agent like Claude, Gemini, etc.)
2. Let the agent finish a generation → status shows "Completed ✓"
3. Switch focus to another app (VS Code, browser, etc.)
4. Switch back to AgentWatch
5. Repeat steps 3-4 several times

**Expected:**
- Status stays "Completed ✓" (no flicker to "Working...")
- No duplicate "Agent finished" notifications
- Terminal view doesn't jump or glitch

**Before the fix:** Status would bounce between "Completed" and "Working" on every focus change.

### 1.5 Verify bridge server is running

1. Open Settings in the app (⚙️ icon)
2. Look for "Chrome Extension" section
3. Note the connection status (should show "Ready" or "Listening")
4. Note the pairing code (you'll need this later)

**Expected:** Bridge server is running on `127.0.0.1:8731` (or a nearby port if 8731 was occupied).

---

## Part 2: Extension Build and Load

### 2.1 Build the extension

```bash
cd agentwatch-web
npm install
npm run build
```

**Expected:** `agentwatch-web/dist/` folder is created with:
- `manifest.json`
- `background.js`
- `content.js`
- `popup.html` / `popup.js`
- Icon files

### 2.2 Load unpacked in Chrome

1. Open Chrome
2. Navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `agentwatch-web/dist/` folder
6. Confirm AgentWatch icon appears in toolbar

**Expected:** Extension loads without errors. Check for any error badges on the extension card.

### 2.3 Check permissions

Click "Details" on the AgentWatch extension card, then "Permissions".

**Expected permissions:**
- Read and change data on specific sites (claude.ai, chatgpt.com, etc.)
- Display notifications
- Communicate with cooperating native applications (or similar for tabs/storage)

**NOT expected:** Broad permissions like "Read and change all your data on all websites".

---

## Part 3: Standalone Mode Testing

Test the extension working **without** the desktop app.

### 3.1 Close the desktop app

Quit the AgentWatch desktop app completely.

### 3.2 Test on Claude

1. Open `https://claude.ai` in Chrome
2. Open the extension popup (click toolbar icon)
   - Should show "Not connected" or "Standalone mode"
3. Start a conversation with Claude (ask any question)
4. Observe while Claude generates:
   - Extension badge should show a dot or count
   - Popup should show the tab as "Working..."
5. Wait for Claude to finish
   - Chrome notification should appear: "Claude finished"
   - Popup should show "Done ✓"
6. Click the notification
   - Should focus the Claude tab
   - Should scroll to the latest message

**Expected:** All steps work without the desktop app.

### 3.3 Test on other Tier-1 sites

Repeat 3.2 for:
- ChatGPT (`https://chatgpt.com`)
- Gemini (`https://gemini.google.com`)
- Perplexity (`https://perplexity.ai`)
- GitHub Copilot (`https://copilot.microsoft.com`)
- Grok (`https://x.com` — if you have access)

**If detection fails on any site:** See Part 5 (Selector Verification).

### 3.4 Test multi-tab tracking

1. Open Claude in Tab A, start a conversation
2. Open ChatGPT in Tab B, start a conversation
3. Let both finish
4. Open extension popup

**Expected:** Both tabs listed independently with correct states.

---

## Part 4: Bonded Mode Testing

Test the extension + desktop app integration.

### 4.1 Start the desktop app

Launch the app and confirm the bridge is running (Settings → "Chrome Extension" section).

### 4.2 Pair the extension

1. Copy the pairing code from the app's Settings
2. Open the extension popup in Chrome
3. Paste the pairing code
4. Click "Pair" or "Connect"
5. Popup should show "Connected ✓"

**Expected:** Connection succeeds. If not, see Troubleshooting.

### 4.3 Verify the Chrome section appears

1. Look at the desktop app
2. A new "Chrome" section should appear (below or alongside the CLI sessions section)
3. It should list any watched tabs from Part 3

**Expected:** Chrome section is visible and shows connected tabs.

### 4.4 Test watch + notify + jump (bonded)

1. In Chrome, open `https://claude.ai`
2. Start a conversation
3. Observe the desktop app:
   - Chrome section should show the Claude tab as "Working..."
   - State pill should be amber
4. Let Claude finish
5. Desktop app should show:
   - State pill turns green "Done ✓"
   - Snippet of the answer displayed
6. In the desktop app, click "Go to →" on the Claude card
7. Chrome should focus the Claude tab and scroll to the answer

**Expected:** All state updates are live in the desktop app, and jump-to works.

### 4.5 Test reply-back (the sanctioned write)

1. In the desktop app, find a Claude tab that is "Done ✓"
2. An opt-in reply box should appear on the card (clearly labeled "✎ writes into the page")
3. Type a follow-up question in the reply box
4. Click "Send" or "Reply"
5. Switch to Chrome
6. The message should appear in the Claude composer and be submitted automatically
7. Watch the desktop app update as Claude generates again

**Expected:** Reply injects correctly and conversation continues. The desktop app tracks the new generation.

### 4.6 Test focus + scroll from desktop

1. Have multiple Chrome tabs open (Claude, ChatGPT, etc.)
2. All should appear in the desktop app's Chrome section
3. Click "Go to →" on any tab card
4. Chrome should:
   - Focus the correct window (even if Chrome is in the background)
   - Focus the correct tab
   - Scroll to the latest assistant message

**Expected:** Jump-to works reliably across windows and tabs.

### 4.7 Test disconnect → standalone fallback

1. Close the desktop app
2. Wait a few seconds
3. Open the extension popup
4. Should show "Not connected" or "Standalone mode"
5. Start a new conversation in Chrome
6. Should still get notifications (standalone mode)

**Expected:** Extension falls back to standalone gracefully.

---

## Part 5: Selector Verification & Updates

If any site fails to detect working/done states, the adapter selectors need updating.

### 5.1 Identify the failing site

Example: Gemini isn't detecting when the agent finishes.

### 5.2 Inspect the DOM

1. Open `https://gemini.google.com`
2. Start a generation
3. Open Chrome DevTools (F12 or Cmd+Option+I)
4. While the agent is generating, find the Stop button:
   - Right-click Stop button → Inspect
   - Note its attributes: `aria-label`, `data-testid`, `class`, etc.
5. After generation finishes, inspect the latest message:
   - Right-click the assistant's message → Inspect
   - Note stable identifiers (role, data-*, etc.)
6. Inspect the input composer:
   - Right-click the text input → Inspect
   - Note the selector (textarea, contenteditable div, etc.)

### 5.3 Update the adapter

1. Open `agentwatch-web/src/content/adapters/gemini.ts`
2. Update selectors based on your inspection:

**Example:**
```typescript
// Before (illustrative guess)
busySelector: 'button[aria-label="Stop generating"]',

// After inspecting live site
busySelector: 'button[data-action="stop-response"]',
```

3. Save the file

### 5.4 Rebuild and reload

```bash
cd agentwatch-web
npm run build
```

1. Go to `chrome://extensions`
2. Click the reload icon ↻ on AgentWatch
3. Return to the site and test again

**Repeat for each site that needs updates.**

### 5.5 Common selector patterns

| Element | Common Selectors |
|---------|------------------|
| Stop button | `button[aria-label*="Stop"]`, `button[data-action="stop"]` |
| Assistant message | `[role="article"]`, `[data-message-author="assistant"]`, `.message.assistant` |
| User message | `[data-message-author="user"]`, `.message.user` |
| Composer | `div[contenteditable="true"]`, `textarea[placeholder*="Message"]` |
| Conversation | `[role="main"]`, `main`, `.conversation-container` |

---

## Part 6: Edge Cases & Stress Tests

### 6.1 SPA navigation

1. On Claude or ChatGPT, start a conversation
2. Navigate to a different conversation (using site's sidebar/history)
3. Start a new generation in the new conversation

**Expected:** Watcher survives the route change and tracks the new conversation.

### 6.2 Multiple windows

1. Open Claude in Window A
2. Open ChatGPT in Window B
3. Start generations in both
4. Use desktop app to jump between them

**Expected:** Each focuses the correct window + tab.

### 6.3 Service worker restart

1. Watch several tabs until they're "Done"
2. Go to `chrome://extensions`, find AgentWatch
3. Click "service worker" link, then terminate it (or wait for Chrome to put it to sleep)
4. Start a new generation on any site

**Expected:** Extension rebuilds state and continues tracking.

### 6.4 Extension reload

1. Watch several tabs
2. Go to `chrome://extensions`, reload AgentWatch
3. Check popup and desktop app

**Expected:** State is lost (expected), but new generations are tracked correctly.

---

## Troubleshooting

### Desktop app

**"All tests pass but app doesn't start"**
- Check console for errors: `npm run dev` logs
- Check Electron version compatibility
- Try rebuilding: `npm run build`

**"Bridge server not starting"**
- Check if port 8731-8740 are blocked by firewall
- Check Settings → should show bridge status
- Check terminal logs for WebSocket errors

### Extension

**"Extension won't load"**
- Check for errors on `chrome://extensions` page
- Click "Errors" button on extension card
- Check manifest.json is in dist/ folder
- Try rebuilding: `cd agentwatch-web && npm run build`

**"No notifications"**
- Check Chrome notification permissions: System Preferences → Notifications → Google Chrome
- Check site permissions on `chrome://extensions` → Details → Permissions
- Check extension popup shows the tab as "Working" → "Done"

**"Can't pair with desktop app"**
- Verify desktop app is running
- Verify bridge server started (check Settings)
- Copy fresh pairing code
- Check extension service worker console for connection errors
- Check firewall allows loopback (127.0.0.1) connections

**"Jump doesn't work"**
- Update `jumpTarget()` selector in adapter
- Check DevTools console for errors

**"Reply injection fails"**
- Update `injectReply()` selector in adapter
- Check the composer is visible and enabled
- Check DevTools console for errors

---

## Success Criteria

✅ **Part A (Flicker fix):**
- All automated tests pass (29 + 6 + 17 + 7)
- Focus changes do NOT flip agent state
- No duplicate notifications

✅ **Part B Desktop:**
- Bridge server starts
- Chrome section appears when extension connects
- Chrome section hides when extension disconnects

✅ **Part B Extension (Standalone):**
- Detects working/done on all Tier-1 sites
- Fires notifications on completion
- Jump-to works from notification and popup

✅ **Part B Extension (Bonded):**
- Pairing succeeds
- Live state updates in desktop app
- Jump-to works from desktop app
- Reply-back injects correctly

---

## What's Left (from Agent Side)

From my side, the implementation is **complete**. What remains is:

1. **Manual testing** (you need to run through Parts 1-6 above)
2. **Selector verification** (you need to update adapters if selectors are stale)
3. **Optional polish:**
   - Replace generated icons with designed assets (if you have them)
   - Web Store listing copy (if you plan to publish)
   - Additional Tier-2/3 adapters (beyond the 6 Tier-1 sites)

The code is production-ready for local use and testing. Selector updates are expected (sites change their HTML), and the adapters are designed to be easily maintainable.

---

## Next Steps

1. Follow Part 1 to verify the desktop app
2. Follow Part 2 to build and load the extension
3. Follow Part 3 to test standalone mode
4. Follow Part 4 to test bonded mode
5. Follow Part 5 to update any failing adapters
6. Report any issues or unexpected behavior

**All code is committed and ready in your working directory.**
