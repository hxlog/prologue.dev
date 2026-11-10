import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import path from "node:path";
import siteMetadata from "../../../data/sitemetadata";
import { tagLabel } from "../../../data/tagLabels";
import { formatDate, readingTimeLabel } from "../../lib/date";

/**
 * Open Graph card — 1200×630, light mode, v4 "stardust edge".
 *
 * Composition (article card):
 *   ┌──────────────────────────────────────────────────────────┐ 2px tri-hue rim
 *   │ · ·                                              (stars) │
 *   │   2026年10月19日 · 约 8 分钟                              │
 *   │                                                          │
 *   │   Title (62px / 600, up to three lines)                   │
 *   │   ──────────────────────────────────────────────         │
 *   │   ◯ 槐序    [ 金融 ] [ 数据科学 ] [ 技术 ] +1             │
 *   │      prologue.dev                                        │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Page cards reuse the frame with the title centred and no meta/tag rows.
 *
 * The "stardust" language is the site's chip treatment scaled up: a 2px
 * tri-hue rim around a white card, two 4–5px star dots in the top-right
 * corner, a gradient hairline above the footer and 6% tri-hue chip washes.
 * Nothing here is decorative-only for its own sake — it is the same rim +
 * stardust vocabulary the reader sees on every card and tag pill.
 *
 * Everything is drawn with Satori-safe primitives only: flexbox, absolute
 * positioning, `linear-gradient`/`radial-gradient`, `boxShadow`, `border`
 * and `borderRadius`. Satori has no `filter: blur` and no CSS grid, so the
 * soft blooms are stacked radial gradients, and the rim is drawn as a padded
 * gradient box rather than with `mask-composite` (unsupported).
 *
 * Fonts: Noto Sans SC, subset at build time by scripts/build-og-font.mjs to
 * the union of glyphs the card can draw and read from `assets/og/` once per
 * process — three weights (400 meta, 600 tags/title, 700 initial-letter
 * avatar). The old per-card Google Fonts `text=` fetch is kept as the
 * fallback for a title carrying a character the subset does not cover, so a
 * card can never lose a glyph.
 *
 * Headers: `s-maxage=31536000, immutable` is safe because the URL carries
 * everything the card depends on (title/date/tags/read) — content edits
 * produce a different query string, so stale cards cannot outlive their
 * content.
 */

const WIDTH = 1200;
const HEIGHT = 630;

// The card palette is hard-coded here rather than read from CSS custom
// properties: Satori renders outside the document and only understands inline
// styles, so the tokens have to be duplicated. Keep this block in sync with
// `:root` in globals.css (light mode).
const palette = {
  paper: "#f7f8fc",
  surface: "#ffffff",
  ink: "#2f3446",
  muted: "#5d6579",
  faint: "#767e92",
  lavender: "#c9cdf5",
  pink: "#f7d4e6",
  sky: "#b4e0ec",
  accent: "#6a6fcd",
  secondary: "#b85680",
  border: "rgba(47, 52, 70, 0.10)",
};

// v3 brand gradient: the same three stops as --gradient-brand (lavender ->
// sky -> pink). Defined once so the rim, the avatar ring and the hairline
// cannot drift apart.
const brandGradient = `linear-gradient(120deg, ${palette.lavender}, ${palette.sky} 46%, ${palette.pink})`;
const rimGradient = `linear-gradient(135deg, rgba(201,205,245,0.95), rgba(180,224,236,0.85) 46%, rgba(247,212,230,0.95))`;
const hairlineGradient =
  "linear-gradient(90deg, rgba(170,160,252,0.28), rgba(84,208,238,0.22) 56%, rgba(252,156,200,0.28))";

/**
 * Build-time assets from scripts/build-og-font.mjs: the three subset weights,
 * `glyphs.json` (the codepoints they cover) and the 152 px avatar.
 *
 * Read from disk rather than imported because Next's tracer follows imports and
 * static `fs` paths, not a path built from `process.cwd()`; the matching
 * `outputFileTracingIncludes` entry in next.config.js is what keeps them in the
 * deployed function.
 */
