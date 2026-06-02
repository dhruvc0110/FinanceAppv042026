# FinApp — Session Memory

Read at the start of every session. Append, don't rewrite. Each entry: what / why / rejected.

---

## 2026-06-01 — Session 5

### Decided: Multi-line Journal Entries — BUILT then REVERTED.
- **What:** Built a true header+lines JE ledger (JournalEntry/JournalLine tables, a Journal Entries sub-tab + balanced multi-line modal, and a `buildBalanceMap` JE pass). Then reverted the whole thing.
- **Why reverted:** Balances did not propagate. Root cause — `buildBalanceMap` is **NOT** the single balance chokepoint I assumed. Many surfaces compute balances by querying the `"Transaction"` table directly and never saw JournalLine rows: `_renderPLPage`, `_renderBSPage`, `_renderAIPage`, `_renderCCPage`, `_renderBAPage`, `_renderPBSPage`, and the XLSX export (`xlDoExport`). Only the Dashboard + a couple of callers go through `buildBalanceMap`. User judged the full fix (unify all surfaces) overkill for the need.
- **How reverted:** `git revert` of the JE commit (clean — JE commit was purely additive and the immediate child of tag `stable-pre-je` = 0552eb6). Then a TEMPORARY one-time cleanup block in `startApp` dropped the orphan JournalEntry/JournalLine tables from the live Drive DB (they persisted because the user had loaded the JE build and saved one entry), synced, and the cleanup block was then removed in a follow-up deploy. Final `index.html` is byte-identical to `stable-pre-je`.
- **KEY LESSON (logged for future balance work):** There is **no single balance chokepoint**. Any feature that must affect balances has to be reflected in every direct-`"Transaction"`-query surface listed above, OR those surfaces must first be refactored onto one shared ledger source. Don't trust "buildBalanceMap drives everything."

### Decided: Product Roadmap page (feature-adoption bucketing + build progress).
- **Why:** Reviewed Monarch / Origin / Empower / YNAB / Kubera (banking-integration, bill-pay, subscription-cancel features excluded by user constraint; web-verified June 2026). Needed a place to triage 32 candidate features into Must / Should / Nice and track build status — and per deep-design, a multi-session build gets a living roadmap *in the app*.
- **Model:** New `RoadmapItem` table (id, theme, title, detail, apps, enhances, bucket, status, sortOrder, notes, updatedAt). Seeded once via `INSERT OR IGNORE` on stable ids (`_ROADMAP_SEED`, F1–F31 + F11b = 32 rows) so re-seeding never clobbers user edits and new features can be appended. Schema added to both `_initCoreSchema` (fresh DBs) and the `startApp` migration region (existing DBs); `_seedRoadmap()` runs in startApp and defensively in `renderRoadmap`.
- **UI:** New sidebar nav item "Roadmap" → `navigate('roadmap')` → `renderRoadmap()`. Summary counts, bucket filter chips + status filter, theme-grouped rows; each row has Must/Should/Nice toggle (click active = clear), Idea/Planned/Building/Done status select, and a notes field. Writes go straight to DB + `syncAfterWrite()`. Isolated blast radius — new table + new page + one nav entry; touches no balance/transaction code.
- **MCQ decisions:** Deliverable = Build into FinApp (not standalone HTML); Source = web-verify first; Page scope = bucketing + progress (not bucketing-only, not +custom-items).
- **NOT done / follow-up:** No add-your-own / hide-feature in-app (the "+custom" option was not chosen). Buckets/status are the user's to set — none pre-assigned.

