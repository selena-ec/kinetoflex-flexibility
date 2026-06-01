const LEGACY_SHEET_NAME = "TrackerState";
const WORKOUT_SHEET_NAME = "WorkoutProgress";
const CYCLE_NOTES_SHEET_NAME = "CycleNotes";
const TOKEN = ""; // Optional: set this to match SYNC_TOKEN in config.js.

const WORKOUT_HEADERS = [
  "id",
  "planVersion",
  "cycle",
  "day",
  "title",
  "area",
  "workoutNumber",
  "completed",
  "sessionNote",
  "updatedAt",
];

const CYCLE_NOTE_HEADERS = [
  "id",
  "planVersion",
  "cycle",
  "energy",
  "soreness",
  "best",
  "restricted",
  "range",
  "updatedAt",
];

function doGet(e) {
  if (!isAuthorized_(e)) {
    return jsonp_(e, { ok: false, error: "Unauthorized" });
  }

  const action = e.parameter.action || "load";
  if (action !== "load") {
    return jsonp_(e, { ok: false, error: "Unknown action" });
  }

  const workoutSheet = getSheet_(WORKOUT_SHEET_NAME, WORKOUT_HEADERS);
  const cycleNotesSheet = getSheet_(CYCLE_NOTES_SHEET_NAME, CYCLE_NOTE_HEADERS);
  const rowState = rowsToState_(workoutSheet, cycleNotesSheet);

  if (rowState.hasRecords) {
    return jsonp_(e, {
      ok: true,
      storageMode: "rows",
      state: rowState.state,
      updatedAt: rowState.updatedAt,
    });
  }

  const legacy = getLegacyState_();
  return jsonp_(e, {
    ok: true,
    storageMode: "legacy",
    state: legacy.state,
    updatedAt: legacy.updatedAt,
  });
}

function doPost(e) {
  if (!isAuthorized_(e)) {
    return text_({ ok: false, error: "Unauthorized" });
  }

  const payload = safeParse_(e.parameter.payload || "{}");
  const workoutSheet = getSheet_(WORKOUT_SHEET_NAME, WORKOUT_HEADERS);
  const cycleNotesSheet = getSheet_(CYCLE_NOTES_SHEET_NAME, CYCLE_NOTE_HEADERS);

  if (payload.records) {
    upsertWorkouts_(workoutSheet, payload.records.workouts || []);
    upsertCycleNotes_(cycleNotesSheet, payload.records.cycleNotes || []);
  } else {
    const records = stateToRecords_(payload.state || {}, payload.updatedAt || new Date().toISOString());
    upsertWorkouts_(workoutSheet, records.workouts);
    upsertCycleNotes_(cycleNotesSheet, records.cycleNotes);
  }

  return text_({ ok: true, storageMode: "rows" });
}

function rowsToState_(workoutSheet, cycleNotesSheet) {
  const state = {
    completed: {},
    notes: {},
    updatedAt: "",
  };
  let hasRecords = false;

  readRows_(workoutSheet).forEach((row) => {
    const id = row[0];
    if (!id) return;
    hasRecords = true;
    const completed = row[7] === true || String(row[7]).toUpperCase() === "TRUE";
    const sessionNote = row[8] || "";
    const updatedAt = row[9] || "";

    state.completed[id] = completed;
    if (sessionNote) state.notes[id] = { session: sessionNote };
    state.updatedAt = newest_(state.updatedAt, updatedAt);
  });

  readRows_(cycleNotesSheet).forEach((row) => {
    const id = row[0];
    if (!id) return;
    hasRecords = true;
    const note = {
      energy: row[3] || "",
      soreness: row[4] || "",
      best: row[5] || "",
      restricted: row[6] || "",
      range: row[7] || "",
    };
    const updatedAt = row[8] || "";

    if (Object.values(note).some(Boolean)) state.notes[id] = note;
    state.updatedAt = newest_(state.updatedAt, updatedAt);
  });

  return { state, updatedAt: state.updatedAt, hasRecords };
}

function stateToRecords_(state, updatedAt) {
  const workouts = Object.keys(state.completed || {}).map((id) => ({
    id,
    planVersion: "",
    cycle: "",
    day: "",
    title: "",
    area: "",
    workoutNumber: "",
    completed: Boolean(state.completed[id]),
    sessionNote: state.notes?.[id]?.session || "",
    updatedAt,
  }));

  const cycleNotes = Object.keys(state.notes || {})
    .filter((id) => !state.notes[id]?.session)
    .map((id) => ({
      id,
      planVersion: "",
      cycle: "",
      energy: state.notes[id]?.energy || "",
      soreness: state.notes[id]?.soreness || "",
      best: state.notes[id]?.best || "",
      restricted: state.notes[id]?.restricted || "",
      range: state.notes[id]?.range || "",
      updatedAt,
    }));

  return { workouts, cycleNotes };
}

function upsertWorkouts_(sheet, records) {
  const rowById = getRowById_(sheet);
  records.forEach((record) => {
    if (!record.id) return;
    const values = [
      record.id,
      record.planVersion || "",
      record.cycle || "",
      record.day || "",
      record.title || "",
      record.area || "",
      record.workoutNumber || "",
      Boolean(record.completed),
      record.sessionNote || "",
      record.updatedAt || new Date().toISOString(),
    ];
    upsertRow_(sheet, rowById, record.id, values);
  });
}

function upsertCycleNotes_(sheet, records) {
  const rowById = getRowById_(sheet);
  records.forEach((record) => {
    if (!record.id) return;
    const values = [
      record.id,
      record.planVersion || "",
      record.cycle || "",
      record.energy || "",
      record.soreness || "",
      record.best || "",
      record.restricted || "",
      record.range || "",
      record.updatedAt || new Date().toISOString(),
    ];
    upsertRow_(sheet, rowById, record.id, values);
  });
}

function upsertRow_(sheet, rowById, id, values) {
  const rowNumber = rowById[id];
  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
    rowById[id] = sheet.getLastRow();
  }
}

function getRowById_(sheet) {
  const rows = readRows_(sheet);
  const rowById = {};
  rows.forEach((row, index) => {
    if (row[0]) rowById[row[0]] = index + 2;
  });
  return rowById;
}

function readRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
}

function getSheet_(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  ensureHeaders_(sheet, headers);
  return sheet;
}

function ensureHeaders_(sheet, headers) {
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some((header, index) => current[index] !== header);
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  }
}

function getLegacyState_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(LEGACY_SHEET_NAME);
  if (!sheet) return { state: {}, updatedAt: "" };

  const stateJson = sheet.getRange("B2").getValue();
  const updatedAt = sheet.getRange("B1").getValue();
  return {
    state: safeParse_(stateJson),
    updatedAt: updatedAt || "",
  };
}

function newest_(left, right) {
  const leftTime = Date.parse(left || "0") || 0;
  const rightTime = Date.parse(right || "0") || 0;
  return rightTime > leftTime ? right : left;
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
