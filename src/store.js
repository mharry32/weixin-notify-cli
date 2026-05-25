import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BASE_URL, DEFAULT_PROFILE, DEFAULT_STATE_DIR } from "./constants.js";
import { CliError } from "./errors.js";
import { EXIT } from "./constants.js";

const CONFIG_FILE = "config.json";
const CONTEXT_FILE = "context-tokens.json";
const SYNC_FILE = "sync.json";
const SEND_LOG_FILE = "send-log.jsonl";

export function stateDir() {
  const raw = process.env.WEIXIN_NOTIFY_STATE_DIR || DEFAULT_STATE_DIR;
  if (raw === "~" || raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

export async function ensureStateDir(dir = stateDir()) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  return dir;
}

export async function readJsonFile(name, fallback = null, dir = stateDir()) {
  await ensureStateDir(dir);
  const file = path.join(dir, name);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    if (err instanceof SyntaxError) {
      throw new CliError("STATE_CORRUPT", `State file is not valid JSON: ${name}`, EXIT.STATE);
    }
    throw new CliError("STATE_READ_FAILED", `Could not read state file: ${name}`, EXIT.STATE);
  }
}

export async function writeJsonFile(name, value, dir = stateDir()) {
  await ensureStateDir(dir);
  const file = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await fs.open(tmp, fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw new CliError("STATE_WRITE_FAILED", `Could not write state file: ${name}`, EXIT.STATE);
  }
}

export async function appendSendLog(entry, dir = stateDir()) {
  await ensureStateDir(dir);
  const file = path.join(dir, SEND_LOG_FILE);
  const line = `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`;
  await fs.appendFile(file, line, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

export async function readConfig() {
  return readJsonFile(CONFIG_FILE, null);
}

export async function writeConfig(config) {
  await writeJsonFile(CONFIG_FILE, config);
}

export function emptyConfig() {
  return {
    version: 1,
    profile: DEFAULT_PROFILE,
    activeAccountId: null,
    accounts: {},
    allowedTargets: [],
    botAgent: "CodexWeixinNotify/0.1.0",
  };
}

export async function saveAccount(account, options = {}) {
  const config = (await readConfig()) || emptyConfig();
  const accountId = account.accountId;
  const existing = config.accounts?.[accountId] || {};
  const homeTarget = account.homeTarget || account.boundUserId || existing.homeTarget || null;
  config.version = 1;
  config.profile = options.profile || config.profile || DEFAULT_PROFILE;
  config.activeAccountId = accountId;
  config.accounts = {
    ...(config.accounts || {}),
    [accountId]: {
      ...existing,
      accountId,
      token: account.token,
      baseUrl: account.baseUrl || existing.baseUrl || DEFAULT_BASE_URL,
      boundUserId: account.boundUserId || existing.boundUserId || null,
      homeTarget,
      savedAt: new Date().toISOString(),
    },
  };
  config.allowedTargets = Array.from(new Set([...(config.allowedTargets || []), homeTarget].filter(Boolean)));
  config.botAgent = config.botAgent || "CodexWeixinNotify/0.1.0";
  await writeConfig(config);
  return config.accounts[accountId];
}

export async function getAccount(accountId = null) {
  const config = await readConfig();
  if (!config?.activeAccountId || !config.accounts) {
    throw new CliError("NO_CREDENTIALS", "No Weixin credentials found. Run: weixin-notify login", EXIT.NO_CREDENTIALS);
  }
  const id = accountId || config.activeAccountId;
  const account = config.accounts[id];
  if (!account?.token) {
    throw new CliError("NO_CREDENTIALS", "No Weixin credentials found. Run: weixin-notify login", EXIT.NO_CREDENTIALS);
  }
  return { config, account };
}

export function isAllowedTarget(config, target) {
  return Boolean(target && config?.allowedTargets?.includes(target));
}

export async function readContextTokens() {
  return readJsonFile(CONTEXT_FILE, {});
}

export async function writeContextTokens(tokens) {
  await writeJsonFile(CONTEXT_FILE, tokens);
}

export async function getContextToken(accountId, target) {
  const tokens = await readContextTokens();
  return tokens?.[accountId]?.[target] || null;
}

export async function setContextToken(accountId, target, token) {
  if (!accountId || !target || !token) return;
  const tokens = await readContextTokens();
  tokens[accountId] = tokens[accountId] || {};
  tokens[accountId][target] = token;
  await writeContextTokens(tokens);
}

export async function readSyncState() {
  return readJsonFile(SYNC_FILE, {});
}

export async function writeSyncState(sync) {
  await writeJsonFile(SYNC_FILE, sync);
}

export async function logoutLocal({ accountId = null, all = false } = {}) {
  const config = await readConfig();
  if (!config) return { removed: 0 };
  if (all) {
    await writeConfig(emptyConfig());
    await writeContextTokens({});
    await writeSyncState({});
    return { removed: Object.keys(config.accounts || {}).length };
  }
  const id = accountId || config.activeAccountId;
  if (!id || !config.accounts?.[id]) return { removed: 0 };
  const account = config.accounts[id];
  delete config.accounts[id];
  config.allowedTargets = (config.allowedTargets || []).filter((target) => target !== account.homeTarget);
  const remaining = Object.keys(config.accounts);
  config.activeAccountId = remaining[0] || null;
  await writeConfig(config);

  const tokens = await readContextTokens();
  delete tokens[id];
  await writeContextTokens(tokens);
  const sync = await readSyncState();
  delete sync[id];
  await writeSyncState(sync);
  return { removed: 1 };
}

export async function withLock(name, fn, options = {}) {
  const dir = await ensureStateDir();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const lockFile = path.join(dir, `${name}.lock`);
  const started = Date.now();
  let handle = null;
  while (!handle) {
    try {
      handle = await fs.open(lockFile, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") {
        throw new CliError("LOCK_FAILED", "Could not create state lock.", EXIT.STATE);
      }
      if (Date.now() - started > timeoutMs) {
        throw new CliError("LOCK_TIMEOUT", "Timed out waiting for another weixin-notify process.", EXIT.STATE);
      }
      await sleep(100);
    }
  }
  try {
    return await fn();
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(lockFile).catch(() => {});
  }
}

export async function fileMode(filePath) {
  const stat = await fs.stat(filePath);
  return stat.mode & 0o777;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
