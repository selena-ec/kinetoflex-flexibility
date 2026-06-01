const cycle = [
  ["Hip Mobility", 1],
  ["Front Split", 1],
  ["Middle Split", 1],
  ["Pancake", 1],
  ["Hip Mobility", 2],
  ["Front Split", 2],
  ["Middle Split", 2],
  ["Pancake", 2],
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

const cycleCoverage = new Set(cycle.map(([area]) => area));
assertEqual(cycle.length, 8, "cycle length");
assertEqual(cycleCoverage.size, 4, "areas per cycle");

for (let day = 0; day < 56; day += 1) {
  const [area, workoutNumber] = cycle[day % cycle.length];
  counts[area] += 1;
  workoutCounts[area][workoutNumber] += 1;
}

for (const area of Object.keys(counts)) {
  assertEqual(counts[area], 14, `${area} sessions`);
}

for (const area of Object.keys(workoutCounts)) {
  assertEqual(workoutCounts[area][1], 7, `${area} workout 1 sessions`);
  assertEqual(workoutCounts[area][2], 7, `${area} workout 2 sessions`);
}

assertEqual(Object.values(counts).reduce((sum, count) => sum + count, 0), 56, "workout slots");

console.log("Plan verification passed:", {
  totalSlots: 56,
  workoutSlots: 56,
  restSlots: 0,
  counts,
  workoutCounts,
});

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
