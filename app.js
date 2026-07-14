const PLAN_LEVEL = "Intermediate";
const PLAN_VERSION = "intermediate-4week-daily-v1";
const STORAGE_KEY = "intermediateFlexibilityTracker.weekly4.v1";
const PLAN_WEEKS = 4;
const CLOUD_CONFIG = window.FLEX_TRACKER_CONFIG || {};
const CLOUD_URL = (CLOUD_CONFIG.GOOGLE_APPS_SCRIPT_URL || "").trim();
const CLOUD_TOKEN = CLOUD_CONFIG.SYNC_TOKEN || "";
const CLOUD_ENABLED = Boolean(CLOUD_URL);
const SAVE_DEBOUNCE_MS = 700;

const weeklyTemplate = [
  dayPlan("Mon", [sessionDay("Hip Mobility", 1)]),
  dayPlan("Tue", [sessionDay("Front Split", 1)]),
  dayPlan("Wed", [sessionDay("Middle Split", 1)]),
  dayPlan("Thu", [sessionDay("Pancake", 1)]),
  dayPlan("Fri", [sessionDay("Hip Mobility", 2), sessionDay("Front Split", 2)]),
  dayPlan("Sat", [sessionDay("Middle Split", 2)]),
  dayPlan("Sun", [sessionDay("Pancake", 2)]),
];

const WORKOUTS_PER_WEEK = weeklyTemplate.reduce((total, day) => total + day.workouts.length, 0);

const areaClass = {
  "Hip Mobility": "hip",
  "Front Split": "front",
  "Middle Split": "middle",
  Pancake: "pancake",
};

const state = loadState();
const plan = buildPlan();

const weeksEl = document.querySelector("#weeks");
const weekTemplate = document.querySelector("#weekTemplate");
const progressGrid = document.querySelector("#progressGrid");
const totalCompletedEl = document.querySelector("#totalCompleted");
const totalPlannedEl = document.querySelector("#totalPlanned");
const weekJump = document.querySelector("#weekJump");
const viewFilter = document.querySelector("#viewFilter");
const resetProgress = document.querySelector("#resetProgress");
const syncStatus = document.querySelector("#syncStatus");
const syncNow = document.querySelector("#syncNow");
let saveTimer = null;
let isHydratingFromCloud = false;
let dirtyWorkoutIds = new Set();
let dirtyWeekNoteIds = new Set();
let needsFullCloudSave = false;

renderWeekJump();
render();
loadCloudState();
updateSyncStatus(CLOUD_ENABLED ? "Cloud sync configured. Loading Google Sheets data..." : "Local-only mode. Add your Google Apps Script URL in config.js to sync with Google Sheets.");

