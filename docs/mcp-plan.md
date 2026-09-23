# Pro MCP integration plan

## Goal

Let a Pro subscriber connect Leið to any standards-compliant remote MCP client and work with their saved songs through structured tools. The MCP server is the long-term AI integration. The in-app AI Composer remains available during migration, then can be disabled without removing the underlying song operations.

This is an implementation plan, not an enabled endpoint.

## Delivery phases

| Phase | Deliverable | Exit check | Status |
| --- | --- | --- | --- |
| 0 | Feature branch and reviewed integration plan | Scope and browser/server boundary documented | Complete |
| 1 | OAuth provider, MCP discovery, Pro-protected empty endpoint, migration | External client can authorize; Free and expired Pro accounts are denied | In progress: database migrated and discovery/challenge verified; client authorization pending |
| 2 | Shared saved-song service and MCP song tools | Ownership, validation, conflict, and protocol tests pass | In progress: song index/read, tempo write, and composition tools (guide, route lookup, plan preview/create/apply) added with in-process protocol tests; real-client check pending |
| 3 | Account connection/revocation UI and rollout flag | Pro user connects a client and disconnect stops further calls | In progress: gated connection and revocation code added; live client check pending |
| 4 | In-app AI chat retirement | MCP path works in production; copy, billing, and usage-meter cleanup reviewed | Pending |

Keep the phases reviewable as separate deliverables. The configured Neon database contains only the owner's test accounts and data. Its existing app tables had no Drizzle migration ledger and lacked the `compositions` table; on 2026-09-23, the missing compositions and OAuth migrations were applied in one transaction and the ledger was baselined after checking the pre-MCP table columns, constraints, and indexes. `npm run db:migrate` now succeeds. End-to-end connection checks and deployment remain release gates. Phase 4 is the explicit chat retirement step; earlier phases do not disable it.

The Phase 1 code is guarded by `MCP_ENABLED=false` by default, and the account entry by `NEXT_PUBLIC_MCP_ENABLED=false`. Apply the committed Drizzle migration to a target database **before** setting either flag to `true`; Better Auth initializes its OAuth resource from the new tables. Both flags are enabled only in this workspace's gitignored `.env.local`; deployed environment variables have not been changed. The branch build and 110 tests pass with the flags on. Local HTTP checks returned valid protected-resource and authorization-server discovery documents and a `401` OAuth challenge for an unauthenticated MCP request. Do not consider Phase 1 complete until consent, token refresh, a Pro connection, and a Free/expired Pro denial have been exercised with a real client.

## Current boundaries

- `components/AIComposerPanel.jsx` sends a prompt through `lib/ai/composer.js` to `POST /api/compose`. The client validates and previews the resulting plan before the user applies it.
- `components/tabs/MixerTab.jsx` applies that plan to browser-owned mixer and Tone state. A server-side MCP call cannot change an open DAW tab through this function.
- Saved songs are user-scoped through `app/api/presets/route.js` and `app/api/presets/[id]/route.js`; song snapshots live in `lib/songState.js`. The MCP implementation should call shared server-side song operations, rather than make HTTP requests to cookie-protected routes.
- `lib/billing/server.js` resolves `getEntitlements(userId).isPro` from the current subscription or override. That value, queried at request time, is the access rule for MCP.
- Before Phase 1, Better Auth served browser cookie sessions only and the lockfile resolved to 1.6.13. The branch now adds bearer-token authorization behind `MCP_ENABLED`; new auth tables are in the generated Drizzle migration and must exist before the flag is enabled.

## Proposed shape

