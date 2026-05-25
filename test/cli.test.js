import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli.js";
import { EXIT } from "../src/constants.js";

test("status --json --field extracts a primitive and preserves status exit code", async () => {
  await withTempState(async () => {
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await main(["status", "--json", "--field", "ok"]);
      assert.equal(stdout.output(), "false\n");
      assert.equal(stderr.output(), "");
      assert.equal(process.exitCode, EXIT.NO_CREDENTIALS);
    } finally {
      stdout.restore();
      stderr.restore();
      restoreExitCode(previousExitCode);
    }
  });
});

test("parse errors are structured when --json is present", async () => {
  await withTempState(async () => {
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await main(["send", "--json", "--message"]);
      assert.equal(stdout.output(), "");
      assert.deepEqual(JSON.parse(stderr.output()), {
        ok: false,
        code: "BAD_USAGE",
        message: "Missing value for --message",
      });
      assert.equal(process.exitCode, EXIT.USAGE);
    } finally {
      stdout.restore();
      stderr.restore();
      restoreExitCode(previousExitCode);
    }
  });
});

test("--field requires --json", async () => {
  await withTempState(async () => {
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await main(["status", "--field", "ok"]);
      assert.equal(stdout.output(), "");
      assert.equal(stderr.output(), "Use --field together with --json.\n");
      assert.equal(process.exitCode, EXIT.USAGE);
    } finally {
      stdout.restore();
      stderr.restore();
      restoreExitCode(previousExitCode);
    }
  });
});

async function withTempState(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-notify-cli-"));
  const previous = process.env.WEIXIN_NOTIFY_STATE_DIR;
  process.env.WEIXIN_NOTIFY_STATE_DIR = tmp;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.WEIXIN_NOTIFY_STATE_DIR;
    else process.env.WEIXIN_NOTIFY_STATE_DIR = previous;
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

function capture(stream) {
  const chunks = [];
  const method = mock.method(stream, "write", (chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    output: () => chunks.join(""),
    restore: () => method.mock.restore(),
  };
}

function restoreExitCode(value) {
  process.exitCode = value;
}
