"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { readVar, resolveValue } from "../../lib/css-probe";

/**
 * Numeric token gallery: radius, shadow, container and motion values read from
 * the running stylesheet (never copied into this file), each with a live
 * preview so the value and the thing it does sit next to each other.
 */

// getComputedStyle normalises lengths to ".625rem" / ".16s"; print them the
// way the token was authored ("0.625rem"), because that is what someone
// copying the value back into globals.css expects to see.
function displayValue(value) {
  if (!value) return value;
  return String(value).replace(/^(-\.)/, "$10").replace(/^\.(?=\d)/, "0.");
}

function msFromValue(value) {
  const text = String(value || "").trim();
  if (text.endsWith("ms")) return parseFloat(text);
  if (text.endsWith("s")) return parseFloat(text) * 1000;
  return 0;
}

function Preview({ row, value }) {
  if (row.preview === "radius") {
    return (
      <span
        aria-hidden="true"
        className="block h-9 w-9 border border-border bg-surface-2"
        style={{ borderRadius: "var(" + row.name + ")" }}
      />
    );
  }
  if (row.preview === "shadow") {
    return (
      <span
        aria-hidden="true"
        className="block h-9 w-9 rounded-md bg-surface"
        style={{ boxShadow: "var(" + row.name + ")" }}
      />
    );
  }
  if (row.preview === "font") {
    return (
      <span
        aria-hidden="true"
        className="block text-lg leading-6 text-foreground"
        style={{ fontFamily: "var(" + row.name + ")" }}
      >
        Aa 文
      </span>
    );
  }
  if (row.preview === "duration") {
    return (
      <span aria-hidden="true" className="group/dot flex h-9 w-20 items-center rounded-md bg-surface-2 px-2">
        <span
          className="block h-1.5 w-1.5 rounded-full bg-accent transition-transform duration-(--duration-base) group-hover/dot:translate-x-14"
          style={{ transitionDuration: "var(" + row.name + ")" }}
        />
      </span>
    );
  }
  if (row.preview === "ease") {
    return (
      <span aria-hidden="true" className="group/dot flex h-9 w-20 items-center rounded-md bg-surface-2 px-2">
        <span
          className="block h-1.5 w-1.5 rounded-full bg-accent transition-transform duration-(--duration-slow) ease-out-expo group-hover/dot:translate-x-14"
          style={{ transitionTimingFunction: "var(" + row.name + ")" }}
        />
      </span>
    );
  }
  if (row.preview === "bar") {
    const width = Math.max(8, msFromValue(value) / 4);
    return (
      <span aria-hidden="true" className="flex h-9 w-20 items-center rounded-md bg-surface-2 px-2">
        <span className="block h-1 rounded-full bg-accent" style={{ width: width + "px" }} />
      </span>
    );
  }
  return <span aria-hidden="true" className="block h-9 w-20 rounded-md bg-surface-2" />;
}

export default function TokenList({ groups }) {
  const rootRef = useRef(null);
  const [values, setValues] = useState({});

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const next = {};
    for (const group of groups) {
      for (const row of group.rows) {
        next[row.name] =
          row.preview === "shadow"
            ? resolveValue(root, "box-shadow", row.name)
            : readVar(root, row.name);
      }
    }
    setValues(next);
  }, [groups]);

  return (
    <div ref={rootRef} className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {groups.map((group) => (
        <section key={group.title} className="card p-5">
          <h4 className="text-sm font-semibold text-foreground">{group.title}</h4>
          <p className="mt-1 text-xs leading-5 text-muted">{group.note}</p>
          <ul className="mt-3 space-y-2">
            {group.rows.map((row) => (
              <li key={row.name} className="flex items-start gap-3">
                <div className="w-20 shrink-0">
                  <Preview row={row} value={values[row.name] || ""} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[0.72rem] leading-4 text-foreground">{row.name}</p>
                  <p className="text-[0.7rem] leading-4 text-muted">{row.usage}</p>
                  <p className="mt-0.5 truncate font-mono text-[0.7rem] leading-4 text-faint" title={values[row.name] || ""}>
                    {displayValue(values[row.name]) || "读取中…"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
