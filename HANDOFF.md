# Finance App — Claude Code Hand-Off Document

> **Last updated:** 2026-05-27 — end of session 2
> **State:** Production, deployed, working. ~13,500 lines in `index.html`.

## Project Overview

A single-file personal household finance tracker (`index.html`) deployed as a static GitHub Pages site. All data lives in a SQLite database file stored in the user's own Google Drive. There is no backend server, no database server, and no Anthropic-controlled persistence. The app is 100% client-side.

**Live URL:** `https://dhruvc0110.github.io/FinanceAppv042026/`
**Repo:** GitHub `main` branch (sole developer, single branch)
**Deployment:** Push to `main` → GitHub Pages auto-deploys within ~60 seconds

---

## How to Resume Work in a New Claude Code Session

1. Open this folder in Claude Code: `/Users/dhruv/Desktop/FinApp/`
2. The system loads `MEMORY.md` automatically on session start — read it for decisions and rationale.
3. Read `HANDOFF.md` (this file) for the architecture and current-state snapshot.
4. Skim `ERRORS.md` before suggesting any non-trivial approach — it documents known pitfalls in this codebase.
5. Latest deployed commit on `main` matches what's on disk in `index.html`.

---

## Architecture

```
Browser (index.html)
  ├── sql.js (SQLite compiled to WASM)        — in-memory DB
  ├── Google OAuth 2.0                        — auth + Drive access
  ├── Google Drive API                        — reads/writes finance.sqlite
  ├── Firebase Realtime Database              — session lock (multi-tab safety)
  ├── Anthropic API
  │     ├─ Sonnet 4 (claude-sonnet-4-20250514)            — Dictate, screenshot import
  │     └─ Haiku 4.5 (claude-haiku-4-5-20251001)          — ticker lookup, small classification
  ├── Google Apps Script (external)           — scheduled email notifications
  ├── Service worker (sw.js)                  — PWA shell cache
  └── Manifest (manifest.webmanifest)         — installable PWA
```

### Data Flow
1. User signs in via Google OAuth.
2. App downloads `finance.sqlite` from Google Drive into memory.
3. sql.js loads the binary as an in-memory SQLite DB.
4. All reads/writes go to the in-memory DB.
5. Every write calls `syncAfterWrite()` which debounces a Drive upload (~500ms).
6. Auto-save runs every 30 seconds as a fallback.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Pure browser — no build step, no bundler |
| Database | sql.js (SQLite → WebAssembly) |
| Persistence | Google Drive REST API v3 |
| Auth | Google Identity Services (OAuth 2.0, `drive.file` scope) |
| Styling | Tailwind CSS via CDN (JIT, all utilities available) |
| Session lock | Firebase Realtime Database |
| AI — Dictate & screenshot import | Anthropic Messages API — `claude-sonnet-4-20250514` |
| AI — ticker lookup / lightweight classification | Anthropic Messages API — `claude-haiku-4-5-20251001` |
| Email notifications | Google Apps Script (external, user-managed) |
| Hosting | GitHub Pages |
| Installable app | Web manifest + service worker (PWA) |

---

## Files in Repo

| File | Purpose |
|------|---------|
| `index.html` | The entire application (~13,500 lines) |
| `manifest.webmanifest` | PWA manifest — name=FinApp, display=standalone, theme=#0f172a |
| `sw.js` | Service worker — network-first HTML, cache-first same-origin assets |
| `icon.svg` | App icon — slate-900 background with white `$` glyph |
| `FinanceNotifications.gs` | Google Apps Script for email notifications |
| `notifications-setup.md` | One-time setup instructions for the Apps Script |
| `firebase-security-rules.md` | Firebase rules tightening guide (not yet applied) |
| `HANDOFF.md` | This document |
| `MEMORY.md` | Cross-session decision log (loaded automatically) |
| `ERRORS.md` | Known failure modes with fixes |
| `.gitignore` | Excludes `.DS_Store`, `.claude/` |
| `.claude/settings.local.json` | Local permission rules for git push to main |
| `.claude/launch.json` | Local `npx http-server` preview config |

---

## Single-File Structure (`index.html`)

Approximate line ranges. The file grows — these are guides, not contracts.

