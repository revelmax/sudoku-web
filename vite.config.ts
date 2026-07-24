import { defineConfig } from "vite";

// base: "./" so the built site works from any static-host subpath
// (GitHub Pages project pages, etc.) without rewriting asset URLs.
export default defineConfig({
  base: "./",
});