### Decided: Must-have build sequence + Done-marking + deploy cadence.
- **Must-haves (user-bucketed):** F2 Alt/manual assets, F3 Asset allocation, F5 Future net-worth projection, F7 Sankey, F26 Document vault.
- **Sequence:** F7 → F2 → F3 → F5 → F26. F7 first as a low-risk loop-validation; F2 is the foundation F3/F5 consume; F26 last (storage design fork).
- **Done-marking mechanism:** each shipped feature's deploy carries a one-time guarded `UPDATE RoadmapItem SET status='Done' WHERE id='Fx' AND status<>'Done'` in the startApp init block. Can't write to the user's live Drive DB from the agent side; this self-propagates on next load. Trade-off: a shipped feature re-asserts Done on load (user accepted).
- **Deploy cadence (user MCQ):** "Deploy as each is ready" — build+verify in preview, then deploy each phase and report (no per-push re-ask).
- **Reading buckets:** the agent CANNOT read the user's bucket choices — finance.sqlite is under Google's private `drive.file` scope, invisible to the Drive MCP. User shares via screenshot.

### Built: F7 Sankey (DONE, deployed 36331b2).
- New "Cash Flow" tab in the Financial Statements composite. Hand-rolled SVG Sankey (income sources → hub → expense uses + Net savings/Drawdown), period-range selector. Reads income(CR-DR)/expense(DR-CR) per account, same path as P&L. No charting dependency (keeps offline-PWA single-file nature). Edge cases verified: deficit→Drawdown, surplus→Net savings, empty→message.

### Built: F2 Manual Assets (verified, deploying).
- New "Assets" sidebar page (Review group). Manual asset = native ASSET account, `role='MANUAL_ASSET'`, tagged `assetClass` (new nullable Account column, also seeds F3). Value via ordinary transactions against one auto-created EQUITY offset (`role='MANUAL_ASSET_EQUITY'`, code MA-EQ) — flows through all balance surfaces, no chokepoint. "New total" value entry → posts signed delta. importSource='Manual Asset'. Add / Update value / History; future-date blocked.
- **Bug fixed during build:** code `'MA-'+genId().slice(0,6)` collided (genId is time-prefixed) → switched to sequential collision-checked `MA-001…`.
- **Hotfix 1 (role CHECK):** real `Account` table has CHECK on `role` (allow-list only) — `role='MANUAL_ASSET'` failed though it passed in the sandbox. Switched to a dedicated `isManualAsset` column (migration ALTER) + offset identified by `code='MA-EQ'`, both `role=NULL`.
- **Hotfix 2 (type CHECK — no EQUITY):** real `Account.type` CHECK is `('EXPENSE','INCOME','ASSET','LIABILITY')` — **no EQUITY**. This DB has no equity accounts; net worth = assets−liabilities (derived; BS shows only A+L). So the offset became an **INCOME account with `role='EXCLUDED'`** (out of P&L/Cash Flow/dashboard/buildBalanceMap, while the ASSET side lifts net worth). Reordered maSaveAsset (offset first) + wrapped add/update in BEGIN/COMMIT/ROLLBACK; one-time startup cleanup deletes tx-less orphan manual-asset accounts from the failed attempts; asset value must be > 0. See ERRORS.md "Live DB schema ≠ _initCoreSchema".
- **Follow-up:** revaluation dated in the past doesn't rewrite intermediate-period running balances (only the cumulative current value is correct — fine for net worth).

### Added: Manual-asset delete + Balance Sheet treatment (per user request).
- **Delete** (`maDelete`): confirm → `BEGIN; DELETE Transaction WHERE dr/cr=id; DELETE Account; COMMIT`. Removes the asset account + its valuation history atomically; offset account untouched.
- **BS treatment** (`maSetBsRole`): per-asset dropdown On balance sheet / Below the line / Excluded → sets `Account.role` to NULL / `'BELOW_THE_LINE'` / `'EXCLUDED'` (all in the CHECK allow-list; already handled by `renderBS` + `buildBalanceMap`). Excluded ⇒ out of BS + net worth + allocation; below-the-line ⇒ separate BS section (still in buildBalanceMap per existing app semantics). Row shows a state pill + dims excluded values; assets remain in the Holdings list in every state (identified by `isManualAsset`, independent of role).

