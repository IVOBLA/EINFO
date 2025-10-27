import React from "react";
import User_LogoffButton from "./User_LogoffButton.jsx";

export default function CornerHelpLogout({
  helpHref,
  helpLabel = "Hilfe",
  helpTitle,
  helpClassName = "",
  className = "",
  logoffClassName = "",
}) {
  const showHelp = Boolean(helpHref);
  const containerClasses = [
    "fixed",
    "bottom-4",
    "right-4",
    "flex",
    "flex-col",
    "items-end",
    "gap-2",
    "z-50",
    "pointer-events-none",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClasses}>
      {showHelp && (
        <a
          href={helpHref}
          target="_blank"
          rel="noopener noreferrer"
          title={helpTitle || helpLabel}
          className={`pointer-events-auto px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg ${helpClassName}`.trim()}
        >
          {helpLabel}
        </a>
      )}
      <User_LogoffButton className={`pointer-events-auto ${logoffClassName}`.trim()} />
    </div>
  );
}
