import { CHUNK_CHAR_LIMIT, MESSAGE_CHAR_LIMIT } from "./constants.js";
import { CliError } from "./errors.js";
import { EXIT } from "./constants.js";

export function assertMessageText(text, limit = MESSAGE_CHAR_LIMIT) {
  if (typeof text !== "string" || text.length === 0) {
    throw new CliError("EMPTY_MESSAGE", "Message text is required.", EXIT.USAGE);
  }
  if (text.length > limit) {
    throw new CliError(
      "MESSAGE_TOO_LARGE",
      `Message is too large. Maximum is ${limit} characters.`,
      EXIT.USAGE,
    );
  }
}

export function chunkText(text, limit = CHUNK_CHAR_LIMIT) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = findChunkBoundary(remaining, limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function findChunkBoundary(text, limit) {
  const windowStart = Math.max(0, limit - 600);
  const slice = text.slice(windowStart, limit);
  const codeFence = slice.lastIndexOf("\n```");
  if (codeFence > 0) return windowStart + codeFence + 1;
  const paragraph = slice.lastIndexOf("\n\n");
  if (paragraph > 0) return windowStart + paragraph + 2;
  const newline = slice.lastIndexOf("\n");
  if (newline > 0) return windowStart + newline + 1;
  const space = slice.lastIndexOf(" ");
  if (space > 0) return windowStart + space + 1;
  return limit;
}
