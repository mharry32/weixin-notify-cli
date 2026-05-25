export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_BOT_TYPE = 3;
export const ILINK_APP_ID = "bot";
export const CHANNEL_VERSION = "2.4.3";
export const BOT_AGENT = "CodexWeixinNotify/0.1.0";
export const DEFAULT_STATE_DIR = "~/.codex-weixin-notify";
export const DEFAULT_PROFILE = "default";

export const EXIT = {
  OK: 0,
  USAGE: 2,
  NO_CREDENTIALS: 10,
  AUTH_EXPIRED: 11,
  NO_TARGET: 12,
  TARGET_NOT_ALLOWED: 13,
  NETWORK: 20,
  API: 21,
  STATE: 30,
  UNSUPPORTED: 40,
};

export const MESSAGE_CHAR_LIMIT = 12_000;
export const CHUNK_CHAR_LIMIT = 3_800;
export const SEND_CHUNK_DELAY_MS = 300;
