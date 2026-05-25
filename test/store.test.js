import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureStateDir, fileMode, readConfig, saveAccount, stateDir } from "../src/store.js";

test("state directory and config file use restrictive permissions", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-notify-store-"));
  const previous = process.env.WEIXIN_NOTIFY_STATE_DIR;
  process.env.WEIXIN_NOTIFY_STATE_DIR = tmp;
  try {
    await ensureStateDir();
    assert.equal(stateDir(), tmp);
    assert.equal(await fileMode(tmp), 0o700);

    await saveAccount({
      accountId: "account-1",
      token: "token-secret",
      baseUrl: "https://ilinkai.weixin.qq.com",
      boundUserId: "user@im.wechat",
      homeTarget: "user@im.wechat",
    });
    const configPath = path.join(tmp, "config.json");
    assert.equal(await fileMode(configPath), 0o600);
    const config = await readConfig();
    assert.equal(config.activeAccountId, "account-1");
    assert.equal(config.accounts["account-1"].token, "token-secret");
  } finally {
    if (previous === undefined) delete process.env.WEIXIN_NOTIFY_STATE_DIR;
    else process.env.WEIXIN_NOTIFY_STATE_DIR = previous;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
