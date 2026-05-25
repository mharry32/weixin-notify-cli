import { EXIT } from "./constants.js";
import { CliError, exitCodeForError, publicError, redact } from "./errors.js";
import { loginCommand } from "./login.js";
import { sendCommand } from "./send.js";
import { syncOnceCommand } from "./sync.js";
import {
  getContextToken,
  logoutLocal,
  readConfig,
  withLock,
} from "./store.js";

export async function main(argv = process.argv.slice(2)) {
  let command;
  let rest;
  let options = {};
  try {
    [command, ...rest] = argv;
    options = parseOptions(rest);
    if (promptDisabled()) options.noInput = true;
    if (options.field && !options.json) {
      throw new CliError("BAD_USAGE", "Use --field together with --json.", EXIT.USAGE);
    }
    if (options.help) {
      printUsage();
      process.exitCode = EXIT.OK;
      return;
    }

    switch (command) {
      case "login":
        return await runLogin(options);
      case "send":
        return await runSend(options);
      case "status":
        return await runStatus(options);
      case "sync-once":
        return await runSyncOnce(options);
      case "logout":
        return await runLogout(options);
      case "-h":
      case "--help":
      case undefined:
        printUsage();
        process.exitCode = command ? EXIT.OK : EXIT.USAGE;
        return;
      default:
        throw new CliError("BAD_USAGE", `Unknown command: ${command}`, EXIT.USAGE);
    }
  } catch (err) {
    process.exitCode = exitCodeForError(err);
    if (options.json || wantsJson(argv)) {
      writeJson(publicError(err), true);
    } else {
      process.stderr.write(`${publicError(err).message}\n`);
    }
  }
}

async function runLogin(options) {
  const result = await loginCommand(options);
  if (options.json) {
    writeJsonResult({ ok: true, ...loginResult(result) }, options);
  } else {
    process.stdout.write("Login confirmed.\n");
    process.stdout.write(`Account: ${redact(result.accountId)}\n`);
    process.stdout.write(`Home target: ${result.homeTarget ? redact(result.homeTarget) : "(not set)"}\n`);
  }
}

async function runSend(options) {
  const result = await sendCommand(options);
  if (options.json) writeJsonResult(result, options);
  else if (result.dryRun) {
    process.stdout.write(`Dry run OK. Target: ${result.target}; chunks: ${result.chunks}; length: ${result.messageLength}\n`);
  } else {
    process.stdout.write(`Sent ${result.sent} message chunk(s) to ${result.target}.\n`);
  }
}

async function runStatus(options) {
  const status = await statusCommand(options);
  if (options.json) writeJsonResult(status, options);
  else {
    process.stdout.write(`Credential present: ${status.credentialPresent ? "yes" : "no"}\n`);
    if (status.activeAccountId) process.stdout.write(`Active account: ${status.activeAccountId}\n`);
    if (status.baseUrlHost) process.stdout.write(`Base URL host: ${status.baseUrlHost}\n`);
    process.stdout.write(`Home target present: ${status.homeTargetPresent ? "yes" : "no"}\n`);
    if (status.lastLoginAt) process.stdout.write(`Last login: ${status.lastLoginAt}\n`);
    process.stdout.write(`Context token for home target: ${status.contextTokenForHomeTarget ? "yes" : "no"}\n`);
  }
  if (!status.credentialPresent) process.exitCode = EXIT.NO_CREDENTIALS;
}

async function statusCommand() {
  const config = await readConfig();
  const active = config?.activeAccountId ? config.accounts?.[config.activeAccountId] : null;
  const credentialPresent = Boolean(active?.token);
  let contextTokenForHomeTarget = false;
  if (credentialPresent && active.homeTarget) {
    contextTokenForHomeTarget = Boolean(await getContextToken(active.accountId, active.homeTarget));
  }
  return {
    ok: credentialPresent,
    credentialPresent,
    activeAccountId: active?.accountId ? redact(active.accountId) : null,
    baseUrlHost: active?.baseUrl ? new URL(active.baseUrl).host : null,
    homeTargetPresent: Boolean(active?.homeTarget),
    homeTarget: active?.homeTarget ? redact(active.homeTarget) : null,
    lastLoginAt: active?.savedAt || null,
    contextTokenForHomeTarget,
    allowedTargetCount: config?.allowedTargets?.length || 0,
  };
}

async function runSyncOnce(options) {
  const result = await syncOnceCommand(options);
  const safe = { ...result, account: redact(result.account) };
  if (options.json) writeJsonResult(safe, options);
  else process.stdout.write(`Synced ${result.messages} message(s); updated ${result.updatedTokens} context token(s).\n`);
}

