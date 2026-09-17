#!/usr/bin/env node
/**
 * Patches the generated (gitignored) android/ project after `cap add android`.
 * Idempotent — safe to run repeatedly. Applies:
 *   1. android:usesCleartextTraffic="true" on <application> (Device Sync uses
 *      ws:// on the LAN; payloads are app-layer AES-GCM encrypted).
 *   2. minSdkVersion 26 (required by @capacitor/barcode-scanner's native lib).
 *   3. versionName / versionCode derived from this package's version, so
 *      release APKs upgrade in place (versionCode = major*10000 + minor*100 + patch).
 *   4. Launcher icons (legacy mipmaps + adaptive foreground/background) generated
 *      from assets/ by capacitor-assets. The icons live in the gitignored
 *      android/ tree, so they have to be regenerated alongside it — run
 *      `npm run icons` at the repo root first if assets/icon.svg changed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const android = join(root, 'android');

function patch(file, apply) {
  const before = readFileSync(file, 'utf8');
  const after = apply(before);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`patched ${file}`);
  } else {
    console.log(`ok      ${file}`);
  }
}

// 1. Cleartext traffic for LAN sync
patch(join(android, 'app/src/main/AndroidManifest.xml'), (src) => {
  if (src.includes('android:usesCleartextTraffic')) return src;
  return src.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
});

// 2. minSdk 26
patch(join(android, 'variables.gradle'), (src) =>
  src.replace(/minSdkVersion = \d+/, 'minSdkVersion = 26'),
);

// 3. Version from package.json
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
if (!m) throw new Error(`cannot parse version "${version}"`);
const versionCode = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);

patch(join(android, 'app/build.gradle'), (src) =>
  src
    .replace(/versionCode \d+/, `versionCode ${versionCode}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`),
);

// 4. Launcher icons. capacitor-assets writes mipmap-*/ and the adaptive icon
// XML into android/, which cap add regenerates from scratch — so this has to
// run on every prepare, not just once.
const iconSource = join(root, 'assets/icon.png');
if (existsSync(iconSource)) {
  execFileSync('npx', ['capacitor-assets', 'generate', '--android'], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('ok      launcher icons');
} else {
  console.warn(`WARNING no ${iconSource} — run \`npm run icons\` at the repo root.`);
  console.warn('        the APK will ship the default Capacitor icon.');
}

console.log(`android project ready (versionName ${version}, versionCode ${versionCode})`);