weekJump.addEventListener("change", () => {
  const target = document.querySelector(`[data-week="${weekJump.value}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
});

viewFilter.addEventListener("change", render);

syncNow.addEventListener("click", () => {
  window.clearTimeout(saveTimer);
  loadCloudState({ force: true });
});

resetProgress.addEventListener("click", () => {
  const confirmed = window.confirm("Reset all checkmarks and notes?");
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, defaultState());
  state.updatedAt = new Date().toISOString();
  needsFullCloudSave = true;
  dirtyWorkoutIds = new Set(getAllWorkoutIds());
  dirtyWeekNoteIds = new Set(plan.map((week) => weekNoteId(week.weekNumber)));
  saveState();
  render();
});

function buildPlan() {
  return Array.from({ length: PLAN_WEEKS }, (_, index) => {
    const weekNumber = index + 1;
    const days = weeklyTemplate.map((day) => ({
      dayName: day.dayName,
      workouts: day.workouts.map((workout) => ({ ...workout })),
    }));

    return {
      weekNumber,
      weekLabel: "Mon-Sun",
      summary: "Daily workouts; Friday has two",
      days,
    };
  });
}

function dayPlan(dayName, workouts) {
  return { dayName, workouts };
}

function sessionDay(area, workoutNumber) {
  return {
    area,
    workoutNumber,
    title: `${area} ${PLAN_LEVEL} - Workout ${workoutNumber}`,
  };
}

function defaultState() {
  return {
    completed: {},
    notes: {},
    updatedAt: "",
  };
}

function loadState() {
  try {
    const savedState = localStorage.getItem(STORAGE_KEY);
    if (savedState) return normalizeState(JSON.parse(savedState));

    return defaultState();
  } catch {
    return defaultState();
  }
}

function saveState({ workoutId = "", weekNotesId = "" } = {}) {
  if (workoutId) dirtyWorkoutIds.add(workoutId);
  if (weekNotesId) dirtyWeekNoteIds.add(weekNotesId);
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleCloudSave();
}

function scheduleCloudSave() {
  if (!CLOUD_ENABLED || isHydratingFromCloud) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveCloudState, SAVE_DEBOUNCE_MS);
}

function loadCloudState({ force = false } = {}) {
  if (!CLOUD_ENABLED) {
    syncNow.disabled = true;
    return;
  }

  updateSyncStatus(force ? "Refreshing from Google Sheets..." : "Loading from Google Sheets...");
  syncNow.disabled = true;

  const callbackName = `flexTrackerCloudLoad_${Date.now()}`;
  const script = document.createElement("script");
  const url = new URL(CLOUD_URL);
  url.searchParams.set("action", "load");
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("_", String(Date.now()));
  if (CLOUD_TOKEN) url.searchParams.set("token", CLOUD_TOKEN);

  const cleanup = () => {
    delete window[callbackName];
    script.remove();
    syncNow.disabled = false;
  };

  window[callbackName] = (response) => {
    cleanup();
    if (!response?.ok) {
      updateSyncStatus(`Google Sheets sync failed: ${response?.error || "unknown error"}`);
      return;
    }

    const cloudState = normalizeState(response.state);
    const localTime = Date.parse(state.updatedAt || "0") || 0;
    const cloudTime = Date.parse(cloudState.updatedAt || response.updatedAt || "0") || 0;

    if (cloudTime > localTime) {
      isHydratingFromCloud = true;
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, cloudState, { updatedAt: cloudState.updatedAt || response.updatedAt || "" });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      isHydratingFromCloud = false;
      updateSyncStatus("Loaded progress from Google Sheets.");
    } else {
      updateSyncStatus(force ? "Local progress is newer. Saving it to Google Sheets..." : "Local progress is current. Future changes will sync to Google Sheets.");
      needsFullCloudSave = true;
      saveCloudState();
    }
  };

  script.onerror = () => {
    cleanup();
    updateSyncStatus("Could not load from Google Sheets. Local progress is still available.");
  };

  script.src = url.toString();
  document.body.append(script);
}

function saveCloudState() {
  if (!CLOUD_ENABLED) return;
  updateSyncStatus("Saving to Google Sheets...");

  const iframeName = "flexTrackerCloudSaveFrame";
  let iframe = document.querySelector(`iframe[name="${iframeName}"]`);
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.hidden = true;
    document.body.append(iframe);
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = CLOUD_URL;
  form.target = iframeName;
  form.hidden = true;

  appendHiddenField(form, "payload", JSON.stringify(buildCloudPayload()));
  if (CLOUD_TOKEN) appendHiddenField(form, "token", CLOUD_TOKEN);

  document.body.append(form);
  form.submit();
  form.remove();

  window.setTimeout(() => {
    updateSyncStatus(`Saved to Google Sheets at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  }, 800);
}

function buildCloudPayload() {
  const full = needsFullCloudSave || (!dirtyWorkoutIds.size && !dirtyWeekNoteIds.size);
  const workoutIds = full ? getAllWorkoutIds() : [...dirtyWorkoutIds];
  const weekNoteIds = full ? getAllWeekNoteIds() : [...dirtyWeekNoteIds];
  const payload = {
    planVersion: PLAN_VERSION,
    updatedAt: state.updatedAt,
    records: {
      workouts: workoutIds.map((id) => workoutRecord(id)),
      cycleNotes: weekNoteIds.map((id) => weekNoteRecord(id)),
    },
  };

  dirtyWorkoutIds.clear();
  dirtyWeekNoteIds.clear();
  needsFullCloudSave = false;
  return payload;
}

function getAllWorkoutIds() {
  return plan.flatMap((week) => {
    return week.days.flatMap((day, dayIndex) => {
      return day.workouts.map((workout, workoutIndex) => itemId(week.weekNumber, dayIndex, workoutIndex));
    });
  });
}

function getAllWeekNoteIds() {
  return plan.map((week) => weekNoteId(week.weekNumber));
}

function workoutRecord(id) {
  const day = dayFromItemId(id);
  return {
    id,
    planVersion: PLAN_VERSION,
    cycle: day?.weekNumber || "",
    day: day?.dayName || "",
    title: day?.workout.title || "",
    area: day?.workout.area || "",
    workoutNumber: day?.workout.workoutNumber || "",
    completed: Boolean(state.completed[id]),
    sessionNote: state.notes[id]?.session || "",
    updatedAt: state.updatedAt,
  };
}

function weekNoteRecord(id) {
  const weekNumber = Number(id.match(/^intermediate4-week-(\d+)-notes$/)?.[1] || "");
  const notes = state.notes[id] || {};
  return {
    id,
    planVersion: PLAN_VERSION,
    cycle: weekNumber || "",
    energy: notes.energy || "",
    soreness: notes.soreness || "",
    best: notes.best || "",
    restricted: notes.restricted || "",
    range: notes.range || "",
    updatedAt: state.updatedAt,
  };
}

