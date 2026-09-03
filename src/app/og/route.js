import { ImageResponse } from "next/og";

import siteMetadata from "../../../data/sitemetadata";

export const runtime = "edge";

// Bounded per-isolate font cache (fonts are subsetted per title via the
// Google Fonts `text=` param, so the key includes the title). The CDN
// Cache-Control below is the primary cache; this just avoids duplicate
// fetches for repeated titles within one isolate.
const fontCache = new Map();

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const hasTitle = searchParams.has("title");
  const title = hasTitle
    ? searchParams.get("title")?.slice(0, 100)
    : siteMetadata.publishName;

  const fontKey = `Noto+Sans+SC:${title}`;
  let notoSansScFont = fontCache.get(fontKey);
  if (!notoSansScFont) {
    notoSansScFont = await fetchFont(title, "Noto+Sans+SC");
    if (fontCache.size > 128) fontCache.clear();
    fontCache.set(fontKey, notoSansScFont);
  }

  const response = new ImageResponse(
    (
      <div tw="flex w-full h-full flex-col bg-[#09090b] text-white p-[80px]">
        <div tw="flex flex-col w-full pt-[40px] px-8">
          <div tw={`flex w-full h-full ml-4`}>
            <div
              style={{
                display: "flex",
                fontSize: 70,
                fontStyle: "normal",
                color: "white",
                marginTop: 30,
                lineHeight: 1.8,
                whiteSpace: "pre-wrap",
              }}
            >
              {title}
            </div>
          </div>
        </div>
        <div tw="flex items-center justify-between w-full mt-auto px-8">
          <div tw="flex items-center">
            <svg
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              fill="#9b9ba4"
              width={50}
              height={50}
            >
              <path d="M24 22.525H0l12-21.05 12 21.05z" />
            </svg>
            <div tw="flex ml-4 text-[#9b9ba4]">
              <div tw="flex text-[#eaeaf0] ml-4 mr-4 text-4xl">
                {siteMetadata.siteRepo}
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Noto Sans SC",
          data: notoSansScFont,
        },
      ],
    }
  );

  // OG images are immutable per title — let the CDN serve them so crawlers
  // don't re-invoke this edge function (and its Google Fonts fetch) per hit.
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=604800, stale-while-revalidate=2592000"
  );
  return response;
}

async function fetchFont(text, font) {
  const API = `https://fonts.googleapis.com/css2?family=${font}&text=${encodeURIComponent(
    text
  )}`;

  const css = await (
    await fetch(API, {
      headers: {
        // Make sure it returns TTF.
        "User-Agent":
          "Mozilla/5.0 (BB10; Touch) AppleWebKit/537.1+ (KHTML, like Gecko) Version/10.0.0.1337 Mobile Safari/537.1+",
      },
    })
  ).text();

  const resource = css.match(
    /src: url\((.+)\) format\('(opentype|truetype)'\)/
  );

  // console.log("css", css);
  if (!resource) return null;

  const res = await fetch(resource[1]);

  return res.arrayBuffer();
}
