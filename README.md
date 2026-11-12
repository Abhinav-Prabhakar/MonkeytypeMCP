# Monkeytype MCP

[![npm version](https://img.shields.io/npm/v/monkeytype-mcp-server?logo=npm&label=npm)](https://www.npmjs.com/package/monkeytype-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/monkeytype-mcp-server?logo=npm)](https://www.npmjs.com/package/monkeytype-mcp-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js)](package.json)

**Ask your AI about your typing.**
A Model Context Protocol server for [Monkeytype](https://monkeytype.com): profiles, personal bests, saved results, streaks, leaderboards and global stats — exposed as 22 typed tools for Claude, Cursor, VS Code, Windsurf, Zed, or any other MCP client.

```
You: How has my typing speed trended over my last 50 tests?
Claude: → analyze_results(limit: 50)
        Your average is 112 WPM with 97.4% accuracy.
        The newer half of your tests averages 5.8 WPM more than the older half — improving.
```

---

## Contents

- [Why this server](#why-this-server)
- [Quick start](#quick-start)
- [Tools](#tools)
- [Example prompts](#example-prompts)
- [Configuration](#configuration)
- [HTTP transport](#http-transport)
- [Docker](#docker)
- [Programmatic API](#programmatic-api)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Legal](#legal)

## Why this server

- **Complete and current.** Every endpoint in the official Monkeytype API (v2.5), including the endpoints that moved in 2025 (`/results/id/{id}`, `/leaderboards/xp/weekly`, `/quotes/isSubmissionEnabled`, `/users/currentTestActivity`).
- **Public tools need no key.** Profiles, global stats, speed histograms and PSAs work out of the box.
- **Built for LLMs, not for curl.** Composite tools (`get_user_overview`, `analyze_results`) collapse four or fifty API calls into one that fits in a context window.
- **Honest failure modes.** 401/403/422/429 responses become one-line, actionable messages (including which ApeKey scope is missing).
- **Production plumbing.** Exponential backoff with `Retry-After`, per-request timeouts, TTL caching for static endpoints, stdio **and** Streamable HTTP.
- **Typed and tested.** Strict TypeScript, Zod-validated tool inputs, 44 tests over the client, every tool, the MCP handshake and the HTTP transport.

## Quick start

### 1. Get an ApeKey (optional for public tools)

1. Sign in at [monkeytype.com](https://monkeytype.com).
2. Open **Account → Ape Keys → Generate new**.
3. Enable the scopes for the endpoints you need (`results:read`, `users:read`, `leaderboards:read`).
4. Copy the key — Monkeytype only shows it once.

### 2. Add the server to your client

The package runs on demand through `npx`; there is nothing to install globally.

**Claude Code**

```bash
claude mcp add monkeytype \
  --env MONKEYTYPE_API_KEY=your_ape_key \
  --env MONKEYTYPE_USERNAME=your_username \
  -- npx -y monkeytype-mcp-server
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "monkeytype": {
      "command": "npx",
      "args": ["-y", "monkeytype-mcp-server"],
      "env": {
        "MONKEYTYPE_API_KEY": "your_ape_key",
        "MONKEYTYPE_USERNAME": "your_username"
      }
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`), **Windsurf** (`~/.codeium/windsurf/mcp_config.json`) and **Cline** use the same shape:

```json
{
  "mcpServers": {
    "monkeytype": {
      "command": "npx",
      "args": ["-y", "monkeytype-mcp-server"],
      "env": { "MONKEYTYPE_API_KEY": "your_ape_key" }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`)

```json
{
  "servers": {
    "monkeytype": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "monkeytype-mcp-server"],
      "env": { "MONKEYTYPE_API_KEY": "your_ape_key" }
    }
  }
}
```

**Anything else** — the generic stdio snippet:

```json
{
  "command": "npx",
  "args": ["-y", "monkeytype-mcp-server"],
  "env": { "MONKEYTYPE_API_KEY": "your_ape_key" }
}
```

Verify the connection before wiring it into a client:

```bash
MONKEYTYPE_API_KEY=your_ape_key npx -y monkeytype-mcp-server --check
```

## Tools

Authentication column: **—** means the tool works without an ApeKey.

### Profile & user

| Tool                         | Auth | What it does                                                                  |
| ---------------------------- | :--: | ----------------------------------------------------------------------------- |
| `check_username`             |  —   | Check whether a username is available                                         |
| `get_profile`                |  —   | Fetch a profile (compact summary by default, `compact: false` for everything) |
| `get_user_overview`          |  —   | Profile + lifetime stats + streak + last result in one call                   |
| `get_stats`                  |  ✓   | Completed tests, started tests, total time typing                             |
| `get_personal_bests`         |  ✓   | Personal bests for a mode (defaults to `time` / `15`)                         |
| `get_tags`                   |  ✓   | Your result tags                                                              |
| `get_streak`                 |  ✓   | Current and longest streak                                                    |
| `get_current_test_activity`  |  ✓   | Daily test counts (up to 372 days)                                            |
| `send_forgot_password_email` |  —   | Trigger the reset email (Monkeytype requires a captcha token)                 |

### Results

| Tool               | Auth | What it does                                                   |
| ------------------ | :--: | -------------------------------------------------------------- |
| `get_results`      |  ✓   | Up to 1000 saved results, newest first                         |
| `get_result_by_id` |  ✓   | One result, including chart data                               |
| `get_last_result`  |  ✓   | Your most recent result                                        |
| `analyze_results`  |  ✓   | Averages, best score, per-mode breakdown and improvement trend |

### Leaderboards

| Tool                        | Auth | What it does                                     |
| --------------------------- | :--: | ------------------------------------------------ |
| `get_leaderboard`           |  ✓   | All-time leaderboard for a language and mode     |
| `get_leaderboard_rank`      |  ✓   | Your rank on that leaderboard                    |
| `get_daily_leaderboard`     |  ✓   | Daily leaderboard (when enabled server-side)     |
| `get_weekly_xp_leaderboard` |  ✓   | Weekly XP leaderboard (when enabled server-side) |

### Public data

| Tool                    | Auth | What it does                                           |
| ----------------------- | :--: | ------------------------------------------------------ |
| `get_configuration`     |  —   | Server configuration and feature flags (cached)        |
| `get_psas`              |  —   | Public service announcements (cached)                  |
| `get_typing_stats`      |  —   | Global tests started/completed and time typed (cached) |
| `get_speed_histogram`   |  —   | Users' personal bests grouped by WPM                   |
| `is_submission_enabled` |  —   | Whether quote submissions are open (cached)            |

Every tool returns pretty-printed JSON in a text content block. Timestamps are Unix epoch **milliseconds**.

## Example prompts

- “How many tests have I completed and how long have I been typing in total?”
- “What is my personal best in 60-second time mode?”
- “Show the top 10 English 15-second leaderboard and tell me how far I am from rank 1.”
- “Analyze my last 100 tests: average WPM, accuracy, and whether I'm improving.”
- “Is `swift_fox` available as a Monkeytype username?”
- “How does my 15-second WPM compare to the global speed histogram?”

## Configuration

| Variable                  | Default                      | Description                                                                       |
| ------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `MONKEYTYPE_API_KEY`      | —                            | ApeKey. Required for authenticated tools; public tools work without it.           |
| `MONKEYTYPE_USERNAME`     | —                            | Default username/uid for `get_profile`, `get_user_overview` and the `me` keyword. |
| `MONKEYTYPE_API_BASE_URL` | `https://api.monkeytype.com` | Override the API host (useful for proxies).                                       |
| `MONKEYTYPE_TIMEOUT_MS`   | `30000`                      | Per-request timeout.                                                              |
| `MONKEYTYPE_MAX_RETRIES`  | `2`                          | Retries for 429/5xx/network failures.                                             |
| `MONKEYTYPE_CACHE_TTL_MS` | `60000`                      | TTL for static endpoints. `0` disables caching.                                   |
| `MCP_TRANSPORT`           | `stdio`                      | `stdio` or `http`.                                                                |
| `MCP_PORT`                | `3000`                       | Port for the HTTP transport.                                                      |
| `MCP_HOST`                | `127.0.0.1`                  | Bind address for the HTTP transport.                                              |

CLI flags mirror the transport settings: `--transport`, `--port`, `--host`, `--check`, `--version`, `--help`.

## HTTP transport

For web clients or shared deployments, serve Streamable HTTP instead of stdio:

```bash
MONKEYTYPE_API_KEY=your_ape_key npx -y monkeytype-mcp-server --transport http --port 8787
```

- MCP endpoint: `POST http://127.0.0.1:8787/mcp` (stateless, JSON responses)
- Health probe: `GET http://127.0.0.1:8787/health`

The server binds to localhost by default. If you expose it publicly, put it behind authentication — anyone who can reach it can use your ApeKey.

## Docker

```bash
docker build -t monkeytype-mcp .

# HTTP transport on :3000
docker run --rm -p 3000:3000 \
  -e MONKEYTYPE_API_KEY=your_ape_key \
  monkeytype-mcp

# stdio transport (the client talks over stdin/stdout)
docker run -i --rm \
  -e MONKEYTYPE_API_KEY=your_ape_key \
  monkeytype-mcp \
  node dist/cli.js --transport stdio
```

## Programmatic API

The package exports the client, the tool registry and a transport-agnostic server factory:

```ts
import { MonkeytypeClient, createServer, loadConfig } from "monkeytype-mcp-server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const config = loadConfig({ ...process.env, MONKEYTYPE_API_KEY: "your_ape_key" });
const client = new MonkeytypeClient(config);

const results = await client.get("/results", { query: { limit: 5 } });
console.log(results);

const server = createServer({ config, client });
await server.connect(new StdioServerTransport());
```

Useful exports: `MonkeytypeClient`, `loadConfig`, `createServer`, `startHttpServer`, `TOOLS`, `MonkeytypeError`, `VERSION`.

## Development

```bash
npm install
npm run dev          # run the CLI from source with reload
npm test             # 44 vitest tests
npm run test:coverage
npm run typecheck
npm run lint
npm run build        # emit dist/ and .d.ts
node dist/cli.js --check
```

Project layout:

```
src/
  cli.ts        CLI entry point (stdio/http/check)
  server.ts     McpServer factory + tool registration
  client.ts     HTTP client: retries, cache, errors
  config.ts     Environment parsing
  errors.ts     Actionable error types
  tools/        One module per API area
tests/          Client, tool, MCP handshake and HTTP tests
```

Pull requests are welcome. Run `npm run lint && npm test && npm run build` before opening one.

## Troubleshooting

| Symptom                               | Fix                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| “This tool needs a Monkeytype ApeKey” | Set `MONKEYTYPE_API_KEY` in the `env` block of your MCP client config, then restart the client.                           |
| `401 Unauthorized`                    | The key is wrong or was revoked. Generate a new one.                                                                      |
| `403` on a specific tool              | The key is missing that scope. Re-create the ApeKey with the matching scope.                                              |
| `422` with valid-looking arguments    | `mode`/`mode2` pairs are validated by Monkeytype (e.g. `time` accepts `15/30/60/120`).                                    |
| `429 Rate limit reached`              | Monkeytype limits results to 60/hour (30/day with an ApeKey). The server retries automatically when `Retry-After` allows. |
| Client can't find the server          | Run `npx -y monkeytype-mcp-server --check`; if that works, your client config likely has a stale cache — restart it.      |
| Empty responses                       | Monkeytype returns empty arrays for “nothing yet” (e.g. no PSAs); that's a valid result, not a bug.                       |

## Legal

This project is not affiliated with, endorsed by, or supported by Monkeytype. It calls the public API using your own credentials. Respect Monkeytype's [terms of service](https://monkeytype.com/terms-of-service) and rate limits.

## License

[MIT](LICENSE) © Abhinav Prabhakar

Thanks to [Monkeytype](https://monkeytype.com) for the API and the [Model Context Protocol](https://modelcontextprotocol.io) team for the SDK.