function dayFromItemId(id) {
  const match = id.match(/^intermediate4-week-(\d+)-day-(\d+)-workout-(\d+)$/);
  if (!match) return null;
  const weekNumber = Number(match[1]);
  const dayIndex = Number(match[2]);
  const workoutIndex = Number(match[3]);
  const week = plan[weekNumber - 1];
  const day = week?.days[dayIndex];
  const workout = day?.workouts[workoutIndex];
  if (!workout) return null;
  return { weekNumber, dayName: day.dayName, dayIndex, workoutIndex, workout };
}

function appendHiddenField(form, name, value) {
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  form.append(input);
}

function normalizeState(value) {
  const normalized = {
    ...defaultState(),
    ...(value && typeof value === "object" ? value : {}),
  };
  return migrateState(normalized);
}

function migrateState(value) {
  const migrated = {
    ...defaultState(),
    ...value,
    completed: {},
    notes: {},
  };

  Object.entries(value.completed || {}).forEach(([id, checked]) => {
    const migratedId = migrateItemId(id);
    if (migratedId) migrated.completed[migratedId] = checked;
  });

  Object.entries(value.notes || {}).forEach(([id, note]) => {
    const migratedId = migrateNoteId(id);
    if (migratedId) migrated.notes[migratedId] = note;
  });

  return migrated;
}

function migrateItemId(id) {
  const currentMatch = id.match(/^intermediate4-week-(\d+)-day-(\d+)-workout-(\d+)$/);
  if (currentMatch) {
    const weekNumber = Number(currentMatch[1]);
    const dayIndex = Number(currentMatch[2]);
    const workoutIndex = Number(currentMatch[3]);
    return isValidWorkoutSlot(weekNumber, dayIndex, workoutIndex) ? id : null;
  }

  return null;
}

function migrateNoteId(id) {
  const currentMatch = id.match(/^intermediate4-week-(\d+)-notes$/);
  if (currentMatch) {
    const weekNumber = Number(currentMatch[1]);
    return weekNumber >= 1 && weekNumber <= PLAN_WEEKS ? id : null;
  }

  return null;
}

function isValidWorkoutSlot(weekNumber, dayIndex, workoutIndex) {
  return Boolean(plan[weekNumber - 1]?.days[dayIndex]?.workouts[workoutIndex]);
}

function updateSyncStatus(message) {
  syncStatus.textContent = message;
}

function render() {
  renderProgress();
  renderWeeks();
}

function renderProgress() {
  const planned = {};
  const completed = {};

  plan.forEach((week) => {
    week.days.forEach((day, dayIndex) => {
      day.workouts.forEach((workout, workoutIndex) => {
        planned[workout.area] = (planned[workout.area] || 0) + 1;
        const id = itemId(week.weekNumber, dayIndex, workoutIndex);
        if (state.completed[id]) {
          completed[workout.area] = (completed[workout.area] || 0) + 1;
        }
      });
    });
  });

  const totalCompleted = Object.values(completed).reduce((sum, count) => sum + count, 0);
  const totalPlanned = Object.values(planned).reduce((sum, count) => sum + count, 0);
  totalCompletedEl.textContent = totalCompleted;
  totalPlannedEl.textContent = totalPlanned;
  progressGrid.innerHTML = "";

  Object.keys(areaClass).forEach((area) => {
    const done = completed[area] || 0;
    const total = planned[area] || 0;
    const percent = total ? Math.round((done / total) * 100) : 0;
    const card = document.createElement("div");
    card.className = "area-progress";
    card.innerHTML = `
      <div class="area-title-row">
        <strong>${area}</strong>
        <span>${done}/${total}</span>
      </div>
      <div class="meter" aria-label="${area} progress">
        <div class="meter-fill ${areaClass[area]}" style="width: ${percent}%"></div>
      </div>
    `;
    progressGrid.append(card);
  });
}

function renderWeeks() {
  weeksEl.innerHTML = "";

  plan.forEach((week) => {
    if (!shouldShowWeek(week)) return;

    const fragment = weekTemplate.content.cloneNode(true);
    const weekEl = fragment.querySelector("[data-week]");
    const daysEl = fragment.querySelector("[data-days]");
    const workoutPanel = fragment.querySelector("[data-workout-panel]");
    const workoutSummary = fragment.querySelector("[data-workout-summary]");
    const completed = completedCount(week.weekNumber);

    weekEl.dataset.week = String(week.weekNumber);
    fragment.querySelector("[data-week-label]").textContent = week.weekLabel;
    fragment.querySelector("[data-title]").textContent = `Week ${week.weekNumber}`;
    fragment.querySelector("[data-areas]").textContent = week.summary;
    workoutSummary.textContent = completed === WORKOUTS_PER_WEEK ? "Week workouts complete" : "Weekly workouts";
    workoutPanel.open = completed !== WORKOUTS_PER_WEEK;

    week.days.forEach((day, dayIndex) => {
      day.workouts.forEach((workout, workoutIndex) => {
        daysEl.append(renderWorkoutCard(week.weekNumber, dayIndex, workoutIndex, day, workout));
      });
    });

    hydrateWeekNotes(fragment, week.weekNumber);
    updateWeekCount(fragment, week.weekNumber);
    weeksEl.append(fragment);
  });
}

