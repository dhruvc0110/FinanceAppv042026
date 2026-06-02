# FinApp — Validation Script (Must + Should features)

Step-by-step manual tests for everything shipped in the Must-have and Should-have
waves. Run in the **live app**. Mark each ✅ / ❌ and note anything odd.

## How to use
- **Hard-reload first** (Cmd/Ctrl-Shift-R) so the service worker doesn't serve a stale build, then confirm the top bar shows **"Synced to Drive"**.
- Tests are grouped by feature. Each has **Where**, **Steps**, **Expect**.
- Tests that create data tell you how to **clean up** at the end.
- A short **Known limitations** list is at the bottom — don't flag those as bugs.
- Tip: do **§A first** (it seeds a couple of safe sample items the later tests reuse), and **§Z last** (cleanup).

---

## §0 — Pre-flight
**Where:** anywhere
1. Hard-reload. Wait for "Synced to Drive".
2. Open the **Roadmap** page (sidebar).
3. Click the **Must** filter, then **Should**.
- **Expect:** all 5 Must (F2, F3, F5, F7, F26) and all 10 Should (F1, F6, F8, F9, F12, F14, F18, F20, F24, F29) show status **Done**. New sidebar items present: **Assets**, **Documents**. Financial Statements has a **Cash Flow** tab. ✅/❌

---

## §A — F2 Manual / alternative assets  (Assets → Holdings)
**Where:** sidebar **Assets** → **Holdings** tab

### A1 — Add an asset
1. Click **+ Add asset**.
2. Name `TEST House`, Class `Real estate`, Current value `500000`, As-of date = today.
3. **Add asset**.
- **Expect:** row appears: "TEST House" + "Real estate" badge, value **$500,000**, "as of <today>". Total manual asset value includes it. ✅/❌

### A2 — Validation guards
1. **+ Add asset**, leave Name blank → **Add asset** → error "Name is required."
2. Set value `0` → error "Enter a value greater than 0."
3. Set As-of date to a **future** date → error "As-of date cannot be in the future."
4. Cancel.
- **Expect:** each guard blocks the save with the message; nothing is created. ✅/❌

### A3 — Update value (posts the delta)
1. On TEST House, click **Update value**. New total value `520000`, date = today. **Save new value**.
2. Click **History** on TEST House.
- **Expect:** value now **$520,000**; History shows an opening **+$500,000** and a revaluation **+$20,000**. ✅/❌
3. Update value again to `505000`.
- **Expect:** value **$505,000**; History adds a **−$15,000** revaluation. ✅/❌

### A4 — Add a second asset (for later tests)
1. Add `TEST Car`, Class `Vehicle`, value `30000`, today.
- **Expect:** two TEST assets listed. ✅/❌

---

## §B — Manual-asset delete + Balance Sheet treatment  (Assets → Holdings)
### B1 — Balance Sheet treatment
1. On TEST House, change the dropdown to **Below the line**.
- **Expect:** an amber "below the line" pill appears on the row.
2. Open **Financial Statements → Balance Sheet**.
- **Expect:** TEST House appears in the **below-the-line** section, *not* in the main Assets total.
3. Back on Assets, set TEST House to **Excluded**.
- **Expect:** grey "excluded" pill; the value dims. On the Balance Sheet it no longer appears at all.
4. Set it back to **On balance sheet**.
- **Expect:** appears in the main Assets section again. ✅/❌

### B2 — Delete
1. On TEST Car, click **Delete** → confirm.
- **Expect:** TEST Car disappears; total drops by $30,000; other accounts unaffected. (Keep TEST House for later.) ✅/❌

---

## §C — F3 Asset allocation  (Assets → Allocation)
**Where:** Assets → **Allocation** tab
1. View the donut + **Breakdown** list.
- **Expect:** current asset balances grouped by class with %; total matches. TEST House (Real estate) shows up if it's "On balance sheet".
2. In **Classify accounts**, find any account showing **Unclassified** and pick a class.
- **Expect:** the donut/breakdown update immediately; that amount moves out of "Unclassified" into the chosen class. ✅/❌
3. Set TEST House to **Excluded** (Holdings tab) then return to Allocation.
- **Expect:** TEST House is no longer in the allocation. Set it back to On balance sheet after. ✅/❌

---

