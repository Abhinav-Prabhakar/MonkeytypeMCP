import type { ErasedToolDefinition } from "./types.js";
import { getLeaderboardTools } from "./leaderboards.js";
import { getPublicTools } from "./public.js";
import { getResultTools } from "./results.js";
import { getUserTools } from "./user.js";

export const TOOLS: ErasedToolDefinition[] = [
  ...getUserTools(),
  ...getResultTools(),
  ...getLeaderboardTools(),
  ...getPublicTools(),
];

export const TOOL_NAMES: string[] = TOOLS.map((tool) => tool.name);

export type { ErasedToolDefinition, ToolContext } from "./types.js";
