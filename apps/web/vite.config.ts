import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.SNEXT_PORT ?? "4317";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
});