async function runLogout(options) {
  const result = await withLock("logout", () => logoutLocal({ accountId: options.account, all: options.all }));
  if (options.json) writeJsonResult({ ok: true, ...result }, options);
  else process.stdout.write(`Removed ${result.removed} local account(s).\n`);
}

function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      throw new CliError("BAD_USAGE", `Unexpected argument: ${arg}`, EXIT.USAGE);
    }
    const [keyRaw, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const key = normalizeKey(keyRaw);
    if (isBooleanOption(key)) {
      options[key] = true;
      continue;
    }
    const value = inlineValue !== undefined ? inlineValue : args[++i];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError("BAD_USAGE", `Missing value for --${keyRaw}`, EXIT.USAGE);
    }
    options[key] = value;
  }
  return options;
}

function normalizeKey(key) {
  const map = {
    "dry-run": "dryRun",
    "allow-unlisted": "allowUnlisted",
    "check-auth": "checkAuth",
    "no-input": "noInput",
    timeout: "timeoutSeconds",
  };
  return map[key] || key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function isBooleanOption(key) {
  return [
    "all",
    "allowUnlisted",
    "checkAuth",
    "dryRun",
    "force",
    "help",
    "json",
    "noInput",
    "stdin",
  ].includes(key);
}

function writeJsonResult(value, options) {
  writeJson(options.field ? fieldValue(value, options.field) : value);
}

function writeJson(value, stderr = false) {
  const encoded = JSON.stringify(value);
  const out = `${encoded === undefined ? "null" : encoded}\n`;
  if (stderr) process.stderr.write(out);
  else process.stdout.write(out);
}

function loginResult(result) {
  return {
    accountId: redact(result.accountId),
    baseUrlHost: result.baseUrl ? new URL(result.baseUrl).host : null,
    boundUserId: result.boundUserId ? redact(result.boundUserId) : null,
    homeTarget: result.homeTarget ? redact(result.homeTarget) : null,
  };
}

function fieldValue(value, path) {
  const rawSegments = String(path).split(".");
  if (rawSegments.length === 0 || rawSegments.some((segment) => segment.length === 0)) {
    throw new CliError("BAD_FIELD", "Field path must use dot-separated object keys.", EXIT.USAGE);
  }

  let current = value;
  for (const segment of rawSegments) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = Number(segment);
      if (index < current.length) {
        current = current[index];
        continue;
      }
    } else if (
      current !== null &&
      typeof current === "object" &&
      Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      current = current[segment];
      continue;
    }
    throw new CliError("FIELD_NOT_FOUND", `Field not found: ${path}`, EXIT.USAGE);
  }
  return current;
}

function promptDisabled() {
  return process.env.WEIXIN_NOTIFY_PROMPT_DISABLED === "1";
}

function wantsJson(argv) {
  return argv.some((arg) => arg === "--json");
}

function printUsage() {
  process.stdout.write(`Usage:
  weixin-notify login [--profile <name>] [--force] [--timeout <seconds>] [--json] [--no-input]
  weixin-notify status [--json] [--field <path>]
  weixin-notify send (--message <text> | --stdin) [--to <target>] [--dry-run] [--allow-unlisted] [--json] [--field <path>] [--no-input]
  weixin-notify sync-once [--timeout <seconds>] [--account <id>] [--json] [--field <path>]
  weixin-notify logout [--account <id> | --all] [--json] [--field <path>]

Commands:
  login       Scan a Weixin QR code and save local credentials.
  status      Show redacted credential and target state.
  send        Send a text notification.
  sync-once   Refresh inbound sync state and context tokens once.
  logout      Remove local credentials.

Common options:
  --json              Write stable machine-readable JSON.
  --field <path>      Extract a dot-separated field from JSON output.
  --no-input          Disable interactive prompts. Also set by WEIXIN_NOTIFY_PROMPT_DISABLED=1.
  --account <id>      Select an account for commands that support it.
  --timeout <seconds> Set a bounded network or login timeout.

Send options:
  --message <text>    Message text to send.
  --stdin             Read message text from standard input.
  --to <target>       Override the saved home target.
  --dry-run           Validate and preview without sending.
  --allow-unlisted    Allow a target that is not in the local allowlist.

Login/logout options:
  --profile <name>     Save credentials under a profile label.
  --force             Refresh login credentials even if one account exists.
  --all               Remove all local accounts during logout.
`);
}
