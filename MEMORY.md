# FinApp — Session Memory

Read at the start of every session. Append, don't rewrite. Each entry: what / why / rejected.

---

## 2026-05-26 — Session 1

### Decided: All date pre-fills use browser-local time, never UTC.
- **Why:** Sidebar clock uses local time; transaction defaults must match. `toISOString()` returns UTC, which is one day off for any user not on Greenwich during the wrong hour.
- **Pattern in use:** `new Date().toLocaleDateString('en-CA')` — `en-CA` is the canonical YYYY-MM-DD shape that HTML `<input type="date">` accepts.
- **Rejected:** Adding a `todayLocal()` helper. Coding-rules says "simplest thing that could work" and "don't add abstractions not explicitly requested." Inlining the pattern at each call site is fine; only ~6 call sites total.
- **Applied at:** [index.html:12750](index.html:12750) (Buy/Vest), [index.html:9602](index.html:9602) (Dictate AI prompt today value), [index.html:3633](index.html:3633) (cosmetic re-format of New Transaction line, which was already correct).
- **Not applied at:** `aboutFetchApiUsage` — Anthropic usage API expects UTC dates, so UTC is correct there.

### Decided: Dictate supports multi-transaction input with `#` delimiter.
- **Why:** User wanted to dictate or type several transactions at once instead of running the flow N times.
- **Rule:** Unquoted `#` starts a new transaction. To preserve a literal `#` inside a description, wrap it in double quotes — `Invoice "#"5012` is one transaction with description `Invoice #5012` (the quotes are stripped).
- **Implementation:** [`_dtProcessText`](index.html) splits on `#` after replacing `"#"` with a `\x00HASH\x00` placeholder, then restores `#` in each segment.
- **Parsing:** Each segment is sent to the AI in a separate API call via `Promise.all` — parallel, not serial.
- **Rejected:** Single API call returning a JSON array. Would have needed prompt rewrite and the AI sometimes returns mixed-quality arrays. Parallel single-tx calls are more robust.
- **Rejected:** Auto-detection of multi-tx via natural language ("and then I bought X"). Less predictable than explicit `#`.

### Decided: Failed-parse segments become drafts with blank accounts.
- **Why:** Never lose user input. If the AI can't interpret a segment, the user gets a draft row with the raw segment text in the description, both accounts blank, amount 0. They complete it manually in the review table.
- **Rejected:** Abort the whole batch on any failure. Loses the segments that parsed fine.
- **Rejected:** Partial-post with a status banner but no draft row for the failure. Forces user to retype.

### Decided: Dictate modal stays open until the entire pending Dictate queue is empty.
- **Why:** Multi-tx batches with N pending drafts shouldn't close the modal after every individual approve. User wants to review all N in one sitting.
- **Implementation:** New `_dtCloseOrRefresh` helper at [index.html](index.html). After every approve / reject / discard, it counts pending Dictate drafts across all batches; if any remain, refresh modal; if zero, close + `navigate(currentPage)`.
- **Rejected:** "Approve All" button. Adds UI surface area; row-by-row already supports it via stay-open behavior.

### Decided: Dictate post returns user to the page they opened the modal from.
- **Why:** Posting from Account Tracker used to bounce the user to the Transactions page. Disorienting.
- **Implementation:** `_dtCloseOrRefresh` calls `navigate(currentPage)` — `currentPage` is the existing global tracking the active page, and it can't be changed while the modal is open (modal blocks navigation).
- **Rejected:** Adding a `returnPage` parameter to `dtOpenFloatingModal`. `currentPage` already exists and is correct — no new state needed.

### Decided: Dictate modal max-width 1100px.
- **Why:** Drafts table needs ~900px for Date/Desc/Amount/DR/CR/Actions columns + padding. Old 680px modal always overflowed horizontally.
- **Behavior on small screens:** `width:100%` still applies, so the modal shrinks to viewport-minus-padding on small screens; the cap only kicks in above ~1130px viewport.
- **Rejected:** Responsive `min(1100px, 95vw)`. Adds complexity; current behavior already does the right thing because `width:100%` is set.

### Known issues flagged but NOT fixed this session
- **Dead tail in `repPlaySave`** at [index.html:10755](index.html:10755) — ~40 lines of code after the function's try/catch that reference undefined `r` and `date` variables. Throws ReferenceError in console after every Play→Save. Out of scope; cleanup pending.
- **HANDOFF.md model mismatch** — claims Sonnet 4 for all AI features; actually screenshot import + ticker-name lookup use Haiku 4.5. HANDOFF.md should be updated.
- **Filter SQL string interpolation** at `buildTxWhere` ([index.html:2962](index.html:2962)), FT `buildWhere` ([index.html:7877](index.html:7877)), `dupRunScan` `dateFilter` ([index.html:10394](index.html:10394)). Low risk because inputs come from `<input type="date">`, but inconsistent with the parameterized write pattern.
- **Duplicated tile builder** between `_renderDashboard` and `_dashGetTiles` — two sources of truth for which tiles exist.
- **Duplicated Repeatable UI** between `_renderSettingsPage` (`repeatableTab`) and `renderRepeatableInner`.

