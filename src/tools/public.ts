import { defineTool, languageSchema, mode2Schema, modeSchema } from "./types.js";

export const getPublicTools = () => [
  defineTool({
    name: "get_configuration",
    title: "Get server configuration",
    description:
      "Monkeytype server configuration: enabled features, limits and support information. Cached briefly.",
    requiresAuth: false,
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.get("/configuration", { auth: false, cache: true }),
  }),

  defineTool({
    name: "get_psas",
    title: "Get public service announcements",
    description: "Current Monkeytype PSAs, including maintenance and event notices.",
    requiresAuth: false,
    inputSchema: {},
    handler: async (_args, { client }) => client.get("/psas", { auth: false, cache: true }),
  }),

  defineTool({
    name: "get_typing_stats",
    title: "Get global typing stats",
    description: "Global number of tests started/completed and total time typed across Monkeytype.",
    requiresAuth: false,
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.get("/public/typingStats", { auth: false, cache: true }),
  }),

  defineTool({
    name: "get_speed_histogram",
    title: "Get speed histogram",
    description:
      "Number of users' personal bests grouped by WPM (multiples of ten) for a language and mode.",
    requiresAuth: false,
    inputSchema: {
      language: languageSchema,
      mode: modeSchema,
      mode2: mode2Schema,
    },
    handler: async (args, { client }) =>
      client.get("/public/speedHistogram", {
        auth: false,
        query: {
          language: args.language,
          mode: args.mode,
          mode2: String(args.mode2),
        },
      }),
  }),

  defineTool({
    name: "is_submission_enabled",
    title: "Is quote submission enabled",
    description: "Whether Monkeytype is currently accepting quote submissions.",
    requiresAuth: false,
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.get("/quotes/isSubmissionEnabled", { auth: false, cache: true }),
  }),
];
