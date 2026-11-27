import React from "react";

/**
 * Agent/MCP entry marks. Drawn on the same 24px grid and 1.6px stroke as the
 * existing icon toolbar; the hover motion is deliberately one small event per
 * mark (a link draws, a dot steps forward, an orbit turns, a prompt blinks)
 * rather than four unrelated animations.
 *
 * The parent is expected to be a group (the toolbar button), so the marks work
 * as decorative SVG inside a normal btn-icon.
 */
export default function AgentMark({ variant = "node", className = "h-5 w-5" }) {
  const common = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": "true",
  };

  if (variant === "bridge") {
    return (
      <svg {...common}>
        <path d="M9 6.5H5.5v11H9M15 6.5h3.5v11H15" />
        <circle
          cx="12"
          cy="12"
          r="1.55"
          fill="currentColor"
          stroke="none"
          className="origin-[12px_12px] transition-transform duration-(--duration-fast) ease-out-expo group-hover:scale-125 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </svg>
    );
  }

  if (variant === "orbit") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3.2" />
        <ellipse
          cx="12"
          cy="12"
          rx="8.6"
          ry="4.1"
          transform="rotate(-28 12 12)"
          className="origin-[12px_12px] opacity-70 transition-transform duration-(--duration-slow) ease-out-expo group-hover:rotate-12 motion-reduce:transition-none motion-reduce:group-hover:rotate-0"
        />
        <circle
          cx="18.9"
          cy="8.2"
          r="1.25"
          fill="currentColor"
          stroke="none"
          className="origin-[18.9px_8.2px] transition-transform duration-(--duration-base) ease-out-expo group-hover:scale-125"
        />
      </svg>
    );
  }

  if (variant === "terminal") {
    return (
      <svg {...common}>
        <rect x="3.5" y="5" width="17" height="14" rx="3.2" />
        <path d="m7.5 9.5 2.5 2.5-2.5 2.5" />
        <path
          d="M12.5 14.5h4"
          className="origin-[12.5px_14.5px] transition-transform duration-(--duration-fast) ease-out-expo group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
        />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path
        d="M7.2 16.8 16.8 7.2"
        pathLength="1"
        className="[stroke-dasharray:1] [stroke-dashoffset:1] transition-[stroke-dashoffset] duration-(--duration-base) ease-out-expo group-hover:[stroke-dashoffset:0] motion-reduce:transition-none motion-reduce:group-hover:[stroke-dashoffset:1]"
      />
      <circle cx="6" cy="18" r="2.1" />
      <circle
        cx="18"
        cy="6"
        r="2.1"
        fill="currentColor"
        className="origin-[18px_6px] transition-transform duration-(--duration-fast) ease-out-expo group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
    </svg>
  );
}