import React from "react";
import User_LogoffButton from "./User_LogoffButton.jsx";

export default function CornerHelpLogout({
  helpHref,
  helpLabel = "i",
  helpTitle = "Hilfe",
  helpClassName = "",
  navButtons = [],
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
  const visibleNavButtons = Array.isArray(navButtons)
    ? navButtons.filter((btn) =>
        btn && btn.label && (typeof btn.onClick === "function" || btn.href)
      )
    : [];
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
      {visibleNavButtons.map((btn, idx) => {
        const label = btn.label;
        const title = btn.title || btn.label;
        const className = [
          "pointer-events-auto",
          "floating-action",
          "nav-btn",
          btn.className,
        ]
          .filter(Boolean)
          .join(" ");

        if (btn.href) {
          return (
            <a
              key={btn.key || idx}
              href={btn.href}
              title={title}
              aria-label={title}
              className={className}
            >
              <span aria-hidden="true">{label}</span>
            </a>
          );
        }

        return (
          <button
            key={btn.key || idx}
            type="button"
            onClick={btn.onClick}
            title={title}
            aria-label={title}
            className={className}
          >
            <span aria-hidden="true">{label}</span>
          </button>
        );
      })}
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
