// Import only the assets used by the treasure web app from the local
// dota-skin-changer export. The published site is self-contained afterward.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const source = path.resolve(process.argv[2] ?? path.join(app, '..', '..', 'dota-skin-changer', 'web'));
const from = path.join(source, 'public', 'assets');
const to = path.resolve(app, '..', 'docs', 'treasures', 'assets');
if (!existsSync(from)) throw Error(`Source assets not found: ${from}`);

const models = JSON.parse(readFileSync(path.join(app, 'src', 'heroModels.json'), 'utf8'));
const crimson = JSON.parse(readFileSync(path.join(app, 'src', 'crimsonPreviews.json'), 'utf8'));
const files = new Set();
const add = (url) => {
  const prefix = '/treasures/assets/';
  if (!url.startsWith(prefix)) throw Error(`Unexpected asset path: ${url}`);
  const relative = url.slice(prefix.length);
  if (relative.includes('..') || path.isAbsolute(relative)) throw Error(`Invalid asset path: ${url}`);
  files.add(relative);
};
for (const definition of Object.values(models)) {
  for (const url of definition.models) add(url);
}
for (const relative of [...files]) {
  const data = readFileSync(path.join(from, relative));
  const length = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + length).toString('utf8'));
  for (const image of gltf.images ?? []) {
    if (!image.uri?.toLowerCase().endsWith('.png')) continue;
    const texture = path.posix.normalize(path.posix.join(path.posix.dirname(relative), image.uri.slice(0, -4) + '.webp'));
    if (texture.startsWith('../')) throw Error(`Invalid texture path: ${texture}`);
    files.add(texture);
  }
}
for (const url of JSON.stringify(crimson).match(/\/treasures\/assets\/[^"\\]+/g) ?? []) add(url);
for (const name of readdirSync(from)) {
  if (/\.(png|wav)$/.test(name)) files.add(name);
}
for (const directory of ['hero-stills', 'hero-turntables']) {
  for (const name of readdirSync(path.join(from, directory))) files.add(`${directory}/${name}`);
}

let bytes = 0;
for (const relative of [...files].sort()) {
  const input = path.join(from, relative);
  const output = path.join(to, relative);
  if (!existsSync(input)) throw Error(`Missing source asset: ${relative}`);
  mkdirSync(path.dirname(output), { recursive: true });
  if (relative.endsWith('.glb')) {
    const optimized = `${input}.gz`;
    const compressed = `${output}.gz`;
    if (!existsSync(optimized) || statSync(optimized).mtimeMs < statSync(input).mtimeMs) {
      throw Error(`Optimized model is missing or stale: ${optimized}`);
    }
    cpSync(optimized, compressed);
    if (existsSync(output)) rmSync(output);
    bytes += statSync(compressed).size;
  } else {
    cpSync(input, output);
    bytes += statSync(output).size;
  }
}
console.log(`Copied ${files.size} treasure assets (${(bytes / 1e6).toFixed(1)} MB) to ${to}`);
