import { buildLlmsFull } from "../../lib/llms";

export async function GET() {
  return new Response(buildLlmsFull(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

// Static export: this handler reads no request data.
export const dynamic = "force-static";
