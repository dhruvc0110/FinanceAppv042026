/**
 * FinApp — Credit-card payment-due email reminders.
 *
 * What it does:
 *   - Reads finance-notifications.json from your Google Drive
 *     (FinanceApp folder), which the FinApp web app writes whenever
 *     you change a credit card or a notification config.
 *   - For each active config, computes the NEXT payment due date
 *     respecting the FinApp day-of-month convention:
 *         stored = NULL  -> ignored
 *         stored = 1-31  -> that day, clamped to month-end on short months
 *         stored = 32    -> explicit "Last day of month"
 *   - For each `daysInAdvance` entry on the config (e.g. [2, 5, 7]),
 *     emails the recipient when today is exactly that many days before
 *     the due date.
 *   - Tracks every sent reminder in `sentLog` so the same card+dueDate+daysOut
 *     never goes out twice. Prunes log entries older than 60 days.
 *
 * One-time setup:
 *   1. Go to https://script.google.com and create a new project.
 *   2. Paste this entire file into the editor (replace any starter code).
 *   3. Save (Cmd/Ctrl+S), give the project a name.
 *   4. Click "Run" with the dailyCheck function selected. Approve the
 *      Drive + Gmail permission prompts (the script needs to read the
 *      JSON in your Drive and send mail from your Gmail).
 *   5. Click the clock icon (Triggers) in the left sidebar -> Add Trigger.
 *        Function:      dailyCheck
 *        Event source:  Time-driven
 *        Type:          Day timer
 *        Time of day:   6am-7am (or whenever you want the reminder)
 *   6. Save. You're done. The trigger fires every day automatically.
 *
 * Updating: when this file changes in the FinApp repo, copy the new
 * contents over the old one in the Apps Script editor and Save. No
 * trigger reconfiguration needed.
 */

var DRIVE_FOLDER_NAME = 'FinanceApp';
var NOTIF_FILE_NAME   = 'finance-notifications.json';
var DOM_LAST          = 32;        // sentinel = "Last day of month"
var SENTLOG_MAX_DAYS  = 60;        // prune sentLog entries older than this

/**
 * Main entry point. Set this as a daily time-driven trigger.
 */
function dailyCheck() {
  var file = findNotifFile_();
  if (!file) {
    Logger.log('No ' + NOTIF_FILE_NAME + ' found in Drive folder "' + DRIVE_FOLDER_NAME + '" — nothing to do.');
    return;
  }

  var data;
  try {
    data = JSON.parse(file.getBlob().getDataAsString());
  } catch (e) {
    Logger.log('Could not parse notifications JSON: ' + e.message);
    return;
  }

  var notifs  = (data.notifications || []).filter(function (n) { return n.isActive; });
  var sentLog = (data.sentLog || []);
  var tz      = Session.getScriptTimeZone();

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayKey = formatYmd_(today, tz);

  var changed   = false;
  var sentCount = 0;

  for (var i = 0; i < notifs.length; i++) {
    var n = notifs[i];
    if (!n.recipientEmail) continue;

    var due = nextDueDate_(n.paymentDueDay, today);
    if (!due) continue;

    var daysList = (n.daysInAdvance || [])
      .map(function (d) { return parseInt(d, 10); })
      .filter(function (d) { return !isNaN(d) && d >= 0; });
    if (daysList.length === 0) continue;

    var diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (daysList.indexOf(diffDays) === -1) continue;   // not a reminder day for this card

    var dueKey = formatYmd_(due, tz);
    if (alreadySent_(sentLog, n.creditCardId, dueKey, diffDays)) continue;

    try {
      sendReminder_(n, due, diffDays, tz);
      sentLog.push({
        creditCardId: n.creditCardId,
        cardName:     n.cardName,
        dueIso:       dueKey,
        daysOut:      diffDays,
        sentAt:       new Date().toISOString()
      });
      changed = true;
      sentCount++;
    } catch (e) {
      Logger.log('Failed to send for ' + n.cardName + ': ' + e.message);
    }
  }

  // Prune sentLog entries whose dueIso is older than SENTLOG_MAX_DAYS days.
  var cutoff = new Date(today.getTime() - SENTLOG_MAX_DAYS * 86400000);
  var cutoffKey = formatYmd_(cutoff, tz);
  var pruned = sentLog.filter(function (s) { return (s.dueIso || '') >= cutoffKey; });
  if (pruned.length !== sentLog.length) { sentLog = pruned; changed = true; }

  if (changed) {
    data.sentLog     = sentLog;
    data.lastUpdated = new Date().toISOString();
    file.setContent(JSON.stringify(data, null, 2));
  }

  Logger.log('FinApp notifications run: sent ' + sentCount + ' email(s); sentLog has ' + sentLog.length + ' entries.');
}

