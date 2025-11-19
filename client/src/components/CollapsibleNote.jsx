import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_LIMIT = 200;

export default function CollapsibleNote({
  text,
  limit = DEFAULT_LIMIT,
  className = "",
  textClassName = "",
  toggleClassName = "text-xs text-blue-700 hover:underline",
}) {
  const safeText = useMemo(() => (typeof text === "string" ? text : ""), [text]);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [safeText]);
  const shouldTruncate = safeText.length > limit;
  const displayText = expanded || !shouldTruncate ? safeText : safeText.slice(0, limit);

  if (!safeText) {
    return (
      <div className={className}>
        <div className={`${textClassName} whitespace-pre-wrap break-words`}>—</div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className={`${textClassName} whitespace-pre-wrap break-words`}>
        {displayText}
        {!expanded && shouldTruncate ? "…" : ""}
      </div>
      {shouldTruncate ? (
        <button
          type="button"
          className={`${toggleClassName} mt-1`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          aria-expanded={expanded}
        >
          {expanded ? "Weniger anzeigen" : "Mehr anzeigen"}
        </button>
      ) : null}
    </div>
  );
}
