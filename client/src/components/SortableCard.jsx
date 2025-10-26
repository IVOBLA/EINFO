import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AssignedVehicleChip from "./AssignedVehicleChip";

const ensureAreaHumanId = (value) => {
  const raw = String(value || "");
  if (!raw) return "";
  if (/^B/i.test(raw)) return `B${raw.slice(1)}`;
  if (/^[A-Za-z]/.test(raw)) return `B${raw.slice(1)}`;
  return `B${raw}`;
};

const isManualHumanId = (value) => /^([MB])-/.test(String(value || ""));

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
 const [chipsOpen, setChipsOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const prevAssignedCountRef = useRef((card.assignedVehicles || []).length);
  const chipsRef = useRef(null);
  const hoverTimerRef = useRef(null);

  const pulseActive = Date.now() < (nearUntilMs || 0);
 useEffect(() => {
    setChipsOpen(false);
  }, [colId]);

useEffect(() => () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);


  // DnD only when editable
  const sortable = editable
    ? useSortable({ id: `card:${card.id}`, data: { type: "card", cardId: card.id } })
   : { attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: null, isDragging: false };
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

 const isManual = isManualHumanId(card?.humanId);
  const displayHumanId = useMemo(() => {
    if (!card?.humanId) return "";
    if (card?.isArea) return ensureAreaHumanId(card.humanId);
    return String(card.humanId);
  }, [card?.humanId, card?.isArea]);
  const formatArea = (c) => {
    if (!c) return "";
     const idPartRaw = c.humanId ? String(c.humanId) : "";
    const idPart = c.isArea ? ensureAreaHumanId(idPartRaw) : idPartRaw;
    const titlePart = c.content ? String(c.content) : "";
    const joined = [idPart, titlePart].filter(Boolean).join(" – ");
    return joined || idPart || titlePart || "";
  };
  const areaLabel = useMemo(() => {
    if (card?.isArea) return formatArea(card);
    if (!card?.areaCardId) return "";
    const key = String(card.areaCardId);
    const fromMap = areaLabelById.get(key);
    if (fromMap) return fromMap;
     const opt = (areaOptions || []).find((o) => String(o.id) === key);
    if (opt) return opt.label;
    return String(card.areaCardId);
  }, [card, areaLabelById, areaOptions]);
  const areaSelectOptions = useMemo(
    () => (areaOptions || []).filter((opt) => String(opt.id) !== String(card.id)),
    [areaOptions, card.id]
  );
  const canSelectArea = editable && !card.isArea && typeof onAreaChange === "function";
  const currentAreaValue = card.areaCardId ? String(card.areaCardId) : "";
  const handleAreaSelect = (value) => {
    if (!canSelectArea) return;
    onAreaChange(card, value);
  };
 const showDetails = hovered || chipsOpen;
  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHovered(true);
      hoverTimerRef.current = null;
    }, 300);
  };
  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHovered(false);
  };
  const handleFocus = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHovered(true);
  };
  const handleBlur = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHovered(false);
  };

  const cardBackgroundClass = card.isArea ? "bg-slate-100 border-slate-200" : "bg-white";
  const buttonBackgroundClass = card.isArea
    ? "bg-slate-200 hover:bg-slate-300"
    : "bg-white hover:bg-gray-50";
  const vehicleButtonBackgroundClass = card.isArea
    ? "bg-slate-200 hover:bg-slate-300"
    : "bg-white hover:bg-red-50";


  return (
    <li
      ref={setNodeRef}
      style={style}
      tabIndex={0}
      className={`relative rounded-lg shadow border transition mx-1 focus:outline-none ${
        cardBackgroundClass
      } ${
        pulse && colId === "neu" ? "ring-2 ring-red-400/60" : ""
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
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
      <div
        className={`p-3 select-none ${card.isArea ? "bg-slate-100 rounded-lg" : ""}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2" {...attributes} {...listeners}>
          <div className="min-w-0">
		      {displayHumanId && (
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                 Einsatz: {displayHumanId}
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

<div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              title={
                colId === "neu"
                  ? "Nahe Einheiten prüfen"
                  : "Einheiten auf-/zuklappen"
              }
           className={`px-2 py-1 rounded text-[12px] border flex items-center gap-1 ${
                vehicleButtonBackgroundClass
              }`}
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
className={`px-2 py-1 rounded text-[12px] border ${buttonBackgroundClass}`}
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
                className={`ml-1 px-2 py-1 rounded text-[12px] border ${buttonBackgroundClass}`}
                title="weiter"
              >
                ➔
              </button>
            )}
          </div>
        </div>

<div
          className={`mt-0 overflow-hidden transition-all duration-200 ease-in-out ${
            showDetails
              ? "max-h-[2000px] opacity-100 pointer-events-auto"
              : "max-h-0 opacity-0 pointer-events-none"
         }`}
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
            )}

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
