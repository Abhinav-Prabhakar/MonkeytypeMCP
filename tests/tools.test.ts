import { describe, expect, it } from "vitest";
import { MonkeytypeClient } from "../src/client.js";
import { MonkeytypeError } from "../src/errors.js";
import { TOOLS } from "../src/tools/index.js";
import type { ToolContext } from "../src/tools/types.js";
import { jsonResponse, recordingFetch, testConfig } from "./helpers.js";

function getTool(name: string) {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  return tool;
}

function context(fetchHandler: Parameters<typeof recordingFetch>[0], apiKey = "ape_key_example") {
  const config = testConfig({ apiKey });
  const { fetchImpl, calls } = recordingFetch(fetchHandler);
  const client = new MonkeytypeClient(config, fetchImpl);
  return { ctx: { client, config } as ToolContext, calls };
}

const ok = (data: unknown) => jsonResponse({ message: "ok", data });

describe("tool registry", () => {
  it("exposes unique snake_case names", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("documents every tool and marks read-only ones", () => {
    for (const tool of TOOLS) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.readOnly).toBe(true);
      expect(tool.inputSchema).toBeTypeOf("object");
    }
  });
});

describe("user tools", () => {
  it("checks a username via the path parameter", async () => {
    const { ctx, calls } = context(() => ok({ username: "alice", available: true }));

    const result = await getTool("check_username").handler({ name: "alice" }, ctx);

    expect(result).toEqual({ username: "alice", available: true });
    expect(calls[0]!.url.pathname).toBe("/users/checkName/alice");
  });

  it("defaults personal bests to time/15", async () => {
    const { ctx, calls } = context(() => ok({}));

    await getTool("get_personal_bests").handler({}, ctx);

    expect(calls[0]!.url.pathname).toBe("/users/personalBests");
    expect(calls[0]!.url.searchParams.get("mode")).toBe("time");
    expect(calls[0]!.url.searchParams.get("mode2")).toBe("15");
  });

  it("resolves 'me' to the configured username", async () => {
    const { ctx, calls } = context(() => ok({ uid: "u1", name: "abhinav" }));

    await getTool("get_profile").handler({ uidOrName: "me" }, ctx);

    expect(calls[0]!.url.pathname).toBe("/users/abhinav/profile");
  });

  it("fails clearly when no username can be resolved", async () => {
    const config = testConfig({ username: undefined });
    const { fetchImpl } = recordingFetch(() => ok({}));
    const ctx = { client: new MonkeytypeClient(config, fetchImpl), config } as ToolContext;

    const error = await getTool("get_profile")
      .handler({}, ctx)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MonkeytypeError);
    expect((error as MonkeytypeError).code).toBe("CONFIG");
    expect((error as MonkeytypeError).hint).toContain("MONKEYTYPE_USERNAME");
  });

  it("compacts profiles by default and can return the raw payload", async () => {
    const profile = {
      uid: "u1",
      name: "abhinav",
      xp: 1234,
      typingStats: { completedTests: 10 },
      personalBests: { time: { "15": [{ wpm: 120 }, { wpm: 118 }] } },
      testActivity: { testsByDays: [0, 1, null, 3], lastDay: 1700000000000 },
      allTimeLbs: { time: { "15": { english: { rank: 1 } } } },
    };
    const { ctx } = context(() => ok(profile));

    const summary = (await getTool("get_profile").handler({ uidOrName: "abhinav" }, ctx)) as Record<
      string,
      unknown
    >;
    expect(summary.personalBestCount).toBe(2);
    expect(summary.activeDays).toEqual({ withTests: 2, tracked: 4, lastDay: 1700000000000 });
    expect(summary).not.toHaveProperty("personalBests");

    const full = await getTool("get_profile").handler(
      { uidOrName: "abhinav", compact: false },
      ctx
    );
    expect(full).toHaveProperty("personalBests");
  });

  it("posts forgot-password payloads", async () => {
    const { ctx, calls } = context(() => ok({}));

    await getTool("send_forgot_password_email").handler({ email: "a@b.co", captcha: "tok" }, ctx);

    expect(calls[0]!.url.pathname).toBe("/users/forgotPasswordEmail");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ email: "a@b.co", captcha: "tok" }));
  });

  it("combines profile, stats, streak and last result into one overview", async () => {
    const { ctx, calls } = context((url) => {
      switch (url.pathname) {
        case "/users/stats":
          return ok({ completedTests: 5 });
        case "/users/streak":
          return ok({ length: 2, maxLength: 9 });
        case "/results/last":
          return ok({ wpm: 111 });
        default:
          return ok({ uid: "u1", name: "abhinav", personalBests: {} });
      }
    });

    const overview = (await getTool("get_user_overview").handler({}, ctx)) as Record<
      string,
      unknown
    >;

    expect(calls).toHaveLength(4);
    expect(overview.user).toBe("abhinav");
    expect(overview.stats).toEqual({ completedTests: 5 });
    expect(overview.streak).toEqual({ length: 2, maxLength: 9 });
    expect(overview.lastResult).toEqual({ wpm: 111 });
  });

  it("still returns partial data when one overview call fails", async () => {
    const { ctx } = context((url) => {
      if (url.pathname === "/users/stats") return jsonResponse({ message: "boom" }, 500);
      return ok({ uid: "u1", name: "abhinav" });
    });

    const overview = (await getTool("get_user_overview").handler({}, ctx)) as {
      stats: { error?: string };
    };

    expect(overview.stats.error).toMatch(/boom/);
  });
});

