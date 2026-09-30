import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, '..', '..', 'docs', 'treasures');
const manifest = JSON.parse(readFileSync(path.join(output, '.vite', 'manifest.json'), 'utf8'));
const keep = new Set();
for (const entry of Object.values(manifest)) {
  keep.add(entry.file);
  for (const css of entry.css ?? []) keep.add(css);
  for (const asset of entry.assets ?? []) keep.add(asset);
}
const bundles = path.join(output, 'assets');
for (const name of readdirSync(bundles)) {
  if (!/^(index|HeroPreview)-[A-Za-z0-9_-]+\.(js|css)$/.test(name)) continue;
  if (!keep.has(`assets/${name}`)) rmSync(path.join(bundles, name));
}
