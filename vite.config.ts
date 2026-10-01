import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./src/manifest";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      // The grant page isn't referenced from the manifest (it's opened at
      // runtime via chrome.windows.create), so crxjs won't discover it —
      // declare it as an explicit entry or it never gets built.
      input: { grant: "src/grant/grant.html" },
    },
  },
});
