import type { CapacitorConfig } from '@capacitor/cli';

/**
 * One Capacitor project, two binaries. `MOBILE_APP` picks which one `cap sync` is
 * preparing; `scripts/sync.mjs` is the only thing that sets it, so the two can never be
 * half-mixed by hand.
 *
 * The Android applicationId is NOT taken from `appId` at build time — it is a Gradle
 * property (`hydromartAppId`, see android/app/build.gradle), because one Android project
 * has to be able to produce both AABs from the same source tree. `appId` here is what
 * `cap add android` scaffolded with and what the config file in the assets reports.
 */
const BINARIES = {
  customer: {
    appId: 'id.hydromart.app',
    appName: 'Hydromart',
    webDir: '../apps/web/mobile-out-customer',
  },
  ops: {
    appId: 'id.hydromart.ops',
    appName: 'Hydromart Ops',
    webDir: '../apps/web/mobile-out-ops',
  },
} as const;

const target = process.env.MOBILE_APP === 'ops' ? 'ops' : 'customer';

const config: CapacitorConfig = {
  ...BINARIES[target],
  server: {
    /**
     * Load the bundled assets from `https://localhost`, not `http://`.
     *
     * This is the single most load-bearing line in the shell. The gateway decides
     * bearer-vs-cookie by `Origin` (`session-bff.ts`), and `isNativeShell()` on the web
     * side answers from the same string. Change the scheme or the hostname and the app
     * silently loses its session on the next login — every request would be treated as
     * a browser and handed cookies the WebView never sends back.
     *
     * It is also what makes the WebView a secure context, which `navigator.geolocation`
     * and the camera both require.
     */
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      /**
       * The shell hides it, not a timer. `launchAutoHide: true` dismisses the splash after
       * a fixed delay whether or not the web layer has painted, which on a cold start over
       * a slow connection means a white screen with nothing in it. `NativeBridge` calls
       * `hide()` once React has mounted — unconditionally, including on the error path,
       * because a splash that only hides on the happy path is a dead app when something
       * throws.
       */
      launchAutoHide: false,
      backgroundColor: '#0b4d57',
      // No `androidSpinnerStyle`/`spinnerColor` here: both are only read when `showSpinner`
      // is true, which it never was. They read as an intention that never happened, and
      // the next person to touch this would have debugged a spinner that was never on.
    },
  },
  android: {
    // F6 sets `usesCleartextTraffic=false` for release. Nothing in the app should ever
    // reach a plain-http URL: `MOBILE_API_URL` is https, and a missing one falls back to
    // `http://localhost:8080`, which Android blocks as an unreadable network error.
    allowMixedContent: false,
  },
};

export default config;
