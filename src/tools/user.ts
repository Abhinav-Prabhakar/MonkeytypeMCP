import { z } from "zod";
import { MonkeytypeError } from "../errors.js";
import { defineTool } from "./types.js";
import type { ToolContext } from "./types.js";
import { mode2Schema, modeSchema } from "./types.js";

const CURRENT_USER_KEYWORDS = new Set(["me", "self", "current", "my"]);

export function resolveUsername(uidOrName: string | undefined, ctx: ToolContext): string {
  if (uidOrName && !CURRENT_USER_KEYWORDS.has(uidOrName.toLowerCase())) {
    return uidOrName.trim();
  }
  const configured = ctx.config.username?.trim();
  if (configured) return configured;

  throw new MonkeytypeError("No username available for this request", {
    code: "CONFIG",
    hint: "Pass a username, or set MONKEYTYPE_USERNAME in the MCP server environment.",
  });
}

interface ProfileData {
  uid?: string;
  name?: string;
  banned?: boolean;
  addedAt?: number;
  discordId?: string;
  xp?: number;
  isPremium?: boolean;
  inventory?: { badges?: Array<{ id: number; selected?: boolean }> };
  allTimeLbs?: Record<string, Record<string, Record<string, unknown>>>;
  testActivity?: { testsByDays?: Array<number | null>; lastDay?: number };
  typingStats?: { completedTests?: number; startedTests?: number; timeTyping?: number };
  personalBests?: Record<string, Record<string, Array<Record<string, unknown>>>>;
}

function compactProfile(profile: ProfileData): Record<string, unknown> {
  const personalBests = profile.personalBests ?? {};
  let personalBestCount = 0;
  for (const byMode2 of Object.values(personalBests)) {
    for (const entries of Object.values(byMode2)) {
      if (Array.isArray(entries)) personalBestCount += entries.length;
    }
  }

  const days = profile.testActivity?.testsByDays ?? [];
  const activeDays = days.filter((value) => typeof value === "number" && value > 0).length;

  return {
    uid: profile.uid,
    name: profile.name,
    banned: profile.banned,
    addedAt: profile.addedAt,
    discordId: profile.discordId,
    xp: profile.xp,
    isPremium: profile.isPremium,
    badges: profile.inventory?.badges?.map((badge) => badge.id) ?? [],
    typingStats: profile.typingStats,
    personalBestCount,
    activeDays: {
      withTests: activeDays,
      tracked: days.length,
      lastDay: profile.testActivity?.lastDay,
    },
    hint: "Call get_profile with compact=false for full personal bests, all-time leaderboards and daily activity.",
  };
}

