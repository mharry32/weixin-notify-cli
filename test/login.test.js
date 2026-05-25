import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loginCommand } from "../src/login.js";
import { readConfig } from "../src/store.js";

test("login stores confirmed QR credentials", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-notify-login-"));
  const previous = process.env.WEIXIN_NOTIFY_STATE_DIR;
  process.env.WEIXIN_NOTIFY_STATE_DIR = tmp;
  const stderrMock = mock.method(process.stderr, "write", () => true);
  const fetchMock = mock.method(globalThis, "fetch", async (url) => {
    const href = String(url);
    if (href.includes("get_bot_qrcode")) {
      return responseJson({ ret: 0, qrcode: "qr-token", qrcode_img_content: "https://qr.example/scan" });
    }
    if (href.includes("get_qrcode_status")) {
      return responseJson({
        ret: 0,
        status: "confirmed",
        bot_token: "bot-token",
        ilink_bot_id: "account-1",
        baseurl: "https://ilinkai.weixin.qq.com",
        ilink_user_id: "user@im.wechat",
      });
    }
    throw new Error(`unexpected url: ${href}`);
  });
  try {
    const result = await loginCommand({ json: true, force: true, timeoutSeconds: 2 });
    assert.equal(result.accountId, "account-1");
    const config = await readConfig();
    assert.equal(config.accounts["account-1"].token, "bot-token");
    assert.equal(config.accounts["account-1"].homeTarget, "user@im.wechat");
  } finally {
    stderrMock.mock.restore();
    fetchMock.mock.restore();
    if (previous === undefined) delete process.env.WEIXIN_NOTIFY_STATE_DIR;
    else process.env.WEIXIN_NOTIFY_STATE_DIR = previous;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("login no-input mode fails before QR network calls", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-notify-login-"));
  const previous = process.env.WEIXIN_NOTIFY_STATE_DIR;
  process.env.WEIXIN_NOTIFY_STATE_DIR = tmp;
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected fetch");
  });
  try {
    await assert.rejects(
      () => loginCommand({ noInput: true, json: true }),
      (err) => err?.code === "INPUT_DISABLED" && err?.exitCode === 40,
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
    if (previous === undefined) delete process.env.WEIXIN_NOTIFY_STATE_DIR;
    else process.env.WEIXIN_NOTIFY_STATE_DIR = previous;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

function responseJson(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
