import test from "node:test";
import assert from "node:assert/strict";
import { compareOptionLabels } from "../src/utils/naturalSort.js";

test("cake sizes sort numerically", () => {
  assert.deepEqual(['6"','4"','10"','8"'].sort(compareOptionLabels), ['4"','6"','8"','10"']);
});
test("piece counts sort numerically", () => {
  assert.deepEqual(["12 pieces","2 pieces","6 pieces"].sort(compareOptionLabels), ["2 pieces","6 pieces","12 pieces"]);
});
test("text values sort alphabetically", () => {
  assert.deepEqual(["Vanilla","Chocolate","Strawberry"].sort(compareOptionLabels), ["Chocolate","Strawberry","Vanilla"]);
});
