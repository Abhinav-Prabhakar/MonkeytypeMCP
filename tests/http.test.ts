import { afterEach, describe, expect, it } from "vitest";
import { startHttpServer, type RunningHttpServer } from "../src/http.js";
import { testConfig } from "./helpers.js";

let running: RunningHttpServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "vitest", version: "1.0.0" },
  },
};

const RPC_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

describe("HTTP transport", () => {
  it("exposes a health endpoint", async () => {
    running = await startHttpServer({
      config: testConfig({ apiKey: undefined }),
      port: 0,
    });

    const response = await fetch(`${running.url}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      transport: "streamable-http",
      authenticated: false,
    });
  });

  it("answers initialize requests on POST /mcp", async () => {
    running = await startHttpServer({ config: testConfig(), port: 0 });

    const response = await fetch(`${running.url}/mcp`, {
      method: "POST",
      headers: RPC_HEADERS,
      body: JSON.stringify(INITIALIZE),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { serverInfo: { name: string; version: string } };
    };
    expect(body.result.serverInfo.name).toBe("monkeytype-mcp");
    expect(body.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("serves tools/list statelessly", async () => {
    running = await startHttpServer({ config: testConfig(), port: 0 });

    const response = await fetch(`${running.url}/mcp`, {
      method: "POST",
      headers: { ...RPC_HEADERS, "mcp-protocol-version": "2024-11-05" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.length).toBeGreaterThan(10);
  });

  it("returns 404 for unknown paths and 405 for GET /mcp", async () => {
    running = await startHttpServer({ config: testConfig(), port: 0 });

    const notFound = await fetch(`${running.url}/nope`);
    expect(notFound.status).toBe(404);

    const methodNotAllowed = await fetch(`${running.url}/mcp`);
    expect(methodNotAllowed.status).toBe(405);
  });

  it("rejects malformed JSON with a JSON-RPC parse error", async () => {
    running = await startHttpServer({ config: testConfig(), port: 0 });

    const response = await fetch(`${running.url}/mcp`, {
      method: "POST",
      headers: RPC_HEADERS,
      body: "{not json",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });
});