const ASSET_DIR = path.join(process.cwd(), "assets", "og");

// The three weights the card draws with: 400 meta row, 600 title/author/+N,
// 700 the initial-letter avatar. Keep in sync with scripts/build-og-font.mjs.
const WEIGHTS = [400, 600, 700];

const fontCache = new Map();

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const title = clip(searchParams.get("title"), 90) || siteMetadata.publishName;
  const date = clip(searchParams.get("date"), 40);
  const read = clip(searchParams.get("read"), 20);
  const tags = (searchParams.get("tags") || "")
    .split(",")
    .map((tag) => clip(tag, 24))
    .filter(Boolean)
    .slice(0, 3 + 1); // up to 3 labels + the remainder count

  const isPost = Boolean(date || tags.length);

  // Characters actually drawn — the subset that gets fetched.
  const text = [
    title,
    date ? formatDate(date) : "",
    read,
    blogName(),
    domain(),
    siteMetadata.author,
    ...tags.map(tagLabel),
    "+0123456789",
  ].join("");

  const avatar = avatarDataUri();

  // Local subset first (no network); the per-card Google subset only when the
  // generated fonts are absent or do not cover every drawn character.
  const fonts = localFontsFor(text) || (await loadFonts(text));

  const response = new ImageResponse(
    (
      <div
        style={{
          width: WIDTH,
          height: HEIGHT,
          display: "flex",
          position: "relative",
          backgroundColor: palette.paper,
          color: palette.ink,
          fontFamily: "Noto Sans SC",
          overflow: "hidden",
        }}
      >
        {/* Three soft blooms, same three hues as the rim. Satori has no blur,
            so each is a wide radial gradient that fades to transparent well
            before its box edge. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            background:
              "radial-gradient(760px 560px at 14% 8%, rgba(201,205,245,0.72), transparent 72%)," +
              "radial-gradient(720px 520px at 86% 6%, rgba(180,224,236,0.62), transparent 74%)," +
              "radial-gradient(820px 520px at 64% 104%, rgba(247,212,230,0.66), transparent 74%)",
          }}
        />

        {/* 2px tri-hue rim: an outer box painted with the gradient and 2px of
            padding, with the white card sitting inside it. Satori cannot mask
            a conic border, and a real border cannot hold a gradient. */}
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 40,
            right: 40,
            bottom: 40,
            display: "flex",
            flexDirection: "column",
            padding: 2,
            borderRadius: 28,
            background: rimGradient,
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              padding: "40px 54px 36px",
              borderRadius: 26,
              backgroundColor: palette.surface,
              overflow: "hidden",
              boxShadow: "0 26px 60px -34px rgba(47,52,70,0.42)",
            }}
          >
            {/* Two star dots, a 5px one over a 4px one. The white ring is a
                1px border; Satori has no spread box-shadow. */}
            <div
              style={{
                position: "absolute",
                top: 26,
                right: 28,
                display: "flex",
                width: 5,
                height: 5,
                borderRadius: 999,
                backgroundColor: "rgba(170,160,252,0.95)",
                border: "1px solid rgba(255,255,255,0.85)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 38,
                right: 44,
                display: "flex",
                width: 4,
                height: 4,
                borderRadius: 999,
                backgroundColor: "rgba(252,156,200,0.95)",
                border: "1px solid rgba(255,255,255,0.85)",
              }}
            />

            {/* Meta row (posts only). The separator is a dot, not a glyph, so
                it never depends on the font subset. */}
            {isPost ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontSize: 22,
                  lineHeight: 1.4,
                  color: palette.muted,
                }}
              >
                {date ? <span>{formatDate(date)}</span> : null}
                {date && read ? (
                  <div
                    style={{
                      display: "flex",
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      backgroundColor: "rgba(47,52,70,0.22)",
                    }}
                  />
                ) : null}
                {read ? <span>{read}</span> : null}
              </div>
            ) : null}

            {/* Title. flexGrow pushes the footer down and lets the page card
                centre a short title in the whole card. */}
            <div
              style={{
                display: "flex",
                flexGrow: 1,
                minHeight: 0,
                marginTop: isPost ? 22 : 0,
                alignItems: isPost ? "flex-start" : "center",
                justifyContent: isPost ? "flex-start" : "center",
                fontSize: isPost ? titleSize(title) : 68,
                fontWeight: 600,
                lineHeight: isPost ? 1.2 : 1.24,
                letterSpacing: -0.8,
                color: palette.ink,
              }}
            >
              <div
                style={{
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 3,
                  overflow: "hidden",
                  textAlign: isPost ? "left" : "center",
                }}
              >
                {title}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                height: 1,
                marginBottom: 22,
                background: hairlineGradient,
              }}
            />

            {/* Author strip + stardust chips. The gradient hairline above is
                the only rule on the card; there is no border under the footer. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: isPost ? "space-between" : "center",
                gap: 20,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <AvatarImage dataUri={avatar} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div
                    style={{
                      display: "flex",
                      fontSize: 26,
                      fontWeight: 600,
                      color: palette.ink,
                      lineHeight: 1.25,
                    }}
                  >
                    {siteMetadata.author}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: 20,
                      marginTop: 3,
                      color: palette.faint,
                      lineHeight: 1.3,
                    }}
                  >
                    {domain()}
                  </div>
                </div>
              </div>

              {isPost && tags.length > 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {tags.slice(0, 3).map((tag) => (
                    <div
                      key={tag}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        height: 40,
                        padding: "0 18px",
                        borderRadius: 999,
                        fontSize: 20,
                        fontWeight: 500,
                        color: palette.muted,
                        background:
                          "linear-gradient(140deg, rgba(170,160,252,0.066), rgba(84,208,238,0.048) 55%, rgba(252,156,200,0.066))",
                        border: "1px solid rgba(170,160,252,0.14)",
                      }}
                    >
                      {tagLabel(tag)}
                    </div>
                  ))}
                  {tags.length > 3 ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: 40,
                        padding: "0 15px",
                        borderRadius: 999,
                        fontSize: 20,
                        fontWeight: 600,
                        color: palette.faint,
                        border: "1px dashed rgba(47,52,70,0.26)",
                      }}
                    >
                      +{tags.length - 3}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      ...(fonts.length ? { fonts } : {}),
    }
  );

  response.headers.set(
    "Cache-Control",
    "public, s-maxage=31536000, stale-while-revalidate=31536000, immutable"
  );
  return response;
}

/** Title size: 62px base, stepping down so a long headline still fits 3 lines. */
function titleSize(title) {
  if (title.length > 56) return 46;
  if (title.length > 40) return 54;
  return 62;
}

/** Circular avatar with the brand gradient ring, falling back to an initial. */
function AvatarImage({ dataUri }) {
  if (dataUri) {
    return (
      <div
        style={{
          display: "flex",
          width: 64,
          height: 64,
          borderRadius: 999,
          padding: 3,
          background: brandGradient,
        }}
      >
        {/* next/og accepts an <img> with a data URI; Satori needs the explicit
            width/height and a borderRadius to clip. `next/image` cannot be
            used here at all: Satori serialises this tree to its own layout,
            it is not React DOM. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUri}
          alt=""
          width={58}
          height={58}
          style={{ borderRadius: 999, objectFit: "cover" }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 64,
        height: 64,
        borderRadius: 999,
        padding: 3,
        background: brandGradient,
        fontSize: 28,
        fontWeight: 700,
        color: palette.accent,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          borderRadius: 999,
          backgroundColor: palette.surface,
        }}
      >
        {siteMetadata.author.slice(0, 1)}
      </div>
    </div>
  );
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function domain() {
  return String(siteMetadata.siteUrl || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function blogName() {
  return siteMetadata.publishName;
}

/**
 * The avatar, inlined as a data URI.
 *
 * `assets/og/avatar-152.png` is generated once by scripts/build-og-font.mjs
 * from the author's 871 KB source PNG with the exact sharp pipeline this
 * function used to run on every cold start (`resize(152, 152, { fit: "cover",
 * position: "centre" })`, PNG level 9). Same bytes, but the request path no
 * longer loads libvips or reads the 871 KB original. next/og inlines every
 * asset it is handed, so the 152 px file is what keeps this within the
 * function's bundle budget.
 *
 * Read once per process; the buffer is tiny and identical for every card. Any
 * failure (missing file, unreadable PNG) degrades to the initial-letter avatar
 * instead of failing the whole card.
 */
let avatarData;
function avatarDataUri() {
  if (avatarData !== undefined) return avatarData;
  try {
    const png = readFileSync(path.join(ASSET_DIR, "avatar-152.png"));
    avatarData = `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    avatarData = null;
  }
  return avatarData;
}

/**
 * The build-time subset, memoised per process.
 *
 * `undefined` = not attempted yet, `null` = assets unavailable (the route then
 * uses the remote fallback). Missing files are not an error: a deployment that
 * forgets the traced assets, or a fresh clone before the script has run, must
 * still answer with a correct card.
 */
let localFonts;
function localFontSet() {
  if (localFonts !== undefined) return localFonts;
  try {
    const coverage = JSON.parse(
      readFileSync(path.join(ASSET_DIR, "glyphs.json"), "utf8")
    );
    const fonts = WEIGHTS.map((weight) => ({
      name: "Noto Sans SC",
      data: readFileSync(path.join(ASSET_DIR, `NotoSansSC-${weight}.ttf`)),
      weight,
      style: "normal",
    }));
    localFonts = { fonts, codepoints: new Set(coverage.codepoints) };
  } catch {
    localFonts = null;
  }
  return localFonts;
}

/**
 * The local fonts, or null when they cannot draw every character of `text`.
 *
 * The coverage check is what keeps a title the build script has never seen
 * (an unmapped tag, a shared link with a custom title, a character added in a
 * content edit after the last script run) off the tofu path: those cards fall
 * through to the per-card Google subset, which is built from the exact text.
 */
function localFontsFor(text) {
  const set = localFontSet();
  if (!set) return null;
  for (const char of text) {
    if (!set.codepoints.has(char.codePointAt(0))) return null;
  }
  return set.fonts;
}

/**
 * Fetch the Noto Sans SC subsets for the given text — the fallback path.
 *
 * One request per weight. Google's CSS endpoint returns @font-face rules whose
 * src is a per-subset TTF; the legacy-user-agent header is what makes it
 * serve that TTF rather than the woff2 Satori cannot parse.
 *
 * A failed weight is dropped rather than retried: Satori still needs at least
 * one font that covers the drawn characters, and the 700 weight's request
 * covers the same text, so a 400/600 failure degrades styling, not legibility.
 */
async function loadFonts(text) {
  const results = await Promise.all(
    WEIGHTS.map((weight) => loadFont(weight, text))
  );

  const fonts = [];
  results.forEach((data, i) => {
    if (!data) return;
    fonts.push({
      name: "Noto Sans SC",
      data,
      weight: WEIGHTS[i],
      style: "normal",
    });
  });

  return fonts;
}

async function loadFont(weight, text) {
  const key = `${weight}:${hash(text)}`;
  if (fontCache.has(key)) return fontCache.get(key);

  try {
    const css = await (
      await fetch(
        `https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(text)}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (BB10; Touch) AppleWebKit/537.1+ (KHTML, like Gecko) Version/10.0.0.1337 Mobile Safari/537.1+",
          },
        }
      )
    ).text();

    const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
    if (!match) return null;

    const res = await fetch(match[1]);
    if (!res.ok) return null;
    const data = await res.arrayBuffer();

    if (fontCache.size > 240) fontCache.clear();
    fontCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

/** Small non-cryptographic hash, only used as a cache key. */
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
