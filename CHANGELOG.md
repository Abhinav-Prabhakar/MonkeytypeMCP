# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-11-12

A full rewrite of the server. The package now ships compiled TypeScript instead
of a single `server.js`, and the MCP surface is generated from one typed
registry.

### Added

- 22 tools, including two composite helpers:
  - `get_user_overview` — profile + stats + streak + last result in one call.
  - `analyze_results` — averages, best score, mode/language breakdown and WPM trend.
- Public tools now work **without** an ApeKey; only authenticated tools fail fast.
- Streamable HTTP transport (`--transport http`) with a `/health` probe, in
  addition to stdio.
- Retry with exponential backoff, `Retry-After` support, per-request timeouts and
  a TTL cache for static endpoints.
- `monkeytype-mcp --check` to validate configuration and connectivity.
- Programmatic API: `MonkeytypeClient`, `createServer`, `loadConfig`,
  `startHttpServer` and the tool registry.
- Dockerfile, MCP Registry manifest and a CHANGELOG.
- 44 tests covering the client, every tool, the MCP handshake and HTTP transport.

### Changed

- The npm package is now `monkeytype-mcp-server` (the `monkeytype-mcp` name
  belongs to an npm account that is no longer accessible, so it is frozen at
  1.0.10). The command is still `monkeytype-mcp`.
- Endpoints moved to the current Monkeytype API (v2.5):
  - `check_username` → `GET /users/checkName/{name}`
  - `get_result_by_id` → `GET /results/id/{resultId}`
  - `get_weekly_xp_leaderboard` → `GET /leaderboards/xp/weekly`
  - `is_submission_enabled` → `GET /quotes/isSubmissionEnabled`
  - `get_current_test_activity` → `GET /users/currentTestActivity`
  - `send_forgot_password_email` → `GET /users/forgotPasswordEmail` (POST, requires captcha)
  - `get_results` now uses `onOrAfterTimestamp` (the API's current parameter name).
- `get_personal_bests` defaults to `time` / `15` when arguments are omitted.
- `get_profile` returns a compact summary by default; pass `compact: false` for
  the full payload.
- Requires Node.js 20 or newer.

### Removed

- `axios`, `zod-to-json-schema` and the monolithic `server.js`.
- The `--transport sse`-style workarounds and the `mktemp` installation snippet
  from the old README.

## [1.0.10] — 2025-05-19

- Added `MONKEYTYPE_USERNAME` support for `get_profile`.
- Added the Glama badge.

## [1.0.0] — 2025-04

- Initial release: Monkeytype API endpoints exposed as MCP tools.
