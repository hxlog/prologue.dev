/**
 * Asserts the loader produces the same document shape Contentlayer2 did, by
 * comparing field-for-field against the committed fixture
 * scripts/fixtures/content-shape-baseline.json.
 *
 * The fixture, not .contentlayer/generated, is the reference on purpose:
 * .contentlayer is gitignored, is produced only by Contentlayer2, and is gone
 * the moment Task 5 uninstalls it -- which is exactly the change this check
 * exists to validate. Refresh it with capture-shape-baseline.mjs if the
 * document schema ever legitimately changes.
 *
 * Run: node scripts/check-content-shape.mjs
 * Exit: 0 = same shape, 1 = a field was renamed, dropped, or retyped
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reference = JSON.parse(
  readFileSync(path.join(ROOT, "scripts", "fixtures", "content-shape-baseline.json"), "utf8")
);
const { getPosts } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "content", "standalone.js")).href
);
const allPosts = getPosts();

const FIELDS = [
  "title", "description", "image", "imageDesc",
  "draft", "featured", "tags", "slug", "urlslug", "slugAsParams",
];
const DATE_FIELDS = ["publishDate", "lastmod"];

let problems = 0;
const bySlug = new Map(allPosts.map((p) => [p.slug, p]));

if (allPosts.length !== reference.length) {
  console.error(`count: expected ${reference.length}, got ${allPosts.length}`);
  problems++;
}

for (const ref of reference) {
  const post = bySlug.get(ref.slug);
  if (!post) {
    console.error(`missing post: ${ref.slug}`);
    problems++;
    continue;
  }

  // categories: contentlayer's schema gives the field a `default: []` but no
  // `required: false`, and the generated output does carry the key on all 63
  // posts -- so the loader emitting [] as well is a match, not a divergence.
  // Both sides compare as a list so an absent key would also read as [].
  const cats = JSON.stringify([...(post.categories || [])].sort());
  const refCats = JSON.stringify([...(ref.categories || [])].sort());
  if (cats !== refCats) {
    console.error(`${ref.slug} .categories ref=${refCats} got=${cats}`);
    problems++;
  }

  for (const field of FIELDS) {
    const a = JSON.stringify(post[field] ?? null);
    const b = JSON.stringify(ref[field] ?? null);
    if (a !== b) {
      console.error(`${ref.slug} .${field}\n  ref=${b}\n  got=${a}`);
      problems++;
    }
  }

  for (const field of DATE_FIELDS) {
    const a = post[field] ? new Date(post[field]).toISOString() : null;
    const b = ref[field] ? new Date(ref[field]).toISOString() : null;
    if (a !== b) {
      console.error(`${ref.slug} .${field} ref=${b} got=${a}`);
      problems++;
    }
  }

  // body.html is a lazy, throwing getter by design (see load.js), so it is
  // deliberately NOT read in this loop -- reading it for all 63 posts would pay
  // Shiki's ~13s cold start, which is exactly what the lazy design avoids, and
  // the equivalence harness is what proves its content. What is checked here is
  // that `body.raw` is a string and that `body` carries an `html` property at
  // all, so a consumer that reads it gets a real error rather than `undefined`.
  if (typeof post.body?.raw !== "string") {
    console.error(`${ref.slug} .body.raw is not a string`);
    problems++;
  }
  if (!Object.getOwnPropertyDescriptor(post.body ?? {}, "html")) {
    console.error(`${ref.slug} .body has no html property`);
    problems++;
  }
  if (!Array.isArray(post.headings)) {
    console.error(`${ref.slug} .headings not an array`);
    problems++;
  }
  const rt = post.readingTime;
  if (!rt || typeof rt.text !== "string" || typeof rt.words !== "number") {
    console.error(`${ref.slug} .readingTime shape wrong: ${JSON.stringify(rt)}`);
    problems++;
  }
}

console.log(`\n${reference.length} posts compared, ${problems} problems`);
process.exit(problems === 0 ? 0 : 1);
