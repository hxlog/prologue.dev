# prologue — database

One database, `prologue`, on a shared self-hosted PostgreSQL 18 cluster.
Two neighbouring databases live on the same server and are **never touched** by
anything here: `postgres` (another project's `bp_*` tables) and `umami`.

## Roles

| role | purpose | limits |
|---|---|---|
| `postgres` | superuser; only for migrations, extensions, `ALTER ROLE` | — |
| `prologue_app` | the application. The app never connects as superuser | `CONNECTION LIMIT 20` |

`prologue_app` also carries per-role timeouts so a runaway query cannot hold a
connection or an open transaction indefinitely:

```sql
ALTER ROLE prologue_app SET statement_timeout = '30s';
ALTER ROLE prologue_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE prologue_app SET lock_timeout = '5s';
ALTER ROLE prologue_app SET work_mem = '8MB';
```

These are set **per role**, not globally: `statement_timeout` is a server-wide
setting and a global value would also apply to umami's migrations.

## Connection paths

| variable | endpoint | used by |
|---|---|---|
| `DATABASE_URL` | PgBouncer `:6432`, transaction pooling | the application |
| `DATABASE_URL_UNPOOLED` | Postgres `:5432` direct | migrations, scripts |

Transaction pooling is safe here — verified: interactive multi-statement
transactions, `SAVEPOINT`, error-then-rollback, concurrent connections and
named prepared statements all behave correctly through the pooler.

What transaction pooling **breaks**, and which this codebase therefore avoids:
`LISTEN`/`NOTIFY`, SQL-level `PREPARE`/`DEALLOCATE` of session state, session
advisory locks (`pg_advisory_lock`; `pg_advisory_xact_lock` is fine),
`WITH HOLD` cursors, and any plain `SET` (use `SET LOCAL` inside a transaction).

## Applying migrations

Migrations are numbered `.sql` files, applied in order, each in its own
transaction, against the **direct** connection:

```bash
PGPASSWORD=... psql -h $HOST -U postgres -d prologue -v ON_ERROR_STOP=1 \
  -f db/migrations/0001_init.sql
```

They are applied by a separate CI job, **not** during `next build`. Vercel
reuses the same `DATABASE_URL` for production and preview, so a build-time
migration would let a pull request mutate the production schema, and concurrent
immutable preview builds would race. Roll back a deployment and the DDL stays.

## Searching Chinese

PostgreSQL cannot search Chinese out of the box on this cluster, and the
failure is silent. Measured here:

```
to_tsvector('simple','我爱北京天安门')          -> '我爱北京天安门':1     (ONE token)
to_tsvector(...) @@ plainto_tsquery('simple','北京')  ->  false
show_trgm('北京')                                -> unusable
LIKE '%北京%'  -> Seq Scan        LIKE '%abcdef%' -> Bitmap Index Scan
```

So `pg_trgm` looks fine and is never used for CJK. `zhparser`, `pg_jieba`,
`pgroonga`, `rum` and `pg_bigm` are all unavailable on this server.

The workaround is `zh_tok()` / `zh_q()`:

- `zh_tok(text) -> tsvector` — each CJK **run** becomes overlapping bigrams
  (`服务端渲染` → `服务 务端 端渲 渲染`); a run of one character stays as itself;
  each latin/digit run becomes one lowercased word.
- `zh_q(text) -> tsquery` — the same tokenization, AND-ed. **Every query that
  may contain CJK must go through this.** `plainto_tsquery` against a bigram
  index matches nothing, silently.

`simple` rather than `english` is deliberate: no stemming, so `serverless`
matches exactly instead of being reduced.

### Two traps, both of which bit us

1. **Per character vs per run.** A first implementation emitted a trailing
   single character per position, so `zh_q('北京')` produced `'北京' & '京'` and
   the document never contained `京` — every two-character query returned
   nothing, with no error. Fixed in `0003`. The rule is per run.

2. **Changing the function does not refresh stored vectors.** `search_doc` is
   `GENERATED ALWAYS AS ... STORED`, and PostgreSQL only recomputes a generated
   column when one of its *base* columns changes. `CREATE OR REPLACE FUNCTION`
   therefore leaves every existing row stale. The supported fix is
   `ALTER TABLE ... ALTER COLUMN search_doc SET EXPRESSION AS (...)` (PG17+),
   which rewrites the table. `0003` does this.

Anything that touches the tokenizer must therefore: bump the function name
suffix (`zh_tok_v2`) or rewrite the expression, then re-run the document
rewrite **and** the assertion in `scripts/db/verify-search.mjs`, which compares
stored vectors against the live function.

### Positions are kept

Stripping positions to shrink the index was measured and rejected: the GIN
index barely changed (3,480 kB → 3,456 kB) while `ts_rank_cd` dropped to
`0.00000` for every row, because cover-density ranking needs positional data.
GIN stores lexemes, not positions, so the saving was never there.

### Snippets

`ts_headline` **does not work for Chinese.** It matches raw parser tokens
against dictionary-normalized lexemes, so against bigram tokens it flags
nothing and returns an unhighlighted prefix. Snippets are built in application
code instead. Because `ts_headline` output is also not XSS-safe, the English
path sanitizes if it is ever used.
