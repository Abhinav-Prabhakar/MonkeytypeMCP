import { z } from "zod";
import { defineTool, languageSchema, modeSchema } from "./types.js";

interface ResultItem {
  wpm?: number;
  rawWpm?: number;
  acc?: number;
  consistency?: number;
  mode?: string;
  mode2?: string;
  timestamp?: number;
  testDuration?: number;
  language?: string;
  difficulty?: string;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

const numbersOf = (items: ResultItem[], pick: (item: ResultItem) => number | undefined) =>
  items.map(pick).filter((value): value is number => typeof value === "number");

function tally(items: ResultItem[], pick: (item: ResultItem) => string | undefined) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export const getResultTools = () => [
  defineTool({
    name: "get_results",
    title: "Get results",
    description:
      "Recent typing test results for the authenticated user, newest first. Up to 1000 per call. Rate limit: 60/hour (30/day with an ApeKey).",
    requiresAuth: true,
    inputSchema: {
      limit: z.number().int().min(0).max(1000).optional().describe("Max results to return."),
      offset: z.number().int().min(0).optional().describe("Number of results to skip."),
      onOrAfterTimestamp: z
        .number()
        .int()
        .min(1589428800000)
        .optional()
        .describe("Only results at or after this Unix epoch timestamp in milliseconds."),
    },
    handler: async (args, { client }) =>
      client.get<ResultItem[]>("/results", {
        query: {
          limit: args.limit,
          offset: args.offset,
          onOrAfterTimestamp: args.onOrAfterTimestamp,
        },
      }),
  }),

  defineTool({
    name: "get_result_by_id",
    title: "Get result by id",
    description:
      "Fetch one saved result by id, including chart data. Ids look like 'abc123def456'. Rate limit: 300/hour.",
    requiresAuth: true,
    inputSchema: {
      resultId: z.string().min(1).describe("Result id (alphanumeric and underscores)."),
    },
    handler: async ({ resultId }, { client }) =>
      client.get(`/results/id/${encodeURIComponent(resultId)}`),
  }),

  defineTool({
    name: "get_last_result",
    title: "Get last result",
    description: "The most recent saved result for the authenticated user, including chart data.",
    requiresAuth: true,
    inputSchema: {},
    handler: async (_args, { client }) => client.get("/results/last"),
  }),

  defineTool({
    name: "analyze_results",
    title: "Analyze recent results",
    description:
      "Aggregate recent results into averages, best score, trend and mode/language breakdown. Cheaper than fetching raw results and doing the math yourself.",
    requiresAuth: true,
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(2)
        .max(1000)
        .optional()
        .describe("How many recent results to analyse. Defaults to 50."),
      mode: modeSchema.optional(),
      language: languageSchema.optional(),
      onOrAfterTimestamp: z
        .number()
        .int()
        .min(1589428800000)
        .optional()
        .describe("Only analyse results at or after this Unix epoch timestamp in milliseconds."),
    },
    handler: async (args, { client }) => {
      const limit = args.limit ?? 50;
      const raw = await client.get<ResultItem[]>("/results", { query: { limit } });

      const filtered = raw.filter((item) => {
        if (args.mode && item.mode !== args.mode) return false;
        if (args.language && item.language !== args.language) return false;
        if (args.onOrAfterTimestamp && (item.timestamp ?? 0) < args.onOrAfterTimestamp)
          return false;
        return true;
      });

      const sorted = [...filtered].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      if (sorted.length === 0) {
        return { count: 0, message: "No results matched the filters." };
      }

      const wpmValues = numbersOf(sorted, (item) => item.wpm);
      const timestamps = numbersOf(sorted, (item) => item.timestamp);
      const best = sorted.reduce((top, item) => ((item.wpm ?? 0) > (top.wpm ?? 0) ? item : top));
      const half = Math.max(1, Math.floor(sorted.length / 2));
      const newerHalf = sorted.slice(0, half);
      const olderHalf = sorted.slice(half);
      const newerAvg = average(numbersOf(newerHalf, (item) => item.wpm));
      const olderAvg = average(numbersOf(olderHalf, (item) => item.wpm));

      return {
        count: sorted.length,
        dateRange: {
          from: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
          to: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
        },
        averages: {
          wpm: average(wpmValues),
          rawWpm: average(numbersOf(sorted, (item) => item.rawWpm)),
          accuracy: average(numbersOf(sorted, (item) => item.acc)),
          consistency: average(numbersOf(sorted, (item) => item.consistency)),
        },
        best: {
          wpm: best.wpm ?? null,
          accuracy: best.acc ?? null,
          mode: best.mode ?? null,
          mode2: best.mode2 ?? null,
          language: best.language ?? null,
          timestamp: best.timestamp ?? null,
        },
        totalTypingSeconds: round(
          numbersOf(sorted, (item) => item.testDuration).reduce((sum, value) => sum + value, 0)
        ),
        byMode: tally(sorted, (item) => item.mode),
        byLanguage: tally(sorted, (item) => item.language),
        trend: {
          newerHalfAverageWpm: newerAvg,
          olderHalfAverageWpm: olderAvg,
          deltaWpm: newerAvg !== null && olderAvg !== null ? round(newerAvg - olderAvg) : null,
          direction:
            newerAvg !== null && olderAvg !== null
              ? newerAvg > olderAvg
                ? "improving"
                : newerAvg < olderAvg
                  ? "declining"
                  : "flat"
              : "unknown",
        },
        recent: sorted.slice(0, 5).map((item) => ({
          wpm: item.wpm,
          accuracy: item.acc,
          mode: item.mode,
          mode2: item.mode2,
          language: item.language,
          timestamp: item.timestamp,
        })),
      };
    },
  }),
];
