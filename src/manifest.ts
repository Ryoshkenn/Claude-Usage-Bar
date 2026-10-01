import { defineManifest } from "@crxjs/vite-plugin";
import { EXTENSION_NAME } from "./shared/constants";

export default defineManifest({
  manifest_version: 3,
  name: EXTENSION_NAME,
  version: "1.4.0",
  description: "Claude usage overlay with privacy-safe usage metadata.",
  // "alarms" wakes the service worker at reset time (MV3 kills it after ~30s
  // idle, so setTimeout can never survive to a reset hours away). "scripting"
  // injects the reset banner into whatever page you're on — but only ever into
  // origins the user has explicitly granted below.
  permissions: ["storage", "alarms", "scripting"],
  host_permissions: ["https://claude.ai/*"],
  // Deliberately optional, not required: the all-sites banner is off by default
  // and Chrome only prompts at the moment the user turns it on. Putting this in
  // `host_permissions` would disable the extension for every existing install
  // until each user re-accepted the new warning.
  // Cast: @crxjs/vite-plugin's manifest types predate optional_host_permissions,
  // which is valid MV3 and passes through to the emitted manifest untouched.
  ...({ optional_host_permissions: ["*://*/*"] } as Record<string, unknown>),
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
