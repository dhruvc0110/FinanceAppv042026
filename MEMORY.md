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
