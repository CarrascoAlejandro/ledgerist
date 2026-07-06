import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ledger.app',
  appName: 'Ledger',
  webDir: '../web/dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // P2P sync dials ws:// LAN addresses from the https-scheme webview —
    // without this the WebView blocks it as mixed content. Payloads are
    // app-layer AES-GCM encrypted regardless of the transport.
    // NOTE: API 28+ additionally requires android:usesCleartextTraffic="true"
    // on <application> in AndroidManifest.xml (android/ is regenerated — see
    // README "Mobile App" for the post-`cap add` step).
    allowMixedContent: true,
  },
};

export default config;
