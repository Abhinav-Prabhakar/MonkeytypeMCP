#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MonkeytypeClient } from "./client.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { toErrorMessage } from "./errors.js";
import { startHttpServer } from "./http.js";
import { createServer } from "./server.js";
import { SERVER_NAME, VERSION } from "./version.js";

const HELP = `${SERVER_NAME} ${VERSION}

Usage:
  monkeytype-mcp [options]

Options:
  --transport <stdio|http>   Transport to serve on. Default: stdio (env: MCP_TRANSPORT)
  --port <number>            Port for the HTTP transport. Default: 3000 (env: MCP_PORT)
  --host <host>              Host for the HTTP transport. Default: 127.0.0.1 (env: MCP_HOST)
  --check                    Verify configuration and API connectivity, then exit
  --version                  Print the version
  --help                     Print this help

Environment:
  MONKEYTYPE_API_KEY         ApeKey for authenticated tools (optional for public tools)
  MONKEYTYPE_USERNAME        Default username/uid for profile-style tools
  MONKEYTYPE_API_BASE_URL    Override the API base URL
  MONKEYTYPE_TIMEOUT_MS      Per-request timeout. Default: 30000
  MONKEYTYPE_MAX_RETRIES     Retries for 429/5xx/network errors. Default: 2
  MONKEYTYPE_CACHE_TTL_MS    Cache TTL for static endpoints. Default: 60000

Examples:
  MONKEYTYPE_API_KEY=... npx monkeytype-mcp
  npx monkeytype-mcp --transport http --port 8787

Docs: https://github.com/Abhinav-Prabhakar/MonkeytypeMCP
`;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function runCheck(config: ServerConfig): Promise<void> {
  const client = new MonkeytypeClient(config);
  console.log(`${SERVER_NAME} ${VERSION}`);
  console.log(`  base URL: ${config.baseUrl}`);
  console.log(`  ApeKey:   ${config.apiKey ? "configured" : "not set (public tools only)"}`);
  console.log(`  username: ${config.username ?? "not set"}`);

  let failures = 0;
  try {
    await client.get("/configuration", { auth: false });
    console.log("  public API: reachable");
  } catch (error) {
    failures += 1;
    console.error(`  public API: FAILED — ${toErrorMessage(error)}`);
  }

  if (config.apiKey) {
    try {
      await client.get("/users/stats", { auth: true });
      console.log("  authenticated API: reachable (ApeKey valid)");
    } catch (error) {
      failures += 1;
      console.error(`  authenticated API: FAILED — ${toErrorMessage(error)}`);
    }
  }

  if (failures > 0) process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      transport: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      check: { type: "boolean", default: false },
      version: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.version) {
    console.log(VERSION);
    return;
  }

  const config = loadConfig();

  if (values.check) {
    await runCheck(config);
    return;
  }

  const transportName = values.transport ?? process.env.MCP_TRANSPORT ?? "stdio";

  if (transportName === "http") {
    const rawPort = values.port ?? process.env.MCP_PORT ?? "3000";
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      fail(`invalid port: ${rawPort}`);
    }
    const host = values.host ?? process.env.MCP_HOST ?? "127.0.0.1";
    const running = await startHttpServer({ config, host, port });
    console.error(`${SERVER_NAME} ${VERSION} listening on ${running.url}/mcp`);

    const shutdown = async () => {
      await running.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    return;
  }

  if (transportName !== "stdio") {
    fail(`unknown transport "${transportName}" (expected stdio or http)`);
  }

  const server = createServer({ config });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `${SERVER_NAME} ${VERSION} running on stdio${config.apiKey ? "" : " (public tools only — set MONKEYTYPE_API_KEY)"}`
  );
}

main().catch((error) => {
  console.error(`fatal: ${toErrorMessage(error)}`);
  process.exit(1);
});
