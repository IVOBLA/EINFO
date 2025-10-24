import React, { useEffect, useMemo, useState } from "react";

function formatAreaLabel(card = {}) {
  const idPart = card?.humanId ? String(card.humanId) : "";
  const titlePart = card?.content ? String(card.content) : "";
  const joined = [idPart, titlePart].filter(Boolean).join(" – ");
  return joined || idPart || titlePart || "Bereich";
}

function initForm(info = {}) {
  return {
    title: info?.content || "",
    typ: info?.typ || info?.type || "",
    ort: info?.additionalAddressInfo || info?.ort || "",
    isArea: !!info?.isArea,
    areaCardId: info?.isArea ? "" : info?.areaCardId || "",
  };
}

export default function IncidentInfoModal({
  open,
  onClose,
  info = {},
  canEdit = false,
  onSave,
  areaOptions = [],
  areaLabelById = new Map(),
  forceEdit = false,
  types = [],
}) {
	 if (!open) return null;
	
const isManual = useMemo(
    () => String(info?.humanId || "").startsWith("M-"),
    [info]
  );

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => initForm(info));
  const [error, setError] = useState("");

  const alarmzeit = info.timestamp
    ? new Date(info.timestamp).toLocaleString("de-AT", { hour12: false })
    : "—";

  const locationCombined = useMemo(() => {
    const locParts = [];
    if (info.location) locParts.push(String(info.location));
    if (Number.isFinite(info.latitude) && Number.isFinite(info.longitude)) {
      locParts.push(`(${info.latitude}, ${info.longitude})`);
    }
    return locParts.length ? locParts.join(" ") : undefined;
  }, [info]);

  const areaSelectOptions = useMemo(
    () => areaOptions.filter((opt) => opt.id !== info?.id),
    [areaOptions, info?.id]
  );

  const areaDisplayLabel = useMemo(() => {
    if (info?.isArea) {
      return formatAreaLabel(info);
    }
    if (!info?.areaCardId) return "—";
    const fromMap = areaLabelById.get(info.areaCardId);
    if (fromMap) return fromMap;
    const opt = areaOptions.find((o) => o.id === info.areaCardId);
    if (opt) return opt.label;
    return String(info.areaCardId);
  }, [info, areaLabelById, areaOptions]);

  useEffect(() => {
    setForm(initForm(info));
    setError("");
    setBusy(false);
    if (forceEdit && canEdit && isManual) {
      setEditing(true);
    } else {
      setEditing(false);
    }
  }, [info, forceEdit, canEdit, isManual, open]);

  const close = () => {
    if (busy) return;
    setEditing(false);
    setError("");
    onClose?.();
  };

  const startEdit = () => {
    if (!canEdit || !isManual) return;
    setForm(initForm(info));
    setError("");
    setEditing(true);
  };

  const cancelEdit = () => {
    if (busy) return;
    setForm(initForm(info));
    setError("");
    setEditing(false);
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    if (!onSave || !info?.id) {
      setEditing(false);
      return;
    }
    const nextTitle = (form.title || "").trim();
    if (!nextTitle) {
      setError("Titel darf nicht leer sein.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(info.id, {
        title: nextTitle,
        typ: (form.typ || "").trim(),
        ort: (form.ort || "").trim(),
        isArea: !!form.isArea,
        areaCardId: form.isArea ? null : form.areaCardId || null,
      });
      setEditing(false);
    } catch (err) {
      const msg = err?.message || "Speichern fehlgeschlagen.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };


  const Row = ({ label, value }) => (
    <div className="flex items-start gap-3 py-1">
      <div className="w-32 shrink-0 text-gray-600">{label}</div>
      <div className="flex-1 font-medium break-words">{value ?? "—"}</div>
    </div>
  );

  const renderEditForm = () => {
    return (
      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid grid-cols-1 gap-2">
          <label className="text-sm font-medium text-gray-700">
            Titel
            <input
              className="mt-1 w-full border rounded px-2 py-1"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              disabled={busy}
            />
          </label>

<label className="text-sm font-medium text-gray-700">
            Typ
            <input
              className="mt-1 w-full border rounded px-2 py-1"
              value={form.typ}
              onChange={(e) => setForm((prev) => ({ ...prev, typ: e.target.value }))}
              list="incident-info-types"
              disabled={busy}
            />
            <datalist id="incident-info-types">
              {(types || []).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>

          <label className="text-sm font-medium text-gray-700">
            Ort
            <input
              className="mt-1 w-full border rounded px-2 py-1"
              value={form.ort}
              onChange={(e) => setForm((prev) => ({ ...prev, ort: e.target.value }))}
              disabled={busy}
            />
          </label>

<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isArea}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    isArea: e.target.checked,
                    areaCardId: e.target.checked ? "" : prev.areaCardId,
                  }))
                }
                disabled={busy}
              />
              Bereich
            </label>
            {!form.isArea && (
              <select
                className="border rounded px-2 py-1 text-sm"
                value={form.areaCardId}
                onChange={(e) => setForm((prev) => ({ ...prev, areaCardId: e.target.value }))}
                disabled={busy || areaSelectOptions.length === 0}
              >
                <option value="">— Bereich auswählen —</option>
                {areaSelectOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            )}
          </div>
          {!form.isArea && areaSelectOptions.length === 0 && (
            <p className="text-xs text-gray-500">Noch keine Bereiche vorhanden.</p>
          )}
        </div>

        
		 {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
type="button"
            className="px-3 py-1.5 rounded border"
            onClick={cancelEdit}
            disabled={busy}
          >
             Abbrechen
          </button>
		   <button
            type="submit"
            className="px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Speichern…" : "Speichern"}
          </button>
        </div>
      </form>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative z-[101] w-[min(92vw,640px)] rounded-xl bg-white shadow-xl p-4 md:p-6">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-lg md:text-xl font-bold">Einsatz-Info</h2>
          <div className="flex items-center gap-2">
            {canEdit && isManual && !editing && (
              <button
                type="button"
                className="px-3 py-1.5 rounded border bg-white text-sm hover:bg-gray-50"
                onClick={startEdit}
              >
                Bearbeiten
              </button>
            )}
            <button
              className="h-8 w-8 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center"
              onClick={close}
              aria-label="Schließen"
              title="Schließen"
            >
              <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
                <path d="M1 1 L11 11 M11 1 L1 11" stroke="black" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {editing ? (
          renderEditForm()
        ) : (
          <>
            <div className="space-y-1">
              <Row label="Titel" value={info.content} />
              <Row label="Typ" value={info.typ || info.type} />
              <Row label="Einsatz ID" value={info.humanId} />
              <Row label="Alarmzeit" value={alarmzeit} />
              <Row label="Alarmiert" value={info.alerted} />
              <Row label="Beschreibung" value={info.description} />
              <Row label="Adresse" value={info.additionalAddressInfo || info.ort} />
              <Row label="Location" value={locationCombined} />
              <Row label="Bereich" value={areaDisplayLabel} />
            </div>

            <div className="mt-4 flex justify-end">
              <button
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={close}
              >
                OK
              </button>
            </div>
          </>
        )}
        </div>
      </div>
  );
}
