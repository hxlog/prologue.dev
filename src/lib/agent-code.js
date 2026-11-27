import siteMetadata from "../../data/sitemetadata";

const SITE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

export const MCP_ENDPOINT = SITE + "/mcp";
export const A2A_CARD = SITE + "/.well-known/agent-card.json";
export const A2A_ENDPOINT = SITE + "/a2a";

export const MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      [siteMetadata.agent.mcpClientName]: {
        type: "streamable-http",
        url: MCP_ENDPOINT,
      },
    },
  },
  null,
  2
);

export const A2A_CURL = [
  "curl -X POST " + A2A_ENDPOINT + " \\",
  "  -H 'Content-Type: application/json' \\",
  "  -d '{",
  '    "jsonrpc": "2.0",',
  '    "id": 1,',
  '    "method": "message/send",',
  '    "params": {',
  '      "message": { "messageId": "m1", "role": "user",',
  '        "parts": [{ "text": "Hello" }] }',
  "    }",
  "  }'",
].join("\n");