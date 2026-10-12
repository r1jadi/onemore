# services/games

The public game catalogue: which games exist, what they are, and how many
published games each category holds. It is the read side of the product — the
screens that browse, search and open a game.

## Routes

| Route                               | Auth          | What it does                                                                                                                                                                             |
| ----------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/games`                 | public        | A page of published games, newest first. Filters: `category` (slug), `q` (substring over title, tagline and description), `sort` (only `latest`), `limit` (1–100, default 20), `cursor`. |
| `GET /api/v1/games/{slug}`          | public        | One published game, by its stable slug (`stack-10`).                                                                                                                                     |
| `GET /api/v1/categories`            | public        | Every category with its real published-game count.                                                                                                                                       |
| `POST /api/v1/games`                | authenticated | **Planned** — answers `501`. Creating a game is a separate feature.                                                                                                                      |
| `PATCH /api/v1/games/{slug}`        | authenticated | **Planned** — answers `501`.                                                                                                                                                             |
| `POST /api/v1/games/{slug}/publish` | authenticated | **Planned** — answers `501`. Publishing is a moderation decision.                                                                                                                        |

`x-status` in [`packages/api-contracts/openapi-v1.yaml`](../../packages/api-contracts/openapi-v1.yaml)
is the authority for which of these are implemented; the planned three exist so
the contract and the router cannot drift, and so a client gets a documented `501`
rather than an unexplained `404`.

## What the catalogue deliberately does not return

No response carries a play count, like total, comment total, save total, rating,
average session duration or ranking. None of them can be derived from stored
activity today: the sessions, scores and social services are not implemented, so
`public.game_sessions` and `public.scores` are empty. A zero would read as a
measurement and an estimate would read as a fact, so the fields are absent and the
UI renders nothing.

`sort` therefore accepts exactly one value. `popular` and `trending` need play
counts, and a `400` that says so is more honest than a ranking computed from
publication order.

For the same reason `GET /api/v1/games/{slug}` reports `playable: false` and
`runtime: null` for every game: no game runtime has been built, and the UI must not
offer a Play button that cannot start anything. `playable` is true only when a
runtime genuinely exists — the database enforces that with
`games_playable_requires_runtime`.

## How it reads

Two properties of the client
([`internal/supabasegames/client.go`](internal/supabasegames/client.go)) matter:

- **Public reads use the publishable key and no user token.** The Data API answers
  as the `anon` role, so Row Level Security is the authority on what exists: an
  unpublished game is not filtered out by this service, it is not in the response
  at all. The service holds no credential that could read a draft.
- **The service never writes.** Creating and editing games is a later feature, so a
  bug here cannot mutate production content.

An unknown slug and an unpublished game both answer `404`, which is why they must
stay indistinguishable: telling them apart would let a stranger enumerate drafts.

Category counts come from `public.category_game_counts`, a view whose
`status = 'published'` filter lives inside its definition — so a draft never
contributes, not even for a caller who could see it.

## Cursors

Pagination is keyset, not offset: the cursor is the sort key of the last row of the
previous page (its `published_at` and `id`), base64url-encoded and opaque. A game
published between two requests therefore lands on a later page instead of shifting
every following row and duplicating one.

The client asks the Data API for one row more than the page size; that extra row is
how the handler knows another page exists without a `COUNT`.

## Running it locally

```bash
cd services
ENVIRONMENT=development \
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_PUBLISHABLE_KEY=<publishable key> \
go run ./games/cmd/games            # serves :8080 by default
```

```bash
# Through the gateway, which is how the browser reaches it in production
UPSTREAM_GAMES_URL=http://localhost:8080 SERVICE_NAME=gateway HTTP_ADDR=:8081 \
  go run ./gateway/cmd/gateway
curl -s localhost:8081/api/v1/games | jq
```

Without `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` the service still boots,
serves its probes, and answers `503` on the catalogue routes — a diagnosable state
rather than a crash loop.

## Deployment

Deployed as the `games` service in [`vercel.json`](../../vercel.json) with
`"root": "services/"` and `"entrypoint": "main.go"`. That file is
[`services/main.go`](../main.go), and it exists only because Vercel's Go framework
preset recognises exactly three entrypoint names — `main.go`, `cmd/api/main.go` and
`cmd/server/main.go` — and the other two are taken by the users and auth services.
It is the same one line as [`cmd/games/main.go`](cmd/games/main.go), so the local
binary and the deployment cannot drift.

The gateway reaches it over the `UPSTREAM_GAMES_URL` service binding declared on the
`api` service, so the public path stays
`https://onemorestartup.vercel.app/api/v1/games`. See
[deployment/vercel.md](../../docs/deployment/vercel.md).

## Tests

```bash
cd services && go test ./games/...
```

The suite covers the query the client builds, the cursor round-trip, every rejected
parameter, `404` for an unknown slug, the `503` when Supabase is unconfigured, and
the absence of fabricated metrics from a response. The database-side rules —
unpublished games invisible to an anonymous caller, and the category count — are in
[`tests/security/rls_test.sql`](../../tests/security/rls_test.sql), run by
`./scripts/test-rls.sh`.
