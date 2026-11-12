export type ErrorCode =
  | "CONFIG"
  | "AUTH"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "RATE_LIMIT"
  | "UPSTREAM"
  | "TIMEOUT"
  | "NETWORK"
  | "CANCELLED"
  | "UNKNOWN";

export interface MonkeytypeErrorOptions {
  code?: ErrorCode;
  status?: number;
  hint?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

/**
 * Every failure raised by this package is a `MonkeytypeError`, so MCP clients
 * get a short, actionable message instead of an opaque stack trace.
 */
export class MonkeytypeError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  readonly hint?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: MonkeytypeErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "MonkeytypeError";
    this.code = options.code ?? "UNKNOWN";
    this.status = options.status;
    this.hint = options.hint;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /** Single-line, LLM-friendly rendering of the failure. */
  toToolMessage(): string {
    return this.hint ? `${this.message} — ${this.hint}` : this.message;
  }
}

const HINTS: Partial<Record<number, string>> = {
  400: "MonkeyType rejected the request. Check the tool arguments.",
  401: "Missing or invalid ApeKey. Set MONKEYTYPE_API_KEY to a key from monkeytype.com → Account → Ape Keys.",
  403: "The ApeKey is invalid or lacks the scope required by this endpoint. Create a key with the matching scope.",
  404: "Nothing was found. Double-check the username, result id or uid.",
  422: "MonkeyType rejected the parameters. Check mode/mode2 combinations and value ranges.",
  429: "Rate limit reached. MonkeyType resets limits on a rolling window; retry in a moment.",
};

export function errorFromStatus(
  status: number,
  message: string,
  retryAfterSeconds?: number
): MonkeytypeError {
  let code: ErrorCode = "UPSTREAM";
  if (status === 401 || status === 403) code = "AUTH";
  else if (status === 404) code = "NOT_FOUND";
  else if (status === 429) code = "RATE_LIMIT";
  else if (status >= 400 && status < 500) code = "BAD_REQUEST";

  return new MonkeytypeError(message, {
    code,
    status,
    hint: HINTS[status],
    retryAfterSeconds,
  });
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof MonkeytypeError) return error.toToolMessage();
  if (error instanceof Error) return error.message;
  return String(error);
}
