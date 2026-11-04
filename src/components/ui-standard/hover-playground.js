"use client";

import { useRef, useState } from "react";

/**
 * Live preview of the shipped card hover (option 07: twin outline + soft glow).
 *
 * The readout duplicates spotlight.js's arithmetic from the pointer event
 * itself rather than reading the custom properties back, because the global
 * listener writes them in the same frame — reading here would race it. The
 * values are the same numbers the production script writes.
 */

const SWATCHES = [
  { label: "青 sky", token: "--glow-sky" },
  { label: "紫 lavender", token: "--glow-lav" },
  { label: "粉 pink", token: "--glow-pink" },
];

function DemoCard({ mode, pointer, onMove, onLeave }) {
  const label = mode === "dark" ? "Dark 作用域" : "Light 模式";
  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div
        className="min-w-0"
        style={{
          background: "var(--background)",
          borderRadius: "var(--radius-panel)",
          boxShadow: "inset 0 0 0 1px var(--border)",
          padding: "1rem",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[0.72rem] text-faint">{label}</p>
          <p className="font-mono text-[0.72rem] text-faint">{pointer ? "hover" : "rest"}</p>
        </div>

        <article
          className="card card-interactive card-spotlight relative mt-3 flex flex-col p-5"
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          <p className="eyebrow">双描边柔光 · 07</p>
          <h4 className="card-title mt-2.5 text-lg font-semibold leading-7 tracking-tight text-foreground">
            移动指针，观察描边旋转
          </h4>
          <p className="mt-2 text-sm leading-6 text-muted">
            外圈是 1px 三色 conic 渐变，从指针方向起算；内描边与柔光跟随指针位置，卡片只上浮 2px。
          </p>
          <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
            <span className="chip">青 · sky</span>
            <span className="chip">紫 · lavender</span>
            <span className="chip">粉 · pink</span>
          </div>
        </article>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[0.7rem] leading-4">
          <div>
            <dt className="text-faint">--spot-ang</dt>
            <dd className="text-foreground">{pointer ? pointer.ang.toFixed(1) + "deg" : "—"}</dd>
          </div>
          <div>
            <dt className="text-faint">外圈起角 from</dt>
            <dd className="text-foreground">{pointer ? pointer.from.toFixed(1) + "deg" : "—"}</dd>
          </div>
          <div>
            <dt className="text-faint">--spot-x</dt>
            <dd className="text-foreground">{pointer ? pointer.x.toFixed(1) + "%" : "—"}</dd>
          </div>
          <div>
            <dt className="text-faint">--spot-y</dt>
            <dd className="text-foreground">{pointer ? pointer.y.toFixed(1) + "%" : "—"}</dd>
          </div>
        </dl>

        <p className="mt-2 text-[0.7rem] leading-4 text-faint">
          外圈顺序（自指针方向顺时针）：青 → 紫 → 粉。静止时不绘制任何颜色。
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {SWATCHES.map((swatch) => (
            <span key={swatch.token} className="inline-flex items-center gap-1.5 text-[0.7rem] text-muted">
              <span
                aria-hidden="true"
                className="block h-3 w-3 rounded-full"
                style={{
                  background: "rgb(var(" + swatch.token + "))",
                  boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 14%, transparent)",
                }}
              />
              {swatch.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HoverPlayground() {
  const [pointer, setPointer] = useState({ light: null, dark: null });
  const frames = useRef({ light: 0, dark: 0 });
  const pending = useRef({ light: null, dark: null });

  const move = (mode) => (event) => {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    pending.current[mode] = {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
      ang:
        (Math.atan2(
          event.clientY - (rect.top + rect.height / 2),
          event.clientX - (rect.left + rect.width / 2)
        ) *
          180) /
        Math.PI,
    };
    if (frames.current[mode]) return;
    frames.current[mode] = requestAnimationFrame(() => {
      frames.current[mode] = 0;
      const p = pending.current[mode];
      if (!p) return;
      setPointer((prev) => ({
        ...prev,
        [mode]: { ...p, from: ((p.ang + 90) % 360 + 360) % 360 },
      }));
    });
  };

  const leave = (mode) => () => {
    if (frames.current[mode]) cancelAnimationFrame(frames.current[mode]);
    frames.current[mode] = 0;
    pending.current[mode] = null;
    setPointer((prev) => ({ ...prev, [mode]: null }));
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <DemoCard
        mode="light"
        pointer={pointer.light}
        onMove={move("light")}
        onLeave={leave("light")}
      />
      <DemoCard
        mode="dark"
        pointer={pointer.dark}
        onMove={move("dark")}
        onLeave={leave("dark")}
      />
    </div>
  );
}
