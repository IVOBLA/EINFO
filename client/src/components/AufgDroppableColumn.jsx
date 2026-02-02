// client/src/components/AufgDroppableColumn.jsx
import React, { useRef, useState, useLayoutEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

const STATUS_CONFIG = {
  "Neu":              { colClass: "col-new",      titleClass: "col-title-new",      badgeClass: "kpi-badge-new",      icon: "\u25CF" },
  "In Bearbeitung":   { colClass: "col-progress", titleClass: "col-title-progress", badgeClass: "kpi-badge-progress", icon: "\u25B6" },
  "Erledigt":         { colClass: "col-done",     titleClass: "col-title-done",     badgeClass: "kpi-badge-done",     icon: "\u2714" },
};

export default function AufgDroppableColumn({ id, title, count, itemIds, bg = "", children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const cfg = STATUS_CONFIG[id] || {};

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

  return (
    <section
      ref={(node) => {
        setNodeRef(node);
        wrapRef.current = node;
      }}
      id={id}
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
          <span className={`kpi-badge ${cfg.badgeClass || ""}`}>{count}</span>
        </div>
      </div>

      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <ul className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2.5 space-y-2.5">
          {children}
        </ul>
      </SortableContext>
    </section>
  );
}