describe("result tools", () => {
  it("passes paging params to /results", async () => {
    const { ctx, calls } = context(() => ok([]));

    await getTool("get_results").handler({ limit: 10, offset: 20 }, ctx);

    expect(calls[0]!.url.pathname).toBe("/results");
    expect(calls[0]!.url.searchParams.get("limit")).toBe("10");
    expect(calls[0]!.url.searchParams.get("offset")).toBe("20");
  });

  it("uses the documented result ids path", async () => {
    const { ctx, calls } = context(() => ok({ wpm: 100 }));

    await getTool("get_result_by_id").handler({ resultId: "abc_123" }, ctx);

    expect(calls[0]!.url.pathname).toBe("/results/id/abc_123");
  });

  it("analyses results into averages, best and trend", async () => {
    const results = [
      {
        wpm: 120,
        acc: 98,
        consistency: 80,
        timestamp: 5,
        mode: "time",
        language: "english",
        testDuration: 15,
      },
      {
        wpm: 100,
        acc: 96,
        consistency: 70,
        timestamp: 4,
        mode: "time",
        language: "english",
        testDuration: 15,
      },
      {
        wpm: 80,
        acc: 94,
        consistency: 60,
        timestamp: 3,
        mode: "words",
        language: "english",
        testDuration: 30,
      },
      {
        wpm: 60,
        acc: 92,
        consistency: 50,
        timestamp: 2,
        mode: "words",
        language: "english",
        testDuration: 30,
      },
    ];
    const { ctx } = context(() => ok(results));

    const analysis = (await getTool("analyze_results").handler({ limit: 10 }, ctx)) as {
      count: number;
      averages: { wpm: number; accuracy: number };
      best: { wpm: number };
      byMode: Record<string, number>;
      trend: { direction: string; deltaWpm: number };
      totalTypingSeconds: number;
    };

    expect(analysis.count).toBe(4);
    expect(analysis.averages.wpm).toBe(90);
    expect(analysis.averages.accuracy).toBe(95);
    expect(analysis.best.wpm).toBe(120);
    expect(analysis.byMode).toEqual({ time: 2, words: 2 });
    expect(analysis.trend.direction).toBe("improving");
    expect(analysis.trend.deltaWpm).toBe(40);
    expect(analysis.totalTypingSeconds).toBe(90);
  });

  it("handles an empty analysis without dividing by zero", async () => {
    const { ctx } = context(() => ok([]));

    const analysis = await getTool("analyze_results").handler({}, ctx);

    expect(analysis).toMatchObject({ count: 0 });
  });
});

describe("leaderboard and public tools", () => {
  it("builds leaderboard queries", async () => {
    const { ctx, calls } = context(() => ok({ count: 0, entries: [] }));

    await getTool("get_leaderboard").handler(
      { language: "english", mode: "time", mode2: 60, page: 0, pageSize: 50 },
      ctx
    );

    const params = calls[0]!.url.searchParams;
    expect(calls[0]!.url.pathname).toBe("/leaderboards");
    expect(params.get("mode2")).toBe("60");
    expect(params.get("pageSize")).toBe("50");
  });

  it("uses the current weekly XP endpoint", async () => {
    const { ctx, calls } = context(() => ok({ entries: [] }));

    await getTool("get_weekly_xp_leaderboard").handler({}, ctx);

    expect(calls[0]!.url.pathname).toBe("/leaderboards/xp/weekly");
  });

  it("marks public tools as unauthenticated", async () => {
    const { ctx, calls } = context(() => ok({}));

    await getTool("get_speed_histogram").handler(
      { language: "english", mode: "time", mode2: "15" },
      ctx
    );

    expect(calls[0]!.url.pathname).toBe("/public/speedHistogram");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("hits the current quotes endpoint", async () => {
    const { ctx, calls } = context(() => ok({ enabled: true }));

    await getTool("is_submission_enabled").handler({}, ctx);

    expect(calls[0]!.url.pathname).toBe("/quotes/isSubmissionEnabled");
  });

  it("caches get_configuration", async () => {
    const { ctx, calls } = context(() => ok({ configuration: {} }));

    await getTool("get_configuration").handler({}, ctx);
    await getTool("get_configuration").handler({}, ctx);

    expect(calls).toHaveLength(1);
  });
});