| Lines (approx) | Contents |
|---------------|----------|
| 1–310 | HTML head, CSS, Google/Firebase SDK scripts, mobile-card + view-mode CSS |
| 310–395 | Constants: `DRIVE_FOLDER_NAME`, `DRIVE_FILE_NAME`, `NOTIF_FILE_NAME`, OAuth client ID, Firebase config |
| 395–700 | Google OAuth sign-in flow, token management |
| 700–900 | Drive helpers: `driveGet`, `driveUploadFile`, `driveDownloadFile` |
| 900–1100 | DB init: load from Drive via IndexedDB cache, `loadFromDrive()` |
| 1100–1250 | Firebase lock system: `checkAndClaimLock`, `releaseLock` |
| 1250–1640 | Sidebar HTML, navigation (`navigate()`), `_pageTabBar()` helper |
| 1640–1910 | `startApp()` — all table creation/migrations |
| 1910–2000 | SQL helpers: `query(sql, params)`, `queryVal(sql, params)` |
| 2000–2115 | Format helpers: `fmtCurrency`, `fmtDate`, `escHtml`, `genId` |
| 2115–2250 | Account Tracker page |
| 2250–2430 | Equity Tracker — Dividends tab |
| 2430–2560 | `_TX_COMBO_TABS`, sub-tab state, **early `let` declarations including `_showDictateTab`** |
| 2560–7720 | Remaining page renderers (P&L, Balance Sheet, Budget, Transactions, etc.) |
| 7720–8260 | Future Transactions page |
| 8260–9120 | Import Transactions (screenshot AI import) |
| 9120–9600 | Dictate Transaction feature |
| 9600–10460 | Repeatable Transaction tab |
| 10460–11000 | Duplicate Review, Equity Tracker (lots/sales) |
| 11000–11500 | Credit Card page, Notes, Notification CRUD + `writeNotificationsJson()` |
| 11500–12000 | Settings page tabs |
| 12000–13145 | View-mode logic (`_applyViewMode` etc.), responsive helpers, global handlers |
| 13145–13500 | Build History panel, late-mounted feature glue |

> ⚠️ **Dead-tail hazard:** Lines ~11099-11140 contain leftover code from `repPlaySave()` that calls `navigate('transactions')` **at top-level on script load**. Any `let`/`const` whose value is read by `_TX_COMBO_TABS`-related code must be declared **before** this point. See ERRORS.md ("TDZ trap") for the full story. Eventually remove the dead-tail in a dedicated cleanup pass.

---

## Database Schema

All tables are created with `CREATE TABLE IF NOT EXISTS` in `startApp()` (and `_initCoreSchema()`). Migrations use `ALTER TABLE ... ADD COLUMN` wrapped in try/catch.

### Core Accounting Tables

```sql
Account (
  id TEXT PRIMARY KEY,
  code TEXT, name TEXT NOT NULL, type TEXT NOT NULL,  -- ASSET|LIABILITY|EQUITY|INCOME|EXPENSE
  role TEXT,          -- BELOW_THE_LINE | EXCLUDED | FLUX_PL | NULL
  grouping TEXT,
  hasSubAccounts INTEGER NOT NULL DEFAULT 0,
  showOnInquiry INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

SubAccount (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL,
  code TEXT, name TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1
)

"Transaction" (
  id TEXT PRIMARY KEY,
  trxDate TEXT NOT NULL,    -- ISO timestamp
  period TEXT NOT NULL,     -- YYYYMM
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  drAccountId TEXT NOT NULL, crAccountId TEXT NOT NULL,
  drSubId TEXT, crSubId TEXT,
  notes TEXT,
  isReconciled INTEGER NOT NULL DEFAULT 0,
  importSource TEXT,        -- Manual | Scheduled | Recurring | Imported | Equity | Dictate | excel
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

FutureTransaction (
  id TEXT PRIMARY KEY,
  trxDate TEXT NOT NULL, period TEXT NOT NULL,
  description TEXT NOT NULL, amount REAL NOT NULL,
  drAccountId TEXT NOT NULL, crAccountId TEXT NOT NULL,
  drSubId TEXT, crSubId TEXT, notes TEXT,
  recurrence TEXT DEFAULT 'Once',
  endDate TEXT, isActive INTEGER NOT NULL DEFAULT 1,
  importSource TEXT,        -- NEW in session 2 — propagates to Transaction on migrate
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

Period (
  period TEXT PRIMARY KEY,  -- YYYYMM
  isLocked INTEGER NOT NULL DEFAULT 0
)
```

