import { z } from "zod";
import type { MonkeytypeClient } from "../client.js";
import type { ServerConfig } from "../config.js";

export interface ToolContext {
  client: MonkeytypeClient;
  config: ServerConfig;
}

export type ErasedToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => Promise<unknown>;

export interface ErasedToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** Tools marked as requiring auth fail fast with a helpful message without an ApeKey. */
  requiresAuth: boolean;
  readOnly: boolean;
  handler: ErasedToolHandler;
}

/**
 * Declares a tool with fully typed arguments while storing it in the flat
 * registry that the MCP server iterates over.
 */
export function defineTool<S extends z.ZodRawShape>(definition: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  requiresAuth: boolean;
  readOnly?: boolean;
  handler: (args: z.output<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
}): ErasedToolDefinition {
  return {
    readOnly: true,
    ...definition,
    handler: definition.handler as unknown as ErasedToolHandler,
  };
}

export const modeSchema = z
  .enum(["time", "words", "quote", "custom", "zen"])
  .describe("Typing mode: time, words, quote, custom or zen.");

export const mode2Schema = z
  .union([z.string(), z.number()])
  .describe(
    "Secondary mode value. time → 15/30/60/120; words → 10/25/50/100; quote → short/medium/long/thorough; zen → zen; custom → custom."
  );

export const languageSchema = z
  .string()
  .min(1)
  .describe("Language id from Monkeytype, e.g. english, english_1k, spanish, german, french.");

export const pageSchema = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Zero-based page number. Defaults to 0.");

export const pageSizeSchema = z
  .number()
  .int()
  .min(10)
  .max(200)
  .optional()
  .describe("Entries per page (10-200). Defaults to 50.");

export const friendsOnlySchema = z
  .boolean()
  .optional()
  .describe("Restrict the leaderboard to your friends. Requires an ApeKey.");
