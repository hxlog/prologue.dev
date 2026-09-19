#!/usr/bin/env node
/**
 * Check that every relative import in src/ resolves to a real file.
 *
 * Written after the route-group split. Moving `src/app/studio/login/page.js`
 * into `src/app/studio/(auth)/login/page.js` added a directory level to every
 * relative specifier in the tree, and the naive fix — add one `../` to every
 * specifier — is wrong, because the number of `../` a specifier needs is
 * `depth(old file) - depth(target)` and the files were at different depths.
 * `src/app/page.js` is one level down; `src/app/blog/[...slug]/page.js` is
 * three. The build found fifteen of them one at a time.
 *
 * This finds all of them at once, in a second, without a build. It resolves
 * only RELATIVE specifiers — a bare `next/link` is the bundler's problem — and
 * it checks the usual extension candidates, because this codebase writes
 * extensionless specifiers throughout.
 *
 *   node scripts/studio/check-imports.mjs [dir]
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TARGET = path.resolve(ROOT, process.argv[2] ?? "src");

const EXTENSIONS = ["", ".js", ".jsx", ".mjs", ".json", ".css"];

/** Every .js/.jsx/.mjs file under a directory, skipping node_modules. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every relative specifier in one file.
 *
 * Matches static `from "..."` and dynamic `import("...")`. Template literals
 * and computed specifiers are skipped rather than guessed at — every import in
 * this codebase is a literal.
 */
function specifiers(source) {
  const found = [];
  const patterns = [
    /\bfrom\s+["'](\.[^"']*)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']*)["']\s*\)/g,
    /\brequire\s*\(\s*["'](\.[^"']*)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.push({ specifier: match[1], index: match.index });
    }
  }
  return found;
}

function resolves(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
    // An extensionless directory import — `./foo` meaning `./foo/index.js`.
    const indexed = path.join(candidate, "index.js");
    if (fs.existsSync(indexed)) return true;
  }
  return false;
}

const files = walk(TARGET);
const broken = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const { specifier, index } of specifiers(source)) {
    if (resolves(file, specifier)) continue;
    const line = source.slice(0, index).split("\n").length;
    broken.push({
      file: path.relative(ROOT, file).replace(/\\/g, "/"),
      line,
      specifier,
    });
  }
}

if (!broken.length) {
  console.log(`OK — ${files.length} files, every relative import resolves.`);
} else {
  console.log(`\n${broken.length} unresolved import(s) in ${files.length} files:\n`);
  for (const b of broken) console.log(`  ${b.file}:${b.line}\n    ${b.specifier}`);
  process.exitCode = 1;
}
