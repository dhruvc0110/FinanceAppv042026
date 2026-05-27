# FinApp — Things That Didn't Work

Check before suggesting approaches to similar tasks. Each entry: what didn't work / what worked / note.

---

## Edit tool: match failure on lines with literal `…` and unicode box-drawing chars

**What didn't work:** Trying to replace a multi-line block in `index.html` whose `old_string` included:
- A comment header like `// ── Anthropic API call ────────────────────────────────────────` (uses U+2500 box-drawing chars, count of dashes matters)
- A status string `'<span class="text-slate-400">&#x23F3; Interpreting…</span>'` where the source actually contains the six literal characters `…` (backslash, u, 2, 0, 2, 6), not the ellipsis character U+2026 itself

The Edit tool auto-swaps `\uXXXX` escapes ↔ the character form when matching, but it doesn't auto-swap box-drawing characters, and the combination of both mismatches in one block caused the swap-recovery to fail.

**What worked:** Drop the comment-header line from `old_string` entirely. Anchor the match at `async function _dtProcessText(text, onComplete) {` (or any other line without unicode runs). The function body itself was unambiguous.

**Note for next time:** When editing this codebase, comment-headers with unicode dashes are unreliable anchors for Edit matching. Match from the function signature or a plain ASCII line. Also: if you see `…` or similar in a Read output, that's how it actually exists in the source — `cat -A` or `xxd` confirms.

---

## Sort handlers re-injected panels without removing the previous one

**What didn't work:** When adding sortable headers to the tile-expansion panels for Credit Card and Bank Account detail views, `ccInjectPanel()` and `baInjectPanel()` appended a fresh `<div id="ccDetailPanel">` (or `baDetailPanel`) without first removing the existing one. Each sort click left the previous panel in the DOM, so after 3 clicks you'd see 3 stacked tables, all showing the same data with different sort orders.

**What worked:** Add `document.getElementById('ccDetailPanel')?.remove()` (and the analogous line for BA) at the very top of each inject function. This matched the pattern already used by `aiInjectPanel()` for the AI Tracker — which didn't have the bug because it was written that way from the start.

**Note for next time:** When a panel is shown by clicking a tile, **and the same handler is also called to re-render after a sort/filter change**, the handler must be idempotent on the DOM. Either remove-then-append, or use `replaceChildren()` on a stable container. Search for sibling inject functions before writing a new one — they often already encode this convention.

---

## TDZ trap: top-level dead code reading a `let` declared later in the file

**What didn't work:** Adding `let _showDictateTab = …;` near where it was used (line ~13473 in the dictate-toggle section), and a helper `_visibleTxComboTabs()` near `_TX_COMBO_TABS` (line ~2544) that read `_showDictateTab`. On page load the browser threw `ReferenceError: Cannot access '_showDictateTab' before initialization` and **all subsequent `let` declarations in the file were never created**, breaking the entire app on first paint.

The root cause is a pre-existing dead-tail at lines 11099-11140 — leftover code from `repPlaySave()` that runs `navigate('transactions')` at script top-level. That `navigate()` call calls `_TX_COMBO_TABS`-related code which now calls `_visibleTxComboTabs()` which reads `_showDictateTab` — but the `let` for `_showDictateTab` is below this line, so it's in the temporal dead zone.

**What worked:** Move the `let _showDictateTab = …;` declaration up to right beside `_TX_COMBO_TABS` (line ~2544), well before the dead-tail. Helper functions reading the var were already in the right place.

**Note for next time:** This codebase has a pre-existing dead-tail at lines ~11099-11140 that **executes at script load**. Any new `let`/`const` whose value is read transitively by anything that runs at top-level (`navigate()`, `_TX_COMBO_TABS`, anything in the body of the dead-tail) must be declared **before** line ~11099. When in doubt, declare new state variables near `_TX_COMBO_TABS` or at the top of the file. The dead-tail itself should be removed in a future pass — it's becoming a load-bearing hazard.

---

## Service worker cached old HTML during preview testing

**What didn't work:** After registering `sw.js` and shipping the PWA, subsequent test loads in the preview kept serving the old HTML even after edits + deploys. The cache-first/network-first split in the SW is correct for production but masks new code during rapid iteration.

**What worked:** In DevTools → Application → Service Workers, click "Unregister" for all SWs, then Application → Storage → "Clear site data". For hard guarantees in code: bump the `CACHE` constant in `sw.js` (currently `'finapp-shell-v1'`) on any change to the cache strategy — that forces clients to drop the old cache on next activate.

**Note for next time:** When testing changes to `index.html` against a browser that previously loaded the PWA, **don't trust a hard reload alone**. Either unregister the SW first, test in incognito (no SW registers), or bump the cache name. Document this for the user too — they'll hit it when shipping fixes.

---

## `eval()` from injected `<script>` tags cannot see the main script's `let` declarations

**What didn't work:** During preview testing, calling `mcp__Claude_Preview__preview_eval` with code like `_showDictateTab` returned `undefined` even though the value was clearly set in the running script. Same with `_TX_COMBO_TABS`, `_dtContext`, etc.

The reason: `let` and `const` declarations create *lexically scoped* bindings on the script's module record, not properties of the global object. `eval()` running in a fresh `<script>` context can see closure-captured `let`s through functions that close over them, but it cannot do a bare-name lookup for them.

**What worked:** Instead of `eval('_showDictateTab')`, call a function that closes over the variable: `eval('gcToggleDictateTab.toString()')` or `eval('JSON.stringify(_visibleTxComboTabs().map(t=>t.id))')` — the function reference itself is resolvable via property lookup on the global object (if declared as a `function` declaration, not as `const fn = …`).

For state inspection: use Read on the source instead of trying to inspect the running app, or use `window.__finappDebug = { _showDictateTab, _TX_COMBO_TABS }` style explicit exposure during testing.

**Note for next time:** preview_eval is for triggering UI behavior, not for inspecting `let` state. To verify state, click the rendered button and screenshot the result.

---

## `settingsTab` resets to 'scratchpad' on every render

**What didn't work:** After calling `navigate('settings')` to land the user on the Display tab where the new Dictate toggle lives, the page kept opening on Scratchpad regardless of which tab was supposed to be active. The state variable `settingsTab` was being set to `'display'` programmatically but the rendered output didn't reflect it.

The cause: `renderSettings(container)` contains the line `settingsTab = 'scratchpad';` near the top, so any external attempt to pre-set the tab is clobbered.

**What worked:** Call `settingsGoTab('display')` **after** `navigate('settings')`. That function sets `settingsTab` and immediately re-renders. The order matters — navigate first (which mounts the settings page and resets `settingsTab`), then `settingsGoTab` (which overrides and re-renders).

**Note for next time:** This pattern (`settingsGoTab`-style "go to sub-tab" helpers) exists for several composite pages. Prefer them over directly mutating the sub-tab state variable. If you need to deep-link into a sub-tab from another page, the sequence is always: `navigate('X')` → `xGoTab('sub')`.

---
