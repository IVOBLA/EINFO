import React, { useCallback, useEffect, useMemo, useState } from "react";
import DatePicker, { registerLocale } from "react-datepicker";
import de from "date-fns/locale/de";
import "react-datepicker/dist/react-datepicker.css";

registerLocale("de", de);

const formatDueAt = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("de-AT", {
    timeZone: "Europe/Vienna",
    hour12: false,
  });
};

const normalizeProtocolId = (value) => {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) {
    const normalized = String(Number(raw));
    return normalized === "0" ? "0" : normalized;
  }
  return raw;
};

const normalizeProtocolIds = (values) => {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = normalizeProtocolId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

const sanitizeProtocolDetail = (entry) => {
  if (!entry) return null;
  const nr = normalizeProtocolId(entry?.nr ?? entry?.id ?? entry?.value);
  if (!nr) return null;
  const detail = { nr };
  const assign = (key, aliases = []) => {
    const sources = [entry[key], ...aliases.map((alias) => entry[alias])];
    for (const source of sources) {
      if (source == null) continue;
      const text = String(source).trim();
      if (text) {
        detail[key] = text;
        return;
      }
    }
  };
  assign("title", ["label"]);
  assign("information", ["desc", "beschreibung", "content"]);
  assign("infoTyp");
  assign("datum");
  assign("zeit");
  assign("anvon");
  return detail;
};

const formatProtocolLabel = (detail) => {
  if (!detail) return "Meldung";
  const nr = detail.nr ? `#${detail.nr}` : "Meldung";
  const parts = [nr];
  if (detail.infoTyp) parts.push(detail.infoTyp);
  if (detail.anvon) parts.push(detail.anvon);
  const text = detail.title || detail.information;
  if (text) parts.push(text);
  const when = [detail.datum, detail.zeit].filter(Boolean).join(" ");
  if (when) parts.push(when);
  return parts.join(" — ");
};

export default function AufgInfoModal({
  open,
  item,
  onClose,
  onSave,
  canEdit,
  incidentOptions = [],
  incidentLookup,
  protocolOptions = [],
  protocolLookup,
  onCreateProtocol,
}) {
  const it = item || null;
  const originProtocolId = useMemo(() => normalizeProtocolId(it?.originProtocolNr), [it?.originProtocolNr]);
  const isAutoFromProtocol = Boolean(originProtocolId);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    title: "",
    type: "",
    responsible: "",
    desc: "",
    dueAt: null,
    relatedIncidentId: "",
    linkedProtocolNrs: [],
  });

  const incidentMap = useMemo(() => {
    if (incidentLookup && typeof incidentLookup.get === "function") return incidentLookup;
    const map = new Map();
    if (incidentLookup && typeof incidentLookup === "object") {
      Object.entries(incidentLookup).forEach(([key, value]) => {
        map.set(String(key), value);
      });
    }
    return map;
  }, [incidentLookup]);

  useEffect(() => {
    if (!open) return;
    setEdit(false);
    const initialLinked = normalizeProtocolIds(
      it?.linkedProtocolNrs ?? (Array.isArray(it?.linkedProtocols) ? it.linkedProtocols.map((entry) => entry?.nr) : [])
    );
    const withOrigin = originProtocolId && !initialLinked.includes(originProtocolId)
      ? [...initialLinked, originProtocolId]
      : initialLinked;
    setForm({
      title: it?.title || "",
      type: it?.type || "",
      responsible: it?.responsible || "",
      desc: it?.desc || "",
      dueAt: it?.dueAt ? new Date(it.dueAt) : null,
      relatedIncidentId: it?.relatedIncidentId ? String(it.relatedIncidentId) : "",
      linkedProtocolNrs: withOrigin,
    });
  }, [open, it?.id, originProtocolId, it?.linkedProtocolNrs, it?.linkedProtocols]);
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (ev) => {
      if (ev.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const normalizedFormProtocols = useMemo(() => {
    const current = normalizeProtocolIds(form.linkedProtocolNrs);
    if (originProtocolId && !current.includes(originProtocolId)) current.push(originProtocolId);
    return current;
  }, [form.linkedProtocolNrs, originProtocolId]);

  const normalizedItemProtocols = useMemo(
    () => {
      const current = normalizeProtocolIds(
        it?.linkedProtocolNrs ?? (Array.isArray(it?.linkedProtocols) ? it.linkedProtocols.map((entry) => entry?.nr) : [])
      );
      if (originProtocolId && !current.includes(originProtocolId)) current.push(originProtocolId);
      return current;
    },
    [it?.linkedProtocolNrs, it?.linkedProtocols, originProtocolId]
  );

  const existingLinkedMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(it?.linkedProtocols)) {
      for (const entry of it.linkedProtocols) {
        const detail = sanitizeProtocolDetail(entry);
        if (!detail) continue;
        map.set(detail.nr, detail);
      }
    }
    return map;
  }, [it?.linkedProtocols]);

  const availableProtocolOptions = useMemo(() => {
    const arr = Array.isArray(protocolOptions) ? protocolOptions : [];
    const seen = new Set();
    const list = [];
    for (const entry of arr) {
      const detail = sanitizeProtocolDetail(entry);
      if (!detail || seen.has(detail.nr)) continue;
      seen.add(detail.nr);
      list.push({
        value: detail.nr,
        label: formatProtocolLabel(detail),
        detail,
      });
    }
    list.sort((a, b) => {
      const aNum = Number(a.value);
      const bNum = Number(b.value);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return bNum - aNum;
      return String(b.value).localeCompare(String(a.value), "de", { numeric: true });
    });
    return list;
  }, [protocolOptions]);

  const selectedProtocolDetails = useMemo(() => {
    return normalizedFormProtocols.map((id) => {
      const fromLookup = protocolLookup && typeof protocolLookup.get === "function" ? protocolLookup.get(id) : null;
      return sanitizeProtocolDetail(fromLookup) || existingLinkedMap.get(id) || { nr: id };
    });
  }, [normalizedFormProtocols, protocolLookup, existingLinkedMap]);

  const availableProtocolIds = useMemo(
    () => new Set(availableProtocolOptions.map((opt) => opt.value)),
    [availableProtocolOptions]
  );

  const missingProtocols = useMemo(() => {
    return normalizedFormProtocols
      .filter((id) => !availableProtocolIds.has(id))
      .map((id) => existingLinkedMap.get(id) || { nr: id });
  }, [normalizedFormProtocols, availableProtocolIds, existingLinkedMap]);

  const protocolsChanged = useMemo(() => {
    if (!it) return normalizedFormProtocols.length > 0;
    if (normalizedFormProtocols.length !== normalizedItemProtocols.length) return true;
    const a = [...normalizedFormProtocols].sort();
    const b = [...normalizedItemProtocols].sort();
    return a.some((value, idx) => value !== b[idx]);
  }, [it, normalizedFormProtocols, normalizedItemProtocols]);

  const toggleProtocolSelection = useCallback((nr) => {
    const id = normalizeProtocolId(nr);
    if (!id) return;
    setForm((prev) => {
      const current = new Set(normalizeProtocolIds(prev.linkedProtocolNrs));
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...prev, linkedProtocolNrs: [...current] };
    });
  }, []);

  const changed = useMemo(() => {
    if (!it) return false;
    const currentIncidentId = form.relatedIncidentId ? String(form.relatedIncidentId) : "";
    const originalIncidentId = it?.relatedIncidentId ? String(it.relatedIncidentId) : "";

    return (
      (form.title ?? "") !== (it.title ?? "") ||
      (form.type ?? "") !== (it.type ?? "") ||
      (form.responsible ?? "") !== (it.responsible ?? "") ||
      (form.desc ?? "") !== (it.desc ?? "") ||
      currentIncidentId !== originalIncidentId ||
      ((form.dueAt ? form.dueAt.toISOString() : null) ?? null) !==
        ((it.dueAt ? new Date(it.dueAt).toISOString() : null) ?? null) ||
      protocolsChanged
    );
  }, [form, it, protocolsChanged]);

  const handleSave = async () => {
    if (!canEdit || !it) return;
    if (!changed) {
      setEdit(false);
      return;
    }
    const payload = {
      id: it.id,
      title: form.title?.trim() || "",
      type: form.type?.trim() || "",
      responsible: form.responsible?.trim() || "",
      desc: form.desc?.trim() || "",
      dueAt: form.dueAt ? form.dueAt.toISOString() : null,
    };
    const incidentId = form.relatedIncidentId ? String(form.relatedIncidentId) : "";
    if (incidentId) {
      const info = incidentMap.get(incidentId);
      payload.relatedIncidentId = incidentId;
      payload.incidentTitle = info?.label || info?.content || it.incidentTitle || `#${incidentId}`;
    } else {
      payload.relatedIncidentId = null;
      payload.incidentTitle = null;
    }
    const selectedIds = normalizedFormProtocols;
    payload.linkedProtocolNrs = selectedIds;
    if (selectedIds.length) {
      const details = [];
      for (const id of selectedIds) {
        const lookupEntry = protocolLookup && typeof protocolLookup.get === "function" ? protocolLookup.get(id) : null;
        const sourceDetail =
          sanitizeProtocolDetail(lookupEntry) ||
          existingLinkedMap.get(id) ||
          { nr: id };
        const detail = { nr: sourceDetail.nr };
        const assign = (key) => {
          const value = sourceDetail[key];
          if (value == null) return;
          const text = String(value).trim();
          if (text) detail[key] = text;
        };
        assign("title");
        assign("information");
        assign("infoTyp");
        assign("datum");
        assign("zeit");
        assign("anvon");
        details.push(detail);
      }
      payload.linkedProtocols = details;
    } else {
      payload.linkedProtocols = [];
    }
    await onSave?.(payload);
    setEdit(false);
  };

  const currentIncident = useMemo(() => {
    if (!it?.relatedIncidentId) return null;
    const id = String(it.relatedIncidentId);
    const info = incidentMap.get(id);
    if (info) return { ...info, id, fromBoard: true };
    return {
      id,
      label: it.incidentTitle || `#${id}`,
      statusName: "",
      fromBoard: false,
    };
  }, [incidentMap, it?.relatedIncidentId, it?.incidentTitle]);

  const selectOptions = useMemo(() => {
    const base = Array.isArray(incidentOptions) ? incidentOptions : [];
    if (!currentIncident || currentIncident.fromBoard) return base;
    if (base.some((opt) => String(opt.id) === String(currentIncident.id))) return base;
    return [
      ...base,
      {
        id: currentIncident.id,
        label: `${currentIncident.label} (nicht mehr am Einsatzboard)`,
        statusName: currentIncident.statusName,
        fromBoard: false,
      },
    ];
  }, [incidentOptions, currentIncident]);

  if (!open || !it) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40"
      onClick={() => onClose?.()}
    >
      <div
        className="w-[840px] max-w-[90vw] rounded-2xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Aufgabe</h2>
          <div className="flex items-center gap-2">
            {onCreateProtocol ? (
              <button
                type="button"
                onClick={() => {
                  onCreateProtocol(it);
                  onClose?.();
                }}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                title="Meldung aus Aufgabe erstellen"
              >
                Meldung
              </button>
            ) : null}
            {canEdit ? (
              !edit ? (
                <button
                  onClick={() => setEdit(true)}
                  className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50"
                >
                  Bearbeiten
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setEdit(false)}
                    className="px-3 py-1.5 rounded border bg-white"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                    disabled={!changed}
                  >
                    Speichern
                  </button>
                </>
              )
            ) : null}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
                title="Schließen"
              >
                ✕
              </button>
            </div>
          </div>

        {!edit ? (
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="text-xs text-gray-600">Titel</div>
              <div className="font-medium break-words">{it.title || "—"}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-600">Typ</div>
                <div>{it.type || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Verantwortlich</div>
                <div>{it.responsible || "—"}</div>
              </div>
            </div>
            {it.originProtocolNr ? (
              <div className="text-xs">
                Ursprung:{" "}
                <button
                  className="text-blue-700 hover:underline"
                  onClick={() =>
                    window.location.assign(`/protokoll#/protokoll/edit/${it.originProtocolNr}`)
                  }
                  title={`Meldung #${it.originProtocolNr} öffnen`}
                >
                  Meldung: {it.originProtocolNr}
                </button>
              </div>
            ) : null}
            {it.relatedIncidentId ? (
              <div className="text-xs">
                Einsatz:{" "}
                <span className="font-medium">
                  {currentIncident?.label || it.incidentTitle || `#${it.relatedIncidentId}`}
                </span>
                {currentIncident?.statusName ? (
                  <span className="text-gray-500 ml-1">({currentIncident.statusName})</span>
                ) : null}
                {currentIncident && !incidentMap.has(String(currentIncident.id)) ? (
                  <span className="ml-1 text-[11px] text-amber-600">(nicht mehr am Einsatzboard)</span>
                ) : null}
              </div>
            ) : null}
            <div>
              <div className="text-xs text-gray-600">Verknüpfte Meldungen</div>
              {selectedProtocolDetails.length ? (
                <ul className="mt-1 space-y-1">
                  {selectedProtocolDetails.map((detail) => {
                    const nr = detail.nr;
                    const label = formatProtocolLabel(detail);
                    return (
                      <li key={nr}>
                        <button
                          type="button"
                          className="text-blue-700 hover:underline"
                          onClick={() => {
                            if (!nr) return;
                            window.location.assign(`/protokoll#/protokoll/edit/${nr}`);
                          }}
                          title={nr ? `Meldung #${nr} öffnen` : "Meldung öffnen"}
                        >
                          {label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-sm">—</div>
              )}
            </div>
            <div>
              <div className="text-xs text-gray-600">Notizen</div>
              <div className="whitespace-pre-wrap break-words">{it.desc || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Frist/Kontrollzeitpunkt</div>
              <div className="font-medium">{formatDueAt(it.dueAt)}</div>
            </div>
          </div>
		  ) : (
          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">Titel</span>
              <input
                className="w-full border rounded px-2 py-1 h-9"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-gray-600">Typ</span>
                <input
                  className="w-full border rounded px-2 py-1 h-9"
                  value={form.type}
                  onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Verantwortlich (Rolle)</span>
                <input
                  className="w-full border rounded px-2 py-1 h-9"
                  value={form.responsible}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, responsible: e.target.value }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Einsatzverknüpfung</span>
                <select
                  className="w-full border rounded px-2 py-1 h-9"
                  value={form.relatedIncidentId}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, relatedIncidentId: e.target.value }))
                  }
                >
                  <option value="">Kein Einsatz</option>
                  {selectOptions.map((opt) => {
                    const value = String(opt.id);
                    const status = opt.statusName || opt.statusLabel || "";
                    const label = status ? `${status}: ${opt.label}` : opt.label;
                    return (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block col-span-2">
                <span className="text-xs text-gray-600">Verknüpfte Meldungen</span>
                {isAutoFromProtocol ? (
                  <div className="mt-1">
                    {selectedProtocolDetails.length ? (
                      <ul className="space-y-1">
                        {selectedProtocolDetails.map((detail) => {
                          const nr = detail.nr;
                          const label = formatProtocolLabel(detail);
                          return (
                            <li key={nr}>
                              <button
                                type="button"
                                className="text-blue-700 hover:underline"
                                onClick={() => {
                                  if (!nr) return;
                                  window.location.assign(`/protokoll#/protokoll/edit/${nr}`);
                                }}
                                title={nr ? `Meldung #${nr} öffnen` : "Meldung öffnen"}
                              >
                                {label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="text-sm">—</div>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 flex flex-col gap-2">
                    <div className="max-h-48 overflow-y-auto border rounded divide-y">
                      {availableProtocolOptions.length ? (
                        availableProtocolOptions.map((opt) => {
                          const checked = normalizedFormProtocols.includes(opt.value);
                          return (
                            <label
                              key={opt.value}
                              className="flex items-start gap-2 px-2 py-2 text-sm hover:bg-gray-50"
                            >
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={checked}
                                onChange={() => toggleProtocolSelection(opt.value)}
                              />
                              <span>{opt.label}</span>
                            </label>
                          );
                        })
                      ) : (
                        <div className="px-2 py-2 text-sm text-gray-500">
                          Keine Meldungen verfügbar.
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Meldungen, bei denen diese Rolle als „ergeht an“ eingetragen ist.
                    </div>
                    {missingProtocols.length ? (
                      <div className="rounded border border-amber-300 bg-amber-50 px-2 py-2 text-xs text-amber-800">
                        <div className="font-semibold mb-1">Bereits verknüpft (nicht mehr in der Auswahl)</div>
                        <ul className="space-y-1">
                          {missingProtocols.map((detail) => (
                            <li key={detail.nr} className="flex items-start justify-between gap-2">
                              <span>{formatProtocolLabel(detail)}</span>
                              <button
                                type="button"
                                className="text-red-600 hover:underline"
                                onClick={() => toggleProtocolSelection(detail.nr)}
                              >
                                Entfernen
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-gray-600">Notizen</span>
              <textarea
                className="w-full border rounded px-2 py-2 min-h-[160px]"
                value={form.desc}
                onChange={(e) => setForm((prev) => ({ ...prev, desc: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Frist/Kontrollzeitpunkt</span>
              <DatePicker
                selected={form.dueAt}
                onChange={(date) => setForm((prev) => ({ ...prev, dueAt: date }))}
                showTimeSelect
                dateFormat="dd.MM.yyyy HH:mm"
                timeIntervals={5}
                timeFormat="HH:mm"
                timeCaption="Zeit"
                locale="de"
                isClearable
                placeholderText="Kein Termin"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}