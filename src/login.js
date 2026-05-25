import readline from "node:readline/promises";
import qrcodeTerminal from "qrcode-terminal";
import { DEFAULT_BASE_URL, DEFAULT_BOT_TYPE } from "./constants.js";
import { CliError } from "./errors.js";
import { EXIT } from "./constants.js";
import { pollQrStatus, startQrLogin, validateBaseUrl } from "./ilink-client.js";
import { readConfig, saveAccount, withLock } from "./store.js";

const QR_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESHES = 3;

export async function loginCommand(options = {}) {
  return withLock("login", async () => {
    if (options.noInput) {
      throw new CliError(
        "INPUT_DISABLED",
        "Login requires interactive QR confirmation. Run login in a terminal without --no-input.",
        EXIT.UNSUPPORTED,
      );
    }

    const config = await readConfig();
    const existingActive = config?.activeAccountId ? config.accounts?.[config.activeAccountId] : null;
    if (!options.force && existingActive?.token) {
      throw new CliError(
        "ALREADY_LOGGED_IN",
        "Credentials already exist. Use --force to generate a fresh QR code.",
        EXIT.USAGE,
      );
    }

    const timeoutMs = Math.max(Number(options.timeoutSeconds || 480) * 1000, 1000);
    const deadline = Date.now() + timeoutMs;
    let baseUrl = DEFAULT_BASE_URL;
    let qr = await fetchAndPrintQr({ baseUrl, json: options.json });
    let refreshes = 1;
    let scannedPrinted = false;
    let pendingVerifyCode = null;

    while (Date.now() < deadline) {
      const status = await pollQrStatus({
        baseUrl,
        qrcode: qr.qrcode,
        verifyCode: pendingVerifyCode,
        timeoutMs: QR_POLL_TIMEOUT_MS,
      }).catch((err) => {
        if (err?.code === "NETWORK_TIMEOUT" || err?.code === "NETWORK_ERROR") return { status: "wait" };
        throw err;
      });

      switch (status.status) {
        case "wait":
          break;
        case "scaned":
          pendingVerifyCode = null;
          if (!scannedPrinted && !options.json) {
            process.stdout.write("Scan received. Waiting for confirmation.\n");
            scannedPrinted = true;
          }
          break;
        case "need_verifycode":
          if (options.noInput) {
            throw new CliError("INPUT_DISABLED", "Verification code entry is disabled by --no-input.", EXIT.UNSUPPORTED);
          }
          pendingVerifyCode = await readVerifyCode(
            pendingVerifyCode ? "Verification code did not match. Enter the digits again: " : "Enter the digits shown in Weixin: ",
          );
          continue;
        case "scaned_but_redirect":
          if (status.redirect_host) {
            baseUrl = validateBaseUrl(`https://${status.redirect_host}`);
          }
          break;
        case "binded_redirect":
          if (existingActive?.token) {
            return {
              accountId: existingActive.accountId,
              baseUrl: existingActive.baseUrl,
              boundUserId: existingActive.boundUserId,
              homeTarget: existingActive.homeTarget,
            };
          }
          throw new CliError("BINDED_REDIRECT", "This bot appears to be already bound, but local credentials are missing. Run: weixin-notify login --force", EXIT.NO_CREDENTIALS);
        case "verify_code_blocked":
          throw new CliError("VERIFY_CODE_BLOCKED", "Verification code was blocked. Retry later.", EXIT.API);
        case "expired":
          refreshes += 1;
          if (refreshes > MAX_QR_REFRESHES) {
            throw new CliError("QR_EXPIRED", "QR code expired too many times. Retry login.", EXIT.API);
          }
          qr = await fetchAndPrintQr({ baseUrl: DEFAULT_BASE_URL, json: options.json });
          baseUrl = DEFAULT_BASE_URL;
          scannedPrinted = false;
          pendingVerifyCode = null;
          break;
        case "confirmed":
          return saveConfirmedStatus(status, baseUrl, options);
        default:
          throw new CliError("UNKNOWN_QR_STATUS", "Unknown QR login status.", EXIT.API);
      }
      await sleep(1000);
    }

    throw new CliError("LOGIN_TIMEOUT", "Login timed out before confirmation.", EXIT.API);
  });
}

async function fetchAndPrintQr({ baseUrl, json }) {
  const qr = await startQrLogin({ baseUrl, botType: DEFAULT_BOT_TYPE });
  if (!qr?.qrcode || !qr?.qrcode_img_content) {
    throw new CliError("BAD_QR_RESPONSE", "QR login start response was incomplete.", EXIT.API);
  }
  const output = json ? process.stderr : process.stdout;
  output.write("QR code shown. Scan with Weixin.\n");
  qrcodeTerminal.generate(qr.qrcode_img_content, { small: true }, (rendered) => {
    output.write(`${rendered}\n`);
  });
  output.write(`Fallback URL: ${qr.qrcode_img_content}\n`);
  return qr;
}

async function saveConfirmedStatus(status, fallbackBaseUrl, options) {
  if (!status.ilink_bot_id || !status.bot_token) {
    throw new CliError("BAD_LOGIN_RESPONSE", "Login confirmed but credentials were incomplete.", EXIT.API);
  }
  const baseUrl = validateBaseUrl(status.baseurl || fallbackBaseUrl || DEFAULT_BASE_URL);
  const saved = await saveAccount(
    {
      accountId: status.ilink_bot_id,
      token: status.bot_token,
      baseUrl,
      boundUserId: status.ilink_user_id || null,
      homeTarget: status.ilink_user_id || null,
    },
    { profile: options.profile },
  );
  return {
    accountId: saved.accountId,
    baseUrl: saved.baseUrl,
    boundUserId: saved.boundUserId,
    homeTarget: saved.homeTarget,
  };
}

async function readVerifyCode(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
