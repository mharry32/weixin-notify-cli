#!/usr/bin/env node
import os from "node:os";
import path from "node:path";

if (!process.env.WEIXIN_NOTIFY_STATE_DIR) {
  process.env.WEIXIN_NOTIFY_STATE_DIR = path.join(os.homedir(), ".codex-weixin-notify-open");
}

const { main } = await import("../src/cli.js");

main(process.argv.slice(2)).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
