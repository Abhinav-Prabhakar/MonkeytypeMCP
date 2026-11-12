import { describe, expect, it, vi } from "vitest";
import { MonkeytypeClient, type FetchLike } from "../src/client.js";
import { MonkeytypeError } from "../src/errors.js";
import { jsonResponse, recordingFetch, testConfig } from "./helpers.js";

describe("MonkeytypeClient", () => {
  it("unwraps the envelope and sends the ApeKey", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ message: "ok", data: { completedTests: 3 } })
    );
    const client = new MonkeytypeClient(testConfig(), fetchImpl);

    await expect(client.get("/users/stats")).resolves.toEqual({ completedTests: 3 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.toString()).toBe("https://api.monkeytype.com/users/stats");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(
      "ApeKey ape_key_example"
    );
    expect((calls[0]!.init?.headers as Record<string, string>)["User-Agent"]).toMatch(
      /^monkeytype-mcp\//
    );
  });

  it("omits the ApeKey for public endpoints", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ message: "ok", data: { enabled: true } })
    );
    const client = new MonkeytypeClient(testConfig(), fetchImpl);

    await client.get("/quotes/isSubmissionEnabled", { auth: false });

    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("serialises query parameters and drops empty values", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ message: "ok", data: [] }));
    const client = new MonkeytypeClient(testConfig(), fetchImpl);

    await client.get("/leaderboards", {
      query: { language: "english", page: 0, pageSize: undefined, friendsOnly: false },
    });

    const params = calls[0]!.url.searchParams;
    expect(params.get("language")).toBe("english");
    expect(params.get("page")).toBe("0");
    expect(params.get("pageSize")).toBeNull();
    expect(params.get("friendsOnly")).toBe("false");
  });

  it("retries 429 responses and honours Retry-After", async () => {
    let attempt = 0;
    const { fetchImpl, calls } = recordingFetch(() => {
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse({ message: "Rate limit exceeded" }, 429, { "retry-after": "0" });
      }
      return jsonResponse({ message: "ok", data: { wpm: 143 } });
    });
    const client = new MonkeytypeClient(testConfig({ maxRetries: 1 }), fetchImpl);

    await expect(client.get("/results/last")).resolves.toEqual({ wpm: 143 });
    expect(calls).toHaveLength(2);
  });

  it("does not retry client errors and explains 401s", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ message: "Unauthorized" }, 401)
    );
    const client = new MonkeytypeClient(testConfig({ maxRetries: 3 }), fetchImpl);

    const error = await client.get("/users/stats").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MonkeytypeError);
    expect((error as MonkeytypeError).code).toBe("AUTH");
    expect((error as MonkeytypeError).status).toBe(401);
    expect((error as MonkeytypeError).toToolMessage()).toContain("MONKEYTYPE_API_KEY");
    expect(calls).toHaveLength(1);
  });

  it("gives up after maxRetries on 5xx responses", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ message: "upstream exploded" }, 503)
    );
    const client = new MonkeytypeClient(testConfig({ maxRetries: 2 }), fetchImpl);

    await expect(client.get("/psas")).rejects.toThrow(/upstream exploded/);
    expect(calls).toHaveLength(3);
  });

  it("caches static endpoints between calls", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ message: "ok", data: { version: 1 } })
    );
    const client = new MonkeytypeClient(testConfig(), fetchImpl);

    await client.get("/configuration", { auth: false, cache: true });
    await client.get("/configuration", { auth: false, cache: true });

    expect(calls).toHaveLength(1);
    client.clearCache();
    await client.get("/configuration", { auth: false, cache: true });
    expect(calls).toHaveLength(2);
  });

  it("does not cache by default", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ message: "ok", data: { streak: 4 } })
    );
    const client = new MonkeytypeClient(testConfig(), fetchImpl);

    await client.get("/users/streak");
    await client.get("/users/streak");

    expect(calls).toHaveLength(2);
  });

  it("maps timeouts to a TIMEOUT error", async () => {
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      });
    const client = new MonkeytypeClient(testConfig({ timeoutMs: 5 }), fetchImpl);

    const error = await client.get("/results").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MonkeytypeError);
    expect((error as MonkeytypeError).code).toBe("TIMEOUT");
  });

  it("wraps network failures", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const client = new MonkeytypeClient(testConfig(), fetchImpl);

    const error = await client.get("/psas").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MonkeytypeError);
    expect((error as MonkeytypeError).code).toBe("NETWORK");
    expect((error as MonkeytypeError).hint).toContain("MONKEYTYPE_API_BASE_URL");
  });

  it("exposes whether an ApeKey is configured", () => {
    expect(new MonkeytypeClient(testConfig({ apiKey: undefined })).hasApiKey).toBe(false);
    expect(new MonkeytypeClient(testConfig({ apiKey: "abc" })).hasApiKey).toBe(true);
  });

  it("posts JSON bodies", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ message: "ok", data: {} }));
    const client = new MonkeytypeClient(testConfig(), fetchImpl);

    await client.post("/users/forgotPasswordEmail", {
      auth: false,
      body: { email: "a@b.co", captcha: "token" },
    });

    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ email: "a@b.co", captcha: "token" }));
    expect((calls[0]!.init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
  });

  it("reports non-JSON bodies as upstream failures", async () => {
    const fetchImpl: FetchLike = async () => new Response("<html>nope</html>", { status: 200 });
    const client = new MonkeytypeClient(testConfig(), fetchImpl);

    const error = await client.get("/psas").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MonkeytypeError);
    expect((error as MonkeytypeError).code).toBe("UPSTREAM");
  });

  it("surfaces the Retry-After value on rate limit errors", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ message: "Rate limit exceeded" }, 429, { "retry-after": "42" })
    );
    const client = new MonkeytypeClient(testConfig({ maxRetries: 0 }), fetchImpl);

    const error = await client.get("/results").catch((err: unknown) => err);

    expect((error as MonkeytypeError).code).toBe("RATE_LIMIT");
    expect((error as MonkeytypeError).retryAfterSeconds).toBe(42);
  });

  it("uses the configured base url", async () => {
    const spy = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      jsonResponse({ message: "ok", data: null })
    );
    const client = new MonkeytypeClient(
      testConfig({ baseUrl: "http://localhost:9999" }),
      spy as unknown as FetchLike
    );

    await client.get("/psas");

    expect(String(spy.mock.calls[0]![0])).toBe("http://localhost:9999/psas");
  });
});
