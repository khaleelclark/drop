#!/usr/bin/env node
// Native packages consume the reviewed frontend without rebuilding it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function verify(root, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expected = new Set();
  for (const item of (manifest.bundleFiles ?? manifest.distFiles)) {
    if (!item.path.startsWith('web/dist/') || item.path.split('/').includes('..') || expected.has(item.path)) throw Error('Invalid frozen asset path');
    expected.add(item.path);
    const file = path.join(root, item.path);
    if (!fs.lstatSync(file).isFile()) throw Error(`Nonregular asset: ${item.path}`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== item.size || crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error(`Frozen asset mismatch: ${item.path}`);
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (!entry.isFile() || !expected.delete(file)) throw Error(`Unexpected asset: ${file}`);
    }
  }
  if (!expected.size) throw Error('Empty frozen bundle');
  const count = expected.size;
  walk('web/dist');
  if (expected.size) throw Error('Missing frozen asset');
  return count;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  console.log(`Verified ${verify(root, path.join(root, 'web/release-evidence/tab-switch-build/frozen-manifest.json'))} frozen frontend assets`);
}
module.exports = {verify};
