# Saved versions and how to roll back

Every version of FinApp that has ever been live is kept in GitHub's history.
On top of that, important releases get a **snapshot** with a readable name,
so you don't have to hunt through the history to find them.

## Saved snapshots

| Snapshot | What it is |
|---|---|
| `snapshot/2026-09-26` | Live version from 26 Sep 2026 (Sensitivity Analysis page added) |
| `snapshot/2026-11-21` | Live version from 21 Nov 2026, 9:48 PM CT ("Pending" checkbox). Last version before the Nov 2026 clean-up. |
| `snapshot/2026-11-22` | Live version from 22 Nov 2026 (clean-up + Reports with date shortcuts, charts and phone layout). Last version before the Ask box. |
| `snapshot/2026-11-22b` | Live version from 22 Nov 2026 with the Ask box. Last version before the scheduled posting time setting and local-time fixes. |

Before each new change goes live, a new snapshot of the current live version
is made first and added to this table.

## How to roll back the live app

The live site always serves whatever `index.html` is on the `main` branch, so
rolling back means putting an older `index.html` back on `main`.

**Easiest way (in the browser):**
1. On GitHub, open the repository and switch the branch dropdown to the snapshot
   you want, for example `snapshot/2026-11-21`.
2. Click `index.html`, then the **Download raw file** button.
3. Switch back to `main` and use **Add file → Upload files** to upload that
   `index.html`. Commit. The live site updates in about a minute.

**Or ask Claude:** "Roll FinApp back to snapshot 2026-11-21." Claude will open a
change that restores it for you to approve.

Rolling back the app never touches your data: your finances live in
`finance.sqlite` in your Google Drive, not in GitHub. Newer versions only ever
*add* columns or tables to that file, so older versions keep working with it.

## Important: GitHub is the master copy

Make changes through GitHub (or through Claude), not by re-uploading files from
an old local folder. Uploading an old local `index.html` will silently undo any
change made since that folder was last updated.
