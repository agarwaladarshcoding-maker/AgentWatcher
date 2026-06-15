# AgentWatch - Quick Start Guide

## Current Status ✓
**Branch:** `phase3-permissions-claude-theme`  
**Commit:** `7b3cf6c`  
**Build:** ✓ All 15 self-checks passed

---

## Start the App

### 1. Kill any old instances
```bash
pkill -f agentwatch
```

### 2. Choose your mode:

#### Development Mode (recommended for testing)
Hot-reload, instant updates:
```bash
npm run dev
```

#### Production Mode
Real packaged experience:
```bash
npm run build
./bin/agentwatch.js gemini
```
or
```bash
./bin/agentwatch.js claude
```

---

## Testing Checklist

### ✓ 1. Dark Theme (Claude Colors)
- [ ] App background is warm near-black (#262624)
- [ ] Terminal is darker (#1F1E1D)
- [ ] Coral accent (#D97757) on buttons
- [ ] Text is warm near-white (#ECEBE3)

### ✓ 2. New Terminal Works
1. Click **Settings** (gear icon)
2. Click **New Terminal**
3. Type `gemini` or `node` or `bash`
4. Click **Run**
5. **Expected:** Terminal starts (no "command not found")

### ✓ 3. Notifications Work
1. Wait for an agent to ask a permission prompt
2. **Expected:** 
   - OS notification appears
   - Dock bounces (macOS)
   - Badge shows "1"
   - Only ONE notification (no duplicates)
3. Click the notification
4. **Expected:** App focuses and switches to that session
5. Answer the prompt (Allow/Deny)
6. **Expected:** Notification closes automatically

### ✓ 4. Terminal Scrollbar
1. Resize the terminal window (drag corner)
2. Scroll up and down quickly
3. **Expected:** 
   - No flash
   - No glitches
   - Smooth dark scrollbar (#4A4843)

### ✓ 5. History Export
1. Click **History** (clock icon)
2. Click a session to expand it
3. Click **Export JSON** or **Export Markdown**
4. **Expected:** File saves to ~/Downloads
5. Open the file
6. **Expected:** Contains session data (events, verdicts, timeline)

---

## Available Commands

```bash
# Development (hot-reload)
npm run dev

# Build production
npm run build

# Start production build
npm start

# Run self-check (verifies everything)
npm run selfcheck

# Rebuild native modules (if needed)
npm run rebuild

# Package as .dmg/.exe/.deb
npm run package

# TypeScript check
npm run typecheck
```

---

## Troubleshooting

### "Command not found" in New Terminal
- ✓ Fixed! `resolveLoginPath()` loads your shell's PATH
- If still fails: check `echo $PATH` in your terminal, verify the command exists

### Notifications don't appear
- Check macOS System Settings → Notifications → AgentWatch (or Electron)
- If "Do Not Disturb" is on, fallback cues still work (dock bounce, flash, badge)
- ✓ The app will never miss a prompt (even if OS suppresses toast)

### Dark theme not loading
- Hard refresh: Cmd+R in dev mode
- Clear cache: Cmd+Shift+R
- ✓ Should work out of the box (color-scheme: dark)

### Terminal scrollbar glitches
- ✓ Fixed! Custom webkit scrollbar styles
- If still happens: check zoom level (Cmd+0 to reset)

---

## What's New in This Branch

### Phase 3 (Permissions)
- Permission control plane
- Allow/Deny buttons in terminal
- OS-level notifications

### Phase 4 (History)
- SQLite audit log
- Persistent session history
- Event/verdict timeline

### Phase 5 (Polish + Fixes)
- ✓ Claude dark theme (entire system)
- ✓ New Terminal PATH resolution
- ✓ Notification dedupe + click-to-focus
- ✓ Terminal scrollbar stability
- ✓ Session export (JSON + Markdown)
- ✓ Comprehensive self-check script

---

## Ready to Test!

Everything is committed and verified. Just run:
```bash
npm run dev
```

And test the 5 items in the checklist above.

For any issues, check `PHASE5_COMPLETE.md` for implementation details.
