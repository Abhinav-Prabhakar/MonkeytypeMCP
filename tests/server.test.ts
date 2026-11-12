import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { MonkeytypeClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import { TOOLS } from "../src/tools/index.js";
import { jsonResponse, recordingFetch, testConfig } from "./helpers.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    await closers.pop()!();
  }
});

async function connect(
  handler: Parameters<typeof recordingFetch>[0],
  apiKey: string | null = "ape_key_example"
) {
  const config = testConfig({ apiKey: apiKey ?? undefined });
  const { fetchImpl, calls } = recordingFetch(handler);
  const server = createServer({ config, client: new MonkeytypeClient(config, fetchImpl) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const mcp = new Client({ name: "vitest-client", version: "1.0.0" });
  await mcp.connect(clientTransport);
  closers.push(async () => {
    await mcp.close();
    await server.close();
  });

  return { mcp, calls };
}

describe("MCP server", () => {
  it("lists every registered tool with a schema", async () => {
    const { mcp } = await connect(() => jsonResponse({ message: "ok", data: [] }));

    const { tools } = await mcp.listTools();

    expect(tools).toHaveLength(TOOLS.length);
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("returns JSON text content for a successful call", async () => {
    const { mcp, calls } = await connect(() =>
      jsonResponse({ message: "ok", data: { testsCompleted: 42 } })
    );

    const result = await mcp.callTool({ name: "get_typing_stats", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(content[0]!.text)).toEqual({ testsCompleted: 42 });
    expect(calls[0]!.url.pathname).toBe("/public/typingStats");
  });

  it("fails fast when an authenticated tool has no ApeKey", async () => {
    const { mcp, calls } = await connect(() => jsonResponse({ message: "ok", data: {} }), null);

    const result = await mcp.callTool({ name: "get_stats", arguments: {} });
    const content = result.content as Array<{ text: string }>;

    expect(result.isError).toBe(true);
    expect(content[0]!.text).toContain("MONKEYTYPE_API_KEY");
    expect(calls).toHaveLength(0);
  });
  it("returns upstream errors as tool errors instead of crashing", async () => {
    const { mcp } = await connect(() => jsonResponse({ message: "Unauthorized" }, 401));

    const result = await mcp.callTool({ name: "get_stats", arguments: {} });
    const content = result.content as Array<{ text: string }>;

    expect(result.isError).toBe(true);
    expect(content[0]!.text).toContain("ApeKey");
  });

  it("rejects out-of-range arguments through the SDK schema", async () => {
    const { mcp } = await connect(() => jsonResponse({ message: "ok", data: {} }));

    const result = await mcp.callTool({
      name: "get_leaderboard",
      arguments: { language: "english", mode: "time", mode2: "15", pageSize: 5 },
    });
    const content = result.content as Array<{ text: string }>;

    expect(result.isError).toBe(true);
    expect(content[0]!.text).toContain("validation error");
  });
});