## §D — F1 Net worth over time  (Assets → Net worth)
**Where:** Assets → **Net worth** tab
1. Note the **Net worth now / Assets / Liabilities** stat cards and the line chart.
2. Toggle **12m / 24m / 36m / All**.
- **Expect:** chart window changes; three lines (Net worth, Assets, Liabilities); "Net worth now" = current Assets − Liabilities; "Change over window" = last minus first point. ✅/❌
3. Cross-check: the "Net worth now" here should match the **Balance Sheet** net figure for the latest period. ✅/❌

---

## §E — F5 Net-worth projection + F18 Retirement readiness  (Assets → Projection)
**Where:** Assets → **Projection** tab

### E1 — Projection (F5)
1. Note **Net worth today**. Set Horizon `10`, Expected annual return `6`, Monthly net contribution (pre-filled — adjust if you like).
2. Change the return to `8` and tab out.
- **Expect:** the line and the **Projected in N yr / Total contributions / Growth** stats recompute. Projected > today when return/contribution are positive. ✅/❌

### E2 — Retirement readiness (F18)
1. In the **Retirement readiness (4% rule)** card: Current age `40`, Retirement age `65`, Spending in retirement (pre-filled, adjust).
- **Expect:** **Needed (25× spend)** = spending ÷ 0.04; **Nest egg at 65** = today's net worth projected to age 65; **Surplus/Shortfall** and **Sustainable spend/yr** (= 4% of nest egg) shown; **On track?** green when nest egg ≥ needed.
2. Set Spending very high (e.g. 10× current) → tab out.
- **Expect:** flips to a red **Shortfall** with "N% of goal". ✅/❌

---

## §F — F7 Cash-flow Sankey + F6 trend + F8 category trends  (Financial Statements → Cash Flow)
**Where:** **Financial Statements → Cash Flow** tab

### F1 — Sankey (F7)
1. Set the **From/To** period range to a few recent months with activity.
- **Expect:** income sources flow (left) → central total → expense categories (right); if income > expense a blue **Net savings** node, if expense > income a red **Drawdown** node. Income/Expenses/Net totals above match. ✅/❌
2. Set From/To to a period with no data.
- **Expect:** "No income or expense recorded in …" message (no broken chart). ✅/❌

### F2 — Income vs expense by month (F6)
1. Scroll to **Income vs expense by month**.
- **Expect:** green Income bars, red Expense bars, blue Net line, one group per month in the range. ✅/❌

### F3 — Top spending categories over time (F8)
1. Scroll to **Top spending categories over time**.
- **Expect:** stacked bars per month; up to 6 named expense categories + an "Other (n)" segment; taller bars in higher-spend months. ✅/❌

---

## §G — F9 Custom date-range reports  (Reports)
**Where:** **Reports** (sidebar)
1. Drag a **Measure** (e.g. *Sum of amount*) into **Values** and a dimension (e.g. *Month*) into **Rows**.
2. In the **Date range** bar, set **From** and **To** to a narrow window (e.g. one or two months).
- **Expect:** a purple **"Date between …"** chip appears in Filters; the table limits to that window; totals shrink accordingly. ✅/❌
3. Click **Clear** on the date range.
- **Expect:** the chip disappears and the full result returns. ✅/❌
4. Set a range, click **Save as…**, name it, reload the page, **load** the saved report.
- **Expect:** the date range comes back with the saved report. ✅/❌

---

## §H — F24 Bulk edit transactions  (Transactions)
**Where:** **Transactions** list
> ⚠️ This edits/deletes real transactions. Use a couple you can re-create, or just test re-categorize and **undo it** by re-categorizing back.
1. Tick the checkboxes on 2–3 rows (or the header checkbox to select the page).
- **Expect:** a dark **bulk bar** appears: "N selected · Set [Debit/Credit account] [account] Apply | Delete Clear".
2. Choose **Debit account** + a target account → **Apply** → confirm.
- **Expect:** those rows' DR account changes to the chosen one; selection clears. (Re-select and set it back to undo.) ✅/❌
3. (Optional, destructive) Select a disposable row → **Delete** → confirm.
- **Expect:** the row(s) vanish. ✅/❌
4. **Clear** with rows selected.
- **Expect:** selection clears, bulk bar disappears. ✅/❌

---

