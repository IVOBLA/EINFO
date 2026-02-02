import React from "react";
import { useDroppable } from "@dnd-kit/core";

const COL_CONFIG = {
  "neu":              { colClass: "col-new",      titleClass: "col-title-new",      icon: "\u25CF" },
  "in-bearbeitung":   { colClass: "col-progress", titleClass: "col-title-progress", icon: "\u25B6" },
  "erledigt":         { colClass: "col-done",     titleClass: "col-title-done",     icon: "\u2714" },
};

/**
 * Droppable Spalte. Erwartet `title` als ReactNode (kann also Summen enthalten).
 */
export default function DroppableColumn({ colId, title, bg, children, editable = true }) {
  const cfg = COL_CONFIG[colId] || {};
  const colClass = cfg.colClass || bg;

  if (!editable) {
    return (
      <section
        className={`droppable-column ${colClass} rounded-2xl shadow-sm p-0 h-full flex flex-col min-h-0 overflow-hidden`}
      >
        <div className="column-header sticky top-0 z-10">
          {title}
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </section>
    );
  }

  const { setNodeRef, isOver } = useDroppable({
    id: `col:${colId}`,
    data: { type: "column", colId },
  });

  return (
    <section
      ref={setNodeRef}
      className={`droppable-column ${colClass} rounded-2xl shadow-sm p-0 h-full flex flex-col min-h-0 overflow-hidden ${
        isOver ? "ring-2 ring-blue-300" : ""
      }`}
    >
      <div className="column-header sticky top-0 z-10">
        {title}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {children}
      </div>
    </section>
  );
}
