import React from "react";

export default function SimulationActiveIcon({ className = "h-5 w-5" }) {
  return (
    <img
      className={className}
      src="/simulation_aktiv.gif"
      alt="Simulation aktiv"
      aria-hidden="false"
    />
  );
}
