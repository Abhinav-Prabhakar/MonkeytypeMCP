import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MonkeytypeClient } from "./client.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { MonkeytypeError, toErrorMessage } from "./errors.js";
import { TOOLS } from "./tools/index.js";
import type { ErasedToolDefinition, ToolContext } from "./tools/types.js";
import { SERVER_NAME, VERSION } from "./version.js";

const INSTRUCTIONS = `Monkeytype MCP exposes the public Monkeytype API (typing tests, results, stats, leaderboards).

Guidance:
- Start with get_user_overview for a fast snapshot of a player.
- Public tools (get_configuration, get_psas, get_typing_stats, get_speed_histogram, is_submission_enabled, get_profile) work without an ApeKey.
- Anything scoped to "me" (results, stats, streaks, leaderboards) needs MONKEYTYPE_API_KEY.
- Prefer analyze_results over fetching raw results when the question is about averages or trends.
- Timestamps are Unix epoch milliseconds.`;

export interface CreateServerOptions {
  config?: ServerConfig;
  client?: MonkeytypeClient;
}

function serialize(data: unknown): string {
  if (typeof data === "string") return data;
  if (data === undefined) return "null";
  return JSON.stringify(data, null, 2);
}

function toolContext(tool: ErasedToolDefinition, ctx: ToolContext): void {
  if (tool.requiresAuth && !ctx.client.hasApiKey) {
    throw new MonkeytypeError("This tool needs a Monkeytype ApeKey", {
      code: "CONFIG",
      hint: "Set MONKEYTYPE_API_KEY to a key from monkeytype.com → Account → Ape Keys.",
    });
  }
}

/**
 * Builds a fully wired MCP server. Transport-agnostic: connect it to stdio,
 * the streamable HTTP transport, or an in-memory pair in tests.
 */
export function createServer(options: CreateServerOptions = {}): McpServer {
  const config = options.config ?? loadConfig();
  const client = options.client ?? new MonkeytypeClient(config);
  const ctx: ToolContext = { client, config };

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: VERSION,
      title: "Monkeytype MCP",
    },
    {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    }
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          idempotentHint: tool.readOnly,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          toolContext(tool, ctx);
          const data = await tool.handler(args as Record<string, unknown>, ctx);
          return { content: [{ type: "text" as const, text: serialize(data) }] };
        } catch (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${toErrorMessage(error)}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
