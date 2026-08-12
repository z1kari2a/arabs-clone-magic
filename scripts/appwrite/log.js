// Timestamped leveled logger + retry helper shared by the Appwrite scripts.

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (color, text) => (useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text);

const stamp = () => new Date().toISOString().slice(11, 23);

function emit(stream, color, tag, args) {
  const prefix = `${paint("dim", stamp())} ${paint(color, tag.padEnd(5))}`;
  stream.write(`${prefix} ${args.map(fmt).join(" ")}\n`);
}

function fmt(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  info: (...a) => emit(process.stdout, "blue", "INFO", a),
  ok: (...a) => emit(process.stdout, "green", "OK", a),
  warn: (...a) => emit(process.stdout, "yellow", "WARN", a),
  error: (...a) => emit(process.stderr, "red", "ERROR", a),
  step: (...a) => emit(process.stdout, "cyan", "STEP", a),
  debug: (...a) => {
    if (process.env.APPWRITE_DEBUG) emit(process.stdout, "dim", "DEBUG", a);
  },
  /** Blank-line separated section header. */
  section: (title) => {
    process.stdout.write(
      `\n${paint("cyan", "── " + title + " " + "─".repeat(Math.max(0, 58 - title.length)))}\n`,
    );
  },
};

/** Appwrite/network failures worth retrying — everything else is a real bug. */
export function isRetryable(err) {
  const code = err?.code ?? err?.response?.code;
  if (code === 429 || code === 408 || (typeof code === "number" && code >= 500)) return true;
  const sys = err?.cause?.code ?? err?.code;
  return (
    typeof sys === "string" &&
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "EPIPE",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(sys)
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn`, retrying transient failures with exponential backoff + jitter.
 * @param {string} label shown in logs so a retry says WHAT is being retried
 */
export async function withRetry(label, fn, { retries = 4, baseDelay = 500 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt > retries || !isRetryable(err)) throw err;
      const delay = Math.round(baseDelay * 2 ** (attempt - 1) * (1 + Math.random() * 0.3));
      log.warn(
        `${label} failed (attempt ${attempt}/${retries + 1}): ${err?.message ?? err} — retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

export { sleep };