1. **Auth and transport.** Upgrade Better Auth to a compatible release, then use its [MCP plugin](https://better-auth.com/docs/plugins/mcp) and [Client ID Metadata Document plugin](https://better-auth.com/docs/plugins/cimd) to connect external clients to existing user accounts via OAuth. Publish public protected-resource and authorization-server discovery metadata, use authorization-code plus PKCE, issue resource-bound access tokens, and provide token revocation. Confirm interoperability with older clients that require dynamic client registration; enable and rate-limit that fallback only if the supported client tests need it. Check the plugin's actual schema against `lib/db/schema.js`, run `npm run db:generate`, and commit the migration. Verify the auth handler forwards the required `/.well-known/*` paths in Next.js. Do not accept a browser session cookie or an arbitrary API key as MCP authorization.
2. **Remote endpoint.** Add `app/mcp/route.js` as a stateless Streamable HTTP endpoint using the official MCP TypeScript SDK. Start with the current `2026-07-28` protocol profile recommended by Better Auth; test older clients separately and enable the SDK's `2025` compatibility path only with a matching OAuth discovery/registration flow. Keep every operation bounded to a single request; avoid a process-local session, long-running audio task, or WebSocket dependency. Validate `Origin`/host and request size at the HTTP boundary.
3. **Pro gate.** At the MCP HTTP boundary, validate the Bearer token, its issuer, audience/resource, scope, expiry, and mapped user. Return a proper `401` OAuth challenge for a missing or invalid token. Resolve `getEntitlements(userId)` on each MCP request and deny a Free, expired, or revoked account with `403`, including `server/discover`, tool listing, and tool calls. OAuth discovery metadata must stay public so a client can start authorization. Recheck the entitlement inside every tool handler. Never trust a client-supplied user ID or plan name to establish ownership. A connected client loses access as soon as the server observes a Pro downgrade; a previously issued token does not grant Pro by itself.
4. **Shared song service.** Extract the user-scoped preset database logic from `app/api/presets/*` into a server module called by both HTTP routes and MCP tools. **Done:** the plan vocabulary, prompt text and validator now live in the pure `lib/ai/planContract.js` (with the engine's data constants moved to `lib/soundSpecs.js`, `lib/fxSpecs.js`, `lib/drumSpecs.js` and `lib/harmony.js`); the plan's wire shape is one Zod schema in `lib/ai/planSchema.js`, shared by `/api/compose` and the MCP tools; and `lib/ai/planSnapshot.js` is a pure port of `MixerTab.applyAIPlan` onto snapshot maps. No `MixerTab.jsx` or Tone.js import reaches the server, and `test/server-purity.test.js` enforces that. Use version checks for updates so an MCP client cannot silently overwrite a newer browser save.
5. **Tools.** The first four are `list_cities`, `list_songs`, `get_song(songId)`, and `set_song_tempo(songId, bpm, expectedUpdatedAt)`. They establish ownership, read, and conflict-safe write behavior without changing snapshot topology. Phase 2 then adds composition, the MCP counterpart of the in-app AI Composer. The connected client is the model, so the server makes no LLM call and uses none of the `ai` allowance:
   - `get_composer_guide(cityId)`: the same vocabulary text the in-app system prompt uses, plus the user's lane limit and route-type counts.
   - `list_routes(cityId, type?, query?, limit?)`: reads the committed per-city index in `lib/server/routeIndex/` (built by `npm run index:routes`), never the large `lines.<city>.json` files.
   - `preview_song_plan(cityId | songId, plan)`: read-only; returns the `dropped` validation warnings and a summary of the song.
   - `create_song_from_plan(cityId, name, plan)` and `apply_plan_to_song(id, expectedUpdatedAt, plan)`: write the song and return `openUrl` (`/?song=<id>`).
   - A `compose_loop` prompt walks prompt-aware clients through those steps. Return compact structured results and validation warnings. A preview is read-only; a save writes only the authenticated user's song and does not trigger playback or export. Mark tool annotations accurately, but enforce safety server-side because annotations are only hints to clients.
6. **Account connection UI.** Add a “Connect an AI client” view in the existing `HeaderMenu`/`ProfilePanel` account surface with the MCP URL, brief OAuth connection steps, and a way to review/revoke connected clients. Show an upgrade path to Free users. Keep credentials out of the page and browser storage. The server checks for an active consent on every MCP request, so disconnecting removes access even for an unexpired signed token, and revokes stored refresh/access tokens. Record connect, tool-use, denial, and revoke events without saving prompts, song payloads, or tokens in analytics/logs.
7. **Chat sunset.** During rollout, keep `/api/compose` and `AIComposerPanel` working behind the existing AI allowance while MCP is tested. Add a feature flag for the in-app chat UI and endpoint; once MCP connection and song editing are proven, switch the flag off, remove its navigation entry, and stop exposing `/api/compose`. Keep the pure plan validator and song service because MCP uses them. Update billing copy and onboarding at the same time so Pro is sold as external AI client access rather than in-app chat.

## Implementation order and checks

1. Add OAuth/MCP auth and the committed database migration. Confirm a real external client can discover the endpoint, authorize an existing user, refresh a token, and reconnect after a deploy.
2. Add the shared song service and MCP tools. Test ownership isolation, malformed input, concurrent edits, Free/expired Pro denial, and immediate denial after downgrade. Exercise both supported protocol revisions with an MCP client or inspector.
3. Add the connection UI and staged chat flag. Run `npm test` and `npm run build`, then manually connect a Pro account, save a song through MCP, and open it in the DAW. Verify that an MCP save does not claim to modify a currently open tab; the user reloads/opens the saved song to hear it.
4. Disable the built-in chat only after the connection flow and saved-song path work in production. Remove the OpenRouter dependency and AI usage meter in a separate cleanup, after billing and existing subscription expectations have been reviewed.

The first release deliberately targets saved-song editing. If live control of an open DAW becomes necessary, design a separate authenticated browser handoff with explicit user approval for applying changes; that is a different capability from the remote MCP server.

## What makes the current branch usable

1. Commit and deploy this branch. The deployed `BETTER_AUTH_URL` must be the public HTTPS app origin; the MCP resource is derived from it as `<origin>/mcp`. Use the same database that now has migration `0007` recorded.
2. Set `MCP_ENABLED=true` and `NEXT_PUBLIC_MCP_ENABLED=true` in the deployment environment, then rebuild/redeploy. The local `.env.local` flags are already on but do not configure Vercel.
3. Sign in with a Pro account (the owner's superadmin test account also qualifies). In the header menu, copy the MCP URL from **Connect an AI client** and add it as a remote server in a client that supports the MCP `2026-07-28` profile and Client ID Metadata Documents. Approve the OAuth consent screen.
4. Check that `list_cities`, `list_songs`, `get_song`, and `set_song_tempo` work for the owner, reject a Free account, detect a stale `expectedUpdatedAt`, and stop working after **Disconnect**. Exercise token refresh/reconnect after deployment. Then ask the client for a loop ("a 100 BPM dub loop in Budapest with a kick-ducked bass"). Check that it calls `get_composer_guide` → `list_routes` → `preview_song_plan` → `create_song_from_plan`, then open the returned `openUrl`, press Play and listen. Compare with the same prompt in the in-app composer. MCP tools save songs; they never control an open DAW tab.
5. Test older MCP clients separately. This branch currently rejects legacy protocol requests and does not enable Dynamic Client Registration, so broad interoperability and full replacement of the in-app AI Composer remain later work.

## Reference material

- [MCP TypeScript SDK v2 HTTP handler and compatibility](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [Better Auth MCP plugin](https://better-auth.com/docs/plugins/mcp)
- [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)
