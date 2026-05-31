# Google Sheets Backend Setup

This tracker can save progress to Google Sheets through a small Google Apps Script Web App.

## Product Stack

- GitHub Pages hosts the static tracker files.
- Google Apps Script Web App acts as the API.
- Google Sheets stores the tracker state in your Google account.
- Browser `localStorage` remains a local fallback.

When your phone and laptop both open the same hosted URL and use the same Apps Script endpoint, they load and save to the same Google Sheet.

## 1. Create the Google Sheet

1. Create a new Google Sheet.
2. Name it something like `Beginner Flexibility Tracker Data`.
3. In the Sheet, go to `Extensions` -> `Apps Script`.

## 2. Add the Apps Script

1. Delete any starter code in Apps Script.
2. Paste the contents of `google-apps-script.gs`.
3. Optional: set `TOKEN` to a private phrase.
4. Click `Save`.

## 3. Deploy as a Web App

1. Click `Deploy` -> `New deployment`.
2. Choose type: `Web app`.
3. Set `Execute as` to `Me`.
4. Set `Who has access` to `Anyone with the link`.
5. Click `Deploy`.
6. Copy the Web App URL. It should end with `/exec`.

## 4. Connect the Tracker

Open `config.js` and paste the Web App URL:

```js
window.FLEX_TRACKER_CONFIG = {
  GOOGLE_APPS_SCRIPT_URL: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
  SYNC_TOKEN: "",
};
```

If you set `TOKEN` in Apps Script, set the same value as `SYNC_TOKEN`.

## How Sync Works

- The page always saves to browser `localStorage`.
- If `GOOGLE_APPS_SCRIPT_URL` is configured, it also saves the same tracker state to Google Sheets.
- On load, the page compares local and cloud timestamps and uses the newest state.
- The Sheet stores the tracker state as JSON in the `TrackerState` tab.

## Important Notes

- Do not publish a real `SYNC_TOKEN` in a public GitHub repo.
- The token is a lightweight guard, not full user authentication.
- If you edit the Apps Script later, deploy a new version for changes to take effect.