### Workflow decisions
- **Edits land in `/Users/dhruv/Desktop/FinApp/index.html` (local). Deployment to GitHub Pages requires a separate push step.** The folder is being converted to a git working tree this session (see session 1 wrap).
- **Per coding-rules: no preamble, simplest fix first, don't touch unrelated code, end every coding task with a Files Changed block.**
- **Per deep-design: pose design choices with pros/cons before implementing non-trivial features.**

---

## 2026-05-27 — Session 2

12 commits shipped, all live. See HANDOFF.md "Recent commits" for the list and SHAs.

### Decided: sub-tab state preserves across navigation by default (no implicit resets).
- **Why:** Switching between sub-tabs on Account Tracker / Transactions / Financial Statements / Transact Equity was wiping the user's expanded tile, pagination, sort, edit mode. Modern apps (Slack, Notion) preserve sub-tab state. User explicitly picked "universal preservation" over the alternatives.
- **Implementation:** Removed `*OpenId = null`, `*Page = 0`, `*Tab = 'pending'`, `*EditMode = false`, `equitySortCol/Dir = ...` resets from the public `render*()` entry functions. Now state sticks until the user changes it. Added top-level `let dupTab = 'pending'` since removing the reset would have left it implicitly undefined on first visit.
- **Rejected:** Differentiating "sidebar entry → reset" vs "sub-tab switch → preserve". Would have required refactoring init helpers per page. User wanted universal behavior.
- **`renderReviewEquity` untouched** — intentionally forces Summary-only mode with default sort, that's the point of Review mode.

### Decided: sub-tab bar protection via `_getActiveContent()` helper.
- **Why:** `ccTileClick`, `txDeleteRow`, etc. called `_renderCCPage()`/`_renderTxPage()` with no container arg. The default `document.getElementById('pageContent')` is the OUTER main-content div, so `innerHTML = …` wiped the entire composite shell including the sub-tab bar.
- **Implementation:** New `_getActiveContent()` near `query`/`queryVal`. Returns the first existing inner sub-tab container ID (`atContent`/`fsContent`/`txComboContent`/`teContent`) or falls back to `pageContent`. Replaced all 20 occurrences of `if (!container) container = document.getElementById('pageContent');` with the helper.
- **Rejected:** Per-click-handler fix (pass the right container explicitly). Too many call sites. Helper is one chokepoint.
- **Rejected:** Module-level `_activeSubTabContainer` global set by composites. More state to manage; lookup-on-demand is simpler.

