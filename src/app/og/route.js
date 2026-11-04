import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import siteMetadata from "../../../data/sitemetadata";
import { tagLabel } from "../../../data/tagLabels";
import { formatDate, readingTimeLabel } from "../../lib/date";

/**
 * Open Graph card — 1200×630, light mode, anime-blog aesthetic.
 *
 * Composition:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  (lavender→pink hairline along the top)                  │
 *   │                                                          │
 *   │   meta row:  2026年10月19日 · 约 8 分钟                   │
 *   │                                                          │
 *   │   Title (up to three lines, 72px)                        │
 *   │                                                          │
 *   │   ◯ avatar  槐序            [ 哲学 ] [ 技术 ] +2          │
 *   │              prologue.dev · 槐序的序章                    │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Page cards (no date/tags) use the same frame with the title vertically
 * centred and the same author strip.
 *
 * Everything is drawn with Satori-safe primitives only: flexbox, absolute
 * positioning, `linear-gradient`/`radial-gradient`, `boxShadow` and
 * `borderRadius`. Satori has no `filter: blur` and no CSS grid, so the soft
 * blooms behind the card are stacked radial gradients, not blurred blobs.
 *
 * Fonts: Noto Sans SC is fetched per card from Google Fonts with a `text=`
 * subset built from the exact characters being drawn, which keeps each font
 * payload to a few KB instead of the whole CJK face. Three weights are
 * requested (400 meta, 600 tags, 700 title); a weight that fails to load is
 * simply omitted from the `fonts` array and Satori falls back.
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
// sky -> pink). Defined once so the hairline, the dot and the avatar ring
// cannot drift apart.
const brandGradient = `linear-gradient(120deg, ${palette.lavender}, ${palette.sky} 46%, ${palette.pink})`;

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
    ...tags.map(tagLabel),
    "+0123456789",
    "文章",
  ].join("");

  const avatar = await avatarDataUri();

  const fonts = await loadFonts(text);

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundColor: palette.paper,
          color: palette.ink,
          fontFamily: "Noto Sans SC",
          overflow: "hidden",
        }}
      >
        {/* Decorative blooms. Two large radial gradients, the lavender one
            top-right and the pink one bottom-left, so the panel reads as
            lit from two corners rather than tinted flat. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background:
              "radial-gradient(720px 480px at 88% -10%, rgba(201,205,245,0.52), transparent 62%)," +
              "radial-gradient(560px 440px at 6% 100%, rgba(180,224,236,0.42), transparent 62%)," +
              "radial-gradient(680px 520px at 4% 108%, rgba(247,212,230,0.52), transparent 60%)",
          }}
        />

        {/* Brand hairline */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 10,
            display: "flex",
            background: brandGradient,
          }}
        />

        {/* Card */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            margin: "44px 48px 48px",
            padding: "52px 60px 44px",
            borderRadius: 32,
            backgroundColor: "rgba(255,255,255,0.86)",
            border: `1px solid ${palette.border}`,
            boxShadow: "0 24px 60px -28px rgba(47,52,70,0.32)",
          }}
        >
          {/* Site line */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: isPost ? 30 : 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: brandGradient,
                }}
              />
              <div
                style={{
                  display: "flex",
                  fontSize: 26,
                  fontWeight: 600,
                  letterSpacing: 1,
                  color: palette.accent,
                }}
              >
                {blogName()}
              </div>
            </div>
            <div style={{ display: "flex", fontSize: 24, color: palette.faint }}>
              {domain()}
            </div>
          </div>

          {isPost ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginBottom: 22,
                fontSize: 24,
                color: palette.muted,
              }}
            >
              {date ? <span>{formatDate(date)}</span> : null}
              {date && read ? (
                <span style={{ color: palette.lavender }}>·</span>
              ) : null}
              {read ? <span>{read}</span> : null}
            </div>
          ) : null}

          {/* Title. flexGrow centres it on page cards, where there is no meta
              row or tag row to fill the column. lineClamp is honoured by
              Satori and keeps a long title from colliding with the footer. */}
          <div
            style={{
              display: "flex",
              flexGrow: 1,
              alignItems: "center",
              fontSize: title.length > 34 ? 58 : 70,
              fontWeight: 700,
              lineHeight: 1.32,
              letterSpacing: -1,
              color: palette.ink,
            }}
          >
            <div
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 3,
                overflow: "hidden",
              }}
            >
              {title}
            </div>
          </div>

          {/* Author strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
              marginTop: 28,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <AvatarImage dataUri={avatar} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 30,
                    fontWeight: 600,
                    color: palette.ink,
                  }}
                >
                  {siteMetadata.author}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 22,
                    marginTop: 4,
                    color: palette.faint,
                  }}
                >
                  {domain()}
                </div>
              </div>
            </div>

            {tags.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {tags.slice(0, 3).map((tag) => (
                  <div
                    key={tag}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      height: 44,
                      padding: "0 18px",
                      borderRadius: 999,
                      fontSize: 22,
                      fontWeight: 600,
                      color: palette.secondary,
                      backgroundColor: "rgba(242,198,220,0.34)",
                      border: `1px solid rgba(242,198,220,0.92)`,
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
                      height: 44,
                      padding: "0 16px",
                      borderRadius: 999,
                      fontSize: 22,
                      fontWeight: 600,
                      color: palette.faint,
                      border: `1px dashed rgba(47,52,70,0.26)`,
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

/** Circular avatar with the brand gradient ring, falling back to an initial. */
function AvatarImage({ dataUri }) {
  const ring = brandGradient;
  if (dataUri) {
    return (
      <div
        style={{
          display: "flex",
          width: 84,
          height: 84,
          borderRadius: 999,
          padding: 4,
          background: ring,
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
          width={76}
          height={76}
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
        width: 84,
        height: 84,
        borderRadius: 999,
        padding: 4,
        background: ring,
        fontSize: 36,
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
 * The avatar, resized and inlined as a data URI.
 *
 * The source file is the author's 871 KB 1077×1078 PNG. next/og inlines every
 * asset it is handed, so passing it through unresolved would blow the
 * function's 500 KB bundle budget; sharp resizes it to a 152 px square (2× the
 * 76 px display size) before it becomes an argument. `outputFileTracingIncludes`
 * in next.config.js is what makes the file present at runtime at all — a
 * `fs.readFile` on a path Next did not see during tracing is missing from the
 * deployed function.
 *
 * Read once per process; the buffer is tiny and identical for every card.
 */
let avatarPromise;
function avatarDataUri() {
  if (!avatarPromise) {
    avatarPromise = (async () => {
      try {
        const file = path.join(process.cwd(), "public", siteMetadata.avatar);
        const png = await sharp(await readFile(file))
          .resize(152, 152, { fit: "cover", position: "centre" })
          .png({ compressionLevel: 9 })
          .toBuffer();
        return `data:image/png;base64,${png.toString("base64")}`;
      } catch {
        // Any failure (missing file, unsupported image) degrades to the
        // initial-letter avatar instead of failing the whole card.
        return null;
      }
    })();
  }
  return avatarPromise;
}

/**
 * Fetch the Noto Sans SC subsets for the given text.
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
  const weights = [400, 600, 700];
  const results = await Promise.all(
    weights.map((weight) => loadFont(weight, text))
  );

  const fonts = [];
  results.forEach((data, i) => {
    if (!data) return;
    fonts.push({
      name: "Noto Sans SC",
      data,
      weight: weights[i],
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
