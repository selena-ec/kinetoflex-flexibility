const weeklyTemplate = [
  [
    ["Hip Mobility", 1],
    ["Front Split", 1],
  ],
  [],
  [
    ["Middle Split", 1],
    ["Pancake", 1],
  ],
  [],
  [
    ["Hip Mobility", 2],
    ["Front Split", 2],
  ],
  [],
  [
    ["Middle Split", 2],
    ["Pancake", 2],
  ],
];

const counts = {
  "Hip Mobility": 0,
  "Front Split": 0,
  "Middle Split": 0,
  Pancake: 0,
};

const workoutCounts = {
  "Hip Mobility": { 1: 0, 2: 0 },
  "Front Split": { 1: 0, 2: 0 },
  "Middle Split": { 1: 0, 2: 0 },
  Pancake: { 1: 0, 2: 0 },
};

let workoutSlots = 0;
let openDays = 0;

for (let week = 0; week < 8; week += 1) {
  weeklyTemplate.forEach((day) => {
    if (!day.length) openDays += 1;

    day.forEach(([area, workoutNumber]) => {
      workoutSlots += 1;
      counts[area] += 1;
      workoutCounts[area][workoutNumber] += 1;
    });
  });
}

assertEqual(workoutSlots, 64, "workout slots");
assertEqual(openDays, 24, "open days");

for (const area of Object.keys(counts)) {
  assertEqual(counts[area], 16, `${area} sessions`);
}

for (const area of Object.keys(workoutCounts)) {
  assertEqual(workoutCounts[area][1], 8, `${area} workout 1 sessions`);
  assertEqual(workoutCounts[area][2], 8, `${area} workout 2 sessions`);
}

console.log("Plan verification passed:", {
  weeks: 8,
  workoutSlots,
  openDays,
  counts,
  workoutCounts,
});

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
