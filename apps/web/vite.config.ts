import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A host that serves the site from a sub-path (e.g. GitHub Pages at
// /<repo-name>/) sets VITE_BASE. Locally it defaults to "/".
export default defineConfig({
  base: process.env["VITE_BASE"] ?? "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  worker: { format: "es" },
});
