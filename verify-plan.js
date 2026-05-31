const cycle = [
  ["Hip Mobility", "Front Split", "Middle Split"],
  ["Hip Mobility", "Front Split", "Pancake"],
  ["Hip Mobility", "Middle Split", "Pancake"],
  ["Front Split", "Middle Split", "Pancake"],
];

const counts = {
  "Hip Mobility": 0,
  "Front Split": 0,
  "Middle Split": 0,
  Pancake: 0,
};

let workoutSlots = 0;
let restSlots = 0;

for (let week = 0; week < 12; week += 1) {
  const areas = cycle[week % cycle.length];
  if (new Set(areas).size !== 3) {
    throw new Error(`Week ${week + 1} does not have 3 unique areas.`);
  }

  workoutSlots += areas.length * 2;
  restSlots += 1;

  for (const area of areas) {
    counts[area] += 2;
  }
}

const expectedCounts = Object.fromEntries(Object.keys(counts).map((area) => [area, 18]));

assertEqual(workoutSlots, 72, "workout slots");
assertEqual(restSlots, 12, "rest slots");
assertEqual(workoutSlots + restSlots, 84, "total slots");

for (const [area, expected] of Object.entries(expectedCounts)) {
  assertEqual(counts[area], expected, `${area} sessions`);
}

console.log("Plan verification passed:", {
  totalSlots: workoutSlots + restSlots,
  workoutSlots,
  restSlots,
  counts,
});

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
