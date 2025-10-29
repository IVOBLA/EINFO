// client/src/components/AufgDroppableColumn.jsx
import React, { useRef, useState, useLayoutEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

export default function AufgDroppableColumn({ id, title, count, itemIds, bg = "", children }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  // Höhe bis zum unteren Bildschirmrand berechnen (ohne globales CSS zu ändern)
  const wrapRef = useRef(null);
  const [height, setHeight] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      // 12px „Luft“ unten, min. 240px als Fallback
      const h = Math.max(240, Math.floor(viewportH - rect.top - 12));
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
        // eigener Ref für Höhenmessung
        // (dnd-kit Ref und unser Ref zusammenführen)
        // @ts-ignore
        wrapRef.current = node;
      }}
      id={id}
      style={height ? { height } : undefined}
      className={[
        "droppable-column",
        "flex flex-col overflow-hidden", // Header sticky, Liste scrollt
        bg,
        isOver ? "ring-2" : "",
      ].join(" ")}
    >
      {/* Sticky Header wie im alten Board */}
      <div className="column-header sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="kpi-badge">{count}</span>
        </div>
      </div>

      {/* Scrollt bis zum unteren Rand; keine globale CSS-Änderung nötig */}
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <ul className="flex-1 overflow-y-auto overflow-x-hidden pl-1 pr-2 py-2 space-y-8">
          {children}
        </ul>
      </SortableContext>
    </section>
  );
}
