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

## LLM-SQL whack-a-mole: every fix opens a new failure mode of the same shape

**What didn't work:** Building reliable NL-to-SQL for finance data via prompt engineering. Across ~8 commits of targeted fixes, the same pattern surfaced repeatedly — the LLM emits SQL that is "almost right" against the user's specific data quirks, fails differently each time, and the next prompt tightening shifts the failure to a different layer:

- Prefix-only LIKE → broaden the prompt → LLM adds OR clauses around narrow conditions instead
- Unicode dash in LIKE → normalize dashes in the scrub → LLM uses exact-match
- LLM doesn't know current year → inject date context → LLM caches a pattern with the year baked into the SQL template
- KB caches a partial-correct answer → matcher serves the stale wrong pattern → user has to 👎 each one
- Agent doesn't sanity-check the result → tell it to → multi-step runs blow the 30k/min rate limit
- Aggregate returns COUNT=0 → narrative LLM happily writes "you have no X this year"
- LLM emits exact-match `description = 'Dividend - QQQI'` → real data has format variants → 0 rows → confident wrong narrative

**What worked:** Architectural pivot, not more prompt tuning. Replaced the LLM-as-analyst path with a deterministic semantic model + drag-and-drop pivot builder (`renderReports`). User picks dimensions and measures from a curated list; query compiler emits a tested SQL string; pivot transformer turns flat group-by into a matrix. No LLM in the path. Cost: zero per query, latency: instant, correctness: deterministic.

**Note for next time:** If you're patching prompt rules for the 3rd time on the same underlying class of failure, the architecture is wrong. NL-to-SQL against opinionated finance schemas requires either (a) a tested semantic model with the LLM as a *router* picking among known shapes, or (b) skipping the LLM entirely and giving the user a structured builder. Free-form SQL generation is a moving target. The user's diagnosis was sharp: "every fix opens a new failure mode of the same approach."

---

## Aggregate-empty result is NOT `rows.length === 0`

**What didn't work:** Honest empty-result handling in Ask FinApp was gated on `rows.length === 0`. An aggregate query like `SELECT SUM(amount), COUNT(*) FROM "Transaction" WHERE …` always returns exactly one row — even when nothing matches the WHERE. That single row has SUM=null, COUNT=0. The check missed this entirely, so the narrative LLM happily wrote "you've received $0 of QQQI dividends this year" as if it were the answer.

