"use client";

import { useState } from "react";
import Modal from "./modal";
import siteMetadata from "../../data/sitemetadata";
import { useCopy } from "../lib/use-copy";

const SITE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");
const MCP_ENDPOINT = SITE + "/mcp";
const A2A_CARD = SITE + "/.well-known/agent-card.json";
const A2A_ENDPOINT = SITE + "/a2a";

const MCP_CONFIG = JSON.stringify(
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

const A2A_CURL = [
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

function CopyButton({ value, label = "复制" }) {
  const { state, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      className="shrink-0 rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-muted transition-colors duration-(--duration-fast) hover:bg-accent-strong hover:text-on-accent"
    >
      {state === "copied" ? "已复制 ✓" : state === "error" ? "手动复制" : label}
    </button>
  );
}

function CodeBlock({ label, code }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="section-label">{label}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto rounded-control border border-border bg-surface-2 p-3 font-mono text-[11px] leading-5 text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CopyRow({ label, description, value }) {
  const { state, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      className="group flex w-full items-center justify-between gap-3 rounded-control border border-border bg-surface px-4 py-3 text-left transition-[transform,border-color,box-shadow] duration-(--duration-fast) ease-out-expo hover:-translate-y-px hover:border-accent hover:shadow-card-hover"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground group-hover:text-accent">
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-muted">{description}</span>
        <span className="mt-1 block truncate font-mono text-xs text-faint">{value}</span>
      </span>
      <span
        className={
          "shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-(--duration-fast) " +
          (state === "copied"
            ? "bg-accent-soft text-accent"
            : "bg-surface-2 text-muted group-hover:bg-accent-strong group-hover:text-on-accent")
        }
      >
        {state === "copied" ? "已复制 ✓" : "复制"}
      </span>
    </button>
  );
}

export default function AgentEntryPanel({ open, onClose }) {
  const [tab, setTab] = useState("mcp");
  const isMcp = tab === "mcp";

  return (
    <Modal open={open} onClose={onClose} title="Agent 接入">
      <div
        role="tablist"
        aria-label="Agent 接入方式"
        className="grid grid-cols-2 gap-1 rounded-pill border border-border bg-surface-2 p-1"
      >
        {[
          { id: "mcp", label: "MCP" },
          { id: "a2a", label: "A2A" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={
              "rounded-pill px-3 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) " +
              (tab === item.id
                ? "bg-surface text-foreground shadow-card"
                : "text-muted hover:text-foreground")
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div key={tab} className="page-enter mt-4">
        {isMcp ? (
          <div className="space-y-3">
            <CodeBlock label="客户端配置" code={MCP_CONFIG} />
            <CopyRow
              label="MCP 端点"
              description="Streamable HTTP"
              value={MCP_ENDPOINT}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted">
              A2A 客户端先读取 Agent Card，再向 JSON-RPC 端点发送消息。
            </p>
            <CodeBlock label="A2A 调用示例" code={A2A_CURL} />
            <CopyRow
              label="A2A Agent Card"
              description="能力与接口发现文档"
              value={A2A_CARD}
            />
            <CopyRow
              label="A2A JSON-RPC"
              description="发送 message/send"
              value={A2A_ENDPOINT}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}