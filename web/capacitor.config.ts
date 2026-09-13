import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android packaging via Capacitor. The web build in `dist/` is bundled into the
 * APK; the app talks to your server over HTTPS (address entered on the login
 * screen or set with VITE_API_BASE at build time).
 *
 *   npm run build -w web
 *   npx cap add android      (first time only)
 *   npm run cap:sync -w web
 *   npm run cap:open -w web  (opens Android Studio)
 */
const config: CapacitorConfig = {
  appId: "uk.trails.app",
  appName: "Trails",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // Location permissions are requested at runtime by @capacitor/geolocation.
  },
};

export default config;