### Built: F3 Asset allocation (verified, deploying).
- **IA change:** the Assets page is now a composite — tabs **Holdings** | **Allocation** (`_asTab`, `asSetTab`, `_renderAssetsContent`, `_pageTabBar`). Sets up F5 as a future "Projection" tab. Added manual-assets to `_currentSub`/`_switchSub` for back-gesture support.
- **Taxonomy unified** into shared `_ASSET_CLASSES`/`_ASSET_CLASS_COLOR` (Cash, Equities, Bonds, Real estate, Crypto, Precious metals, Collectible, Vehicle, Other; + Unclassified). F2 now uses the shared list too.
- **Allocation tab:** Chart.js doughnut (reused existing lib, registered in activeCharts + destroyed on re-render) of current ASSET balances grouped by assetClass, a % breakdown, and an inline per-account classifier (`asSetClass` → UPDATE Account.assetClass). Accounts with no class show as "Unclassified" (never hidden). Reads via `buildBalanceMap(null)`.
- **MCQ-equivalent defaults (stated, not asked — momentum):** preset taxonomy, manual per-account classification, doughnut chart, tabbed Assets page.

### Built: F5 Net-worth projection (verified, deploying).
- Third Assets tab **Projection**. Compound-growth model: net worth today (Σ ASSET balances − Σ LIABILITY balances via buildBalanceMap) projected forward with monthly compounding. Inputs: horizon (yrs), expected annual return %, monthly net contribution — contribution pre-filled from trailing-12-month avg monthly net (income−expense), editable. Chart.js line + summary stats (projected, total contributions, growth). `fpSet` re-renders on change (onchange, not oninput, to keep input focus).
- **Limitation/note:** trailing-avg denominator counts all DISTINCT recent periods incl. setup-only months, so it can understate the suggested contribution — it's an editable starting point. Does not auto-pull individual scheduled/future transactions (uses the avg instead). Not Monte Carlo (deliberate — simple & controllable).

