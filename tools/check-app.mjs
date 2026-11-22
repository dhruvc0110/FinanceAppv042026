// Basic safety check for FinApp: confirms every inline <script> block in
// index.html is valid JavaScript, and that sw.js / the manifest parse.
// Run locally with:  node tools/check-app.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const html = readFileSync('index.html', 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'finapp-check-'));
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, failed = false;
while ((m = re.exec(html))) {
  const f = join(dir, `inline-${i++}.js`);
  writeFileSync(f, m[1]);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed = true; console.error(`Inline script #${i} has a syntax error:\n${e.stderr}`); }
}
try { execFileSync(process.execPath, ['--check', 'sw.js'], { stdio: 'pipe' }); }
catch (e) { failed = true; console.error(`sw.js has a syntax error:\n${e.stderr}`); }
try { JSON.parse(readFileSync('manifest.webmanifest', 'utf8')); }
catch (e) { failed = true; console.error('manifest.webmanifest is not valid JSON: ' + e.message); }

if (failed) process.exit(1);
console.log(`OK: ${i} inline script block(s), sw.js and manifest are valid.`);
