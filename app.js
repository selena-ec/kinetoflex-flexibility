const STORAGE_KEY = "beginnerFlexibilityTracker.daily56.v1";
const LEGACY_STORAGE_KEYS = [
  "beginnerFlexibilityTracker.daily48.v1",
  "beginnerFlexibilityTracker.daily.v1",
];
const PLAN_DAYS = 56;
const CYCLE_LENGTH = 8;
const CLOUD_CONFIG = window.FLEX_TRACKER_CONFIG || {};
const CLOUD_URL = (CLOUD_CONFIG.GOOGLE_APPS_SCRIPT_URL || "").trim();
const CLOUD_TOKEN = CLOUD_CONFIG.SYNC_TOKEN || "";
const CLOUD_ENABLED = Boolean(CLOUD_URL);
const SAVE_DEBOUNCE_MS = 700;

const cycle = [
  sessionDay("Hip Mobility", 1),
  sessionDay("Front Split", 1),
  sessionDay("Middle Split", 1),
  sessionDay("Pancake", 1),
  sessionDay("Hip Mobility", 2),
  sessionDay("Front Split", 2),
  sessionDay("Middle Split", 2),
  sessionDay("Pancake", 2),
];

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
const weekJump = document.querySelector("#weekJump");
const viewFilter = document.querySelector("#viewFilter");
const resetProgress = document.querySelector("#resetProgress");
const syncStatus = document.querySelector("#syncStatus");
const syncNow = document.querySelector("#syncNow");
let saveTimer = null;
let isHydratingFromCloud = false;

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
  loadCloudState({ force: true });
});

resetProgress.addEventListener("click", () => {
  const confirmed = window.confirm("Reset all checkmarks and notes?");
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, defaultState());
  state.updatedAt = new Date().toISOString();
  saveState();
  render();
});

function buildPlan() {
  return Array.from({ length: PLAN_DAYS / CYCLE_LENGTH }, (_, index) => {
    const weekNumber = index + 1;
    const days = Array.from({ length: 8 }, (__, dayIndex) => {
      const planDayIndex = index * 8 + dayIndex;
      return cycle[planDayIndex % cycle.length];
    });

    return {
      weekNumber,
      cycleLabel: `Days ${index * 8 + 1}-${index * 8 + 8}`,
      areas: [...new Set(days.map((day) => day.area))],
      days,
    };
  });
}

function sessionDay(area, workoutNumber) {
  return {
    area,
    workoutNumber,
    title: `${area} Beginner - Workout ${workoutNumber}`,
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

    for (const legacyKey of LEGACY_STORAGE_KEYS) {
      const legacyState = localStorage.getItem(legacyKey);
      if (legacyState) return normalizeState(JSON.parse(legacyState));
    }

    return defaultState();
  } catch {
    return defaultState();
  }
}

