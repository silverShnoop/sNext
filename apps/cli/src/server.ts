import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { paths } from "@snext/core";
import { DEFAULT_PORT, findRunningServer, startServer, type ServerInfo } from "@snext/web/server";

/** Start in the foreground, trying the next few ports if the default is taken. */
export async function serveForeground(dir: string, port: number | undefined, host: string | undefined) {
  const base = port ?? DEFAULT_PORT;
  for (let p = base; p < base + 10; p++) {
    try {
      const server = await startServer({ dir, port: p, host });
      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.on(sig, () => server.close().then(() => process.exit(0)));
      }
      return server;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || port !== undefined) throw err;
    }
  }
  throw new Error(`no free port in ${base}-${base + 9}`);
}

/** Return the running server for this data dir, starting a detached one if needed. */
export async function ensureServer(dir: string, port?: number): Promise<{ info: ServerInfo; started: boolean }> {
  const running = await findRunningServer(dir);
  if (running) return { info: running, started: false };

  fs.mkdirSync(paths.state(dir), { recursive: true });
  const out = fs.openSync(path.join(paths.state(dir), "server.out"), "a");
  const args = [process.argv[1]!, "serve", "--dir", dir];
  if (port) args.push("--port", String(port));
  const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", out, out] });
  child.unref();

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const info = await findRunningServer(dir);
    if (info) return { info, started: true };
    if (child.exitCode !== null) break;
  }
  throw new Error(`server failed to start; see ${path.join(paths.state(dir), "server.out")}`);
}

export async function stopServer(dir: string): Promise<ServerInfo | undefined> {
  const info = await findRunningServer(dir);
  if (!info) return undefined;
  process.kill(info.pid, "SIGTERM");
  return info;
}

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // no browser available; the URL is printed anyway
  }
}