**What worked:** `_askIsLogicallyEmpty(rows, columns)` — returns true if `rows.length === 0`, OR if `rows.length === 1` and every column value in that row is null, undefined, '', 0, or '0'. Wired into the narrative gate, the SQL-panel force-show, the warning chip ("Empty result · verify"), and the KB-store guard (don't cache patterns whose result was logically empty).

**Note for next time:** Whenever you compute "is this answer empty/missing" for a user-facing UX flag, distinguish between *no matching rows* and *no aggregate signal*. They look the same to `length`, but the LLM (or any narrative generator) will treat them as confident zeros if you don't.

---

## LLMs Unicode-ify separator characters in LIKE patterns

**What didn't work:** The Ask agent emitted `description LIKE 'Dividend – QQQI%'` with an en-dash (U+2013). The user's actual data has `'Dividend - QQQI'` with ASCII hyphen-minus (U+002D). SQL `LIKE` is byte-exact. 0 rows. The prompt used ASCII hyphens throughout — the LLM still chose Unicode dashes when reproducing patterns in its output. This is a known Sonnet behavior.

**What worked:** Normalize in the SQL scrub. `_askSqlScrub` (and any equivalent in future LLM-touched-SQL paths) replaces en-dash (U+2013) and em-dash (U+2014) with hyphen-minus before execution. Bulletproof. Safe for finance data where these typographic dashes don't appear in legitimate descriptions.

**Note for next time:** Don't trust LLMs to faithfully reproduce ASCII-only patterns. Normalize at the boundary. The same risk applies to smart quotes (`’` vs `'`), non-breaking spaces (U+00A0 vs space), and various other "helpful" Unicode substitutions. Add a `_normalizeAscii(sql)` step on the boundary if you ever revive the LLM path.

---

## Auto-caching LLM answers in a KB poisons future queries

**What didn't work:** Ask FinApp's KB stored every successful agent answer as a `QueryPattern` with `hits=1, confidence=low`. The matcher LLM then matched future similar questions against that pattern with `confidence='medium'` (params inferred) and ran the cached SQL — even when the original agent answer was "partially correct" (e.g. found 3 of 5 monthly dividends because the LIKE missed format variants). User's only recovery was 👎 on each individual answer, which deleted the pattern but didn't prevent the agent's NEXT run from producing the same partial-correct SQL and re-caching it.

**What worked:** Two layered mitigations:
1. Don't cache logically-empty results (`_askIsLogicallyEmpty` guard) — stops the worst case of caching "found nothing" as a reusable answer.
2. "Clear KB cache" admin button in the modal sidebar — single click `DELETE FROM QueryPattern`. Useful for nuking accumulated bad patterns after a prompt-engineering improvement lands.

The deeper fix would be to quarantine new patterns (hits=1) from the matcher entirely until the user thumbs-up promotes them. Architecture change we didn't ship before pivoting away from LLM-SQL.

**Note for next time:** Auto-population of an LLM-cache is only safe if you have a strong signal that the cached answer was correct. Thumbs-up promotion as a prerequisite for matchability is the right pattern. Plain "non-empty result" is not strong enough — partial-correct results poison the cache for everything similar.

---

## Anthropic prompt caching is the single biggest token-spend lever

**What didn't work:** Multi-iteration agent runs in Ask FinApp blew Anthropic's 30k input-tokens-per-minute rate limit. Each agent iteration carried the full ~2-3k system prompt (schema + business notes + rules). 5 iterations = 15k input tokens minimum. Two back-to-back questions hit the cap.

**What worked:** Wrap the system prompt with `cache_control: {type: 'ephemeral'}`. Anthropic caches the prefix for 5 minutes; subsequent reads get a ~90% discount on input tokens *and* count against the rate limit at the discounted rate. Iterations 2–N in the agent loop reuse the cache; back-to-back questions within 5 minutes hot-start.

```javascript
body.system = [{
  type: 'text',
  text: longSystemPrompt,
  cache_control: { type: 'ephemeral' }
}];
```

Only valid when the cached content is ≥ 1024 tokens. Small prompts (matcher, narrative) skip caching. Pass `cacheSystem: true` only from paths that loop with a stable system prompt.

**Note for next time:** When building any multi-turn LLM flow with a stable system prompt > 1k tokens, set `cache_control` from day one. Costs nothing extra to opt in; saves 50–90% of input tokens on multi-step runs and is the difference between hitting and not hitting per-minute limits.

---

## Edit tool: heavy box-drawing comment headers disappear silently if you re-edit later

**What didn't work:** Earlier in the session I used `// ════════════════════════════════════════════════════════════ \n // ASK FINAPP — conversational reporting (Phase 2 rebuild) \n // ════════════════════════════════════════════════════════════` as an anchor for one Edit. A later Edit that consumed it left the comment block above gone but the body text still there. A *third* Edit trying to match against that header again failed with "String to replace not found."

**What worked:** Grep first when the file has been heavily edited (`grep -n "ASK FINAPP — conversational reporting"`). If the anchor's missing, anchor on a unique non-comment line instead (`function _askLlmSql`, `let _askMode = ...`). Never trust an earlier-session line number; the file changed.

**Note for next time:** Box-drawing-character anchors are fragile across multi-edit sessions. Prefer anchoring on a function signature or any uniquely-named identifier. Especially in a 15k-line single file where comment headers may repeat or get partially deleted.

---

## Live DB schema ≠ `_initCoreSchema` — the real finance.sqlite has constraints/columns the fresh schema doesn't

**What didn't work (twice now):**
1. The Refund flow inserted `linkedTxId` — a column present in `_initCoreSchema` but **missing** from the user's existing DB (CREATE TABLE IF NOT EXISTS never alters an existing table). Save failed with "no column named linkedTxId."
2. F2 Manual Assets set `role='MANUAL_ASSET'` on a new account. The user's real `Account` table has a **CHECK constraint** `role IN ('ACCRUED_EXPENSE','ACCRUED_LIABILITY','BELOW_THE_LINE','EXCLUDED','FLUX_PL')` that `_initCoreSchema`'s `Account` does NOT have. Insert failed: "CHECK constraint failed: role". Passed in the sandbox (fresh schema, no CHECK), failed on first real use.

**What worked:**
1. Add an idempotent `ALTER TABLE … ADD COLUMN` in the startApp migration region for any new column.
2. Don't overload `role` (or any column with a CHECK) for new markers. Added a dedicated `isManualAsset` column (via ALTER) and identified the equity offset by its unique `code='MA-EQ'` instead of a custom role value. Set `role=NULL` on both new accounts.

3. **Same feature, next layer:** after fixing (2), the offset account used `type='EQUITY'`. The real `Account.type` has CHECK `type IN ('EXPENSE','INCOME','ASSET','LIABILITY')` — **no EQUITY**. Failed: "CHECK constraint failed: type". This DB has no equity accounts at all; the Balance Sheet shows only Assets + Liabilities and net worth is derived as assets−liabilities.

**What worked (offset):** the manual-asset offset is an **INCOME account flagged `role='EXCLUDED'`** (both allowed). EXCLUDED keeps it out of P&L, Cash Flow Sankey, dashboard and `buildBalanceMap`; the ASSET side still lifts net worth (assets−liabilities). Also: (a) reordered `maSaveAsset` to create the offset BEFORE the asset and wrapped the whole save in `BEGIN/COMMIT/ROLLBACK` so a mid-way failure can't leave an orphan; (b) added a startup cleanup that deletes manual-asset accounts (`isManualAsset=1`) with zero transactions (orphans from the earlier partial failures); (c) require asset value > 0 so every real asset has an opening entry (makes "tx-less = orphan" reliable).

**Known constraints on the real `Account` table:** `type IN ('EXPENSE','INCOME','ASSET','LIABILITY')` (NO EQUITY) · `role IS NULL OR role IN ('ACCRUED_EXPENSE','ACCRUED_LIABILITY','BELOW_THE_LINE','EXCLUDED','FLUX_PL')`.

**Note for next time:** The fresh `_initCoreSchema` is NOT a faithful model of the user's real DB — the live finance.sqlite was created from an older/stricter schema with **extra CHECK constraints and columns**. Before writing to an existing table: (a) never assume a column exists — add a migration ALTER; (b) never write a novel value into a constrained column (`role`, `type`, possibly `importSource`) — add a new column or use an allowed value; (c) there are NO EQUITY accounts — represent owner's-equity/offset needs via an EXCLUDED income/expense account; (d) the sandbox won't catch these because it builds tables from `_initCoreSchema` — to reproduce, recreate the specific table WITH its real CHECK constraints before testing; (e) wrap multi-statement writes in BEGIN/COMMIT/ROLLBACK so a constraint failure mid-sequence doesn't leave partial rows.

---
