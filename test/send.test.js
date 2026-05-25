import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sendCommand } from "../src/send.js";
import { saveAccount } from "../src/store.js";

test("send dry-run validates allowlist and redacts payload", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-notify-send-"));
  const previous = process.env.WEIXIN_NOTIFY_STATE_DIR;
  process.env.WEIXIN_NOTIFY_STATE_DIR = tmp;
  try {
    await saveAccount({
      accountId: "account-1",
      token: "token-secret",
      baseUrl: "https://ilinkai.weixin.qq.com",
      boundUserId: "user@im.wechat",
      homeTarget: "user@im.wechat",
    });
    const result = await sendCommand({ message: "hello", dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.payload.msg.to_user_id.includes("user@im.wechat"), false);
    assert.equal(result.payload.msg.item_list[0].text_item.text, "<5 chars>");
    assert.deepEqual(result.warnings, ["CONTEXT_TOKEN_MISSING"]);
  } finally {
    if (previous === undefined) delete process.env.WEIXIN_NOTIFY_STATE_DIR;
    else process.env.WEIXIN_NOTIFY_STATE_DIR = previous;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("send refuses unknown target unless explicitly allowed", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-notify-send-"));
  const previous = process.env.WEIXIN_NOTIFY_STATE_DIR;
  process.env.WEIXIN_NOTIFY_STATE_DIR = tmp;
  try {
    await saveAccount({
      accountId: "account-1",
      token: "token-secret",
      baseUrl: "https://ilinkai.weixin.qq.com",
      boundUserId: "user@im.wechat",
      homeTarget: "user@im.wechat",
    });
    await assert.rejects(
      () => sendCommand({ message: "hello", to: "other@im.wechat", dryRun: true }),
      /allowlist/,
    );
  } finally {
    if (previous === undefined) delete process.env.WEIXIN_NOTIFY_STATE_DIR;
    else process.env.WEIXIN_NOTIFY_STATE_DIR = previous;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("send maps expired session to AUTH_EXPIRED", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-notify-send-"));
  const previous = process.env.WEIXIN_NOTIFY_STATE_DIR;
  process.env.WEIXIN_NOTIFY_STATE_DIR = tmp;
  const fetchMock = mock.method(globalThis, "fetch", async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ret: -14 }),
  }));
  try {
    await saveAccount({
      accountId: "account-1",
      token: "token-secret",
      baseUrl: "https://ilinkai.weixin.qq.com",
      boundUserId: "user@im.wechat",
      homeTarget: "user@im.wechat",
    });
    await assert.rejects(
      () => sendCommand({ message: "hello" }),
      (err) => err?.code === "AUTH_EXPIRED" && err?.exitCode === 11,
    );
  } finally {
    fetchMock.mock.restore();
    if (previous === undefined) delete process.env.WEIXIN_NOTIFY_STATE_DIR;
    else process.env.WEIXIN_NOTIFY_STATE_DIR = previous;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
