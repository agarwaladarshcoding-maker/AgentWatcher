# Quick Test — Browser Bonding

Fast verification checklist for the browser bonding feature.

---

## 1. Desktop App (5 minutes)

```bash
# Build and test
npm install
npm run build
npm run selfcheck    # Should pass 29/29
npm run test:bridge  # Should pass 7/7

# Start the app
npm run dev
```

**Test flicker fix:**
- Start a CLI agent, let it finish (shows "Completed ✓")
- Switch to VS Code and back 3-4 times
- ✅ Status should stay "Completed" (no flicker)

**Get pairing code:**
- Open Settings → note the pairing code

---

## 2. Extension (5 minutes)

```bash
cd agentwatch-web
npm install
npm run build
```

**Load in Chrome:**
1. `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `agentwatch-web/dist/`

---

## 3. Standalone Test (5 minutes)

**Close the desktop app.**

1. Open `https://claude.ai`
2. Ask Claude a question
3. Wait for it to finish
4. ✅ Should get Chrome notification "Claude finished"
5. Click notification
6. ✅ Should focus tab and scroll to answer

---

## 4. Bonded Test (10 minutes)

**Start the desktop app.**

1. Open extension popup in Chrome
2. Paste pairing code → Pair
3. ✅ Should show "Connected ✓"

4. In desktop app:
   - ✅ "Chrome" section appears

5. In Chrome, open `https://claude.ai`
6. Ask Claude a question
7. In desktop app:
   - ✅ Claude card shows "Working..." (amber)
   - ✅ When done, shows "Done ✓" (green) + answer snippet

8. In desktop app, click "Go to →" on Claude card
9. ✅ Chrome focuses the tab and scrolls

10. In desktop app, type a reply in the box → Send
11. ✅ Reply appears in Claude and submits automatically

---

## 5. Selector Verification (as needed)

**If any site doesn't detect working/done:**

1. Open DevTools on that site (F12)
2. While agent is generating:
   - Inspect the Stop button
   - Note its selector
3. Open `agentwatch-web/src/content/adapters/<site>.ts`
4. Update `busySelector` to match
5. Rebuild: `npm run build`
6. Reload extension at `chrome://extensions`
7. Test again

---

## Expected Results

✅ All automated tests pass  
✅ No state flicker on focus changes  
✅ Standalone notifications work  
✅ Pairing succeeds  
✅ Desktop app shows Chrome section when connected  
✅ Jump-to focuses tabs correctly  
✅ Reply-back injects and submits  

---

## If Something Fails

See **TESTING_GUIDE.md** for detailed troubleshooting and selector update instructions.

---

## Files You May Need to Edit

**Adapter selectors** (if detection fails):
- `agentwatch-web/src/content/adapters/claude.ts`
- `agentwatch-web/src/content/adapters/chatgpt.ts`
- `agentwatch-web/src/content/adapters/gemini.ts`
- `agentwatch-web/src/content/adapters/perplexity.ts`
- `agentwatch-web/src/content/adapters/copilot.ts`
- `agentwatch-web/src/content/adapters/grok.ts`

**After editing**, rebuild:
```bash
cd agentwatch-web && npm run build
```

Then reload extension at `chrome://extensions`.

---

**All code is ready. Start with step 1 above!**
