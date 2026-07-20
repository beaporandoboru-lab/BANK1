import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes the build use relative asset paths, so it works
// whether the site is served at https://<user>.github.io/<repo>/ or
// at a custom domain root, without any extra configuration.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
