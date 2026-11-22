# Locking down the Firebase sync-lock

FinApp uses a small Firebase Realtime Database only to stop two open copies of
the app from saving over each other. No financial data is stored there, but the
database rules are currently **open**: anyone who knows the URL can read the
lock records (your email address and device names), delete them, or send your
open session a "save and close" command.

The app code now signs in to Firebase with the same Google account you use for
FinApp. Once that is switched on, the rules below make each lock readable and
writable only by its owner.

## Step 1: Turn on Google sign-in in Firebase (2 minutes)

1. Open https://console.firebase.google.com and choose project `financeapp-494818`.
2. Go to **Build → Authentication → Sign-in method** and enable **Google**. Save.
3. In the same Google provider panel, open **Allowlist client IDs from external
   projects** and add the FinApp OAuth client ID:
   `847723444460-qpp08glqba87uokt56msa84neu4oej50.apps.googleusercontent.com`
   (only needed if that client lives in a different Google Cloud project; adding
   it is harmless either way).
4. Go to **Project settings → General** and copy the **Web API key**
   (starts with `AIza…`). This key is public by design; it is safe in the code.

## Step 2: Put the key in the app

Set `FIREBASE_WEB_API_KEY` near the top of `index.html` to that value, publish,
then open FinApp and check the browser console has no
`Firebase auth unavailable` warning. While the key is blank the app keeps
working exactly as before (open mode).

## Step 3: Publish the locked-down rules

Only after step 2 is live and working, go to **Build → Realtime Database →
Rules**, replace everything with the following, and click **Publish**:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "locks": {
      "$key": {
        ".read":  "auth != null && auth.token.email_verified == true && $key == auth.token.email.replace('.', '_').replace('@', '_')",
        ".write": "auth != null && auth.token.email_verified == true && $key == auth.token.email.replace('.', '_').replace('@', '_')"
      }
    },
    "commands": {
      "$key": {
        ".read":  "auth != null && auth.token.email_verified == true && $key == auth.token.email.replace('.', '_').replace('@', '_')",
        ".write": "auth != null && auth.token.email_verified == true && $key == auth.token.email.replace('.', '_').replace('@', '_')"
      }
    }
  }
}
```

`$key` matches how the app names each lock (`emailToKey()` in `index.html`
turns `.` and `@` into `_`).

## If something goes wrong

The lock is non-essential: if Firebase refuses a request the app shows no
error and carries on, you just lose the "already open on another device"
warning. To undo, paste the old open rules back
(`{"rules": {".read": true, ".write": true}}`) and publish.