/**
 * Locate finance-notifications.json inside the user's FinanceApp folder.
 */
function findNotifFile_() {
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  while (folders.hasNext()) {
    var folder = folders.next();
    var files = folder.getFilesByName(NOTIF_FILE_NAME);
    if (files.hasNext()) return files.next();
  }
  return null;
}

/**
 * Compute the next due date >= today for a stored paymentDueDay.
 * Handles 32 = "Last day of month" and clamps 1-31 to month-end for
 * short months (Feb 28/29, Apr/Jun/Sep/Nov 30).
 */
function nextDueDate_(stored, today) {
  if (!stored) return null;
  var y = today.getFullYear();
  var m = today.getMonth();

  var domThis = resolveDom_(stored, y, m);
  var due = new Date(y, m, domThis);
  due.setHours(0, 0, 0, 0);
  if (due.getTime() >= today.getTime()) return due;

  var domNext = resolveDom_(stored, y, m + 1);
  due = new Date(y, m + 1, domNext);
  due.setHours(0, 0, 0, 0);
  return due;
}

/**
 * Given a stored day-of-month code (1-31 or 32) and a target year+month,
 * return the actual calendar day. Mirrors the in-app _resolveDom helper.
 */
function resolveDom_(stored, year, monthIdx) {
  if (!stored) return null;
  var dim = new Date(year, monthIdx + 1, 0).getDate();
  return stored >= DOM_LAST ? dim : Math.min(stored, dim);
}

function alreadySent_(sentLog, cardId, dueKey, daysOut) {
  for (var i = 0; i < sentLog.length; i++) {
    var s = sentLog[i];
    if (s.creditCardId === cardId && s.dueIso === dueKey && s.daysOut === daysOut) {
      return true;
    }
  }
  return false;
}

function formatYmd_(date, tz) {
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

function sendReminder_(n, due, diffDays, tz) {
  var dueStr  = Utilities.formatDate(due, tz, 'EEEE, MMMM d');
  var when    = diffDays === 0 ? 'today'
              : diffDays === 1 ? 'tomorrow'
              : 'in ' + diffDays + ' days';
  var subject = 'FinApp: ' + n.cardName + ' payment due ' + when + ' (' + dueStr + ')';
  var body    = 'Heads up — your ' + n.cardName + ' credit-card payment is due '
              + when + ', on ' + dueStr + '.\n\n'
              + 'This reminder was scheduled in FinApp.\n';
  GmailApp.sendEmail(n.recipientEmail, subject, body);
}

/**
 * Optional: run this from the editor once to verify the JSON parses
 * and to see which reminders WOULD have fired today (without sending).
 */
function dryRun() {
  var file = findNotifFile_();
  if (!file) { Logger.log('No notifications JSON found.'); return; }
  var data    = JSON.parse(file.getBlob().getDataAsString());
  var tz      = Session.getScriptTimeZone();
  var today   = new Date(); today.setHours(0, 0, 0, 0);
  var notifs  = (data.notifications || []).filter(function (n) { return n.isActive; });

  Logger.log('Today (' + tz + '): ' + formatYmd_(today, tz));
  Logger.log('Active notification configs: ' + notifs.length);

  for (var i = 0; i < notifs.length; i++) {
    var n   = notifs[i];
    var due = nextDueDate_(n.paymentDueDay, today);
    if (!due) { Logger.log('- ' + n.cardName + ': no valid paymentDueDay'); continue; }
    var diff = Math.round((due.getTime() - today.getTime()) / 86400000);
    var daysList = (n.daysInAdvance || []);
    var hit  = daysList.indexOf(diff) !== -1;
    Logger.log('- ' + n.cardName +
               ' | dueDay=' + n.paymentDueDay +
               ' (resolved ' + formatYmd_(due, tz) + ', ' + diff + ' days out)' +
               ' | daysInAdvance=' + JSON.stringify(daysList) +
               (hit ? ' | WOULD SEND' : ''));
  }
}
