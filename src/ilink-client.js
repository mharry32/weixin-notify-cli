import crypto from "node:crypto";
import {
  BOT_AGENT,
  CHANNEL_VERSION,
  DEFAULT_BASE_URL,
  DEFAULT_BOT_TYPE,
  ILINK_APP_ID,
} from "./constants.js";
import { CliError, isAuthExpiredPayload } from "./errors.js";
import { EXIT } from "./constants.js";

const DEFAULT_API_TIMEOUT_MS = 15_000;

export function buildClientVersion(version = CHANNEL_VERSION) {
  const [major = 0, minor = 0, patch = 0] = version
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

export function validateBaseUrl(raw) {
  const value = raw || DEFAULT_BASE_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("INVALID_BASE_URL", "Invalid iLink base URL.", EXIT.STATE);
  }
  if (url.protocol !== "https:") {
    throw new CliError("INVALID_BASE_URL", "iLink base URL must use HTTPS.", EXIT.STATE);
  }
  return url.toString().replace(/\/$/, "");
}

export function buildBaseInfo() {
  return {
    channel_version: CHANNEL_VERSION,
    bot_agent: BOT_AGENT,
  };
}

export function buildHeaders({ token = null, json = true } = {}) {
  const headers = {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(buildClientVersion(CHANNEL_VERSION)),
  };
  if (json) {
    headers["Content-Type"] = "application/json";
    headers.AuthorizationType = "ilink_bot_token";
    headers["X-WECHAT-UIN"] = randomWechatUin();
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function requestJson({
  method = "POST",
  baseUrl = DEFAULT_BASE_URL,
  endpoint,
  token = null,
  body = undefined,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
  label = "iLink request",
  tolerateEmpty = true,
}) {
  const base = `${validateBaseUrl(baseUrl)}/`;
  const url = new URL(endpoint, base);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method,
      headers: buildHeaders({ token, json: method !== "GET" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new CliError("HTTP_ERROR", `${label} failed with HTTP ${res.status}.`, EXIT.API);
    }
    if (!raw.trim()) {
      if (tolerateEmpty) return {};
      throw new CliError("EMPTY_RESPONSE", `${label} returned an empty response.`, EXIT.API);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CliError("BAD_RESPONSE", `${label} returned invalid JSON.`, EXIT.API);
    }
    assertApiSuccess(parsed, label);
    return parsed;
  } catch (err) {
    if (err instanceof CliError) throw err;
    if (err?.name === "AbortError") {
      throw new CliError("NETWORK_TIMEOUT", "Network timeout.", EXIT.NETWORK);
    }
    throw new CliError("NETWORK_ERROR", "Network error.", EXIT.NETWORK);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function assertApiSuccess(payload, label = "iLink request") {
  if (isAuthExpiredPayload(payload)) {
    throw new CliError("AUTH_EXPIRED", "Weixin session expired. Run: weixin-notify login", EXIT.AUTH_EXPIRED);
  }
  const ret = payload?.ret;
  const errcode = payload?.errcode;
  const hasFailureRet = ret !== undefined && ret !== 0;
  const hasFailureErrcode = errcode !== undefined && errcode !== 0;
  if (hasFailureRet || hasFailureErrcode) {
    const message = payload?.errmsg || payload?.errmsg_cn || payload?.msg || payload?.message || "";
    const parts = [`${label} failed`];
    if (ret !== undefined) parts.push(`ret=${ret}`);
    if (errcode !== undefined) parts.push(`errcode=${errcode}`);
    if (message) parts.push(`message=${sanitizeApiMessage(message)}`);
    throw new CliError("ILINK_API_ERROR", `${parts.join("; ")}.`, EXIT.API, {
      ret,
      errcode,
      message: sanitizeApiMessage(message),
    });
  }
}

function sanitizeApiMessage(value) {
  return String(value).replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***").slice(0, 240);
}

export async function startQrLogin({ baseUrl = DEFAULT_BASE_URL, botType = DEFAULT_BOT_TYPE, timeoutMs } = {}) {
  return requestJson({
    baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(String(botType))}`,
    body: { local_token_list: [] },
    timeoutMs,
    label: "QR login start",
    tolerateEmpty: false,
  });
}

export async function pollQrStatus({ qrcode, verifyCode = null, baseUrl = DEFAULT_BASE_URL, timeoutMs } = {}) {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  return requestJson({
    method: "GET",
    baseUrl,
    endpoint,
    timeoutMs,
    label: "QR status",
    tolerateEmpty: false,
  });
}

export function buildTextMessageBody({ target, text, contextToken = null, clientId = generateClientId() }) {
  const msg = {
    from_user_id: "",
    to_user_id: target,
    client_id: clientId,
    message_type: 2,
    message_state: 2,
    item_list: [
      {
        type: 1,
        text_item: { text },
      },
    ],
  };
  if (contextToken) msg.context_token = contextToken;
  return { msg, base_info: buildBaseInfo() };
}

export async function sendTextMessage({ baseUrl, token, target, text, contextToken = null, timeoutMs } = {}) {
  const body = buildTextMessageBody({ target, text, contextToken });
  await requestJson({
    baseUrl,
    token,
    endpoint: "ilink/bot/sendmessage",
    body,
    timeoutMs,
    label: "Send message",
  });
  return body.msg.client_id;
}

export async function getUpdates({ baseUrl, token, syncBuffer = "", timeoutMs = 35_000 } = {}) {
  try {
    return await requestJson({
      baseUrl,
      token,
      endpoint: "ilink/bot/getupdates",
      body: {
        get_updates_buf: syncBuffer || "",
        base_info: buildBaseInfo(),
      },
      timeoutMs,
      label: "Sync updates",
    });
  } catch (err) {
    if (err?.code === "NETWORK_TIMEOUT") {
      return { ret: 0, msgs: [], get_updates_buf: syncBuffer || "" };
    }
    throw err;
  }
}

function randomWechatUin() {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function generateClientId() {
  return `codex-weixin-notify-${crypto.randomBytes(8).toString("hex")}`;
}
