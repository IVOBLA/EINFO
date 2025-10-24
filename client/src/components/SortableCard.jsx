import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AssignedVehicleChip from "./AssignedVehicleChip";

export function SortableCard(props) {
  const {
    card, colId, vehiclesById, pillWidthPx = 160,
    onUnassign, onOpenMap, onAdvance,
    onEditPersonnelStart, editing, editingValue, setEditingValue, onEditPersonnelSave, onEditPersonnelCancel,
    onClone,
    onVehiclesIconClick,
    onShowInfo,
	 areaOptions = [],
    areaLabelById = new Map(),
	areaColorById = new Map(),
    onAreaChange,
    onEditCard,
    nearIds, nearUntilMs,
    distById,
    pulse,
    // NEW: role-gating
    editable = true,
  } = props;

  // Start: in-bearbeitung = offen, erledigt = zu, neu = egal
  const [chipsOpen, setChipsOpen] = useState(colId === "in-bearbeitung");
  const prevAssignedCountRef = useRef((card.assignedVehicles || []).length);
  const chipsRef = useRef(null);

  const pulseActive = Date.now() < (nearUntilMs || 0);

  // DnD only when editable
  const sortable = editable
    ? useSortable({ id: `card:${card.id}`, data: { type: "card", cardId: card.id } })
    : { attributes:{}, listeners:{}, setNodeRef:(el)=>{}, transform:null, transition:null, isDragging:false };
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  const resolvedAreaColor = useMemo(() => {
    if (!card) return null;
    const directColor = typeof card.areaColor === "string" && card.areaColor ? card.areaColor : null;
    if (card.isArea) return directColor;
    if (!card.areaCardId) return null;
    if (directColor) return directColor;
    const idStr = String(card.areaCardId);
    if (areaColorById.has(idStr)) {
      return areaColorById.get(idStr) || null;
    }
    const opt = (areaOptions || []).find((o) => String(o.id) === idStr);
    if (opt?.color) return opt.color;
    return null;
  }, [card, areaColorById, areaOptions]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
	borderColor: resolvedAreaColor || undefined,
    borderWidth: resolvedAreaColor ? "2px" : undefined,
  };

  const vehicleCount = colId === "erledigt"
    ? (card.everVehicles?.length || 0)
    : (card.assignedVehicles?.length || 0);

  const assigned = useMemo(
    () => (card.assignedVehicles || []).map((id) => vehiclesById.get(id)).filter(Boolean),
    [card, vehiclesById]
  );

  const persons = useMemo(() => {
    if (colId === "erledigt") {
      return Number.isFinite(card?.everPersonnel) ? card.everPersonnel : 0;
    }
    if (Number.isFinite(card?.manualPersonnel)) return card.manualPersonnel;
    return assigned.reduce((s, v) => s + (v?.mannschaft ?? 0), 0);
  }, [colId, card, assigned]);

  // Nur im Status "in-bearbeitung":
  // 1) Bei aktivem Pulse automatisch aufklappen, wenn eine zugeordnete Einheit nahe ist
  useEffect(() => {
    if (colId !== "in-bearbeitung") return;
    if (!pulseActive) return;
    const hasNearAssigned = (card.assignedVehicles || []).some((vId) =>
      nearIds?.has(String(vId))
    );
    if (hasNearAssigned) setChipsOpen(true);
  }, [colId, pulseActive, nearIds, card.assignedVehicles]);

  // 2) Bei Zunahme der zugeordneten Einheiten (Drag & Drop) automatisch aufklappen
  useEffect(() => {
    if (colId !== "in-bearbeitung") return;
    const current = (card.assignedVehicles || []).length;
    const prev = prevAssignedCountRef.current;
    if (current > prev) {
      setChipsOpen(true);
    }
    prevAssignedCountRef.current = current;
  }, [colId, card.assignedVehicles]);

  // 3) Auto-Scroll zum Chip-Block, sobald in "in-bearbeitung" geöffnet wird
  useEffect(() => {
    if (colId === "in-bearbeitung" && chipsOpen && chipsRef.current) {
      try {
        chipsRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch {}
    }
  }, [colId, chipsOpen]);

  const handleVehiclesIconClick = () => {
    if (colId === "neu") {
      if (typeof onVehiclesIconClick === "function") {
        onVehiclesIconClick(card, colId);
      }
    } else if (colId === "in-bearbeitung" || colId === "erledigt") {
      setChipsOpen((prev) => !prev);
    }
  };

  const startEditPersonnel = () => {
    if (!editable) return;
    if (typeof onEditPersonnelStart === "function") {
      onEditPersonnelStart(card, persons);
    }
  };

 const isManual = String(card?.humanId || "").startsWith("M-");
  const formatArea = (c) => {
    if (!c) return "";
    const idPart = c.humanId ? String(c.humanId) : "";
    const titlePart = c.content ? String(c.content) : "";
    const joined = [idPart, titlePart].filter(Boolean).join(" – ");
    return joined || idPart || titlePart || "";
  };
  const areaLabel = useMemo(() => {
    if (card?.isArea) return formatArea(card);
    if (!card?.areaCardId) return "";
    const fromMap = areaLabelById.get(card.areaCardId);
    if (fromMap) return fromMap;
    const opt = (areaOptions || []).find((o) => o.id === card.areaCardId);
    if (opt) return opt.label;
    return String(card.areaCardId);
  }, [card, areaLabelById, areaOptions]);
  const areaSelectOptions = useMemo(
    () => (areaOptions || []).filter((opt) => opt.id !== card.id),
    [areaOptions, card.id]
  );
  const canSelectArea = editable && !card.isArea && typeof onAreaChange === "function";
  const currentAreaValue = card.areaCardId ? String(card.areaCardId) : "";
  const handleAreaSelect = (value) => {
    if (!canSelectArea) return;
    onAreaChange(card, value);
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      tabIndex={0}
      className={`group relative rounded-lg bg-white shadow border transition mx-1 focus:outline-none
              ${pulse && colId === "neu" ? "ring-2 ring-red-400/60" : ""}`}
    >
      {pulse && colId === "neu" && (
        <>
          {/* Innerer, weicher Licht-Impuls */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg bg-red-500/10 animate-pulse-inner"
          />
          {/* Äußerer Ping als Shadow-Welle (overflow-sicher) */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg animate-ping-safe"
          />
        </>
      )}
      <div className="p-3 select-none">
        {/* Header */}
        <div className="flex items-start justify-between gap-2" {...attributes} {...listeners}>
          <div className="min-w-0">
		     {card.humanId && (
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Einsatz: {card.humanId}
              </div>
            )}
			{card.isArea && (
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                Bereich
              </div>
            )}
            <div className="font-semibold text-sm leading-5 truncate">{card.content}</div>
            {!!card.ort && (
              <button
                type="button"
                onClick={() => onOpenMap?.(card.ort)}
                className="text-[12px] text-blue-700 hover:underline truncate"
                title="Ort in Karte öffnen"
              >
                {card.ort}
              </button>
            )}
          </div>

                  <div
            className="flex items-center gap-1 shrink-0 transition-opacity duration-150 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
          >
            <button
              type="button"
              title={
                colId === "neu"
                  ? "Nahe Einheiten prüfen"
                  : "Einheiten auf-/zuklappen"
              }
              className="px-2 py-1 rounded text-[12px] border hover:bg-red-50 flex items-center gap-1"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleVehiclesIconClick();
              }}
            >
              🚒 {vehicleCount}
              {(colId === "in-bearbeitung" || colId === "erledigt") && (
                <span>{chipsOpen ? "▾" : "▸"}</span>
              )}
            </button>

            <button
              type="button"
              className="px-2 py-1 rounded text-[12px] border bg-white hover:bg-gray-50"
              title="Personalzahl bearbeiten"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                startEditPersonnel();
              }}
            >
              👥 {persons}
            </button>

            {editable && onAdvance && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onAdvance(card); }}
                className="ml-1 px-2 py-1 rounded text-[12px] border bg-white hover:bg-gray-50"
                title="weiter"
              >
                ➔
              </button>
            )}
          </div>
        </div>

 <div
          className="mt-0 overflow-hidden transition-all duration-200 ease-in-out max-h-0 opacity-0 pointer-events-none group-hover:max-h-[2000px] group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:max-h-[2000px] group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
        >
          <div className="pt-2 space-y-2">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-gray-600 whitespace-nowrap">Bereich</span>
              {canSelectArea ? (
                <select
                  className="border rounded px-2 py-1 text-[12px] min-w-[140px]"
                  value={currentAreaValue}
                  onChange={(e) => handleAreaSelect(e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <option value="">— Bereich auswählen —</option>
                  {areaSelectOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              ) : (
<span className="font-medium text-gray-800">{areaLabel || "—"}</span>
              )}
            </div>
{/* Zugeordnete Einheiten */}
            {colId === "neu" && !!assigned.length && (
              <div className="flex flex-wrap gap-1.5">
                {assigned.map((v) => (
                  <AssignedVehicleChip
                    key={`ass-${card.id}-${v.id}`}
                    cardId={card.id}
                    vehicle={v}
                    pillWidthPx={pillWidthPx}
                    onUnassign={onUnassign}
                    onClone={onClone}
                    near={!!nearIds && pulseActive && nearIds.has(String(v.id))}
                    readonly={!editable}
                    distKm={distById?.get(String(v.id)) ?? null}
                  />
                ))}
              </div>
    )}
  {colId === "in-bearbeitung" && chipsOpen && !!assigned.length && (
              <div ref={chipsRef} className="flex flex-wrap gap-1.5">
                {assigned.map((v) => (
                  <AssignedVehicleChip
                    key={`ass-${card.id}-${v.id}`}
                    cardId={card.id}
                    vehicle={v}
                    pillWidthPx={pillWidthPx}
                    onUnassign={onUnassign}
                    onClone={onClone}
                    near={!!nearIds && pulseActive && nearIds.has(String(v.id))}
                    readonly={!editable}
                    distKm={distById?.get(String(v.id)) ?? null}
                  />
                ))}
              </div>
            )}}

          {colId === "erledigt" && chipsOpen && !!(card.everVehicles?.length) && (
              <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                {card.everVehicles.map((vid) => {
                  const v = vehiclesById.get(vid);
                  const label = v?.label || v?.id || "Unbekannt";
                  const ort = v?.ort ? ` (${v.ort})` : "";
                  return <li key={vid}>{label}{ort}</li>;
                })}
              </ul>
            )}

    {/* Inline-Edit Personen */}
            {editable && editing?.cardId === card.id && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="w-20 border rounded px-2 py-1 text-sm"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  placeholder="Personen"
                />
                <button
                  className="px-2 py-1 text-sm rounded bg-emerald-600 text-white"
                  onClick={() => onEditPersonnelSave(card)}
                >
                  Speichern
                </button>
                <button
                  className="px-2 py-1 text-sm rounded bg-gray-200"
                  onClick={onEditPersonnelCancel}
                >
                  Abbrechen
                </button>
              </div>
            )}

 {/* Footer */}
            <div className="flex justify-end gap-2">
              {editable && isManual && typeof onEditCard === "function" && (
                <button
                  type="button"
                  className="text-[12px] text-blue-700 hover:underline"
                  title="Bearbeiten"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onEditCard(card); }}
                >
                  ✎
                </button>
              )}
              <button
                type="button"
                className="text-[12px] text-blue-700 hover:underline"
                title="Ort in Karte öffnen"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onOpenMap?.(card.ort); }}
              >
                Karte
              </button>
              <button
                type="button"
                className="text-[12px] text-blue-700 hover:underline"
                title="Einsatz-Info"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onShowInfo?.(card); }}
              >
                ?
              </button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