### Built: F26 Document vault (verified, deploying). → ALL 5 MUST-HAVES SHIPPED.
- **Storage model (user MCQ): links/references, NOT embedded files** — because whole-DB-file Drive sync would re-upload every embedded file on each save. New `Document` table (id,title,url,category,accountId,docDate,notes,...). New "Documents" sidebar page. Add/Edit/Delete; category (Statement/Insurance/Deed/Tax/Other); optional link to any account/asset; URL auto-normalized (prepends https://); "no link" state; Open opens in new tab. Delete removes only the catalog entry.
- **Status:** Must-haves complete — F7 (36331b2), F2 (8f81a0c), F3 (9aad354), F5 (f967cb7), F26 (this deploy). All carry one-time `status='Done'` marks → Roadmap auto-updates on load. Remaining: 10 Should + 17 Nice, unstarted.

### Should-haves wave (10): F1,F6,F8,F9,F12,F14,F18,F20,F24,F29.
- **Sequence:** F1 → F6 → F8 → F18 → F9 → F24 → F20 → F29 → F12+F14. Low-risk viz first; budgeting envelope pair (F12/F14) last (touches budget engine). Same cadence: build → verify vs real constraints → deploy each → auto-mark Done.
- **Note:** Dashboard already has small net-worth + income/expense lines — F1/F6 are richer dedicated views, not duplicates.
- **Built: F1 Net worth over time** — new **Net worth** tab on the Assets composite (`_renderNetWorthTab`, `_nwMonths` 12/24/36/All). Cumulative assets−liabilities per period via `buildBalanceMap(periods<=P)`, excluding BELOW_THE_LINE (matches dashboard logic + manual-asset BS settings). Chart.js line (net worth/assets/liabilities) + stat cards. Verified.
- **Built: F6 Cash-flow over time** — added an "Income vs expense by month" Chart.js chart (grouped Income/Expense bars + Net line) to the **Cash Flow** tab beneath the Sankey, spanning the periods in the existing cfFrom..cfTo range. `_cfChart` tracked + destroyed on re-render, pushed to activeCharts. Per-period income/expense via `buildBalanceMap([p])`. Verified.
- **Built: F8 Spending-by-category trends** — third Cash Flow card "Top spending categories over time": stacked-bar Chart.js (`_cfCatChart`) of top-6 EXPENSE accounts by total over the range (rest → "Other (n)"), per-period via `buildBalanceMap([p])`. Cash Flow tab is now the cash-flow analytics hub (Sankey + income/expense trend + category stacks). Verified.
- **Built: F18 Retirement projection** — "Retirement readiness (4% rule)" card on the Projection tab, reusing F5's compound engine (fpReturn/fpContrib). Inputs: current age, retirement age, annual retirement spending (pre-filled from trailing-12mo expense ×12 via `_fpTrailingMonthlyExpense`). Computes nest egg at retirement (project nw0 for yrsToRet), needed = spend/0.04 (25×), surplus/shortfall, sustainable spend = nest×0.04, on-track flag. Verified ($188k→$1.48M nest, $900k needed, on track).

---

## 2026-05-31 — Session 4

### Decided: Floating pill gets a 3rd (middle) button → New Transaction.
- **Why:** Fast "add a transaction" from any page without first navigating to the Transactions tab.
- **Implementation:** `_floatingPillHtml()` now has 3 buttons — red Dictate mic | slate-900 file-plus (New) | greyed Reports. New handler `txOpenNewFromPill()`: `navigate('transactions')` → force `_txComboTab='transactions'` via `txComboSetTab` if needed (the `txFormModal` only exists on that sub-tab) → `txShowNewForm()`. Synchronous render, no timing risk.

### Decided: Refund / Return functionality on Transactions.
- **Why:** User buys $100 on May 12, returns part/all on May 14, records it May 15. Needs a transaction with createdAt=system date, trxDate=return date, reversing the original, auto-linked, supporting multiple partial returns.
- **Model:** A refund is a normal `"Transaction"` row that **reverses** the original (refund DR = original CR, refund CR = original DR). `importSource='Refund'`. `linkedTxId` = original id is the **authoritative parent pointer** — `SUM(amount) WHERE linkedTxId=?` gives "refunded so far". Also inserts a `TransactionLink` row (note `'Refund'`, ordered aId<bId like `txLinkPair`) so the existing link badge + cross-app drill-down surface the pairing. No schema change — both columns already existed (`linkedTxId` was unused on Transaction; `TransactionLink` is the generic manual-link table from Session's universal drill-down).
- **UI:** New "Refund" row-action (rose return-arrow icon, between Link and Edit) → `txOpenRefundModal(id)`. Dedicated `#txRefundModal`: original summary + "Refunded so far / Remaining", return date (default today), amount (default = remaining), description (default "Refund: <orig>"), reversed DR/CR pickers, notes. Save = `rfSaveRefund()`.
- **User decisions (MCQ this session):**
  - **Over-refund → HARD BLOCK.** Cumulative refunds cannot exceed original amount. Enforced in both open (skip if remaining≤0) and save (`amt - remaining > 0.005`). Re-checked server-side at save, not just on open.
  - **Distinct 'Refund' source badge + filter.** Added `'Refund':'bg-rose-50 text-rose-600'` to `_txSourceBadge` and a `<option value="Refund">` to the Source filter (flows through `buildTxWhere` unchanged since it maps `importSource = f.source`).
  - **Accounts editable, pre-filled reversed.** Pickers default to the reversed accounts but the user can change them.
- **Deliberate limitation:** Return date in the future is **blocked** (refunds always post to `"Transaction"`, never routed to `FutureTransaction`) — keeps `linkedTxId` semantics single-table and matches the "recording something that happened" flow.
- **Rejected:** `note='Refund'` on TransactionLink as the *only* link (free-text, fragile for summing). Parent pointer on `linkedTxId` is authoritative; TransactionLink is just for display.
- **NOT done / follow-up:** Deleting an original that has refunds doesn't warn or cascade — refund rows keep a dangling `linkedTxId` and the TransactionLink row points at a missing tx (drill-down already tolerates missing target by rendering ''). Refunding a refund row is technically allowed (odd but harmless). Not verified end-to-end (sandbox has no Drive-backed DB; verified parse + wiring only).

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

---

## 2026-05-28 — Session 3

~25 commits shipped. Session arc: small UX wins → ambitious LLM reporting → abandoned LLM, pivoted to deterministic pivot builder → paused the pivot builder pending hardening pass.

### Decided: Browser back gesture restores previous in-app tab/sub-tab via synthetic history.
- **Why:** Back was logging the user out of the PWA because nothing in the app touched the history API — a back gesture popped past the only entry and exited the SPA.
- **Implementation:** Every `navigate(page)` and every composite `XSetTab(sub)` calls `_pushNavState(page, sub)` which `history.pushState`-es a `{__finapp, page, sub}` entry. A `popstate` listener routes back to the prior state and re-applies it without re-pushing (guarded by `_navFromPop`). URL is never changed (no GitHub Pages 404 risk).
- **Gating:** `_historyReady` flag stays false until just before the post-login `navigate('dashboard')`, so the orphan `navigate('transactions')` in the `repPlaySave` dead-tail (still at line ~11099) does NOT pollute the stack at script-load.
- **Rejected:** Hash-based deep-link URLs (`#transactions/posted`). Bookmarkable but more invasive — URL-parsing on load, hashchange listener, conflicts with existing localStorage sub-tab restore.

### Decided: PWA long-press shortcuts + sized icons + maskable variant.
- **Why:** Long-press on the FinApp home-screen icon should expose Dictate / Transactions / Future / Dashboard. Default Chrome behavior was a useless context menu.
- **Implementation:** Added `shortcuts` array to `manifest.webmanifest` with 4 entries pointing to `./?startPage=…&sub=…`. `startApp()` reads those params and deep-links via `navigate(startPage)` + `_switchSub(startPage, startSub)`, then strips the query string from the URL so reloads don't keep re-firing. Added a separate `icon-maskable.svg` (font-size 260 instead of 320, so any Pixel/Samsung circular mask can't clip the glyph). Bumped SW cache `v1 → v2` so existing PWAs install the new manifest on next launch.
- **Rejected:** iOS-specific shortcut support. iOS Safari only renders shortcuts for select apps; not worth special handling.

### Decided: Day-of-month allows 1–31 plus explicit "Last day of month" sentinel.
- **Why:** User pays bills / receives dividends on days 29, 30, 31, and some on "last day of month" specifically. Old inputs capped at 28 to avoid Feb overflow.
- **Storage:** `dayOfMonth` (Repeatable) and `paymentDueDay` (CreditCard) stay `INTEGER`. NULL = unset, 1–31 = that day clamped to month-end on short months, 32 = explicit "Last day". No schema migration.
- **Implementation:** New helpers `DOM_LAST = 32`, `_daysInMonth`, `_resolveDom`, `_domDisplay`, `_domOptions`. Three form inputs (Settings → Repeatable, Settings → Credit Cards, Transactions composite Repeatable) switched from `<input type="number" max="28">` to `<select>` populated by `_domOptions(stored)`. All consumption sites use `_resolveDom(stored, year, monthIdx)`: `migrateFutureTransactions` auto-gen, CC tile due-date math (current and next month resolved separately), `repPlay`. Display sites use `_domDisplay`.
- **External:** `FinanceNotifications.gs` rewritten from scratch (the file wasn't in the repo). User pastes into their Apps Script project. Same `resolveDom_` logic mirrors the in-app helper so 32 = month-end.
- **Rejected:** Pragmatic clamp only (just allow 1–31, no explicit "Last day"). User wanted the *semantic* preserved in data, not just the resolved day.

### Decided: Floating Dictate + Ask pill, globally mounted.
- **Why:** Original Dictate mic was inline-rendered by three page templates (Transactions, Future Transactions, Account Tracker), so the new Ask half inherited that limitation — invisible on Dashboard, Settings, Equity, Budget.
- **Implementation:** New `_floatingPillHtml()` returns the two-half pill (red Dictate mic + slate Ask button with a thin separator). Mounted ONCE in `startApp()` (right after login), appended to `document.body`. `position:fixed` so DOM placement is irrelevant. Removed the 3 inline mounts. `_dtCtxFromPage()` derives the Dictate target table at click time from `currentPage` + `_txComboTab`.
- **Rejected:** Per-page mounts with click-time context-detection. The inline pattern was the bug we were fixing.

### Decided: LLM-driven Ask FinApp — built, iterated, abandoned. Pivoted to Reports.
- **What we built:** Ask FinApp went through two architectures:
  - **Phase 1+2 (single-shot):** NL → LLM SQL → execute → optional Chat narrative. Table/Chat toggle. Schema runtime-pulled from `sqlite_master`. SQL scrub (SELECT-only, blocklist). Multi-turn chat history. SavedQuery table. CSV export. ~470 lines in one commit.
  - **Phase 2 rebuild (KB + agent):** Dropped the Table/Chat toggle. Single Chat mode + "Show SQL" preference. New `QueryPattern` KB table. KB lookup matches user question via LLM. HIGH → single-shot cached SQL; MEDIUM → cached SQL with assumptions visible; LOW → tool-using agent (`describe_table`, `distinct_values`, `sample_rows`, `run_query`). Agent answer generalizes into a KB pattern on success. Confidence chip + 👍/👎 feedback. Honest empty-result handling (`_askIsLogicallyEmpty`). Roadmap card in Settings → About.
- **What kept breaking:** Each fix surfaced a new failure mode of the same shape — LLM-emitted SQL was unreliable against the user's real data quirks. The user diagnosed: "every fix opens a new failure mode of the same approach." See ERRORS.md "LLM-SQL whack-a-mole."
- **Concrete fixes applied in the iteration spiral** (each its own commit):
  - Date awareness: `_askDateContext()` injected into agent / matcher / KB-store / narrative prompts. LLM falls back to its training cutoff and bakes the wrong year otherwise.
  - Aggregate-empty detection: `_askIsLogicallyEmpty(rows, columns)` catches the single-row-all-zero case that `rows.length===0` misses.
  - Matcher confidence: HIGH only when all params explicit; MEDIUM when any param inferred. Chip relabeled "Strong pattern match" / "Pattern · inferred params" / "Weak match" / "Agent · N steps".
  - Unicode-dash normalization in `_askSqlScrub`: en-dash and em-dash become hyphen-minus before exec. LLMs Unicode-ify separators.
  - Broad-LIKE enforcement: AND-of-substrings (`description LIKE '%X%' AND description LIKE '%Y%'`) — never exact, never prefix-only, never OR with narrow conditions.
  - `distinct_values` made mandatory before any description-based LIKE.
  - Aggregate count sanity-check in the prompt: 3 dividends in a year for a monthly ETF should look wrong.
  - "Clear KB cache" button in the modal sidebar.
  - Prompt caching (`cache_control: ephemeral`) on the agent system prompt — ~90% input-token discount on iterations 2–N within 5-min TTL.
  - 429 rate-limit error parsed and rewritten as a user-actionable message instead of raw JSON.
  - Tool-result row cap reduced 25 → 15.
- **Why we stopped:** All Ask code is still in the file (`renderReports` replaced the pill's right-half navigation), but the surface is gone. The pivot decision was driven by repeated failures despite many targeted fixes.
- **Rejected for the LLM path:** Hybrid LLM-routes-to-deterministic-reports (function-calling). User explicitly chose the deterministic-only route (Reports) instead.

### Decided: Reports — self-service drag-and-drop pivot builder. Phase A+B shipped, then paused.
- **Why:** User's itch was "flexibly gain insight from the data we have." LLM-driven didn't deliver. Fallback: Excel-pivot-style but more accessible.
- **Architecture:**
  - **Semantic model** (hand-curated JS arrays): 15 dimensions in 3 categories (When: Date, Year, Quarter, Period, Month name, Day of week — Where: Debit/Credit account name, type, grouping — What: Description, Source, Reconciled). 5 measures (Sum / Avg / Max / Min of Amount, Transaction count). 4 filter ops (eq / ne / contains / between). Each dimension/measure carries a SQL expression that drops into SELECT and GROUP BY.
  - **Query compiler** (`_rptBuildQuery`): composes `SELECT … FROM "Transaction" tx LEFT JOIN Account dra LEFT JOIN Account cra WHERE … GROUP BY … ORDER BY … LIMIT 5000`. Deterministic, tested.
  - **Pivot transformer** (`_rptPivot`): flat group-by output → rows × cols matrix with row/col/grand totals. Totals only computed for additive measures (SUM, COUNT) — AVG/MIN/MAX get blank totals.
  - **UI:** Top bar (Save / Save as / Delete / Reset + saved dropdown). Left field library (When / Where / What / How much). Drop zones: Filters (full width), Rows / Cols / Values (3-col grid). Live result table with totals + Export CSV + Show SQL. Click any cell → drill-down modal with the underlying transactions.
  - **Persistence:** New `SavedReport` table (id, name, config JSON, createdAt, updatedAt). Synced to Drive via `syncAfterWrite()`.
- **Filter editor:** `prompt()`-based for MVP. Inline editor deferred to Phase E.
- **Floating pill:** Right half rewired from `askOpen()` → `navigate('reports')`. Icon swapped from speech bubble to 2×2 grid.
- **Pause:** Sidebar entry removed; pill's right half greyed to slate-400 + opacity 0.7. Tooltip reads "Reports (work in progress — design not yet hardened)". Still clickable; navigate('reports') still works. All Reports code intact for the hardening pass.
- **Rejected:** Direction A — function-calling router only (no Reports page). Rejected because user wanted a browse-able catalog as well as a chat door — but neither shipped; the chat door is paused too.
- **Rejected:** Direction B — kill the Ask modal entirely. User chose to leave Ask code in the file in case it's revived.
- **Rejected for MVP:** Inline filter editor, charts, date presets, % of total, side-by-side period comparison. All listed as Phase C–E "Later" in the Roadmap card.

### Known issues NOT fixed (carried into next session)
- **Reports hardening pass.** The pivot builder works but needs polish: inline filter editor (replacing `prompt()` calls), date presets (YTD / MTD / This quarter), responsive/touch layout for mobile drop zones, "sub-account" dimension for both sides, calculated "Net cash flow" measure, charts. See the Roadmap card in Settings → About.
- **Ask code dead in UI.** ~1000 lines of Ask code (state, modal, agent, KB, matcher, narrative, render, save, feedback) remain in the script. Pill no longer opens it. If we don't revive it, delete in a cleanup pass. If we do revive it, see ERRORS.md for the failure modes to design around.
- **`repPlaySave` dead-tail at ~11099** — still there, still a TDZ trap for any new `let` referenced by `_visibleTxComboTabs`. Carried from Session 2.
- **`Settings → Backup` XLSX importer** still doesn't set `importSource`. Carried from Session 2.
- **Filter SQL string interpolation** in `buildTxWhere` / FT `buildWhere` / `dupRunScan`. Carried from Session 2.
