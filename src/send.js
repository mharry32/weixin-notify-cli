import {
  CHUNK_CHAR_LIMIT,
  MESSAGE_CHAR_LIMIT,
  SEND_CHUNK_DELAY_MS,
} from "./constants.js";
import { CliError, redact } from "./errors.js";
import { EXIT } from "./constants.js";
import { buildTextMessageBody, sendTextMessage } from "./ilink-client.js";
import { assertMessageText, chunkText } from "./text-chunk.js";
import {
  appendSendLog,
  getAccount,
  getContextToken,
  isAllowedTarget,
  withLock,
} from "./store.js";

export async function sendCommand(options = {}) {
  return withLock("send", async () => {
    const text = await resolveMessageText(options);
    assertMessageText(text, MESSAGE_CHAR_LIMIT);

    const { config, account } = await getAccount(options.account);
    const target = options.to || account.homeTarget;
    if (!target) {
      throw new CliError("NO_TARGET", "No target configured. Run login again or pass --to.", EXIT.NO_TARGET);
    }
    if (!options.allowUnlisted && !isAllowedTarget(config, target)) {
      throw new CliError("TARGET_NOT_ALLOWED", "Target is not in the allowlist.", EXIT.TARGET_NOT_ALLOWED);
    }

    const contextToken = await getContextToken(account.accountId, target);
    const chunks = chunkText(text, CHUNK_CHAR_LIMIT);
    const warnings = [];
    if (!contextToken) warnings.push("CONTEXT_TOKEN_MISSING");

    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        target: redact(target),
        account: redact(account.accountId),
        messageLength: text.length,
        chunks: chunks.length,
        payload: redactPayload(buildTextMessageBody({ target, text: chunks[0], contextToken })),
        warnings,
      };
    }

    const messageIds = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const id = await sendChunkWithRetry({
        account,
        target,
        text: chunks[index],
        contextToken,
      });
      messageIds.push(id);
      if (index < chunks.length - 1) await sleep(SEND_CHUNK_DELAY_MS);
    }

    await appendSendLog({
      accountId: redact(account.accountId),
      target: redact(target),
      length: text.length,
      chunks: chunks.length,
      result: "ok",
    }).catch(() => {});

    return {
      ok: true,
      sent: chunks.length,
      target: redact(target),
      messageIds,
      warnings,
    };
  });
}

async function resolveMessageText(options) {
  if (options.message != null && options.stdin) {
    throw new CliError("BAD_USAGE", "Use either --message or --stdin, not both.", EXIT.USAGE);
  }
  if (options.message != null) return String(options.message);
  if (options.stdin) return readStdin(options);
  throw new CliError("BAD_USAGE", "Use --message <text> or --stdin.", EXIT.USAGE);
}

async function readStdin(options) {
  if (options.noInput && process.stdin.isTTY) {
    throw new CliError("INPUT_DISABLED", "Refusing to wait for terminal stdin while --no-input is active.", EXIT.UNSUPPORTED);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function sendChunkWithRetry({ account, target, text, contextToken }) {
  const delays = [0, 1000, 3000];
  let lastErr = null;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
    try {
      return await sendTextMessage({
        baseUrl: account.baseUrl,
        token: account.token,
        target,
        text,
        contextToken,
      });
    } catch (err) {
      if (err?.code === "AUTH_EXPIRED") throw err;
      if (err?.exitCode !== EXIT.NETWORK) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

function redactPayload(payload) {
  return {
    msg: {
      ...payload.msg,
      to_user_id: redact(payload.msg.to_user_id),
      context_token: payload.msg.context_token ? "***" : undefined,
      item_list: payload.msg.item_list?.map((item) => ({
        ...item,
        text_item: item.text_item ? { text: `<${item.text_item.text.length} chars>` } : undefined,
      })),
    },
    base_info: payload.base_info,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
