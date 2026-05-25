import { EXIT } from "./constants.js";

export class CliError extends Error {
  constructor(code, message, exitCode = EXIT.API, details = undefined) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function isAuthExpiredPayload(payload) {
  return payload?.ret === -14 || payload?.errcode === -14;
}

export function redact(value) {
  if (value == null) return value;
  const text = String(value);
  if (text.length <= 8) return "***";
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
}

export function publicError(err) {
  if (err instanceof CliError) {
    return { ok: false, code: err.code, message: err.message };
  }
  if (err?.name === "AbortError") {
    return { ok: false, code: "NETWORK_TIMEOUT", message: "Network timeout." };
  }
  return { ok: false, code: "ERROR", message: err instanceof Error ? err.message : String(err) };
}

export function exitCodeForError(err) {
  if (err instanceof CliError) return err.exitCode;
  if (err?.name === "AbortError") return EXIT.NETWORK;
  return EXIT.API;
}

export function normalizeFetchError(err) {
  if (err?.name === "AbortError") {
    return new CliError("NETWORK_TIMEOUT", "Network timeout.", EXIT.NETWORK);
  }
  if (err instanceof CliError) return err;
  return new CliError("NETWORK_ERROR", "Network error.", EXIT.NETWORK);
}
