import { defineManifest } from "@crxjs/vite-plugin";
import { EXTENSION_NAME } from "./shared/constants";

export default defineManifest({
  manifest_version: 3,
  name: EXTENSION_NAME,
  version: "1.2.0",
  description: "Claude usage overlay with privacy-safe usage metadata.",
  permissions: ["storage"],
  host_permissions: ["https://claude.ai/*"],
  background: {
    service_worker: "src/background/background.ts",
    type: "module",
  },
  action: {
    default_title: EXTENSION_NAME,
    default_popup: "src/popup/popup.html",
    default_icon: {
      16: "icons/icon16.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  },
  icons: {
    16: "icons/icon16.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
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
