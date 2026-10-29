import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SnextError,
  Store,
  buildRoadmap,
  buildTimeline,
  closeSprint,
  commitSprint,
  dropGoal,
  importTree,
  listAgents,
  listMetrics,
  listSprints,
  logSize,
  paths,
  rankGoals,
  readLog,
  readSettings,
  setSprintSummary,
  summarizeMetric,
  tailLog,
  updateSettings,
  type CloseOptions,
  type ImportNode,
  type SettingsPatch,
} from "@snext/core";
import { renderReport } from "./report.js";

export const DEFAULT_PORT = 4317;

export interface ServerOptions {
  dir: string;
  port?: number;
  host?: string;
  /** Directory of built UI assets; defaults to the bundled dist/client. */
  clientDir?: string;
}

export interface ServerInfo {
  pid: number;
  port: number;
  url: string;
  dir: string;
  startedAt: string;
}

export interface RunningServer {
  info: ServerInfo;
  close(): Promise<void>;
}

const UI_ACTOR = "ui";
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const store = new Store(opts.dir);
  const host = opts.host ?? "127.0.0.1";
  const clientDir = opts.clientDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");
  const clients = new Set<http.ServerResponse>();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      serveStatic(res, clientDir, url.pathname);
    } catch (err) {
      sendError(res, err);
    }
  });

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const method = req.method ?? "GET";
    guardRequest(req, method);
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
    const [resource, id, sub] = parts;

    if (resource === "health") return json(res, { ok: true, dir: opts.dir, pid: process.pid });
    if (resource === "events" && method === "GET") return openEvents(req, res);
    if (resource === "agents") return json(res, listAgents(opts.dir));
    if (resource === "log") return json(res, tailLog(opts.dir, Number(url.searchParams.get("limit") ?? 100)).reverse());
    if (resource === "rank" && method === "GET") {
      const within = url.searchParams.get("within") ?? undefined;
      return json(res, rankGoals(store.list(), { within }).map(slim));
    }
    if (resource === "metrics" && method === "GET") return json(res, metricsWithSummary());
    if (resource === "timeline" && method === "GET") {
      const t = buildTimeline(store.list(), readSettings(opts.dir), listSprints(opts.dir));
      return json(res, { ...t, buckets: t.buckets.map((b) => ({ ...b, goals: b.goals.map(slim) })) });
    }
    if (resource === "roadmap" && method === "GET") return json(res, roadmap());
    if (resource === "report" && method === "GET") {
      const html = renderReport(roadmap(), metricsWithSummary());
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        ...(url.searchParams.get("download") ? { "content-disposition": `attachment; filename="snext-report-${html.date}.html"` } : {}),
      });
      return res.end(html.html);
    }
    if (resource === "sprints") {
      if (!id && method === "GET") return json(res, listSprints(opts.dir));
      const n = Number(id);
      if (sub === "commit" && method === "POST") {
        const body = (await readBody(req)) as { force?: boolean };
        return json(res, commitSprint(store, UI_ACTOR, { sprint: n, force: body.force }));
      }
      if (sub === "close" && method === "POST") {
        const body = (await readBody(req)) as Omit<CloseOptions, "sprint" | "today">;
        return json(res, closeSprint(store, UI_ACTOR, { ...body, sprint: n }));
      }
      if (sub === "summary" && method === "PUT") {
        const body = (await readBody(req)) as { summary?: string };
        return json(res, setSprintSummary(opts.dir, n, body.summary ?? "", UI_ACTOR));
      }
    }
    if (resource === "settings" && method === "GET") return json(res, readSettings(opts.dir));
    if (resource === "settings" && method === "PATCH") {
      return json(res, updateSettings(opts.dir, (await readBody(req)) as SettingsPatch, UI_ACTOR));
    }
    if (resource === "import" && method === "POST") {
      const body = (await readBody(req)) as { parent?: string; items: ImportNode[] };
      return json(res, importTree(store, body.items ?? [], UI_ACTOR, { parent: body.parent }));
    }
    if (resource === "items") {
      if (!id && method === "GET") return json(res, store.list());
      if (!id && method === "POST") return json(res, store.create((await readBody(req)) as never, UI_ACTOR), 201);
      if (id && !sub && method === "GET") return json(res, store.get(id));
      if (id && !sub && method === "PATCH") return json(res, store.update(id, (await readBody(req)) as never, UI_ACTOR));
      if (id && !sub && method === "DELETE") {
        const deleted = store.delete(id, { recursive: url.searchParams.get("recursive") === "1" }, UI_ACTOR);
        return json(res, deleted.map((i) => i.id));
      }
      if (id && sub === "drop" && method === "POST") {
        const body = (await readBody(req)) as { note?: string };
        return json(res, dropGoal(store, id, UI_ACTOR, body.note));
      }
      if (id && sub === "move" && method === "POST") return json(res, store.move(id, (await readBody(req)) as never, UI_ACTOR));
      if (id && sub === "links" && method === "POST") return json(res, store.addLink(id, (await readBody(req)) as never, UI_ACTOR));
      if (id && sub === "links" && method === "DELETE") {
        return json(res, store.removeLink(id, url.searchParams.get("ref") ?? "", UI_ACTOR));
      }
    }
    throw new SnextError(`no route for ${method} ${url.pathname}`, "not_found");
  }

  function metricsWithSummary() {
    return listMetrics(opts.dir).map((m) => ({ ...m, summary: summarizeMetric(m) }));
  }

  function roadmap() {
    const r = buildRoadmap(store.list(), readSettings(opts.dir), listSprints(opts.dir));
    return { ...r, timeline: { ...r.timeline, buckets: r.timeline.buckets.map((b) => ({ ...b, goals: b.goals.map(slim) })) } };
  }

  function openEvents(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  // Poll the log rather than fs.watch: it is cheap, works on every platform, and
  // catches writes from the CLI and hand edits made by other processes.
  let offset = logSize(opts.dir);
  const poll = setInterval(() => {
    const { entries, offset: next } = readLog(opts.dir, offset);
    offset = next;
    if (entries.length) {
      const msg = `event: change\ndata: ${JSON.stringify(entries)}\n\n`;
      for (const c of clients) c.write(msg);
    }
  }, 400);
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 25_000);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? DEFAULT_PORT, host, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? DEFAULT_PORT);
  const info: ServerInfo = {
    pid: process.pid,
    port,
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
    dir: opts.dir,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(paths.server(opts.dir), JSON.stringify(info, null, 2));

  return {
    info,
    close: async () => {
      clearInterval(poll);
      clearInterval(heartbeat);
      for (const c of clients) c.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        const current = JSON.parse(fs.readFileSync(paths.server(opts.dir), "utf8")) as ServerInfo;
        if (current.pid === process.pid) fs.rmSync(paths.server(opts.dir));
      } catch {
        // already gone
      }
    },
  };
}

