import test from "node:test";
import assert from "node:assert/strict";
import { assertMessageText, chunkText } from "../src/text-chunk.js";

test("chunkText leaves short text unchanged", () => {
  assert.deepEqual(chunkText("hello", 3800), ["hello"]);
});

test("chunkText splits long Chinese text within limit", () => {
  const chunks = chunkText("通知".repeat(2500), 3800);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 3800));
  assert.equal(chunks.join(""), "通知".repeat(2500));
});

test("chunkText prefers paragraph boundaries", () => {
  const text = `${"a".repeat(3600)}\n\n${"b".repeat(600)}`;
  const chunks = chunkText(text, 3800);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].endsWith("\n\n"));
});

test("assertMessageText rejects empty and oversized messages", () => {
  assert.throws(() => assertMessageText(""), /required/);
  assert.throws(() => assertMessageText("x".repeat(12_001)), /too large/);
});
