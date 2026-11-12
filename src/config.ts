import { VERSION } from "./version.js";

export interface ServerConfig {
  /** Monkeytype ApeKey. Optional: public endpoints work without one. */
  apiKey?: string;
  /** Default username/uid used when a tool argument is omitted. */
  username?: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  /** TTL for rarely-changing endpoints (configuration, PSAs, ...). */
  cacheTtlMs: number;
  userAgent: string;
}

export const DEFAULT_BASE_URL = "https://api.monkeytype.com";

function readInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const apiKey = env.MONKEYTYPE_API_KEY?.trim() || undefined;
  const username = env.MONKEYTYPE_USERNAME?.trim() || undefined;

  return {
    apiKey,
    username,
    baseUrl: stripTrailingSlash(env.MONKEYTYPE_API_BASE_URL?.trim() || DEFAULT_BASE_URL),
    timeoutMs: readInt(env.MONKEYTYPE_TIMEOUT_MS, 30_000),
    maxRetries: readInt(env.MONKEYTYPE_MAX_RETRIES, 2),
    cacheTtlMs: readInt(env.MONKEYTYPE_CACHE_TTL_MS, 60_000),
    userAgent: `${env.MONKEYTYPE_USER_AGENT?.trim() || "monkeytype-mcp"}/${VERSION}`,
  };
}
