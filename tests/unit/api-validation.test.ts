import test from "node:test";
import assert from "node:assert/strict";
import {
  BadRequestError,
  normalizeSubredditName,
  parseOptionalIntegerParam,
  resolveRunMode,
  resolveTrendRange,
} from "../../apps/api/src/api-validation";

test("normalizeSubredditName accepts valid formats", () => {
  assert.equal(normalizeSubredditName("r/MachineLearning"), "machinelearning");
  assert.equal(normalizeSubredditName("data_science"), "data_science");
});

test("normalizeSubredditName rejects invalid subreddit", () => {
  assert.throws(() => normalizeSubredditName("a"), BadRequestError);
  assert.throws(() => normalizeSubredditName("data-science"), BadRequestError);
});

test("resolveRunMode keeps only supported values", () => {
  assert.equal(resolveRunMode(undefined), "live");
  assert.equal(resolveRunMode("live"), "live");
  assert.equal(resolveRunMode("mock"), "mock");
  assert.equal(resolveRunMode("invalid"), null);
});

test("resolveTrendRange aligns to 15-minute windows", () => {
  const params = new URLSearchParams({
    from: "2026-04-10T12:01:00.000Z",
    to: "2026-04-10T13:14:00.000Z",
  });
  const range = resolveTrendRange(params, "2026-04-10T13:20:00.000Z");
  assert.equal(range.fromIso, "2026-04-10T12:00:00.000Z");
  assert.equal(range.toIso, "2026-04-10T13:00:00.000Z");
});

test("resolveTrendRange rejects oversized ranges", () => {
  const params = new URLSearchParams({
    from: "2026-04-09T00:00:00.000Z",
    to: "2026-04-10T12:00:00.000Z",
  });
  assert.throws(() => resolveTrendRange(params, "2026-04-10T12:00:00.000Z"), BadRequestError);
});

test("parseOptionalIntegerParam validates range and integer", () => {
  assert.equal(
    parseOptionalIntegerParam({
      value: "12",
      name: "recentPostsLimit",
      min: 1,
      max: 50,
    }),
    12,
  );
  assert.equal(
    parseOptionalIntegerParam({
      value: null,
      name: "recentPostsLimit",
      min: 1,
      max: 50,
    }),
    undefined,
  );
  assert.throws(
    () =>
      parseOptionalIntegerParam({
        value: "2.5",
        name: "recentPostsLimit",
        min: 1,
        max: 50,
      }),
    BadRequestError,
  );
  assert.throws(
    () =>
      parseOptionalIntegerParam({
        value: "99",
        name: "recentPostsLimit",
        min: 1,
        max: 50,
      }),
    BadRequestError,
  );
});
