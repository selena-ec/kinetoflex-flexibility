const STORAGE_KEY = "beginnerFlexibilityTracker.v1";
const CLOUD_CONFIG = window.FLEX_TRACKER_CONFIG || {};
const CLOUD_URL = (CLOUD_CONFIG.GOOGLE_APPS_SCRIPT_URL || "").trim();
const CLOUD_TOKEN = CLOUD_CONFIG.SYNC_TOKEN || "";
const CLOUD_ENABLED = Boolean(CLOUD_URL);
const SAVE_DEBOUNCE_MS = 700;

const cycle = [
  {
    label: "Week A",
    areas: ["Hip Mobility", "Front Split", "Middle Split"],
    skipped: "Pancake",
  },
  {
    label: "Week B",
    areas: ["Hip Mobility", "Front Split", "Pancake"],
    skipped: "Middle Split",
  },
  {
    label: "Week C",
    areas: ["Hip Mobility", "Middle Split", "Pancake"],
    skipped: "Front Split",
  },
  {
    label: "Week D",
    areas: ["Front Split", "Middle Split", "Pancake"],
    skipped: "Hip Mobility",
  },
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
  const confirmed = window.confirm("Reset all checkmarks, notes, and moved rest days?");
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, defaultState());
  state.updatedAt = new Date().toISOString();
  saveState();
  render();
});

function buildPlan() {
  return Array.from({ length: 12 }, (_, index) => {
    const cycleWeek = cycle[index % cycle.length];
    const weekNumber = index + 1;
    const days = [
      ...cycleWeek.areas.map((area) => sessionDay(area, 1)),
      { type: "rest" },
      ...cycleWeek.areas.map((area) => sessionDay(area, 2)),
    ];

    return {
      weekNumber,
      cycleLabel: cycleWeek.label,
      skipped: cycleWeek.skipped,
      areas: cycleWeek.areas,
      days,
    };
  });
}

function sessionDay(area, workoutNumber) {
  return {
    type: "workout",
    area,
    workoutNumber,
    title: `${area} Beginner - Workout ${workoutNumber}`,
  };
}

function defaultState() {
  return {
    completed: {},
    notes: {},
    restSlots: {},
    updatedAt: "",
  };
}

function loadState() {
  try {
    return { ...defaultState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
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
    const localTime = Date.parse(state.updatedAt || "0") || 0;
    const cloudTime = Date.parse(cloudState.updatedAt || response.updatedAt || "0") || 0;

    if (cloudTime > localTime || force) {
      isHydratingFromCloud = true;
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, cloudState, { updatedAt: cloudState.updatedAt || response.updatedAt || "" });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      isHydratingFromCloud = false;
      updateSyncStatus("Loaded progress from Google Sheets.");
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
  return {
    ...defaultState(),
    ...(value && typeof value === "object" ? value : {}),
  };
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
      if (day.type !== "workout") return;
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
    fragment.querySelector("[data-cycle]").textContent = `${week.cycleLabel} - skips ${week.skipped}`;
    fragment.querySelector("[data-title]").textContent = `Week ${week.weekNumber}`;
    fragment.querySelector("[data-areas]").textContent = week.areas.join(" + ");

    const restSlot = getRestSlot(week.weekNumber);
    const displayDays = moveRestDay(week.days, restSlot);

    displayDays.forEach((day, displayIndex) => {
      const originalIndex = day.originalIndex;
      daysEl.append(renderDay(week.weekNumber, displayIndex, originalIndex, day));
    });

    hydrateWeekNotes(fragment, week.weekNumber);
    updateWeekCount(fragment, week.weekNumber);
    weeksEl.append(fragment);
  });
}

function renderDay(weekNumber, displayIndex, originalIndex, day) {
  const id = itemId(weekNumber, originalIndex);
  const card = document.createElement("section");
  card.className = `day-card ${day.type === "rest" ? "rest" : ""}`;
  if (state.completed[id]) card.classList.add("complete");

  const top = document.createElement("div");
  top.className = "day-topline";
  top.innerHTML = `<span class="day-number">Day ${displayIndex + 1}</span>`;

  if (day.type === "rest") {
    top.append(renderRestPicker(weekNumber, displayIndex));
  }

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
  title.textContent = day.type === "rest" ? "Rest" : day.title;
  checkLabel.append(checkbox, title);

  const pill = document.createElement("span");
  pill.className = `area-pill ${day.type === "rest" ? "rest-pill" : areaClass[day.area]}`;
  pill.textContent = day.type === "rest" ? "Recovery day" : day.area;

  card.append(top, checkLabel, pill);

  if (day.type === "workout") {
    const meta = document.createElement("p");
    meta.className = "workout-meta";
    meta.textContent = `Beginner level.`;
    card.append(meta, renderSessionNote(id));
  }

  return card;
}

function renderRestPicker(weekNumber, displayIndex) {
  const picker = document.createElement("select");
  picker.className = "rest-picker";
  picker.setAttribute("aria-label", `Move rest day for week ${weekNumber}`);

  for (let index = 0; index < 7; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `Rest on Day ${index + 1}`;
    option.selected = index === displayIndex;
    picker.append(option);
  }

  picker.addEventListener("change", () => {
    state.restSlots[weekNumber] = Number(picker.value);
    saveState();
    render();
  });

  return picker;
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
    return day.type === "workout" && state.completed[itemId(weekNumber, index)];
  }).length;
  fragment.querySelector("[data-week-count]").textContent = `${completed}/6`;
}

function shouldShowWeek(week) {
  const filter = viewFilter.value;
  if (filter === "all") return true;
  if (filter === "current") return week.weekNumber === getCurrentWeekNumber();
  if (filter === "incomplete") {
    return week.days.some((day, index) => {
      return day.type === "workout" && !state.completed[itemId(week.weekNumber, index)];
    });
  }
  return true;
}

function getCurrentWeekNumber() {
  const firstIncomplete = plan.find((week) => {
    return week.days.some((day, index) => {
      return day.type === "workout" && !state.completed[itemId(week.weekNumber, index)];
    });
  });
  return firstIncomplete?.weekNumber || 12;
}

function getRestSlot(weekNumber) {
  return Number.isInteger(state.restSlots[weekNumber]) ? state.restSlots[weekNumber] : 3;
}

function moveRestDay(days, restSlot) {
  const annotated = days.map((day, index) => ({ ...day, originalIndex: index }));
  const restIndex = annotated.findIndex((day) => day.type === "rest");
  const [restDay] = annotated.splice(restIndex, 1);
  annotated.splice(restSlot, 0, restDay);
  return annotated;
}

function itemId(weekNumber, dayIndex) {
  return `week-${weekNumber}-day-${dayIndex}`;
}

function weekNoteId(weekNumber) {
  return `week-${weekNumber}-notes`;
}

function renderWeekJump() {
  plan.forEach((week) => {
    const option = document.createElement("option");
    option.value = String(week.weekNumber);
    option.textContent = `Week ${week.weekNumber} (${week.cycleLabel})`;
    weekJump.append(option);
  });
}