> **`FutureTransaction.importSource` (added in session 2):** When a FutureTransaction is auto-migrated to `Transaction` by `migrateFutureTransactions()` (i.e., its due date has arrived), the `importSource` value carries through. If `FutureTransaction.importSource` is null/empty, the migrated row uses `'Scheduled'`. This is critical because the Recent Dividends tab queries `Transaction WHERE importSource='Equity'` — if origin is lost during migration, posted dividends silently disappear from the list.

### Budget Tables

```sql
BudgetPlan (id PK, accountId, period, amount, projectedClose)
BudgetNote (id PK, accountId, period, note, createdAt, updatedAt)
SectionLayout (section PK, items JSON, updatedAt)
```

### Equity Tables

```sql
EquityLot (id PK, ticker, stockName, trxDate, period, qty, price, amount,
           drAccountId, crAccountId, notes, linkedTxId, createdAt)
EquityLotSale (id PK, lotId, trxDate, period, qty, price,
               proceeds, costBasis, gainLoss,
               drAccountId, crAccountId, notes, linkedTxId, createdAt)
MarketPrice (ticker PK, price, isManual, updatedAt)
```

### Configuration Tables

```sql
CreditCard (id PK, name, liabilityAccountId, paymentAccountId, creditLimit,
            paymentDueDay, status='ACTIVE', createdAt, updatedAt)
BankAccount (id PK, name, type, assetAccountId, status='Active', createdAt, updatedAt)
RepeatableTransaction (id PK, name, description, amount, dayOfMonth,
                       drAccountId, crAccountId, notes,
                       isAutoGenerate, status='ACTIVE',
                       templateType='Undefined', createdAt, updatedAt)
RepeatableGenLog (id PK, repeatableId, period, createdAt)
NotificationConfig (id PK, creditCardId, daysInAdvance JSON, recipientEmail,
                    isActive, createdAt, updatedAt)
```

### Import / Drafts Tables

```sql
ScreenshotTemplate (id PK, creditCardId, cardNickname, dateFormat,
                    amountConvention='negative-charges', excludePending,
                    paymentKeywords, refundKeywords, customNotes,
                    extractionPrompt, fingerprintData, sampleImageDataUrl,
                    createdAt, updatedAt)
DraftBatch (id PK, templateId, detectedCardName, status='pending',
            rowCount, approvedCount, rejectedCount,
            source='Import',  -- 'Import' | 'Dictate'
            createdAt, updatedAt)
DraftTransaction (id PK, batchId, date, description, amount,
                  txnType='charge',
                  suggestedDrAccountId, suggestedCrAccountId,
                  drAccountId, crAccountId,
                  status='pending', rawExtracted, createdAt)
ImportLog (id PK, batchId, cardName, templateId,
           rowCount, approvedCount, rejectedCount, importedAt)
```

### Utility Tables

```sql
TransactionLink (id PK, txAId, txBId, note, createdAt)
DuplicateReview (id PK, txARef, txBRef, status='FLAGGED',
                 deleteRef, createdAt, updatedAt)
ScratchPad (id PK, title, data JSON, createdAt, updatedAt)
AppSettings (key PK, value, updatedAt)
  -- known keys: anthropicApiKey, dashTiles
Note (id PK, title, body, createdAt, updatedAt)
User (id PK, email, name, preferences JSON, createdAt)
```

---

## Key Patterns

### SQL — always use parameterized queries

```javascript
// ✓ Correct
db.run('INSERT INTO "Transaction" (id, description) VALUES (?, ?)', [genId(), desc]);

// ✗ Wrong
db.run(`INSERT INTO "Transaction" (id, description) VALUES ('${id}', '${desc}')`);
```

`query(sql, params)` returns `[]` of row objects. `queryVal(sql, params)` returns the first cell.

**Pre-existing exception:** `buildTxWhere()` and FT `buildWhere()` use string interpolation for filter conditions. Low risk (inputs are typed date inputs + escaped search strings) but should be parameterized eventually.

### Page rendering — two patterns

**Pattern A — `innerHTML` template** (most pages, including all composite tabs):
```javascript
function _renderTxPage(container) {
  if (!container) container = _getActiveContent();  // see helper below
  container.innerHTML = `…template…`;
}
```

