const SHEET_NAME = "TrackerState";
const TOKEN = ""; // Optional: set this to match SYNC_TOKEN in config.js.

function doGet(e) {
  if (!isAuthorized_(e)) {
    return jsonp_(e, { ok: false, error: "Unauthorized" });
  }

  const action = e.parameter.action || "load";
  if (action !== "load") {
    return jsonp_(e, { ok: false, error: "Unknown action" });
  }

  const sheet = getStateSheet_();
  const stateJson = sheet.getRange("B2").getValue();
  const updatedAt = sheet.getRange("B1").getValue();

  return jsonp_(e, {
    ok: true,
    state: safeParse_(stateJson),
    updatedAt: updatedAt || "",
  });
}

function doPost(e) {
  if (!isAuthorized_(e)) {
    return text_({ ok: false, error: "Unauthorized" });
  }

  const payload = safeParse_(e.parameter.payload || "{}");
  const sheet = getStateSheet_();
  sheet.getRange("A1:B2").setValues([
    ["updatedAt", payload.updatedAt || new Date().toISOString()],
    ["state", JSON.stringify(payload.state || {})],
  ]);

  return text_({ ok: true });
}

function getStateSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.getRange("A1:B2").setValues([
      ["updatedAt", ""],
      ["state", "{}"],
    ]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 2);
  }

  return sheet;
}

function isAuthorized_(e) {
  if (!TOKEN) return true;
  return e.parameter.token === TOKEN;
}

function jsonp_(e, data) {
  const callback = e.parameter.callback || "callback";
  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(data)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function text_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.TEXT);
}

function safeParse_(value) {
  try {
    return JSON.parse(value || "{}");
  } catch (error) {
    return {};
  }
}