### Decided: User-selectable Layout view (Auto / Phone / Tablet / Desktop) overrides responsive breakpoints.
- **Why:** "Mobile/tablet" is user preference, not just device-size. Some users want compact tables on desktop; some want cards on a tablet.
- **Implementation:** `_viewMode` state + `gcSetView()` toggle in Settings → Display. `_applyViewMode()` resolves `'auto'` against `window.innerWidth` and sets classes on `<html>`: `use-cards` (card layout) or `use-tablet-hide` (compact table). CSS keys off those classes — no JS re-render needed when toggling. Window `resize` listener re-applies on auto mode.
- **Card layout:** `.table-mobile-cards` class on the table, `data-label="…"` on each `<td>`. CSS in the `<style>` block transforms each row into a labelled card.
- **Tablet-hide:** `.tablet-hide` on secondary `<th>`/`<td>` (Notes/Source/Reconciled/Created on Transactions and Future Transactions). Hidden when `html.use-tablet-hide`.
- **Scope:** Card layout applied to Transactions, Future Transactions, AI detail panel, CC Tracker detail panel only (user's "conservative" pick). Repeatable was an earlier POC; left in place.
- **Rejected:** Always-on responsive media queries with no manual override. User wanted control.

### Decided: PWA-installable, custom icon, standalone launch.
- **Why:** User accesses on mobile via home-screen shortcut. Default was a grey "G" with Chrome badge, opening in a tab. They wanted a custom `$` icon and standalone (no-browser-chrome) window.
- **Files added:** `manifest.webmanifest`, `icon.svg` (white `$` on slate-900, sized for maskable safe zone), `sw.js` (network-first for HTML, cache-first for same-origin static, passes cross-origin through).
- **`<head>` additions:** manifest link, SVG icon link, `apple-touch-icon`, `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-mobile-web-app-title=FinApp`, `theme-color=#0f172a`, SW registration script.
- **Rejected:** PNG fallback for iOS < 16. User is on Android Chrome; SVG works there.
- **Rejected:** In-app re-install nudge banner. User said they'd remove old shortcut and re-add manually.
- **Re-install required:** existing home-screen shortcuts don't auto-upgrade; user must remove and re-add via Chrome menu after each deploy.

### Decided: Sortable headers on tile-expansion detail panels.
- **Why:** Account Inquiry showed transactions oldest-first; user wanted newest-first by default with clickable sort.
- **Scope:** AI / CC / BA / Accruals detail panels. Each has its own `_<p>TxSortCol` / `_<p>TxSortDir` state + sort handler.
- **Pattern:** Local `_orderBy()` + `sortTh()` helpers inside the inject function. Default = `trxDate desc`. Click same col → reverse; click new col → desc.
- **Sortable columns kept minimal:** Date, Description, Amount-or-Effect. Side / Sub-Account / Counterpart / Type / Rec deferred — they'd need CASE-based SQL ORDER BY.
- **Accruals needed `_accrualReinject(subId)` helper** — `accrualTileClick` toggles off when called on the open tile, so sort handler can't reuse it. The reinject helper rebuilds + injects without the toggle.

### Decided: Origin preserved through FutureTransaction → Transaction migration.
- **Why:** Future-dated dividends (and recurring, dictate, etc.) lost their origin badge — every migrated row became `'Scheduled'`.
- **Implementation:** Added `importSource TEXT` column to `FutureTransaction` (idempotent ALTER TABLE in `startApp`; added to `_initCoreSchema` for fresh DBs). `migrateFutureTransactions` now reads `ft.importSource || 'Scheduled'`. Six INSERT-INTO-FutureTransaction sites updated to set their origin: divSave→`'Equity'`, txSaveForm→`'Scheduled'`, generateRepeatables→`'Recurring'`, xlCommit→`'excel'`, dtModalApproveDraft (FT)→`'Dictate'`, repPlaySave→`'Repeatable'`.
- **Backfill:** Existing FT rows have NULL → degrade to `'Scheduled'` (no behavior change).
- **NOT touched:** Settings → Backup XLSX importer at line ~13029. Its immediate-side INSERT also omits importSource entirely, so adding it only on the FT side would be asymmetric. Defer to a unified cleanup later.

### Decided: Show/Hide Dictate sub-tab toggle in Display settings.
- **Why:** User wanted to declutter the Transactions composite tab bar. The floating mic button always stays — it's the persistent entry point.
- **Implementation:** `_showDictateTab` state + `gcToggleDictateTab` handler. `_visibleTxComboTabs()` filter on `_TX_COMBO_TABS`. Edge case: if hidden while currently on the Dictate sub-tab, falls back to Transactions.
- **Declaration position matters:** `_showDictateTab` had to be declared near `_TX_COMBO_TABS` early in the file (not next to `_darkMode` at line ~13465). The pre-existing `repPlaySave` dead-tail at line 11099 runs `navigate('transactions')` at top-level on script load — which now flows through `_visibleTxComboTabs()` and reads `_showDictateTab`. Declaring it late put it in TDZ at that moment, which threw, halting all subsequent let declarations. See ERRORS.md.

### Known issues NOT fixed (carried into next session)
- **`repPlaySave` dead-tail** at lines 11099–11140 is now actively dangerous, not just dead. Top-level statements running `navigate('transactions')` on script load create TDZ traps for any new `let` referenced (directly or transitively) by `_visibleTxComboTabs`. Strong recommendation: delete the dead-tail in a dedicated commit.
- **`Settings → Backup` XLSX importer** at line ~13029 — neither immediate nor FT path sets `importSource`. Inconsistent with the newer template importer. Easy cleanup.
- **HANDOFF.md model claim** — the v1 doc said Sonnet 4 everywhere. The new HANDOFF.md (this commit) corrects it: Dictate uses Sonnet 4; screenshot import + ticker-name lookup use Haiku 4.5.
- **Filter SQL string interpolation** in `buildTxWhere` / FT `buildWhere` / `dupRunScan` `dateFilter` — still uses string interpolation rather than parameterized queries. Low risk (inputs are `<input type="date">`) but inconsistent with the parameterized write pattern.
- **Existing live-DB `Dividend - …` rows** with `importSource='Scheduled'` — won't retro-tag. User asked-and-deferred. One-off UPDATE would do it.
