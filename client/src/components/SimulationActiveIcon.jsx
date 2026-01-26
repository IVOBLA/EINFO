import React from "react";

export default function SimulationActiveIcon({ className = "h-5 w-5" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Simulation aktiv"
      focusable="false"
    >
      <circle cx="16" cy="16" r="15" fill="#b91c1c" stroke="#7f1d1d" strokeWidth="2" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="18"
        fill="#fde047"
        stroke="#f59e0b"
        strokeWidth="0.8"
        paintOrder="stroke"
      >
        S
      </text>
    </svg>
  );
}
