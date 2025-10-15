import React from "react";
import { useDroppable } from "@dnd-kit/core";

/**
 * Droppable Spalte. Erwartet `title` als ReactNode (kann also Summen enthalten).
 */
export default function DroppableColumn({ colId, title, bg, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${colId}`,
    data: { type: "column", colId },
  });

  return (
    <section
      ref={setNodeRef}
      className={`${bg} rounded-xl shadow p-3 h-full flex flex-col min-h-0 ${
        isOver ? "outline outline-2 outline-blue-400" : ""
      }`}
    >
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {children}
    </section>
  );
}