/** Returns the server recorded for this data dir if it answers its health check. */
export async function findRunningServer(dir: string): Promise<ServerInfo | undefined> {
  let info: ServerInfo;
  try {
    info = JSON.parse(fs.readFileSync(paths.server(dir), "utf8")) as ServerInfo;
  } catch {
    return undefined;
  }
  try {
    const res = await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(1000) });
    const body = (await res.json()) as { ok?: boolean; dir?: string };
    return body.ok && path.resolve(body.dir ?? "") === path.resolve(dir) ? info : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The API is unauthenticated and meant for this machine only. Reject requests
 * whose Host is not loopback (DNS rebinding) and mutations that are not JSON,
 * which a cross-site form or no-preflight fetch cannot send.
 */
function guardRequest(req: http.IncomingMessage, method: string) {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new SnextError(`forbidden host "${host}"`, "invalid");
  }
  if (method !== "GET" && method !== "DELETE" && !String(req.headers["content-type"]).startsWith("application/json")) {
    throw new SnextError("mutations require content-type: application/json", "invalid");
  }
  if (method === "DELETE" && req.headers.origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) {
    throw new SnextError("cross-origin request refused", "invalid");
  }
}

/** Ranked/planned goals reference their project and area by id and title only. */
function slim<T extends { project?: { id: string; title: string }; area?: { id: string; title: string } }>(g: T) {
  return {
    ...g,
    project: g.project && { id: g.project.id, title: g.project.title },
    area: g.area && { id: g.area.id, title: g.area.title },
  };
}

function serveStatic(res: http.ServerResponse, root: string, pathname: string) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(root, safe);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, "index.html");
  }
  if (!fs.existsSync(file)) {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("sNext UI is not built. Run `pnpm build` in the repository root.");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

function json(res: http.ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res: http.ServerResponse, err: unknown) {
  if (err instanceof SnextError) {
    const status = { not_found: 404, invalid: 400, conflict: 409 }[err.code];
    return json(res, { error: err.message, code: err.code }, status);
  }
  json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new SnextError("request body must be JSON");
  }
}
export { renderReport } from "./report.js";
