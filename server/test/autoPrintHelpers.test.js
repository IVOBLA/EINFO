import test from "node:test";
import assert from "node:assert/strict";

import { getProtocolCreatedAt, parseAutoPrintTimestamp } from "../utils/autoPrintHelpers.js";

test("parseAutoPrintTimestamp handles various inputs", () => {
  const now = Date.now();
  assert.equal(parseAutoPrintTimestamp(now), now);
  assert.equal(parseAutoPrintTimestamp(String(now)), now);
  assert.equal(parseAutoPrintTimestamp(new Date(now)), now);
  assert.equal(parseAutoPrintTimestamp("   "), null);
  assert.equal(parseAutoPrintTimestamp(undefined), null);
});

test("getProtocolCreatedAt prefers explicit create entries", () => {
  const createdAt = Date.now() - 10_000;
  const result = getProtocolCreatedAt({
    history: [
      { action: "update", ts: createdAt + 5_000 },
      { action: "create", ts: createdAt },
      { action: "update", ts: createdAt + 20_000 },
    ],
  });
  assert.equal(result, createdAt);
});

test("getProtocolCreatedAt uses item timestamps before history fallback", () => {
  const createdAt = Date.now() - 60_000;
  const fallbackHistoryTs = createdAt + 30_000;
  const result = getProtocolCreatedAt({
    createdAt,
    history: [
      { action: "update", ts: fallbackHistoryTs },
    ],
  });
  assert.equal(result, createdAt);
});

test("getProtocolCreatedAt falls back to oldest history timestamp", () => {
  const oldest = Date.now() - 120_000;
  const newest = oldest + 90_000;
  const mid = oldest + 60_000;
  const result = getProtocolCreatedAt({
    history: [
      { action: "update", ts: newest },
      { action: "update", ts: mid },
      { action: "irrelevant", ts: oldest },
    ],
  });
  assert.equal(result, oldest);
});