function saveState() {
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
    const shouldPersistMigration = hasLegacyIds(response.state);
    const localTime = Date.parse(state.updatedAt || "0") || 0;
    const cloudTime = Date.parse(cloudState.updatedAt || response.updatedAt || "0") || 0;

    if (cloudTime > localTime || force) {
      isHydratingFromCloud = true;
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, cloudState, { updatedAt: cloudState.updatedAt || response.updatedAt || "" });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      isHydratingFromCloud = false;
      if (shouldPersistMigration) {
        state.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        saveCloudState();
        updateSyncStatus("Migrated progress from Google Sheets to the 56-day plan.");
      } else {
        updateSyncStatus("Loaded progress from Google Sheets.");
      }
    } else {
      updateSyncStatus("Local progress is current. Future changes will sync to Google Sheets.");
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

  appendHiddenField(form, "payload", JSON.stringify({ state, updatedAt: state.updatedAt }));
  if (CLOUD_TOKEN) appendHiddenField(form, "token", CLOUD_TOKEN);

  document.body.append(form);
  form.submit();
  form.remove();

  window.setTimeout(() => {
    updateSyncStatus(`Saved to Google Sheets at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  }, 800);
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

function hasLegacyIds(value) {
  const completedIds = Object.keys(value?.completed || {});
  const noteIds = Object.keys(value?.notes || {});
  return [...completedIds, ...noteIds].some((id) => {
    return id.startsWith("daily48-cycle-") || id.startsWith("daily-week-") || /^week-\d+-(day-\d+|notes)$/.test(id);
  });
}

function migrateItemId(id) {
  const currentMatch = id.match(/^daily56-cycle-(\d+)-day-(\d+)$/);
  if (currentMatch) {
    const cycleNumber = Number(currentMatch[1]);
    const dayIndex = Number(currentMatch[2]);
    return isValidCycleDay(cycleNumber, dayIndex) ? id : null;
  }

  const legacy48Match = id.match(/^daily48-cycle-(\d+)-day-(\d+)$/);
  if (legacy48Match) {
    const cycleNumber = Number(legacy48Match[1]);
    const dayIndex = Number(legacy48Match[2]);
    return isValidCycleDay(cycleNumber, dayIndex) ? itemId(cycleNumber, dayIndex) : null;
  }

  const legacyDailyMatch = id.match(/^daily-week-(\d+)-day-(\d+)$/);
  if (legacyDailyMatch) {
    return migrateGlobalDay(Number(legacyDailyMatch[1]), Number(legacyDailyMatch[2]), 7);
  }

  const legacyWeeklyMatch = id.match(/^week-(\d+)-day-(\d+)$/);
  if (legacyWeeklyMatch) {
    return migrateGlobalDay(Number(legacyWeeklyMatch[1]), Number(legacyWeeklyMatch[2]), 7);
  }

  return null;
}

function migrateNoteId(id) {
  const currentMatch = id.match(/^daily56-cycle-(\d+)-notes$/);
  if (currentMatch) {
    const cycleNumber = Number(currentMatch[1]);
    return cycleNumber >= 1 && cycleNumber <= PLAN_DAYS / CYCLE_LENGTH ? id : null;
  }

  const legacy48Match = id.match(/^daily48-cycle-(\d+)-notes$/);
  if (legacy48Match) {
    const cycleNumber = Number(legacy48Match[1]);
    return cycleNumber >= 1 && cycleNumber <= PLAN_DAYS / CYCLE_LENGTH ? weekNoteId(cycleNumber) : null;
  }

  const legacyMatch = id.match(/^week-(\d+)-notes$/);
  if (legacyMatch) {
    const zeroBasedDay = (Number(legacyMatch[1]) - 1) * 7;
    if (zeroBasedDay < 0 || zeroBasedDay >= PLAN_DAYS) return null;
    return weekNoteId(Math.floor(zeroBasedDay / CYCLE_LENGTH) + 1);
  }

  return null;
}

function migrateGlobalDay(groupNumber, dayIndex, daysPerGroup) {
  const zeroBasedDay = (groupNumber - 1) * daysPerGroup + dayIndex;
  if (zeroBasedDay < 0 || zeroBasedDay >= PLAN_DAYS) return null;

  const cycleNumber = Math.floor(zeroBasedDay / CYCLE_LENGTH) + 1;
  const cycleDayIndex = zeroBasedDay % CYCLE_LENGTH;
  return itemId(cycleNumber, cycleDayIndex);
}

function isValidCycleDay(cycleNumber, dayIndex) {
  return cycleNumber >= 1 && cycleNumber <= PLAN_DAYS / CYCLE_LENGTH && dayIndex >= 0 && dayIndex < CYCLE_LENGTH;
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
      planned[day.area] = (planned[day.area] || 0) + 1;
      const id = itemId(week.weekNumber, dayIndex);
      if (state.completed[id]) {
        completed[day.area] = (completed[day.area] || 0) + 1;
      }
    });
  });

  const totalCompleted = Object.values(completed).reduce((sum, count) => sum + count, 0);
  totalCompletedEl.textContent = totalCompleted;
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

    weekEl.dataset.week = String(week.weekNumber);
    fragment.querySelector("[data-cycle]").textContent = week.cycleLabel;
    fragment.querySelector("[data-title]").textContent = `Cycle ${week.weekNumber}`;
    fragment.querySelector("[data-areas]").textContent = week.areas.join(" + ");

    week.days.forEach((day, dayIndex) => {
      daysEl.append(renderDay(week.weekNumber, dayIndex, day));
    });

    hydrateWeekNotes(fragment, week.weekNumber);
    updateWeekCount(fragment, week.weekNumber);
    weeksEl.append(fragment);
  });
}

function renderDay(weekNumber, dayIndex, day) {
  const id = itemId(weekNumber, dayIndex);
  const card = document.createElement("section");
  card.className = "day-card";
  if (state.completed[id]) card.classList.add("complete");

  const top = document.createElement("div");
  top.className = "day-topline";
  top.innerHTML = `<span class="day-number">Day ${dayIndex + 1}</span>`;

  const checkLabel = document.createElement("label");
  checkLabel.className = "check-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(state.completed[id]);
  checkbox.addEventListener("change", () => {
    state.completed[id] = checkbox.checked;
    saveState();
    render();
  });

  const title = document.createElement("span");
  title.textContent = day.title;
  checkLabel.append(checkbox, title);

  const pill = document.createElement("span");
  pill.className = `area-pill ${areaClass[day.area]}`;
  pill.textContent = day.area;

  card.append(top, checkLabel, pill);

  const meta = document.createElement("p");
  meta.className = "workout-meta";
  meta.textContent = `Beginner level.`;
  card.append(meta, renderSessionNote(id));

  return card;
}

function renderSessionNote(id) {
  const wrapper = document.createElement("label");
  wrapper.className = "session-note";
  wrapper.innerHTML = "<span>Session note</span>";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Optional";
  input.value = state.notes[id]?.session || "";
  input.addEventListener("input", () => {
    state.notes[id] = { ...(state.notes[id] || {}), session: input.value };
    saveState();
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
      saveState();
    });
  });
}

function updateWeekCount(fragment, weekNumber) {
  const week = plan[weekNumber - 1];
  const completed = week.days.filter((day, index) => {
    return state.completed[itemId(weekNumber, index)];
  }).length;
  fragment.querySelector("[data-week-count]").textContent = `${completed}/8`;
}

function shouldShowWeek(week) {
  const filter = viewFilter.value;
  if (filter === "all") return true;
  if (filter === "current") return week.weekNumber === getCurrentWeekNumber();
  if (filter === "incomplete") {
    return week.days.some((day, index) => {
      return !state.completed[itemId(week.weekNumber, index)];
    });
  }
  return true;
}

function getCurrentWeekNumber() {
  const firstIncomplete = plan.find((week) => {
    return week.days.some((day, index) => {
      return !state.completed[itemId(week.weekNumber, index)];
    });
  });
  return firstIncomplete?.weekNumber || 6;
}

function itemId(weekNumber, dayIndex) {
  return `daily56-cycle-${weekNumber}-day-${dayIndex}`;
}

function weekNoteId(weekNumber) {
  return `daily56-cycle-${weekNumber}-notes`;
}

function renderWeekJump() {
  plan.forEach((week) => {
    const option = document.createElement("option");
    option.value = String(week.weekNumber);
    option.textContent = `Cycle ${week.weekNumber}`;
    weekJump.append(option);
  });
}
