import { resolveDataDir } from "@snext/core";
import { startServer } from "./index.js";

// Dev entry: API only (Vite serves the UI on :5173 and proxies /api here).
const server = await startServer({
  dir: resolveDataDir(),
  port: Number(process.env.SNEXT_PORT ?? 4317),
});
console.log(`sNext API on ${server.info.url} (data: ${server.info.dir})`);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.close().then(() => process.exit(0)));
