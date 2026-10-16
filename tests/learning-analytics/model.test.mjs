import test from "node:test";
import assert from "node:assert/strict";
import {
  addRange,
  playbackDelta,
  questionId,
  videoId,
  emptySnapshot,
} from "../../src/lib/learning-analytics/model.ts";
test("coverage merges repeats and overlapping ranges but excludes skipped timeline", () => {
  let ranges = addRange([], 0, 10);
  ranges = addRange(ranges, 30, 50);
  ranges = addRange(ranges, 3, 8);
  assert.deepEqual(ranges, [
    [0, 10],
    [30, 50],
  ]);
  ranges = addRange(ranges, 8, 35);
  assert.deepEqual(ranges, [[0, 50]]);
  assert.deepEqual(addRange(ranges, 80, 70), ranges);
});
test("only visible continuous playback contributes, with speed support", () => {
  assert.equal(playbackDelta(10, 10.25, 250, 1, true), true);
  assert.equal(playbackDelta(10, 10.5, 250, 2, true), true);
  assert.equal(playbackDelta(10, 80, 250, 1, true), false);
  assert.equal(playbackDelta(10, 10.25, 250, 1, false), false);
  assert.equal(playbackDelta(10, 9, 250, 1, true), false);
  assert.equal(playbackDelta(10, 50, 40000, 1, true), false);
  assert.equal(playbackDelta(10, 10, 250, 1, true), false);
});
test("snapshots do not share answers or watched ranges", () => {
  const a = emptySnapshot();
  const b = emptySnapshot();
  a.ranges.push([0, 5]);
  a.responses.push({ question_id: "1", selected: null, elapsed_ms: 15 });
  assert.equal(b.ranges.length, 0);
  assert.equal(b.responses.length, 0);
  assert.equal(questionId("Question"), questionId("Question"));
  assert.notEqual(videoId("a"), videoId("b"));
});
