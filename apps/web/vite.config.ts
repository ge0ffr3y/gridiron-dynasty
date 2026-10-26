import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Keeps the real-league starting file (built from private ratings, git-ignored, copied into
 * public/private/ for the local dev server) out of a production build, so it can never be uploaded
 * with the site. Set KEEP_PRIVATE=1 to keep it in a build you run for yourself.
 */
function leaveOutPrivate(): Plugin {
  let outDir = "";
  return {
    name: "leave-out-private",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    writeBundle() {
      if (process.env["KEEP_PRIVATE"] === "1") return;
      rmSync(join(outDir, "private"), { recursive: true, force: true });
    },
  };
}

// A host that serves the site from a sub-path (e.g. GitHub Pages at
// /<repo-name>/) sets VITE_BASE. Locally it defaults to "/".
export default defineConfig({
  base: process.env["VITE_BASE"] ?? "/",
  plugins: [react(), tailwindcss(), leaveOutPrivate()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  worker: { format: "es" },
});
