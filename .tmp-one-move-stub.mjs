// Temporary harness: the three responses the One Move play screen needs, so the
// real client can be played in a browser without touching a deployed backend.
// The score is echoed; the authoritative verifier is exercised by
// tests/security/rls_test.sql.
import { createServer } from "node:http";

const PORT = 8098;
let sessions = 0;

const game = {
  slug: "one-move",
  title: "One Move",
  tagline: "One move. One solution.",
  description: "Every board is a checkerboard with exactly one move already made.",
  instructions: "Tap the cell that restores the checkerboard.",
  category: { slug: "logic", name: "Logic" },
  runtime: "one-move",
  playable: true,
  plays: 0,
  isOfficial: true,
  coverPath: null,
  publishedAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, x-request-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(payload === undefined ? "" : JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/v1/games/one-move") {
    return send(res, 200, game);
  }

  if (req.method === "POST" && url.pathname === "/api/v1/sessions") {
    sessions += 1;
    const now = new Date();
    return send(res, 201, {
      id: `22222222-3333-4444-8555-${String(sessions).padStart(12, "0")}`,
      gameSlug: "one-move",
      rulesVersion: "one-move@2",
      seed: "1",
      tileCount: 4096,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      ranked: false,
    });
  }

  const complete = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/complete$/);
  if (req.method === "POST" && complete) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const actions = Array.isArray(body?.progress?.actions) ? body.progress.actions : [];
    console.log(
      JSON.stringify({
        session: complete[1],
        rulesVersion: body?.progress?.rulesVersion,
        score: body?.score,
        actions: actions.length,
        durationMs: body?.durationMs,
      }),
    );
    return send(res, 200, {
      sessionId: complete[1],
      gameSlug: "one-move",
      score: Number(body?.score ?? 0),
      clearedColumns: Math.floor(Number(body?.score ?? 0) / 10),
      tilesPlaced: actions.length,
      durationMs: Number(body?.durationMs ?? 1),
      ranked: false,
      recordedAt: new Date().toISOString(),
      personalBest: null,
      rank: null,
      duplicate: false,
    });
  }

  return send(res, 404, { error: { code: "not_found", message: "stub route" } });
});

server.listen(PORT, "127.0.0.1", () => console.log(`stub listening on ${PORT}`));
