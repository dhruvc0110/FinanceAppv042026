# Finance App — Claude Code Hand-Off Document

## Project Overview

A single-file personal household finance tracker (`index.html`, ~13,100 lines) deployed as a static GitHub Pages site. All data lives in a SQLite database file stored in the user's own Google Drive. There is no backend server, no database server, and no Anthropic-controlled persistence. The app is 100% client-side.

**Live URL:** `https://dhruvc0110.github.io/FinanceAppv042026/`  
**Repo:** GitHub (sole developer, single branch)  
**Deployment:** Push `index.html` to `main` → GitHub Pages auto-deploys

---

## Architecture

```
Browser (index.html)
  ├── sql.js (SQLite compiled to WASM) — in-memory DB
  ├── Google OAuth 2.0 — authentication + Drive access
  ├── Google Drive API — reads/writes finance.sqlite on load/save
  ├── Firebase Realtime Database — session lock (prevents two tabs writing simultaneously)
  ├── Anthropic API — screenshot import parsing + dictate transaction interpretation
  └── Google Apps Script (external, user-configured) — scheduled email notifications
```

### Data Flow
1. User signs in via Google OAuth
2. App downloads `finance.sqlite` from Google Drive into memory
3. sql.js loads the binary as an in-memory SQLite DB
4. All reads/writes go to the in-memory DB
5. Every write calls `syncAfterWrite()` which debounces a Drive upload (500ms)
6. Auto-save runs every 30 seconds as a fallback

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Pure browser — no build step, no bundler |
| Database | [sql.js](https://sql.js.org/) — SQLite compiled to WebAssembly |
| Persistence | Google Drive REST API v3 |
| Auth | Google Identity Services (OAuth 2.0, `drive.file` scope) |
| Styling | Tailwind CSS via CDN (JIT, all utilities available) |
| Session lock | Firebase Realtime Database |
| AI features | Anthropic Messages API (`claude-sonnet-4-20250514`) |
| Email notifications | Google Apps Script (external, user-managed) |
| Hosting | GitHub Pages |

---

## Single-File Structure

Everything lives in `index.html`. Key sections in order:

| Line range (approx) | Contents |
|---------------------|----------|
| 1–310 | HTML head, CSS, Google/Firebase SDK scripts |
| 310–395 | Constants: `DRIVE_FOLDER_NAME`, `DRIVE_FILE_NAME`, `NOTIF_FILE_NAME`, OAuth client ID, Firebase config |
| 395–700 | Google OAuth sign-in flow, token management |
| 700–900 | Drive helpers: `driveGet`, `driveUploadFile`, `driveDownloadFile` |
| 900–1100 | DB init: load from Drive via IndexedDB cache, `loadFromDrive()` |
| 1100–1250 | Firebase lock system: `checkAndClaimLock`, `releaseLock` |
| 1250–1640 | Sidebar HTML, navigation (`navigate()`), `_pageTabBar()` helper |
| 1640–1910 | `startApp()` — all table creation/migrations run here |
| 1910–2000 | SQL helpers: `query(sql, params)`, `queryVal(sql, params)` |
| 2000–2115 | Format helpers: `fmtCurrency`, `fmtDate`, `escHtml`, `genId` |
| 2115–2250 | Account Tracker page (`renderAccountTracker`, `_renderATPage`) |
| 2250–2430 | Equity Tracker — Dividends tab (`_renderDividendsTab`) |
| 2430–7720 | All remaining page renderers (P&L, Balance Sheet, Budget, Transactions, etc.) |
| 7720–8260 | Future Transactions page |
| 8260–9120 | Import Transactions (screenshot AI import) |
| 9120–9600 | Dictate Transaction feature |
| 9600–10460 | Repeatable Transaction tab |
| 10460–11000 | Duplicate Review, Equity Tracker (lots/sales) |
| 11000–11500 | Credit Card page, Notes, Notification CRUD + `writeNotificationsJson()` |
| 11500–12000 | Settings page tabs |
| 12000–13145 | Remaining utilities, global event handlers |

---

## Database Schema

All tables are created with `CREATE TABLE IF NOT EXISTS` in `startApp()`. Migrations use `ALTER TABLE ... ADD COLUMN` wrapped in try/catch.

### Core Accounting Tables

```sql
Account (
  id TEXT PRIMARY KEY,
  code TEXT, name TEXT NOT NULL, type TEXT NOT NULL,  -- type: ASSET|LIABILITY|EQUITY|INCOME|EXPENSE
  role TEXT,          -- BELOW_THE_LINE | EXCLUDED | FLUX_PL | NULL
  grouping TEXT,
  hasSubAccounts INTEGER NOT NULL DEFAULT 0,
  showOnInquiry INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

SubAccount (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  code TEXT, name TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1
)

"Transaction" (
  id TEXT PRIMARY KEY,
  trxDate TEXT NOT NULL,    -- ISO timestamp, e.g. 2024-01-15T12:00:00.000Z
  period TEXT NOT NULL,     -- YYYYMM, e.g. 202401
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
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

Period (
  period TEXT PRIMARY KEY,  -- YYYYMM
  isLocked INTEGER NOT NULL DEFAULT 0
)
```

### Budget Tables

```sql
BudgetPlan (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL, period TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  projectedClose REAL
)

BudgetNote (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL, period TEXT NOT NULL,
  note TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

SectionLayout (
  section TEXT PRIMARY KEY,
  items TEXT NOT NULL,      -- JSON array of account IDs
  updatedAt TEXT NOT NULL
)
```

### Equity Tables

```sql
EquityLot (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL, stockName TEXT,
  trxDate TEXT NOT NULL, period TEXT NOT NULL,
  qty REAL NOT NULL, price REAL NOT NULL, amount REAL NOT NULL,
  drAccountId TEXT NOT NULL, crAccountId TEXT NOT NULL,
  notes TEXT, linkedTxId TEXT,
  createdAt TEXT NOT NULL
)

EquityLotSale (
  id TEXT PRIMARY KEY,
  lotId TEXT NOT NULL,
  trxDate TEXT NOT NULL, period TEXT NOT NULL,
  qty REAL NOT NULL, price REAL NOT NULL,
  proceeds REAL, costBasis REAL, gainLoss REAL,
  drAccountId TEXT, crAccountId TEXT,
  notes TEXT, linkedTxId TEXT,
  createdAt TEXT NOT NULL
)

MarketPrice (
  ticker TEXT PRIMARY KEY,
  price REAL NOT NULL,
  isManual INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL
)
```

### Configuration Tables

```sql
CreditCard (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  liabilityAccountId TEXT NOT NULL, paymentAccountId TEXT NOT NULL,
  creditLimit REAL NOT NULL DEFAULT 0,
  paymentDueDay INTEGER,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

BankAccount (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, type TEXT,
  assetAccountId TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

RepeatableTransaction (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, description TEXT, amount REAL,
  dayOfMonth INTEGER,
  drAccountId TEXT, crAccountId TEXT,
  notes TEXT,
  isAutoGenerate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | INACTIVE
  templateType TEXT DEFAULT 'Undefined',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

RepeatableGenLog (
  id TEXT PRIMARY KEY,
  repeatableId TEXT NOT NULL, period TEXT NOT NULL,
  createdAt TEXT NOT NULL
)

NotificationConfig (
  id TEXT PRIMARY KEY,
  creditCardId TEXT NOT NULL,
  daysInAdvance TEXT NOT NULL DEFAULT '[]',  -- JSON array, e.g. [2,5,7]
  recipientEmail TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)
```

### Import / Drafts Tables

```sql
ScreenshotTemplate (
  id TEXT PRIMARY KEY,
  creditCardId TEXT, cardNickname TEXT NOT NULL,
  dateFormat TEXT,
  amountConvention TEXT NOT NULL DEFAULT 'negative-charges',
  excludePending INTEGER NOT NULL DEFAULT 1,
  paymentKeywords TEXT, refundKeywords TEXT,
  customNotes TEXT, extractionPrompt TEXT,
  fingerprintData TEXT, sampleImageDataUrl TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

DraftBatch (
  id TEXT PRIMARY KEY,
  templateId TEXT, detectedCardName TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  rowCount INTEGER NOT NULL DEFAULT 0,
  approvedCount INTEGER NOT NULL DEFAULT 0,
  rejectedCount INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'Import',    -- 'Import' | 'Dictate'
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

DraftTransaction (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  date TEXT, description TEXT, amount REAL,
  txnType TEXT NOT NULL DEFAULT 'charge',
  suggestedDrAccountId TEXT, suggestedCrAccountId TEXT,
  drAccountId TEXT, crAccountId TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  rawExtracted TEXT,
  createdAt TEXT NOT NULL
)

ImportLog (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL, cardName TEXT, templateId TEXT,
  rowCount INTEGER NOT NULL DEFAULT 0,
  approvedCount INTEGER NOT NULL DEFAULT 0,
  rejectedCount INTEGER NOT NULL DEFAULT 0,
  importedAt TEXT NOT NULL
)
```

### Utility Tables

```sql
TransactionLink (
  id TEXT PRIMARY KEY,
  txAId TEXT NOT NULL, txBId TEXT NOT NULL,
  note TEXT, createdAt TEXT NOT NULL
)

DuplicateReview (
  id TEXT PRIMARY KEY,
  txARef TEXT NOT NULL, txBRef TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'FLAGGED',
  deleteRef TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

ScratchPad (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',  -- JSON grid data
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

AppSettings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL
)
-- Key values in use:
--   anthropicApiKey  — Anthropic API key for AI features
--   dashTiles        — JSON array of dashboard tile IDs

Note (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL, body TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)

User (
  id TEXT PRIMARY KEY,
  email TEXT, name TEXT,
  preferences TEXT,   -- JSON blob for dashboard tile config etc.
  createdAt TEXT NOT NULL
)
```

---

## Key Patterns

### SQL — Always Use Parameterized Queries

All write functions use parameterized queries. Never use string interpolation for user data.

```javascript
// ✓ Correct
db.run('INSERT INTO "Transaction" (id, description) VALUES (?, ?)', [genId(), desc]);

// ✗ Wrong — SQL injection risk
db.run(`INSERT INTO "Transaction" (id, description) VALUES ('${id}', '${desc}')`);
```

The `query()` and `queryVal()` helpers accept an optional params array:
```javascript
const rows = query('SELECT * FROM Account WHERE type=?', ['EXPENSE']);
const count = queryVal('SELECT COUNT(*) FROM "Transaction" WHERE period=?', [period]);
```

**Exception:** `buildTxWhere()` and `buildWhere()` (FT) still use string interpolation for dynamic filter conditions — these are a pre-existing issue and should be parameterized in a future pass.

### Page Rendering Pattern

Pages use one of two patterns:

**Pattern A — innerHTML template** (most pages):
```javascript
function _renderTxPage(container) {
  if (!container) container = document.getElementById('txComboContent');
  // ... build data ...
  container.innerHTML = `...html template...`;
  // ... attach event listeners if needed ...
}
```

**Pattern B — createElement** (Account Tracker, some composite pages):
```javascript
function _renderATPage(container) {
  const wrap = document.createElement('div');
  // ... build DOM elements ...
  container.innerHTML = '';
  container.appendChild(wrap);
}
```

### Navigation

```javascript
navigate('dashboard');           // go to page
navigate('settings');
navigate('transactions');        // lands on Transactions tab
navigate('account-tracker');
```

The `_TX_COMBO_TABS` array defines the tabs on the Transactions composite page. The active tab is tracked in `_txComboTab`.

### ID Generation

```javascript
const id = genId();  // returns a UUID v4 string
```

### Drive Upload

```javascript
// The 4th param is the filename — REQUIRED for non-DB files
const uploaded = await driveUploadFile(uint8Array, existingFileId || null, driveFolderId, filename);
// existingFileId: pass null for first-time creation, cached ID for updates
```

---

## Features Implemented in This Session

### 1. SQL Injection Fix (Security)
- All `db.run()` write calls converted from string interpolation to `?` parameterized bindings
- Manual `replace(/'/g,"''")` escaping removed throughout
- `driveUploadFile()` refactored to accept optional `filename` param (4th arg, defaults to `DRIVE_FILE_NAME`)

### 2. Creation Date on Transactions
- `createdAt` column surfaced as a visible "Created" column on Transactions and Future Transactions pages
- Startup migration backfills `createdAt = substr(trxDate,1,10)` for any records with null/empty value
- Date range filters "Created from" / "Created to" added to both filter bars

### 3. Payment Notifications
- New `NotificationConfig` table (card, days-in-advance JSON array, email, isActive)
- **Settings → Configuration → Notifications** tab — full CRUD UI
- `writeNotificationsJson()` — writes `finance-notifications.json` to user's FinanceApp Drive folder after any config or card change
- Bell icon (🔔) on Credit Card Tracker tiles for cards with active notifications
- `ccSave()` and `ccDelete()` both trigger `writeNotificationsJson()` since paymentDueDay affects the schedule
- **External:** `FinanceNotifications.gs` — Google Apps Script reads the JSON, computes due dates, sends Gmail. Daily trigger set by user. `notifications-setup.md` has setup instructions.

### 4. Dictate Transaction
- **Tab:** Settings → Transactions → Dictate Transaction — full page with same mic + review UI
- **Floating mic button** (red, fixed bottom-left at `left:15rem`) on:
  - Transactions page → posts to `Transaction` table
  - Future Transactions page → posts to `FutureTransaction` table
  - Account Tracker page (all 4 tabs)
- **Voice:** Web Speech API push-to-talk. Hold button → speak → release → transcript appears in editable textarea
- **Text fallback:** plain text input field
- **Transcript is editable** before Submit — user can correct speech recognition errors
- **AI interpretation:** Anthropic API (`claude-sonnet-4-20250514`) receives the text + full chart of accounts, returns structured JSON (date, description, amount, drAccountId, crAccountId)
- **Draft review:** creates `DraftBatch` (source='Dictate') + `DraftTransaction`, user reviews in same table UI as screenshot import
- **Approve:** posts to correct table, closes modal, re-renders page
- **Context system:** `_dtContext` ('tab' | 'modal'), `_dtTarget` ('tx' | 'ft') control which UI updates and which table receives the approved draft

**Key state variables:**
```javascript
let _dtRecognition     = null;   // Web Speech API instance
let _dtFinalTranscript = '';     // accumulated transcript
let _dtStatus          = '';     // status message
let _dtTranscriptText  = '';     // displayed transcript text
let _dtContext         = 'tab';  // 'tab' | 'modal'
let _dtTarget          = 'tx';   // 'tx' | 'ft'
let _dtMicHeld         = false;  // push-to-talk button state
let _dtSessionBase     = '';     // text accumulated before current session
```

**Voice recording fix (mobile):** Uses `continuous: false` + session restart loop. Each session accumulates into `_dtSessionBase` only when `sessionGotFinal = true` to prevent mobile Chrome's interim-result replay bug.

### 5. Collapsible Filter Bars + Sortable Columns
**Transactions page:**
- `txFiltersOpen` (bool) — filter bar hidden by default, Filters button + active count badge
- `txSortCol` (string) + `txSortDir` ('asc'|'desc') — column sort state
- `_txOrderBy()` — builds SQL ORDER BY from sort state
- `_txSortTh(col, label, align)` — renders clickable `<th>` with arrow indicator
- `txToggleFilters()`, `txSetSort(col)` — user actions
- Sortable: trxDate, createdAt, description, amount, drName, crName

**Future Transactions page:** Same pattern with `ft` prefix. Defaults to `trxDate ASC` (soonest first).

### 6. Dividend Page Fix
- **Scheduled Dividends** — queries `FutureTransaction WHERE description LIKE 'Dividend%'`, sorted ASC (soonest first)
- **Recent Dividends (last 20 paid)** — queries `Transaction WHERE importSource='Equity' AND description LIKE 'Dividend%'`, sorted DESC (newest first)
- Both tables show a bold **Total** footer row
- Previously, posted dividends were incorrectly shown in the same table as scheduled ones

---

## External Services

### Google Drive
- Scope: `https://www.googleapis.com/auth/drive.file` (app can only access files it created)
- Main DB file: `FinanceApp/finance.sqlite`
- Notifications JSON: `FinanceApp/finance-notifications.json`
- `notifFileId` is a module-level cached file ID for the notifications JSON

### Firebase Realtime Database
- Used only for session locking (prevent two browser tabs from writing simultaneously)
- Path: `/locks/{emailKey}` where `emailKey` is user email with special chars replaced by `_`
- **Rules are currently open** — see `firebase-security-rules.md` for the fix (requires adding Firebase Auth)
- Lock failure is non-fatal; app continues normally with a console warning

### Anthropic API
- Key stored in `AppSettings` table under key `'anthropicApiKey'`
- Retrieved via `_itGetApiKey()` / `_itHasApiKey()`
- Used in: screenshot import parsing (`_itHandleScreenshot`) and dictate transaction (`_dtProcessText`)
- Model: `claude-sonnet-4-20250514`
- Header required for browser access: `'anthropic-dangerous-direct-browser-access': 'true'`

### Google Apps Script (Notifications)
- External to the codebase — user creates once at script.google.com
- Source: `FinanceNotifications.gs` (in repo)
- Reads `finance-notifications.json` from Drive daily
- Sends Gmail via `GmailApp.sendEmail()`
- Writes sent log back to the JSON to prevent duplicate notifications
- Setup instructions: `notifications-setup.md`

---

## Known Issues / Pre-existing Technical Debt

1. **`buildTxWhere()` and FT `buildWhere()`** — still use string interpolation for filter conditions (dates, description search). Low risk (dates come from `<input type="date">`, description uses `replace(/'/g,"''")`) but should be parameterized.

2. **`query()` calls in render functions** — many read queries throughout the render functions use inline string interpolation for IDs (which are internal UUIDs, not user input). These are safe but inconsistent with the parameterized write pattern.

3. **Single file, ~13,100 lines** — no module separation. Navigation, data, and UI are all in one file. Maintainable for a solo developer but would benefit from splitting in a future refactor.

4. **Inline `onclick` handlers** — most interactive elements use `onclick="functionName()"` in HTML strings rather than `addEventListener`. Works but harder to debug.

5. **`schema duplication`** — some table definitions appear both in `_initCoreSchema()` (the initial DB setup) and in `startApp()` migrations. The two should be consolidated.

6. **Firebase rules** — currently open (unauthenticated read/write). See `firebase-security-rules.md`.

---

## Deployment

```bash
# After making changes to index.html:
git add index.html
git commit -m "description of change"
git push origin main
# GitHub Pages auto-deploys within ~60 seconds
```

The app has no build step. The file you edit IS the file that gets served.

---

## Key Helper Functions Quick Reference

| Function | Purpose |
|----------|---------|
| `query(sql, params)` | Run SELECT, returns array of row objects |
| `queryVal(sql, params)` | Run SELECT, returns first cell value |
| `db.run(sql, params)` | Run INSERT/UPDATE/DELETE |
| `db.getRowsModified()` | Row count affected by last `db.run()` |
| `syncAfterWrite()` | Debounced Drive sync (500ms) |
| `writeNotificationsJson()` | Write notification config to Drive |
| `genId()` | Generate UUID v4 |
| `fmtCurrency(v, decimals)` | Format number as USD |
| `fmtDate(isoStr)` | Format ISO date as "May 15, 2026" |
| `escHtml(str)` | Escape HTML entities |
| `navigate(page)` | Navigate to a page |
| `currentPeriod()` | Returns current YYYYMM string |
| `_itGetApiKey()` | Get Anthropic API key from AppSettings |
| `_itHasApiKey()` | Boolean — is API key configured |
| `acctPickerHtml(id, val, placeholder, opts)` | Render account search picker |
| `showToast(msg)` | Show a temporary toast notification |

---

## Files in Repo

| File | Purpose |
|------|---------|
| `index.html` | The entire application |
| `FinanceNotifications.gs` | Google Apps Script for email notifications |
| `notifications-setup.md` | One-time setup instructions for Apps Script |
| `firebase-security-rules.md` | Firebase rules fix (to be applied in Firebase Console) |
| `HANDOFF.md` | This document |
