import { defineManifest } from "@crxjs/vite-plugin";
import { EXTENSION_NAME } from "./shared/constants";

export default defineManifest({
  manifest_version: 3,
  name: EXTENSION_NAME,
  version: "0.1.0",
  description: "Claude usage overlay with privacy-safe usage metadata.",
  permissions: ["storage", "cookies"],
  host_permissions: ["https://claude.ai/*"],
  background: {
    service_worker: "src/background/background.ts",
    type: "module",
  },
  action: {
    default_title: EXTENSION_NAME,
    default_popup: "src/popup/popup.html",
  },
  icons: {
    16: "public/icons/icon16.svg",
    48: "public/icons/icon48.svg",
    128: "public/icons/icon128.svg",
  },
  content_scripts: [
    {
      matches: ["https://claude.ai/*"],
      js: ["src/content/content.tsx"],
      run_at: "document_start",
    },
  ],
  web_accessible_resources: [
    {
      resources: ["pageProbe.js"],
      matches: ["https://claude.ai/*"],
    },
  ],
});