**Pattern B — `createElement`** (Account Tracker, some composite pages):
```javascript
function _renderATPage(container) {
  const wrap = document.createElement('div');
  // build DOM
  container.innerHTML = '';
  container.appendChild(wrap);
}
```

### Composite-page container resolution: `_getActiveContent()`

Composite pages have an inner content `<div>` that owns the rendered body, while a sibling tab-bar persists. Code that re-renders the page after a sort/filter/click change should write into the **inner** content div, **not** the outer page container — writing to the outer div wipes the tab bar.

```javascript
function _getActiveContent() {
  return document.getElementById('atContent')
      || document.getElementById('fsContent')
      || document.getElementById('txComboContent')
      || document.getElementById('teContent')
      || document.getElementById('pageContent');
}
```

Use this helper whenever a click handler needs to re-render "the current page" without resetting tab state. Pattern recurs in Transactions, Future Transactions, Account Tracker, Financial Statements, and Equity Tracker.

### Sub-tab state preservation

Each composite page tracks its own active sub-tab in a module-level `let`:
- `_txComboTab` — Transactions composite
- `_atTab` — Account Tracker
- `_teTab` — Equity Tracker
- `_fsTab` — Financial Statements
- `settingsTab` — Settings
- `dupTab` — Duplicate Review

`navigate(page)` reads/writes these to restore the user's prior sub-tab when they return to a composite page. **Caveat:** `renderSettings()` re-assigns `settingsTab = 'scratchpad'` at the top — deep-link into a settings sub-tab via `navigate('settings'); settingsGoTab('display');` (in that order). See ERRORS.md.

### Visible-tabs filtering: `_visibleTxComboTabs()`

```javascript
function _visibleTxComboTabs() {
  return _TX_COMBO_TABS.filter(t => !(t.id === 'dictate-transaction' && !_showDictateTab));
}
```

User-controlled Display setting `_showDictateTab` (persisted in `AppSettings`) hides/shows the Dictate sub-tab. **`_showDictateTab` must be declared early in the file** — see the dead-tail warning in the file structure section.

### Sortable headers on tile-expansion panels

Each panel keeps its own sort state in module-level `let`s:
- `_aiTxSortCol` / `_aiTxSortDir` — Account Tracker tile expansion
- `_ccTxSortCol` / `_ccTxSortDir` — Credit Card tile expansion
- `_baTxSortCol` / `_baTxSortDir` — Bank Account tile expansion
- `_acTxSortCol` / `_acTxSortDir` — Accrual tile expansion

Default for all: `trxDate DESC`. The sort handlers are named `aiTxSetSort`, `ccTxSetSort`, `baTxSetSort`, `accrualTxSetSort`. **Each handler removes the existing panel before injecting the new one** (otherwise panels stack — see ERRORS.md). The `_accrualReinject()` helper exists because accrual injection is split across two render paths.

### View mode (Phone / Tablet / Desktop / Auto)

Stored in `AppSettings` under key `viewMode`. Module-level `let _viewMode` mirrors it. `_applyViewMode()` toggles two classes on `<html>`:

| View | `html.use-cards` | `html.use-tablet-hide` |
|------|------------------|------------------------|
| Phone | yes | yes |
| Tablet | no | yes |
| Desktop | no | no |
| Auto | matches device width breakpoints | matches device width breakpoints |

CSS picks up the classes:
- `html.use-cards .table-mobile-cards` → table renders as stacked cards via `data-label` attrs
- `html.use-tablet-hide .tablet-hide` → less-important columns are hidden

Settable from Settings → Display → Layout. Handler: `gcSetView(mode)`. **Apply `.table-mobile-cards` to tables that benefit from card layout on small screens.** Apply `.tablet-hide` to non-essential columns. Currently applied to four high-traffic tables (Transactions, Future Transactions, Credit Card detail, Bank Account detail).

### Navigation

```javascript
navigate('dashboard');
navigate('settings');           // mounts settings, resets settingsTab to 'scratchpad'
navigate('transactions');       // mounts composite, restores _txComboTab
navigate('account-tracker');    // mounts composite, restores _atTab
```

To deep-link into a sub-tab: `navigate('settings'); settingsGoTab('display');`. The `XGoTab(sub)` family is the canonical way to switch sub-tabs.

### ID Generation

```javascript
const id = genId();  // UUID v4
```