## §I — F20 Performance vs benchmark  (Equity)
**Where:** sidebar **Equity** (US Equity summary)
> Requires at least one open equity lot with a current price. If you have none, this shows zeros — that's expected.
1. Find the **Performance vs benchmark** card.
2. Enter a benchmark **name** (e.g. `S&P 500`) and a **return %** (e.g. `12`).
- **Expect:** your portfolio's simple return (= unrealised gain ÷ cost basis) shows next to the benchmark %, with **over/under-performance in percentage points** (e.g. portfolio +20% vs 12% → **+8.0 pp ahead**). ✅/❌
3. Reload the page, return to Equity.
- **Expect:** the benchmark name + % you entered persist (saved in the browser). ✅/❌

---

## §J — F29 Customizable dashboard  (Settings + Dashboard)
**Where:** **Settings → Dashboard Tiles**, then **Dashboard**
1. In Settings → Dashboard Tiles, use the **▲ / ▼** buttons to move a tile (e.g. move *Total Assets* above *Net Worth*).
2. Toggle one tile **off**.
3. Open the **Dashboard**.
- **Expect:** tiles appear in the new order; the toggled-off tile is hidden. ✅/❌
4. Reload; revisit Dashboard.
- **Expect:** order + visibility persist (saved to your synced preferences). ✅/❌
5. Re-enable the tile and restore order if you want.

---

## §K — F12 Category rollover + F14 Overspend coverage  (Budget)
**Where:** **Budget** page → **Actual vs Budget** view
1. Switch the Budget view toggle to **Actual vs Budget**. Pick a recent **month**.
- **Expect:** per expense category: **Budget**, **Actual**, **Remaining** (= Budget − Actual), **Rollover-in** (cumulative prior Budget − Actual), **Available** (= cumulative Budget − cumulative Actual). ✅/❌

### K1 — Rollover (F12)
1. Find a category that was **under-spent** in a prior month and has activity this month.
- **Expect:** its **Rollover-in** is positive and its **Available** > this month's Remaining (the prior surplus carried in). A category that overspent earlier carries a negative rollover. ✅/❌

### K2 — Move budget (F14)
1. Use **Move budget** to shift an amount (e.g. `200`) from a category with spare budget to one that's over.
- **Expect:** source category's Budget drops by 200, destination's rises by 200, Remaining/Available recompute; an overspent destination can become covered. ✅/❌

---

## §L — Floating pill is draggable  (any page)
**Where:** the floating **mic / file / grid** pill
1. Grab the **dotted grip** on the left of the pill and drag it somewhere else.
- **Expect:** the whole pill moves; it can't be dragged off-screen (stays within the window). ✅/❌
2. Tap the **mic / file / grid** buttons.
- **Expect:** they still trigger Dictate / New transaction / Reports (the grip is the only drag area). ✅/❌
3. Reload.
- **Expect:** the pill is where you left it. (Position is per-device, by design.) ✅/❌

---

## §M — Cross-feature integrity (the important one)
**Where:** multiple pages — proves manual assets flow everywhere consistently
1. With **TEST House** set to **On balance sheet**, note its value.
2. Check it appears/contributes in **all** of: Balance Sheet (Assets) · Assets → Net worth (raises net worth) · Assets → Allocation (Real estate) · Assets → Projection (raises "Net worth today") · Dashboard net-worth tile.
- **Expect:** the same asset is reflected consistently across every surface — no screen ignores it. ✅/❌

---

## §Z — Cleanup
1. Assets → Holdings → **Delete** "TEST House" (confirm).
2. Documents → delete any "TEST …" entries you added.
3. Reports → **Reset** if you left a test report open (don't save test reports unless you want them).
4. If you re-categorized real transactions in §H, set them back.
- **Expect:** no TEST data remains; balances return to normal. ✅/❌

---

## Known limitations (NOT bugs)
- **Past-dated asset revaluations** only correct the *current* total, not historical period-by-period running balances.
- **F5/F18 pre-filled contribution/spending** count setup-only months in the trailing average, so the suggested figure can read low — it's an editable starting point.
- **F20** has no historical market data, so it's a *since-inception* return vs a benchmark % you enter — not a time-series chart. Benchmark assumption is per-device (localStorage).
- **F24 bulk re-categorize** doesn't stop you setting the same account on both sides (dr == cr) — power-user action.
- **F12 rollover** is *computed* (cumulative budget − actual), not a stored envelope balance — it's a YNAB-style overlay on the existing flat budget grid.
- **Pill position** and **F20 benchmark** are saved per-device (localStorage), so they don't sync across devices.
- The **'Pending'** dashboard tile isn't in the Settings reorder list (pre-existing), so it sorts to the end.
