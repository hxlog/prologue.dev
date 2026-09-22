/**
 * Validates that everything the starter template ships is parseable, before it
 * is published to people who will build it.
 *
 * This exists because of a bug the final sweep found: template/data/
 * headerNavLinks.js had a YAML-style `#` comment header in a `.js` file. It
 * never executes in this repo, so nothing caught it until `npm run lint`
 * tripped over it. **The template's files are only ever checked by accident** —
 * `template/` is not in the app's module graph, has no tests, and its JS runs
 * nowhere — so a broken one can sit there until a stranger clones the template
 * and their first `npm run build` fails.
 *
 * Checks parse-ability, not behaviour: a JS file must be valid ES module
 * syntax, YAML must parse to something, and markdown must carry frontmatter the
 * loader will accept (a title; a publishDate for posts; booleans for
 * draft/featured, which is the exact property-type mistake Obsidian's UI can
 * cause).
 *
 * Usage: node scripts/check-template.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import yaml from "yaml";

const require = createRequire(import.meta.url);
const ROOT = path.join(process.cwd(), "template");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const problems = [];
const files = walk(ROOT);
const byExtension = {};

for (const file of files) {
  const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
  const ext = path.extname(file);
  byExtension[ext] = (byExtension[ext] || 0) + 1;

  try {
    if (ext === ".js") {
      // Parse, do not execute. `new vm.Script` is the wrong tool: it assumes a
      // script (CommonJS) goal, so every `export` is a syntax error and the
      // check would reject the two files that are legitimately ES modules.
      // acorn is already in the tree (via eslint) and parses the module goal.
      const acorn = require("acorn");
      acorn.parse(readFileSync(file, "utf8"), {
        ecmaVersion: "latest",
        sourceType: "module",
        allowHashBang: true,
      });
    } else if (ext === ".yaml" || ext === ".yml") {
      const parsed = yaml.parse(readFileSync(file, "utf8"));
      if (parsed === null || parsed === undefined) {
        problems.push(`${rel}: parses to ${parsed}`);
      }
    } else if (ext === ".json") {
      JSON.parse(readFileSync(file, "utf8"));
    } else if (ext === ".md" || ext === ".mdx") {
      const raw = readFileSync(file, "utf8");
      if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
        problems.push(`${rel}: markdown with no frontmatter block`);
      }
      // The loader requires title; posts additionally require publishDate.
      const fm = raw.slice(4, raw.indexOf("\n---", 3));
      const data = yaml.parse(fm);
      if (!data || typeof data.title !== "string" || !data.title) {
        problems.push(`${rel}: frontmatter has no title`);
      }
      if (rel.includes("/blog/") && !data.publishDate) {
        problems.push(`${rel}: blog post has no publishDate (the loader requires it)`);
      }
      if (data.draft !== undefined && typeof data.draft !== "boolean") {
        problems.push(`${rel}: draft is ${JSON.stringify(data.draft)}, must be a boolean`);
      }
      if (data.featured !== undefined && typeof data.featured !== "boolean") {
        problems.push(`${rel}: featured is ${JSON.stringify(data.featured)}, must be a boolean`);
      }
    }
  } catch (error) {
    problems.push(`${rel}: ${error.message.split("\n")[0]}`);
  }
}

console.log(`template files: ${files.length}  ${JSON.stringify(byExtension)}`);
console.log(`\n${problems.length} problem(s)`);
for (const p of problems) console.log(`  FAIL ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