### Drive Upload

```javascript
// 4th param is the filename — REQUIRED for non-DB files (notifications JSON etc.)
const uploaded = await driveUploadFile(uint8Array, existingFileId || null, driveFolderId, filename);
// existingFileId: null on first creation; pass cached ID for updates
```

---

## Features Snapshot (Session 1 + Session 2)

### Security & Persistence
- **SQL injection fix:** all `db.run()` writes parameterized; `driveUploadFile()` accepts a `filename` arg
- **Service worker (`sw.js`):** network-first HTML, cache-first same-origin static, pass-through cross-origin

### PWA / Install
- `manifest.webmanifest` — `name=FinApp`, `short_name=FinApp`, `display=standalone`, `theme_color=#0f172a`
- `icon.svg` — slate-900 bg, white `$` glyph (works as `any` + `maskable`)
- `<link rel="manifest">`, apple-touch meta tags, SW registration all wired in `index.html`
- Installable from Chrome / Safari; launches in its own window from the home screen

### Transactions / Future Transactions
- `createdAt` surfaced as visible "Created" column; backfill migration in `startApp()`
- Date range filters "Created from / to" on both filter bars
- Collapsible filter bar with active count badge (`txFiltersOpen`, `ftFiltersOpen`)
- Sortable column headers (`txSortCol/Dir`, `ftSortCol/Dir`); `_txOrderBy()` / `_ftOrderBy()` build the ORDER BY
- **Timezone fix:** `trxDate` is now stored as `YYYY-MM-DDTHH:MM:SS.000Z` *built from local date components*, not from `new Date(dateOnly).toISOString()` (which shifts by UTC offset). Applies across all transaction-creation paths.
- **`FutureTransaction.importSource` preservation on migrate:** see schema note above. Recent Dividends now correctly shows future-dated dividends after their due date passes.

### Dictate Transaction
- **Tab:** Settings → Transactions → Dictate Transaction (the standalone landing — toggleable via Display setting)
- **Floating mic** (red, fixed bottom-left at `left:15rem`) on Transactions / Future Transactions / Account Tracker tabs
- **Voice:** Web Speech API push-to-talk; `continuous: false` + session-restart loop to work around mobile Chrome interim-replay
- **Text input:** plain textarea, editable transcript before submit
- **AI:** Anthropic `claude-sonnet-4-20250514`. Header `anthropic-dangerous-direct-browser-access: true`
- **Multi-tx via `#`:** start of each transaction in the input separates a draft. Use `"#"` (quoted) to insert a literal hash
- **Draft review:** creates `DraftBatch (source='Dictate')` + `DraftTransaction`s; same review UI as screenshot import
- **Context system:**
  ```javascript
  let _dtContext = 'tab';   // 'tab' | 'modal'
  let _dtTarget  = 'tx';    // 'tx' | 'ft' — which table receives the approved draft
  ```
- **Modal width:** widened so user doesn't horizontal-scroll
- **Return-to-origin after post:** `_dtCloseOrRefresh()` restores the page where the user opened Dictate
- **Show/Hide toggle:** Display setting `_showDictateTab` controls whether the standalone Dictate sub-tab appears under Transactions. The floating mic and other Dictate entry points are unaffected.

### Account Tracker / Credit Card / Bank Account
- Tile-expansion panels each have sortable headers (default `trxDate DESC`)
- Sort handlers remove the existing panel before re-rendering (idempotent in the DOM)
- Tile-click handlers use `_getActiveContent()` so the tab bar isn't wiped

### Dividends
- **Scheduled Dividends** — `FutureTransaction WHERE description LIKE 'Dividend%'`, ASC (soonest first)
- **Recent Dividends (last 20 paid)** — `Transaction WHERE importSource='Equity' AND description LIKE 'Dividend%'`, DESC (newest first)
- Both tables have bold **Total** footer rows
- Posted dividends from migrated future-dated entries now appear correctly thanks to `importSource` preservation

### Notifications
- `NotificationConfig` table — full CRUD UI in Settings → Configuration → Notifications
- `writeNotificationsJson()` writes `finance-notifications.json` to the user's FinanceApp Drive folder
- Bell icon (🔔) on Credit Card Tracker tiles when notifications are active
- External `FinanceNotifications.gs` Apps Script reads JSON and sends Gmail daily

