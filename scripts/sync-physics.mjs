// Copies packages/model/src/{physics,types}.ts into stdb/src/ with a generated header.
// `--check` fails if the copies differ from the source instead of writing them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'packages/model/src');
const outDir = join(root, 'stdb/src');
const files = ['physics.ts', 'types.ts'];
const check = process.argv.includes('--check');

const header = (file) =>
  `// GENERATED COPY of packages/model/src/${file}. Do not edit.\n// Run \`npm run sync-physics\` to refresh.\n\n`;

let failed = false;
for (const file of files) {
  const src = join(srcDir, file);
  const out = join(outDir, file);
  if (!existsSync(src)) {
    console.error(`missing source: packages/model/src/${file}`);
    failed = true;
    continue;
  }
  const expected = header(file) + readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
  if (check) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== expected) {
      console.error(`out of sync: stdb/src/${file} (run npm run sync-physics)`);
      failed = true;
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(out, expected);
    console.log(`synced stdb/src/${file}`);
  }
}

if (failed) process.exit(1);
if (check) console.log('physics copies match source');
