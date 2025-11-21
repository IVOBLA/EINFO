import React from "react";
import User_LogoffButton from "./User_LogoffButton.jsx";

export default function CornerHelpLogout({
  helpHref,
  helpLabel = "i",
  helpTitle = "Hilfe",
  helpClassName = "",
  onAdd,
  addLabel = "＋",
  addTitle = "Neuen Eintrag anlegen",
  addClassName = "",
  addDisabled = false,
  className = "",
  logoffClassName = "",
  children,
}) {
  const showHelp = Boolean(helpHref);
  const showAdd = typeof onAdd === "function";
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
      {showAdd && (
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          title={addTitle || addLabel}
          aria-label={addTitle || addLabel}
          className={[
            "pointer-events-auto",
            "floating-action",
            "fab",
            addClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span aria-hidden="true">{addLabel}</span>
        </button>
      )}
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
