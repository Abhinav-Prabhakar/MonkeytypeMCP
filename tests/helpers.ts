import type { FetchLike } from "../src/client.js";
import { loadConfig, type ServerConfig } from "../src/config.js";

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadConfig({}),
    apiKey: "ape_key_example",
    username: "abhinav",
    maxRetries: 0,
    cacheTtlMs: 60_000,
    timeoutMs: 1_000,
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function recordingFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>
) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}