export const getUserTools = () => [
  defineTool({
    name: "check_username",
    title: "Check username availability",
    description:
      "Check whether a Monkeytype username is free. Names must be 1-16 characters and not start with a dot. Rate limit: 60/min.",
    requiresAuth: false,
    inputSchema: {
      name: z.string().min(1).max(16).describe("Username to check."),
    },
    handler: async ({ name }, { client }) =>
      client.get<{ username?: string; available?: boolean }>(
        `/users/checkName/${encodeURIComponent(name)}`
      ),
  }),

  defineTool({
    name: "get_personal_bests",
    title: "Get personal bests",
    description:
      "Personal best scores for the authenticated user in a given mode. Requires the results scope on your ApeKey.",
    requiresAuth: true,
    inputSchema: {
      mode: modeSchema.optional().describe("Typing mode. Defaults to time."),
      mode2: mode2Schema.optional().describe("Secondary mode value. Defaults to 15 for time mode."),
    },
    handler: async ({ mode, mode2 }, { client }) =>
      client.get("/users/personalBests", {
        query: { mode: mode ?? "time", mode2: String(mode2 ?? "15") },
      }),
  }),

  defineTool({
    name: "get_tags",
    title: "Get tags",
    description: "List the tags created by the authenticated user.",
    requiresAuth: true,
    inputSchema: {},
    handler: async (_args, { client }) => client.get("/users/tags"),
  }),

  defineTool({
    name: "get_stats",
    title: "Get typing stats",
    description: "Completed tests, started tests and total time typing for the authenticated user.",
    requiresAuth: true,
    inputSchema: {},
    handler: async (_args, { client }) => client.get("/users/stats"),
  }),

  defineTool({
    name: "get_profile",
    title: "Get profile",
    description:
      "Fetch a Monkeytype profile by username or uid. Defaults to MONKEYTYPE_USERNAME. Returns a compact summary unless compact=false.",
    requiresAuth: false,
    inputSchema: {
      uidOrName: z
        .string()
        .optional()
        .describe("Username or uid. Keywords me/self/current/my resolve to MONKEYTYPE_USERNAME."),
      isUid: z.boolean().optional().describe("Treat uidOrName as a uid instead of a name."),
      compact: z
        .boolean()
        .optional()
        .describe("Return a summary instead of the full profile payload. Defaults to true."),
    },
    handler: async ({ uidOrName, isUid, compact }, ctx) => {
      const user = resolveUsername(uidOrName, ctx);
      const profile = await ctx.client.get<ProfileData>(
        `/users/${encodeURIComponent(user)}/profile`,
        { query: { isUid } }
      );
      return compact === false ? profile : compactProfile(profile);
    },
  }),

  defineTool({
    name: "send_forgot_password_email",
    title: "Send password reset email",
    description:
      "Trigger Monkeytype's password reset email. Monkeytype requires a captcha token generated on the website, so this rarely works from an MCP client.",
    requiresAuth: false,
    inputSchema: {
      email: z.email().describe("Account email address."),
      captcha: z
        .string()
        .min(1)
        .describe("Captcha token generated by monkeytype.com (required by the API)."),
    },
    handler: async ({ email, captcha }, { client }) =>
      client.post("/users/forgotPasswordEmail", { auth: false, body: { email, captcha } }),
  }),

  defineTool({
    name: "get_current_test_activity",
    title: "Get test activity",
    description:
      "Daily test counts for the authenticated user (up to 372 days). Handy for streaks and consistency charts.",
    requiresAuth: true,
    inputSchema: {},
    handler: async (_args, { client }) => client.get("/users/currentTestActivity"),
  }),

  defineTool({
    name: "get_streak",
    title: "Get streak",
    description: "Current and longest typing streak for the authenticated user.",
    requiresAuth: true,
    inputSchema: {},
    handler: async (_args, { client }) => client.get("/users/streak"),
  }),

  defineTool({
    name: "get_user_overview",
    title: "Get user overview",
    description:
      "One-shot snapshot: profile summary, lifetime stats, streak and last result. Fewer round trips than calling four tools.",
    requiresAuth: false,
    inputSchema: {
      uidOrName: z
        .string()
        .optional()
        .describe("Username or uid. Defaults to MONKEYTYPE_USERNAME."),
    },
    handler: async ({ uidOrName }, ctx) => {
      const user = resolveUsername(uidOrName, ctx);
      const [profile, stats, streak, lastResult] = await Promise.allSettled([
        ctx.client.get<ProfileData>(`/users/${encodeURIComponent(user)}/profile`),
        ctx.client.get("/users/stats", { auth: true }),
        ctx.client.get("/users/streak", { auth: true }),
        ctx.client.get("/results/last", { auth: true }),
      ]);

      const unwrap = <T>(outcome: PromiseSettledResult<T>): T | { error: string } =>
        outcome.status === "fulfilled"
          ? outcome.value
          : {
              error:
                outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            };

      const profileValue = unwrap(profile);
      return {
        user,
        profile:
          profileValue && typeof profileValue === "object" && "uid" in profileValue
            ? compactProfile(profileValue as ProfileData)
            : profileValue,
        stats: unwrap(stats),
        streak: unwrap(streak),
        lastResult: unwrap(lastResult),
      };
    },
  }),
];
