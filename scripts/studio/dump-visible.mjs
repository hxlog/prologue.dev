/**
 * Dump the visible text of a studio page for a signed-in session.
 *
 * The App Router streams its markup inside a Flight payload as JSON strings, so
 * a naive `body.includes("添加链接")` fails on a page that renders perfectly —
 * the text is there, escaped as `添加链接`. This decodes both
 * the raw body and the escape sequences before looking, which is what an
 * assertion in e2e.mjs has to do too.
 *
 *   node --env-file=.env.local scripts/studio/dump-visible.mjs /studio/nav
 */

import pg from "pg";
import { randomBytes, createHash } from "node:crypto";

const BASE = process.env.BASE_URL || "http://localhost:3215";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  ssl: false,
});
await client.connect();

const { rows: users } = await client.query(`SELECT id FROM users LIMIT 1`);
if (!users.length) {
  console.error("no user to sign in as");
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
await client.query(
  `INSERT INTO sessions (user_id, token_hash, expires_at)
   VALUES ($1, $2, now() + interval '10 minutes')`,
  [users[0].id, tokenHash]
);

const NEEDLES = [
  "添加链接",
  "外部链接",
  "名称",
  "显示",
  "删除",
  "个版本",
  "起始版本",
  "历史版本",
  "页面设置",
  "MDX 无法编译",
  "关于作者",
  "已发布",
];

for (const pathname of process.argv.slice(2)) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { cookie: `__Host-prologue_session=${token}` },
  });
  const body = await res.text();
  const decoded = body.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );

  console.log(`\n=== ${pathname}  status ${res.status}  ${body.length} bytes`);
  for (const needle of NEEDLES) {
    const raw = body.includes(needle);
    const dec = decoded.includes(needle);
    if (raw || dec) console.log(`   ${JSON.stringify(needle)}  raw=${raw} decoded=${dec}`);
  }
}

await client.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
await client.end();
