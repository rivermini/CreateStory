import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const bundle = join(dist, 'jobnib_browser_assistant.bundle.cjs');
const executable = join(dist, 'CreateStory-Jobnib-Companion-win-x64.exe');
const seaConfig = join(dist, 'sea-config.json');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The Windows x64 companion must be built on Windows x64.');
}
if (nodeMajor < 26) {
  throw new Error('Node.js 26 or newer is required to build the standalone companion.');
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(root, 'jobnib_browser_assistant.js')],
  bundle: true,
  outfile: bundle,
  platform: 'node',
  format: 'cjs',
  target: 'node26',
  minify: false,
  sourcemap: false,
});

writeFileSync(seaConfig, JSON.stringify({
  main: bundle,
  mainFormat: 'commonjs',
  output: executable,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgvExtension: 'none',
}, null, 2));

execFileSync(process.execPath, ['--build-sea', seaConfig], { stdio: 'inherit' });

if (process.env.CREATE_STORY_SIGN_CERT_SHA1) {
  execFileSync(process.env.CREATE_STORY_SIGNTOOL || 'signtool.exe', [
    'sign', '/sha1', process.env.CREATE_STORY_SIGN_CERT_SHA1,
    '/fd', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256', executable,
  ], { stdio: 'inherit' });
}

const bytes = readFileSync(executable);
const manifest = {
  version: packageJson.version,
  platform: 'windows-x64',
  filename: 'CreateStory-Jobnib-Companion-win-x64.exe',
  size: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  built_at: new Date().toISOString(),
};
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Built ${executable}`);
console.log(`SHA-256 ${manifest.sha256}`);
