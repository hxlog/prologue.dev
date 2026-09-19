/**
 * The hook itself. See register-loader.mjs for why it exists.
 *
 * Two shapes need handling:
 *   "../db"            -> "../db.js"  or  "../db/index.js"
 *   "@alias"           -> left alone (this repo uses relative paths, not @/*)
 *
 * Only specifiers that are RELATIVE and have no extension are touched, so a
 * genuine package name is never rewritten.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[cm]?js$/.test(specifier) || /\.[cm]?json$/.test(specifier);

  if (isRelative && !hasExtension && context.parentURL) {
    const parentDir = fileURLToPath(new URL(".", context.parentURL));

    for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
      const asUrl = new URL(candidate, `file://${parentDir}`);
      if (existsSync(fileURLToPath(asUrl))) {
        return nextResolve(candidate, context);
      }
    }
  }

  return nextResolve(specifier, context);
}
