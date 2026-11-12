import type { ServerConfig } from "./config.js";
import { MonkeytypeError, errorFromStatus } from "./errors.js";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  method?: "GET" | "POST";
  body?: unknown;
  /** Attach the ApeKey header. Defaults to true; public endpoints skip it. */
  auth?: boolean;
  /** Serve from / store in the short-lived cache (static endpoints only). */
  cache?: boolean;
  signal?: AbortSignal;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

interface Envelope<T> {
  message?: string;
  data?: T;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined) return Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
  const exponential = BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.random() * 100;
  return Math.min(exponential + jitter, MAX_BACKOFF_MS);
}

/**
 * Thin, typed wrapper around the Monkeytype HTTP API.
 *
 * - unwraps the `{ message, data }` envelope
 * - retries idempotent failures with exponential backoff (honouring Retry-After)
 * - caches static endpoints to keep multi-tool conversations cheap
 * - turns HTTP failures into actionable `MonkeytypeError`s
 */
export class MonkeytypeClient {
  readonly config: ServerConfig;
  private readonly fetchImpl: FetchLike;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(config: ServerConfig, fetchImpl?: FetchLike) {
    this.config = config;
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as FetchLike);
  }

  /** True when an ApeKey is configured for authenticated endpoints. */
  get hasApiKey(): boolean {
    return Boolean(this.config.apiKey);
  }

  async get<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  async post<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST" });
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const url = this.buildUrl(path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const cacheKey = `${method} ${url.toString()}`;
    const cacheEnabled = options.cache === true && method === "GET" && this.config.cacheTtlMs > 0;
    if (cacheEnabled) {
      const hit = this.cache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) return hit.value as T;
      if (hit) this.cache.delete(cacheKey);
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.config.userAgent,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.auth !== false && this.config.apiKey) {
      headers.Authorization = `ApeKey ${this.config.apiKey}`;
    }

    const response = await this.fetchWithRetry(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

    const payload = await this.readEnvelope<T>(response);
    const data = (payload.data ?? payload) as T;

    if (cacheEnabled) {
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + this.config.cacheTtlMs,
        value: data,
      });
    }

    return data;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private buildUrl(path: string): URL {
    const normalisedPath = path.startsWith("/") ? path : `/${path}`;
    return new URL(`${this.config.baseUrl}${normalisedPath}`);
  }

  private async fetchWithRetry(url: URL, init: RequestInit): Promise<Response> {
    let lastError: MonkeytypeError | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.config.timeoutMs);

      const externalSignal = init.signal;
      const onExternalAbort = () => controller.abort();
      externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

      try {
        const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
        if (response.ok) return response;

        const message = await this.readErrorMessage(response);
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));

        if (RETRYABLE_STATUS.has(response.status) && attempt < this.config.maxRetries) {
          lastError = errorFromStatus(response.status, message, retryAfter);
          await sleep(backoffMs(attempt, retryAfter));
          continue;
        }

        throw errorFromStatus(response.status, message, retryAfter);
      } catch (error) {
        if (error instanceof MonkeytypeError) {
          // Non-retryable status codes land here and should bubble up untouched.
          if (!RETRYABLE_STATUS.has(error.status ?? 0)) throw error;
          lastError = error;
        } else if (externalSignal?.aborted) {
          throw new MonkeytypeError("Request cancelled", { code: "CANCELLED", cause: error });
        } else if (timedOut) {
          lastError = new MonkeytypeError(
            `Request to ${url.pathname} timed out after ${this.config.timeoutMs}ms`,
            {
              code: "TIMEOUT",
              hint: "Raise MONKEYTYPE_TIMEOUT_MS or retry with a smaller limit.",
            }
          );
        } else {
          lastError = new MonkeytypeError(`Could not reach the Monkeytype API (${url.origin})`, {
            code: "NETWORK",
            hint: "Check your network connection or MONKEYTYPE_API_BASE_URL.",
            cause: error,
          });
        }

        if (attempt < this.config.maxRetries) {
          await sleep(backoffMs(attempt, lastError.retryAfterSeconds));
          continue;
        }
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onExternalAbort);
      }
    }

    throw (
      lastError ??
      new MonkeytypeError("Monkeytype request failed for an unknown reason", { code: "UNKNOWN" })
    );
  }

  private async readEnvelope<T>(response: Response): Promise<Envelope<T>> {
    const text = await response.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as Envelope<T>;
    } catch (error) {
      throw new MonkeytypeError("Monkeytype returned a non-JSON response", {
        code: "UPSTREAM",
        status: response.status,
        hint: "The API may be behind a captive portal or proxy.",
        cause: error,
      });
    }
  }

  private async readErrorMessage(response: Response): Promise<string> {
    const text = await response.text().catch(() => "");
    if (text.trim()) {
      try {
        const body = JSON.parse(text) as { message?: unknown };
        if (typeof body.message === "string" && body.message.trim()) return body.message;
      } catch {
        return text.slice(0, 300);
      }
    }
    return `Monkeytype API responded with HTTP ${response.status}`;
  }
}