### Responsive / Layout
- Page width cap removed (`max-w-7xl` dropped) — pages fill the viewport
- **Layout view selector** in Settings → Display: Auto / Phone / Tablet / Desktop
- `.table-mobile-cards` + `data-label` attrs: tables render as stacked cards under Phone view
- `.tablet-hide`: less-important columns hidden in Tablet view
- Currently applied to four highest-traffic tables — extending the pattern is just CSS class additions

### Build History
- Settings → About → Build History panel
- `aboutFetchBuilds()` calls GitHub API to list recent commits on `main`
- Read-only display, useful for "what changed recently?"

---

## State Variables Quick Reference

| Variable | Type | Purpose |
|----------|------|---------|
| `_txComboTab` | string | Active sub-tab on Transactions composite |
| `_atTab` | string | Active tab on Account Tracker |
| `_teTab` | string | Active tab on Equity Tracker |
| `_fsTab` | string | Active tab on Financial Statements |
| `settingsTab` | string | Active sub-tab on Settings (reset by renderSettings) |
| `dupTab` | string | Active sub-tab on Duplicate Review |
| `_viewMode` | 'auto'\|'phone'\|'tablet'\|'desktop' | User-selected layout mode |
| `_showDictateTab` | boolean | Show standalone Dictate sub-tab. **Declared early (line ~2544)** |
| `_aiTxSortCol/Dir` | string | Sort state for Account Tracker tile expansion |
| `_ccTxSortCol/Dir` | string | Sort state for Credit Card tile expansion |
| `_baTxSortCol/Dir` | string | Sort state for Bank Account tile expansion |
| `_acTxSortCol/Dir` | string | Sort state for Accrual tile expansion |
| `_dtContext` | 'tab'\|'modal' | Dictate UI context |
| `_dtTarget` | 'tx'\|'ft' | Which table approved drafts post to |
| `_dtRecognition` | SpeechRecognition | Web Speech API instance |
| `_dtFinalTranscript` | string | Accumulated transcript |
| `_dtSessionBase` | string | Text from prior session restarts |
| `_dtMicHeld` | boolean | Push-to-talk button state |
| `notifFileId` | string | Cached Drive file ID for notifications JSON |

---

## Key Helper Functions

| Function | Purpose |
|----------|---------|
| `query(sql, params)` | SELECT → array of row objects |
| `queryVal(sql, params)` | SELECT → first cell value |
| `db.run(sql, params)` | INSERT/UPDATE/DELETE |
| `db.getRowsModified()` | Affected row count after `db.run()` |
| `syncAfterWrite()` | Debounced Drive sync (~500ms) |
| `writeNotificationsJson()` | Write notification config to Drive |
| `genId()` | UUID v4 |
| `fmtCurrency(v, decimals)` | Format number as USD |
| `fmtDate(isoStr)` | Format ISO date as "May 15, 2026" |
| `escHtml(str)` | Escape HTML entities |
| `navigate(page)` | Navigate to a page (restores sub-tab state where applicable) |
| `_getActiveContent()` | Returns the inner content `<div>` of the active composite page |
| `_visibleTxComboTabs()` | Filtered list of Transactions sub-tabs (honors `_showDictateTab`) |
| `_applyViewMode()` | Toggle `html.use-cards` / `html.use-tablet-hide` classes |
| `gcSetView(mode)` | Set + persist view mode |
| `gcToggleDictateTab()` | Toggle + persist `_showDictateTab` |
| `aiTxSetSort` / `ccTxSetSort` / `baTxSetSort` / `accrualTxSetSort` | Sort handlers for tile-expansion panels |
| `_accrualReinject()` | Re-inject accrual panel (handles two render paths) |
| `_dtProcessText(text, onComplete)` | Send dictate text to Anthropic, create draft batch |
| `_dtCreateMultiDraft(segments)` | Build multi-draft batch from `#`-split segments |
| `_dtCloseOrRefresh()` | After draft post: close modal + return to origin page |
| `aboutFetchBuilds()` | Fetch recent commits for Build History panel |
| `currentPeriod()` | Current `YYYYMM` string |
| `_itGetApiKey()` / `_itHasApiKey()` | Anthropic API key from AppSettings |
| `acctPickerHtml(id, val, placeholder, opts)` | Account search picker |
| `showToast(msg)` | Temporary toast notification |
| `settingsGoTab(sub)` / `xGoTab(sub)` family | Set + render a sub-tab — use after `navigate(x)` |

