import { buildLlmsFull } from "../../lib/llms";

export async function GET() {
  return new Response(buildLlmsFull(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
