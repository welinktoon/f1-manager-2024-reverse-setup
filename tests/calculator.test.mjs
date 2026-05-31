import assert from "node:assert/strict";

const metrics = ["over", "brake", "corner", "traction", "straight"];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, decimals = 3) => Number(value.toFixed(decimals));

function setupIndexes(values) {
  return {
    A: Math.round(values.front / 0.5),
    B: Math.round((values.rear - 9) / 0.5),
    C: Math.round(9 - values.roll),
    D: Math.round((-2.7 - values.camber) / 0.05),
    E: Math.round(values.toe / 0.05)
  };
}

function predictBias(values) {
  const { A, B, C, D, E } = setupIndexes(values);
  return {
    over: clamp(0.5 + A * 2 / 100 + B * (-1 / 35) + C * (-1 / 80) + D * 1 / 160, 0, 1),
    brake: clamp(0.45 + A * (-1 / 100) + B * 1 / 70 + C * 3 / 160 + D * (-1 / 64) + E * 1 / 100, 0, 1),
    corner: clamp(0.2 + A * 3 / 200 + B * 1 / 56 + C * (-3 / 160) + D * 1 / 64 + E * (-1 / 400), 0, 1),
    traction: clamp(0.25 + A * (-3 / 400) + B * 1 / 56 + C * 1 / 16 + D * (-1 / 160), 0, 1),
    straight: clamp(1 + A * (-1 / 200) + B * (-9 / 140), 0, 1)
  };
}

function score(values, target) {
  const bias = predictBias(values);
  let centerSquareError = 0;
  let centerAbsError = 0;
  let outsideAbsError = 0;
  let maxError = 0;
  let outsideMax = 0;
  let hits = 0;
  for (const m of metrics) {
    const center = Math.abs(bias[m] - target[m].center);
    const outside = bias[m] < target[m].min
      ? target[m].min - bias[m]
      : bias[m] > target[m].max
        ? bias[m] - target[m].max
        : 0;
    centerSquareError += Math.pow(center, 2);
    centerAbsError += center;
    outsideAbsError += outside;
    maxError = Math.max(maxError, center);
    outsideMax = Math.max(outsideMax, outside);
    if (outside === 0) hits += 1;
  }
  const avgError = centerAbsError / metrics.length;
  const outsideAvg = outsideAbsError / metrics.length;
  const rmsError = Math.sqrt(centerSquareError / metrics.length);
  return {
    score: outsideMax * 3000 + outsideAvg * 900 + (metrics.length - hits) * 55 + maxError * 100 + avgError * 50 + rmsError * 30,
    avgError,
    maxError,
    outsideAvg,
    outsideMax,
    hits,
    bias
  };
}

function oldScore(values, target) {
  const bias = predictBias(values);
  return metrics.reduce((sum, m) => sum + Math.pow(Math.abs(bias[m] - target[m].center), 2) * 100, 0);
}

function solve(target, scorer = score) {
  let best = null;
  for (let frontIndex = 0; frontIndex <= 20; frontIndex++) {
    for (let rearIndex = 0; rearIndex <= 14; rearIndex++) {
      for (let rollIndex = 0; rollIndex <= 8; rollIndex++) {
        for (let camberIndex = 0; camberIndex <= 16; camberIndex++) {
          for (let toeIndex = 0; toeIndex <= 20; toeIndex++) {
            const values = {
              front: frontIndex * 0.5,
              rear: 9 + rearIndex * 0.5,
              roll: 9 - rollIndex,
              camber: round(-2.7 - camberIndex * 0.05),
              toe: round(toeIndex * 0.05)
            };
            const result = scorer(values, target);
            const item = typeof result === "number"
              ? { values, score: result, bias: predictBias(values) }
              : { values, ...result };
            if (!best || item.score < best.score) best = item;
          }
        }
      }
    }
  }
  return best;
}

function roundedBias(values) {
  const bias = predictBias(values);
  return metrics.map(m => Math.round(bias[m] * 100));
}

const screenshotSetup = { front: 7.5, rear: 11, roll: 5, camber: -3.5, toe: 0 };
assert.deepEqual(roundedBias(screenshotSetup), [74, 18, 67, 36, 67]);

function asWindowTarget(center, width = 0) {
  return Object.fromEntries(metrics.map(m => [m, {
    min: center[m] - width,
    max: center[m] + width,
    center: center[m]
  }]));
}

const exactTarget = asWindowTarget(predictBias({ front: 4.5, rear: 11, roll: 6, camber: -3.25, toe: 0.3 }));
const exactBest = solve(exactTarget);
assert.deepEqual(exactBest.values, { front: 4.5, rear: 11, roll: 6, camber: -3.25, toe: 0.3 });
assert.ok(exactBest.maxError < 1e-9);
assert.equal(exactBest.hits, 5);

const screenshotTarget = asWindowTarget({
  over: 0.67,
  brake: 0.19,
  corner: 0.80,
  traction: 0.40,
  straight: 0.77
}, 0.04);
const oldBest = solve(screenshotTarget, oldScore);
const newBest = solve(screenshotTarget);
assert.ok(newBest.outsideMax <= score(oldBest.values, screenshotTarget).outsideMax);
assert.ok(newBest.hits >= score(oldBest.values, screenshotTarget).hits);

const wideTarget = asWindowTarget(predictBias({ front: 8, rear: 13, roll: 5, camber: -3.4, toe: 0.5 }), 0.03);
const wideBest = solve(wideTarget);
assert.equal(wideBest.hits, 5);
assert.equal(wideBest.outsideMax, 0);
