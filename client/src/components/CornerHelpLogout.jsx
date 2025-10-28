import React from "react";
import User_LogoffButton from "./User_LogoffButton.jsx";

export default function CornerHelpLogout({
  helpHref,
  helpLabel = "i",
  helpTitle = "Hilfe",
  helpClassName = "",
  className = "",
  logoffClassName = "",
  children,
}) {
  const showHelp = Boolean(helpHref);
  const containerClasses = [
    "fixed",
    "bottom-4",
    "right-4",
    "flex",
    "flex-col",
    "items-end",
    "gap-3",
    "z-50",
    "pointer-events-none",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClasses}>
      {children}
      {showHelp && (
        <a
          href={helpHref}
          target="_blank"
          rel="noopener noreferrer"
          title={helpTitle || helpLabel}
          aria-label={helpTitle || helpLabel}
          className={[
            "pointer-events-auto",
            "floating-action",
            "help-btn",
            helpClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span aria-hidden="true">{helpLabel}</span>
        </a>
      )}
      <User_LogoffButton
        className={`pointer-events-auto floating-action logoff-btn ${logoffClassName}`.trim()}
      />
    </div>
  );
}
