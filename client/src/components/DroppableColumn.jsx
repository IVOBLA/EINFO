import React, { useRef, useState, useLayoutEffect } from "react";
import { useDroppable } from "@dnd-kit/core";

const COL_CONFIG = {
  "neu":              { colClass: "col-new",      titleClass: "col-title-new",      icon: "●" },
  "in-bearbeitung":   { colClass: "col-progress", titleClass: "col-title-progress", icon: "▶" },
  "erledigt":         { colClass: "col-done",     titleClass: "col-title-done",     icon: "✔" },
};

/**
 * Droppable Spalte – modernes Design analog zum Aufgabenboard.
 */
export default function DroppableColumn({ colId, title, bg, children, editable = true }) {
  const cfg = COL_CONFIG[colId] || {};

  const wrapRef = useRef(null);
  const [height, setHeight] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const h = Math.max(240, Math.floor(viewportH - rect.top - 16));
      setHeight(h);
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  if (!editable) {
    return (
      <section
        ref={wrapRef}
        style={height ? { height } : undefined}
        className={[
          "droppable-column",
          "flex flex-col overflow-hidden",
          cfg.colClass || bg,
        ].join(" ")}
      >
        <div className="column-header sticky top-0 z-10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={`col-title flex items-center gap-2 ${cfg.titleClass || ""}`}>
              <span className="text-base" aria-hidden>{cfg.icon || ""}</span>
              {title}
            </h2>
          </div>
        </div>
        {children}
      </section>
    );
  }

  const { setNodeRef, isOver } = useDroppable({
    id: `col:${colId}`,
    data: { type: "column", colId },
  });

  return (
    <section
      ref={(node) => {
        setNodeRef(node);
        wrapRef.current = node;
      }}
      style={height ? { height } : undefined}
      className={[
        "droppable-column",
        "flex flex-col overflow-hidden",
        cfg.colClass || bg,
        isOver ? "ring-2 ring-blue-300" : "",
      ].join(" ")}
    >
      <div className="column-header sticky top-0 z-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={`col-title flex items-center gap-2 ${cfg.titleClass || ""}`}>
            <span className="text-base" aria-hidden>{cfg.icon || ""}</span>
            {title}
          </h2>
        </div>
      </div>
      {children}
    </section>
  );
}
