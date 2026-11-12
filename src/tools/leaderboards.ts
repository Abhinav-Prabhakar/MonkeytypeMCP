import {
  defineTool,
  friendsOnlySchema,
  languageSchema,
  mode2Schema,
  modeSchema,
  pageSchema,
  pageSizeSchema,
} from "./types.js";

export const getLeaderboardTools = () => [
  defineTool({
    name: "get_leaderboard",
    title: "Get all-time leaderboard",
    description:
      "All-time Monkeytype leaderboard for a language and mode. Rate limit: 500/hour. Requires an ApeKey.",
    requiresAuth: true,
    inputSchema: {
      language: languageSchema,
      mode: modeSchema,
      mode2: mode2Schema,
      page: pageSchema,
      pageSize: pageSizeSchema,
      friendsOnly: friendsOnlySchema,
    },
    handler: async (args, { client }) =>
      client.get("/leaderboards", {
        query: {
          language: args.language,
          mode: args.mode,
          mode2: String(args.mode2),
          page: args.page,
          pageSize: args.pageSize,
          friendsOnly: args.friendsOnly,
        },
      }),
  }),

  defineTool({
    name: "get_leaderboard_rank",
    title: "Get your leaderboard rank",
    description:
      "The authenticated user's rank on the all-time leaderboard for a language and mode.",
    requiresAuth: true,
    inputSchema: {
      language: languageSchema,
      mode: modeSchema,
      mode2: mode2Schema,
      friendsOnly: friendsOnlySchema,
    },
    handler: async (args, { client }) =>
      client.get("/leaderboards/rank", {
        query: {
          language: args.language,
          mode: args.mode,
          mode2: String(args.mode2),
          friendsOnly: args.friendsOnly,
        },
      }),
  }),

  defineTool({
    name: "get_daily_leaderboard",
    title: "Get daily leaderboard",
    description:
      "Today's leaderboard. Only available when dailyLeaderboards.enabled is true in the server configuration.",
    requiresAuth: true,
    inputSchema: {
      language: languageSchema,
      mode: modeSchema,
      mode2: mode2Schema,
      friendsOnly: friendsOnlySchema,
      page: pageSchema,
      pageSize: pageSizeSchema,
    },
    handler: async (args, { client }) =>
      client.get("/leaderboards/daily", {
        query: {
          language: args.language,
          mode: args.mode,
          mode2: String(args.mode2),
          page: args.page,
          pageSize: args.pageSize,
          friendsOnly: args.friendsOnly,
        },
      }),
  }),

  defineTool({
    name: "get_weekly_xp_leaderboard",
    title: "Get weekly XP leaderboard",
    description:
      "Weekly XP leaderboard. Only available when leaderboards.weeklyXp.enabled is true in the server configuration.",
    requiresAuth: true,
    inputSchema: {
      friendsOnly: friendsOnlySchema,
      page: pageSchema,
      pageSize: pageSizeSchema,
    },
    handler: async (args, { client }) =>
      client.get("/leaderboards/xp/weekly", {
        query: {
          page: args.page,
          pageSize: args.pageSize,
          friendsOnly: args.friendsOnly,
        },
      }),
  }),
];