function renderWorkoutCard(weekNumber, dayIndex, workoutIndex, day, workout) {
  const id = itemId(weekNumber, dayIndex, workoutIndex);
  const card = document.createElement("section");
  card.className = "day-card";
  if (state.completed[id]) card.classList.add("complete");

  const top = document.createElement("div");
  top.className = "day-topline";
  top.innerHTML = `<span class="day-number">${day.dayName}</span>`;

  card.append(top, renderWorkout(weekNumber, dayIndex, workoutIndex, workout));
  return card;
}

function renderWorkout(weekNumber, dayIndex, workoutIndex, workout) {
  const id = itemId(weekNumber, dayIndex, workoutIndex);
  const block = document.createElement("div");
  block.className = "workout-block";

  const checkLabel = document.createElement("label");
  checkLabel.className = "check-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(state.completed[id]);
  checkbox.addEventListener("change", () => {
    state.completed[id] = checkbox.checked;
    saveState({ workoutId: id });
    render();
  });

  const title = document.createElement("span");
  title.textContent = workout.title;
  checkLabel.append(checkbox, title);

  const pill = document.createElement("span");
  pill.className = `area-pill ${areaClass[workout.area]}`;
  pill.textContent = workout.area;

  const meta = document.createElement("p");
  meta.className = "workout-meta";
  meta.textContent = `${PLAN_LEVEL} level.`;

  block.append(checkLabel, pill, meta, renderSessionNote(id));
  return block;
}

function renderSessionNote(id) {
  const wrapper = document.createElement("label");
  wrapper.className = "session-note";
  wrapper.innerHTML = "<span>Session note</span>";

  const input = document.createElement("textarea");
  input.placeholder = "Optional";
  input.value = state.notes[id]?.session || "";
  input.addEventListener("input", () => {
    state.notes[id] = { ...(state.notes[id] || {}), session: input.value };
    saveState({ workoutId: id });
  });

  wrapper.append(input);
  return wrapper;
}

function hydrateWeekNotes(fragment, weekNumber) {
  fragment.querySelectorAll("[data-note]").forEach((field) => {
    const key = field.dataset.note;
    const id = weekNoteId(weekNumber);
    field.value = state.notes[id]?.[key] || "";
    field.addEventListener("input", () => {
      state.notes[id] = { ...(state.notes[id] || {}), [key]: field.value };
      saveState({ weekNotesId: id });
    });
  });
}

function updateWeekCount(fragment, weekNumber) {
  fragment.querySelector("[data-week-count]").textContent = `${completedCount(weekNumber)}/${WORKOUTS_PER_WEEK}`;
}

function completedCount(weekNumber) {
  const week = plan[weekNumber - 1];
  return week.days.reduce((total, day, dayIndex) => {
    const completed = day.workouts.filter((workout, workoutIndex) => {
      return state.completed[itemId(weekNumber, dayIndex, workoutIndex)];
    }).length;
    return total + completed;
  }, 0);
}

function shouldShowWeek(week) {
  const filter = viewFilter.value;
  if (filter === "all") return true;
  if (filter === "current") return week.weekNumber === getCurrentWeekNumber();
  if (filter === "incomplete") {
    return week.days.some((day, dayIndex) => {
      return day.workouts.some((workout, workoutIndex) => {
        return !state.completed[itemId(week.weekNumber, dayIndex, workoutIndex)];
      });
    });
  }
  return true;
}

function getCurrentWeekNumber() {
  const firstIncomplete = plan.find((week) => {
    return week.days.some((day, dayIndex) => {
      return day.workouts.some((workout, workoutIndex) => {
        return !state.completed[itemId(week.weekNumber, dayIndex, workoutIndex)];
      });
    });
  });
  return firstIncomplete?.weekNumber || PLAN_WEEKS;
}

function itemId(weekNumber, dayIndex, workoutIndex) {
  return `intermediate4-week-${weekNumber}-day-${dayIndex}-workout-${workoutIndex}`;
}

function weekNoteId(weekNumber) {
  return `intermediate4-week-${weekNumber}-notes`;
}

function renderWeekJump() {
  plan.forEach((week) => {
    const option = document.createElement("option");
    option.value = String(week.weekNumber);
    option.textContent = `Week ${week.weekNumber}`;
    weekJump.append(option);
  });
}