---

## External Services

### Google Drive
- Scope: `https://www.googleapis.com/auth/drive.file` (app can only access files it created)
- Main DB: `FinanceApp/finance.sqlite`
- Notifications: `FinanceApp/finance-notifications.json`
- `notifFileId` is cached at module level

### Firebase Realtime Database
- Session lock only (prevents two tabs from writing simultaneously)
- Path: `/locks/{emailKey}` (email with special chars replaced by `_`)
- **Rules are currently open** — see `firebase-security-rules.md`
- Lock failure is non-fatal — app continues with a console warning

### Anthropic API
- Key in `AppSettings.anthropicApiKey` (per-user, configured via Settings)
- Browser header required: `'anthropic-dangerous-direct-browser-access': 'true'`
- **Sonnet 4 (`claude-sonnet-4-20250514`)** — Dictate (`_dtProcessText`) and screenshot import (`_itHandleScreenshot`)
- **Haiku 4.5 (`claude-haiku-4-5-20251001`)** — ticker lookup and lightweight classification

### Google Apps Script (Notifications)
- External — user creates at script.google.com
- Source: `FinanceNotifications.gs`
- Reads `finance-notifications.json` from Drive daily, sends Gmail via `GmailApp.sendEmail()`
- Writes a sent log back to JSON to prevent duplicates
- Setup: `notifications-setup.md`

---

## Known Issues / Pre-existing Tech Debt

1. **Dead-tail at lines ~11099-11140.** Leftover `repPlaySave()` code that calls `navigate('transactions')` at top-level. Forces `_showDictateTab` (and possibly others) to be declared near the top of the file. **Remove in a dedicated cleanup pass.**

2. **`buildTxWhere()` and FT `buildWhere()`** still interpolate dates/search strings into SQL. Low real-world risk (dates are typed inputs, strings are `replace(/'/g,"''")`-escaped) but should be parameterized.

3. **Inline `onclick` handlers** in `innerHTML` templates throughout. Works, but harder to debug than `addEventListener`.

4. **Schema duplication.** Some table definitions appear in both `_initCoreSchema()` and `startApp()` migrations. Consolidate eventually.

5. **Firebase rules** are open. See `firebase-security-rules.md` for the tightening plan (requires adding Firebase Auth or a custom JWT).

6. **Single file, ~13,500 lines.** Maintainable for solo dev but module split would help future work.

7. **Service worker cache during dev.** When iterating on `index.html` against a browser that previously loaded the PWA, hard reload alone is not enough — unregister the SW first, test in incognito, or bump the `CACHE` constant in `sw.js`.

---

## Deployment

```bash
git add index.html             # or whichever files you changed
git commit -m "short description"
git push origin main
# GitHub Pages auto-deploys in ~60 seconds
```

No build step. The file you edit IS the file that gets served.

**Local permission rule:** `.claude/settings.local.json` allows `git push` to `main` without re-prompting on every push.

---

## Session 2 (2026-05-27) — Summary

12 commits shipped:

1. `a1262d0` — Dictate UX: timezone, modal width, multi-tx `#` delimiter, return-to-origin
2. `97132da` — Sub-tab state preservation across navigation (composite pages)
3. `1829ada` — Build History panel in Settings → About
4. `7cbc378` — Fix sub-tab bar getting wiped (introduced `_getActiveContent()` pattern)
5. `ae23e39` — Widen pages (drop max-w-7xl); responsive POCs on selected tables
6. `550f458` — Apply mobile card layout to four highest-traffic tables
7. `fb97d3c` — Layout view selector in Settings → Display (Auto/Phone/Tablet/Desktop)
8. `078e65a` — Installable PWA: manifest, icon, service worker
9. `8f7e223` — Sortable headers on tile-expansion transaction panels
10. `37a58c6` — Fix sort clicks stacking duplicate panels on CC/BA
11. `237f2b1` — Show/Hide Dictate Sub-tab toggle in Settings → Display
12. `b625df4` + `d649b75` — Recent Dividends bug + deeper fix: preserve `importSource` through FT→Transaction migration

All decisions, rationale, and rejected alternatives are in `MEMORY.md`. All session-2 failure modes and how to avoid them are in `ERRORS.md`.
