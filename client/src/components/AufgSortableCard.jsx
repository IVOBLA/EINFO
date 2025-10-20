// client/src/components/AufgSortableCard.jsx
import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "–");
const clip = (s, n = 100) => {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n).trimEnd() + "…" : str;
};

export default function AufgSortableCard({ item, onAdvance, onShowInfo, isNew }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style}>
      <article
        {...attributes}
        {...listeners}
        className={[
          "rounded-lg bg-white shadow-xl border p-3",
          isDragging ? "opacity-90 scale-[1.01]" : "",
		  "transition-transform", isNew ? "pulse-incoming" : "",
        ].join(" ")}
      >
        {/* Kopfzeile: links 'erstellt' + Titel; rechts 'aktual.' + Pfeil */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] text-gray-500 leading-4">
              erstellt: {fmt(item?.createdAt)}
            </div>
            <div className="font-semibold text-sm leading-snug truncate">
              {item?.title || item?.name || "Ohne Titel"}
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-1">
            {item?.updatedAt && (
              <div className="text-[10px] text-gray-500 leading-4">
                aktual.: {fmt(item.updatedAt)}
              </div>
            )}
            <button
              type="button"
              title="weiter"
              onClick={(e) => {
                e.stopPropagation();
                onAdvance?.(item);
              }}
              className="px-2 py-1 rounded text-[12px] border bg-white hover:bg-gray-50"
            >
              ➔
            </button>
          </div>
        </div>

        {/* Notiz (max 100 Zeichen), Zeilenumbrüche erhalten, mit Rand */}
        {item?.desc && (
          <div className="mt-2 text-xs text-gray-800 whitespace-pre-wrap border rounded-md p-2">
            {clip(item.desc, 100)}
          </div>
        )}

        {/* Verantwortlich */}
        {item?.responsible && (
          <div className="mt-2 text-xs text-gray-700">
            Verantwortlich: {item.responsible}
          </div>
        )}

        {/* Footer rechts: „?“ statt „Info“ */}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            title="Details"
            className="text-[12px] text-blue-700 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onShowInfo?.(item);
            }}
          >
            ?
          </button>
        </div>
      </article>
    </li>
  );
}
