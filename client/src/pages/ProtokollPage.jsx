// client/src/pages/ProtokollPage.jsx
import { useEffect, useRef, useState } from "react";
import { initRolePolicy, canEditApp } from "../auth/roleUtils";

const ERGEHT_OPTIONS = ["EL", "LtStb", "S1", "S2", "S3", "S4", "S5", "S6"];



const LS_KEYS = {
  anvon: "prot_sugg_anvon",
  kanal: "prot_sugg_kanalNr",
  verantwortlich: "prot_sugg_ver",
};

function uniqLimit(arr, limit = 12) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// ---- Fehlertoleranz ---------------------------------------------------------
function normDate(input) {
  let s = String(input || "").trim();
  if (!s) return s;
  const m1 = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
  if (m1) {
    const d = m1[1].padStart(2, "0");
    const mo = m1[2].padStart(2, "0");
    const y = m1[3].length === 2 ? "20" + m1[3] : m1[3];
    return `${y}-${mo}-${d}`;
  }
  const m2 = s.match(/^(\d{1,2})(\d{1,2})(\d{2,4})$/);
  if (m2) {
    const d = m2[1].padStart(2, "0");
    const mo = m2[2].padStart(2, "0");
    const y = m2[3].length === 2 ? "20" + m2[3] : m2[3].padStart(4, "20");
    return `${y}-${mo}-${d}`;
  }
  return s;
}
function normTime(input) {
  let s = String(input || "").trim();
  if (!s) return s;
  const m1 = s.match(/^(\d{1,2})(\d{2})$/);
  if (m1) return `${m1[1].padStart(2, "0")}:${m1[2]}`;
  const m2 = s.match(/^(\d{1,2})[:.](\d{1,2})$/);
  if (m2) return `${m2[1].padStart(2, "0")}:${m2[2].padStart(2, "0")}`;
  return s;
}

const initialForm = () => ({
  datum: new Date().toISOString().slice(0, 10),
  zeit: new Date().toTimeString().slice(0, 5),
  uebermittlungsart: { richtung: "", kanalNr: "" }, // "", "ein", "aus"
  anvon: { richtung: "an", name: "" }, // Startfokus auf "an"
  infoTyp: "Information",
  information: "",
  rueckmeldung1: "",
  rueckmeldung2: "",
  ergehtAn: [],
  ergehtAnText: "",
  lagebericht: "",
  massnahmen: Array.from({ length: 5 }, () => ({
    massnahme: "",
    verantwortlich: "",
    done: false,
  })),
});

export default function ProtokollPage({ mode = "create", editNr = null }) {
 
  // ---- Rechte ---------------------------------------------------------------
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await initRolePolicy();
        if (!mounted) return;
        setCanEdit(canEditApp("protokoll"));
      } catch {
        if (!mounted) return;
        setCanEdit(false);
      }
    })();
    return () => { mounted = false; };
  }, []);


 // ---- Modus/NR -------------------------------------------------------------
  const [nr, setNr] = useState(() => {
    const n = Number(editNr);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const isEditMode = Number.isFinite(Number(nr)) && Number(nr) > 0;
  const [loading, setLoading] = useState(isEditMode);

  // ---- UI -------------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [id, setId] = useState(null);
  const anvonInputRef = useRef(null);
  const infoTypInfoRef = useRef(null); // ← Erstfokus „Information“
  const keylockRef = useRef(false);
  const formRef = useRef(null);

  // ---- Toast ----------------------------------------------------------------
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = (type, text, ms = 2200) => {
    setToast({ type, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };

  // ---- Vorschläge ------------------------------------------------------------
  const [suggAnvon, setSuggAnvon] = useState([]);
  const [suggKanal, setSuggKanal] = useState([]);
  const [suggVer, setSuggVer] = useState([]);
  useEffect(() => {
    try {
      setSuggAnvon(JSON.parse(localStorage.getItem(LS_KEYS.anvon) || "[]"));
      setSuggKanal(JSON.parse(localStorage.getItem(LS_KEYS.kanal) || "[]"));
      setSuggVer(JSON.parse(localStorage.getItem(LS_KEYS.verantwortlich) || "[]"));
    } catch {}
  }, []);

  // ---- Formular-State + Helper ----------------------------------------------
  const [form, setForm] = useState(initialForm());
  const set = (path, value) => {
    const parts = Array.isArray(path) ? path : String(path).split(".");
    setForm((prev) => {
      const next = structuredClone(prev);
      let ref = next;
      for (let i = 0; i < parts.length - 1; i++) ref = ref[parts[i]];
      ref[parts.at(-1)] = value;
      return next;
    });
  };

  // ---- Datensatz laden (Edit) -----------------------------------------------
  useEffect(() => {
    if (!isEditMode) {
      setLoading(false);
      setTimeout(() => infoTypInfoRef.current?.focus(), 0); // Erstfokus
      return;
    }
    const n = Number(nr);
    if (!Number.isFinite(n) || n <= 0) return;

    (async () => {
      try {
        const r = await fetch(`/api/protocol/${n}`).then((res) => res.json());
        if (r?.ok && r.item) {
          const it = r.item;
          const u = it.uebermittlungsart || {};
          let anvonDir = "", anvonName = it.anvon || "";
          const s = (it.anvon || "").trim();
          if (/^an\s*:/i.test(s)) { anvonDir = "an";  anvonName = s.replace(/^an\s*:/i, "").trim(); }
          if (/^von\s*:/i.test(s)) { anvonDir = "von"; anvonName = s.replace(/^von\s*:/i, "").trim(); }

          setForm({
            datum: it.datum || "",
            zeit: it.zeit || "",
            uebermittlungsart: { richtung: u.ein ? "ein" : u.aus ? "aus" : "", kanalNr: u.kanalNr || "" },
            anvon: { richtung: anvonDir || "an", name: anvonName },
            infoTyp: it.infoTyp || "Information",
            information: it.information || "",
            rueckmeldung1: it.rueckmeldung1 || "",
            rueckmeldung2: it.rueckmeldung2 || "",
            ergehtAn: Array.isArray(it.ergehtAn) ? it.ergehtAn : [],
            ergehtAnText: it.ergehtAnText || "",
            lagebericht: it.lagebericht || "",
            massnahmen: Array.from({ length: 5 }, (_, i) => {
              const m = it.massnahmen?.[i] || {};
              return { massnahme: m.massnahme || "", verantwortlich: m.verantwortlich || "", done: !!m.done };
            }),
          });
          setId(it.id || null);
          setTimeout(() => infoTypInfoRef.current?.focus(), 0); // Erstfokus nach Laden
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [isEditMode, nr]);

  // ---- Shortcuts -------------------------------------------------------------
  useEffect(() => {
    const blurActive = () => { const el = document.activeElement; if (el && typeof el.blur === "function") el.blur(); };
    const later = (fn) => setTimeout(fn, 0);

    const onKey = (e) => {
      if (e.repeat) return;
      const key = (e.key || "").toLowerCase();
      const isCtrl = e.ctrlKey || e.metaKey;

      if (isCtrl && !e.shiftKey && key === "s") {
        e.preventDefault(); e.stopPropagation();
         if (!canEdit) { showToast?.("error", "Keine Berechtigung (Meldestelle)"); return; }
		if (keylockRef.current) return;
        keylockRef.current = true;
        later(async () => { blurActive(); await new Promise(r => setTimeout(r,0)); handleSaveClose().finally(()=> keylockRef.current=false); });
        return;
      }
      if (isCtrl && ((e.shiftKey && key === "s") || key === "enter")) {
        e.preventDefault(); e.stopPropagation();
         if (!canEdit) { showToast?.("error", "Keine Berechtigung (Meldestelle)"); return; }
		if (keylockRef.current) return;
        keylockRef.current = true;
        later(async () => { blurActive(); await new Promise(r => setTimeout(r,0)); handleSaveNew().finally(()=> keylockRef.current=false); });
        return;
      }
      if (key === "escape") { e.preventDefault(); e.stopPropagation(); later(() => handleCancel()); }
    };

    window.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("keydown", onKey, true); };
  }, []);

  // ➕ Serverdruck
  const [printing, setPrinting] = useState(false);
  const printFrameRef = useRef(null);

  function buildRecipients() {
    const base = Array.isArray(form?.ergehtAn) ? [...form.ergehtAn] : [];
    const extra = (form?.ergehtAnText || "").trim();
    if (extra) base.push(extra);
    return base;
  }

  const handlePrint = async () => {
    if (!canEdit) { showToast?.("error", "Keine Berechtigung zum Drucken/Speichern"); return; }
	if (printing) return;
    const recipients = buildRecipients();
    if (!recipients.length) {
      showToast?.("error", "Bitte Empfänger wählen oder 'Sonstiger Empfänger' ausfüllen.");
      return;
    }

    setPrinting(true);
    try {
      // 1) Speichern → NR sicherstellen
      const nrSaved = await saveCore();
      if (!nrSaved) throw new Error("Speichern fehlgeschlagen");
      setNr(nrSaved);

      // 2) Datensatz holen
      const rItem = await fetch(`/api/protocol/${nrSaved}`).then((res) => res.json());
      const item = rItem?.item;
      if (!item) throw new Error("Datensatz für Druck nicht gefunden");

      showToast?.("info", "PDF wird serverseitig erzeugt …");

      // 3) PDF erzeugen
      const r = await fetch(`/api/protocol/${nrSaved}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, data: item }),
      }).then((res) => res.json());

      if (!r?.ok || !r?.fileUrl) throw new Error(r?.error || "PDF-Erzeugung fehlgeschlagen");

      // 4) PDF laden und einmal drucken
      let iframe = printFrameRef.current;
      if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        iframe.style.visibility = "hidden";
        document.body.appendChild(iframe);
        printFrameRef.current = iframe;
      }
      const src = `${r.fileUrl}#toolbar=0&navpanes=0&scrollbar=0`;
      iframe.onload = () => {
        try {
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          }, 100);
        } catch {
          const w = window.open(src, "_blank", "noopener,noreferrer");
          w?.focus();
        }
      };
      iframe.src = src;

      const pages = Number(r?.pages) || recipients.length;
      showToast?.("success", `Druck gestartet (${pages} Seite${pages > 1 ? "n" : ""})`);
    } catch (e) {
      showToast?.("error", `Drucken fehlgeschlagen: ${e.message || e}`);
    } finally {
      setPrinting(false);
    }
  };

  const handleCancel = () => { window.location.hash = "/protokoll"; };

  // ---- Speichern (FormData + State-Merge) ----
  const saveCore = async () => {
    const fd = formRef.current ? new FormData(formRef.current) : null;
    const snapshot = structuredClone(form);

    // Basis
    snapshot.datum = normDate(fd?.get("datum") || form.datum);
    snapshot.zeit  = normTime(fd?.get("zeit")  || form.zeit);

    // An/Von
    const domAnvonDir  = (fd?.get("anvonDir")  || form.anvon.richtung || "").toString();
    const domAnvonName = (fd?.get("anvonName") || form.anvon.name     || "").toString();
    snapshot.anvon = { richtung: domAnvonDir, name: domAnvonName };

    // Richtung/Kanal
    const domRichtung = (fd?.get("richtung") || form.uebermittlungsart.richtung || "").toString();
    snapshot.uebermittlungsart.richtung = domRichtung;
    snapshot.uebermittlungsart.kanalNr  = (fd?.get("kanalNr") || form.uebermittlungsart.kanalNr || "").toString();

    // Texte
    snapshot.information   = (fd?.get("information")   || form.information   || "").toString();
    snapshot.rueckmeldung1 = (fd?.get("rueckmeldung1") || form.rueckmeldung1 || "").toString();
    snapshot.rueckmeldung2 = (fd?.get("rueckmeldung2") || form.rueckmeldung2 || "").toString();
    snapshot.ergehtAnText  = (fd?.get("ergehtAnText")  || form.ergehtAnText  || "").toString();
    snapshot.infoTyp       = (fd?.get("infoTyp")       || form.infoTyp       || "Information").toString();

    // „Ergeht an“ (mehrfach)
    const eaDom = fd ? Array.from(fd.getAll("ergehtAn")).map(String) : form.ergehtAn;
    snapshot.ergehtAn = eaDom.length ? eaDom : form.ergehtAn;

    // Maßnahmen
    snapshot.massnahmen = snapshot.massnahmen.map((m, i) => {
      const domDone = fd ? fd.get(`m_done_${i}`) !== null : m.done;
      return {
        massnahme:      (fd?.get(`m_massnahme_${i}`)      || m.massnahme      || "").toString(),
        verantwortlich: (fd?.get(`m_verantwortlich_${i}`) || m.verantwortlich || "").toString(),
        done: !!domDone,
      };
    });

    // Payload
    const payload = {
      ...snapshot,
      uebermittlungsart: {
        kanalNr: (snapshot.uebermittlungsart.kanalNr || "").trim(),
        ein: snapshot.uebermittlungsart.richtung === "ein",
        aus: snapshot.uebermittlungsart.richtung === "aus",
      },
      anvon: snapshot.anvon.richtung
        ? `${snapshot.anvon.richtung === "an" ? "An" : "Von"}: ${snapshot.anvon.name}`.trim()
        : snapshot.anvon.name.trim(),
    };

    // Vorschläge pflegen
    try {
      const newAnvon = uniqLimit([payload.anvon, ...(JSON.parse(localStorage.getItem(LS_KEYS.anvon) || "[]"))]);
      const newKanal = uniqLimit([payload.uebermittlungsart.kanalNr, ...(JSON.parse(localStorage.getItem(LS_KEYS.kanal) || "[]"))]);
      const alleVer  = [...snapshot.massnahmen.map(m => m.verantwortlich).filter(Boolean), ...(JSON.parse(localStorage.getItem(LS_KEYS.verantwortlich) || "[]"))];
      const newVer   = uniqLimit(alleVer);
      localStorage.setItem(LS_KEYS.anvon, JSON.stringify(newAnvon));
      localStorage.setItem(LS_KEYS.kanal, JSON.stringify(newKanal));
      localStorage.setItem(LS_KEYS.verantwortlich, JSON.stringify(newVer));
      setSuggAnvon(newAnvon); setSuggKanal(newKanal); setSuggVer(newVer);
    } catch {}

    // API
    if (isEditMode) {
      const r = await fetch(`/api/protocol/${nr}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(res => res.json());
      if (!r?.ok) throw new Error(r?.error || "Speichern fehlgeschlagen");
      setNr(r.nr); setId(r.id || id || null);
      return r.nr;
    } else {
      const r = await fetch("/api/protocol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(res => res.json());
      if (!r?.ok) throw new Error(r?.error || "Speichern fehlgeschlagen");
      setNr(r.nr); setId(r.id || null);
      return r.nr;
    }
  };

  const handleSaveClose = async () => {
    if (!canEdit) { showToast?.("error", "Keine Berechtigung (Meldestelle)"); return; }
	if (saving) return;
    setSaving(true);
    try { const nrSaved = await saveCore(); if (nrSaved) window.location.hash = "/protokoll"; }
    catch (e) { showToast("error", "Fehler beim Speichern: " + e.message, 4000); }
    finally { setSaving(false); }
  };

  const handleSaveNew = async () => {
    if (!canEdit) { showToast?.("error", "Keine Berechtigung (Meldestelle)"); return; }
	if (saving) return;
    setSaving(true);
    try {
      const nrSaved = await saveCore();
      if (nrSaved) {
        showToast("success", `Gespeichert (NR ${nrSaved}) – neuer Eintrag`);
        setForm(initialForm()); setNr(null); setId(null);
        setTimeout(() => infoTypInfoRef.current?.focus(), 0); // Erstfokus nach Neu
      }
    } catch (e) {
      showToast("error", "Fehler beim Speichern: " + e.message, 4000);
    } finally { setSaving(false); }
  };

  // Fallback am <form>
  const onFormKeyDown = (e) => {
    const key = (e.key || "").toLowerCase();
    const isCtrl = e.ctrlKey || e.metaKey;
    if (e.repeat) return;
    if (isCtrl && !e.shiftKey && key === "s") { e.preventDefault(); e.stopPropagation(); handleSaveClose(); }
    else if (isCtrl && ((e.shiftKey && key === "s") || key === "enter")) { e.preventDefault(); e.stopPropagation(); handleSaveNew(); }
  };
  const onSubmit = (e) => { e.preventDefault(); if (!canEdit) { showToast?.("error", "Keine Berechtigung (Meldestelle)"); return; } handleSaveClose(); };

  if (loading) return <div className="p-4">Lade…</div>;

  // „Alle“-Checkbox (in Tabreihenfolge)
  const allSelected = ERGEHT_OPTIONS.every((k) => form.ergehtAn.includes(k));
  const toggleAll = (checked) => set("ergehtAn", checked ? [...ERGEHT_OPTIONS] : []);

  return (
    <div className="mx-auto w-full max-w-[1100px] relative">
      {/* Sticky Actionbar */}
      <div className="prot-actionbar sticky top-0 z-30 -mx-2 md:mx-0 px-2 md:px-0">
        <div className="bg-white/95 backdrop-blur border-b rounded-t-xl px-3 py-2 flex items-center justify-between shadow-sm">
          <div className="text-sm font-semibold">
            {isEditMode ? `Protokoll – Bearbeiten (NR ${nr ?? "—"})` : "Protokoll – Neuer Eintrag"}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleCancel} className="px-3 py-1.5 rounded-md border" title="Maske schließen und zur Übersicht wechseln (ESC)">Abbrechen</button>
            <button type="button" onClick={handleSaveNew} disabled={saving} className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60" title="Speichern und neue Maske (Strg+Shift+S oder Strg+Enter)">Speichern/Neu</button>
            <button type="button" onClick={handleSaveClose} disabled={saving} className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60" title="Speichern und schließen (Strg+S)">{saving ? "Speichern…" : "Speichern"}</button>
            {/* ➕ Drucken */}
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing}
              className="px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-60"
              title="Formular drucken – Anzahl gemäß 'ergeht an' + 'Sonstiger Empfänger'"
            >
              {printing ? "Drucken…" : "Drucken"}
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed right-3 top-3 z-40">
          <div className={"px-3 py-2 rounded shadow text-white " + (toast.type === "success" ? "bg-emerald-600" : toast.type === "error" ? "bg-rose-600" : "bg-slate-600")}>
            <div className="flex items-center gap-3">
              <span>{toast.text}</span>
              <button className="opacity-80 hover:opacity-100" onClick={() => setToast(null)} title="Meldung schließen">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* ➕ Lokales Print-CSS */}
      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .prot-actionbar { display: none !important; }
          html, body { margin: 0 !important; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      {/* Formular */}
      <form ref={formRef} onKeyDown={onFormKeyDown} onSubmit={onSubmit} className="bg-white border-2 rounded-b-xl overflow-hidden shadow">
        <div className="grid grid-cols-12">
          {/* Kopf */}
          <div className="col-span-9 p-6 border-b-2">
            <div className="text-3xl font-extrabold tracking-wide">MELDUNG/INFORMATION</div>
          </div>
          <div className="col-span-3 border-l-2">
            <div className="p-3 text-xs text-gray-600 border-b-2">PROTOKOLL-NR</div>
            <div className="p-6 text-center text-4xl font-bold">{nr ?? "—"}</div>
          </div>

          {/* Datum/Uhrzeit + Typ (6/3/3) */}
          <div className="col-span-12 border-y-2 p-2">
            <div className="grid grid-cols-12 gap-0">
              {/* Datum */}
              <div className="col-span-6 border-r-2 p-2">
                <div className="text-xs text-gray-600 mb-1">Datum</div>
                <input
                  name="datum" type="text"
                  className="border rounded px-2 h-9 w-full"
                  placeholder="yyyy-mm-dd"
                  value={form.datum}
                  onChange={(e) => set("datum", e.target.value)}
                  onBlur={(e) => set("datum", normDate(e.target.value))}
                  title="Datum (auch 101025 oder 10.10.2025 möglich)"
                />
              </div>
              {/* Uhrzeit */}
              <div className="col-span-3 border-r-2 p-2">
                <div className="text-xs text-gray-600 mb-1">Uhrzeit</div>
                <input
                  name="zeit" type="text"
                  className="border rounded px-2 h-9 w-full"
                  placeholder="hh:mm"
                  value={form.zeit}
                  onChange={(e) => set("zeit", e.target.value)}
                  onBlur={(e) => set("zeit", normTime(e.target.value))}
                  title="Uhrzeit (915, 09:15 oder 0915 möglich)"
                />
              </div>
              {/* Typ → exakt über Richtung */}
{/* Typ → exakt über Richtung */}
<div className="col-span-3 p-2">
  <div className="text-xs text-gray-600 mb-1">Typ</div>
  <div className="grid grid-cols-3 gap-x-6 h-9 items-center">
    <label className="inline-flex items-center gap-2">
      <input
        ref={infoTypInfoRef}
        type="radio" name="infoTyp" value="Information"
        checked={form.infoTyp === "Information"}
        onChange={() => set("infoTyp", "Information")}
      />
      <span>Info</span>
    </label>
    <label className="inline-flex items-center gap-2">
      <input
        type="radio" name="infoTyp" value="Auftrag"
        checked={form.infoTyp === "Auftrag"}
        onChange={() => set("infoTyp", "Auftrag")}
      />
      <span>Auftrag</span>
    </label>
    <label className="inline-flex items-center gap-2">
      <input
        type="radio" name="infoTyp" value="Lagemeldung"
        checked={form.infoTyp === "Lagemeldung"}
        onChange={() => set("infoTyp", "Lagemeldung")}
      />
      <span>Lage</span>
    </label>
  </div>
</div>

            </div>
          </div>

          {/* An/Von – Kanal – Richtung (6/3/3), Richtung unter Typ */}
          <div className="col-span-12 border-y-2 p-2">
            <div className="grid grid-cols-12 gap-0 items-end">
              {/* An/Von */}
              <div className="col-span-6 border-r-2 p-2">
                <div className="text-xs text-gray-600 mb-1">An/Von</div>
                <div className="flex items-center gap-3">
                  <input
                    ref={anvonInputRef}
                    name="anvonName"
                    className="border rounded px-2 h-9 w-full flex-1"
                    placeholder="Name / Stelle"
                    list="dl-anvon"
                    value={form.anvon.name}
                    onChange={(e) => {
                      let v = e.target.value;
                      const raw = v.trim();
                      if (/^an\s*:/i.test(raw)) { set(["anvon","richtung"], "an");  v = raw.replace(/^an\s*:/i, "").trim(); }
                      else if (/^von\s*:/i.test(raw)) { set(["anvon","richtung"], "von"); v = raw.replace(/^von\s*:/i, "").trim(); }
                      set(["anvon","name"], v);
                    }}
                    title='Optional mit Präfix "an: …" oder "von: …"'
                  />
                  <div className="flex items-center gap-4 pl-2 min-w-[140px] shrink-0">
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="anvonDir" value="an"
                        checked={form.anvon.richtung === "an"}
                        onChange={() => set(["anvon","richtung"], "an")} />
                      <span>An</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="anvonDir" value="von"
                        checked={form.anvon.richtung === "von"}
                        onChange={() => set(["anvon","richtung"], "von")} />
                      <span>Von</span>
                    </label>
                  </div>
                </div>
                <datalist id="dl-anvon">{suggAnvon.map((v) => <option key={v} value={v} />)}</datalist>
              </div>

              {/* Kanal */}
              <div className="col-span-3 border-r-2 p-2">
                <div className="text-xs text-gray-600 mb-1">Kanal</div>
                <input
                  name="kanalNr"
                  className="border rounded px-2 h-9 w-full"
                  list="dl-kanal"
                  value={form.uebermittlungsart.kanalNr}
                  onChange={(e) => set(["uebermittlungsart","kanalNr"], e.target.value)}
                  title="z. B. Funkkanal, Telefonnummer, E-Mail-Kürzel …"
                />
                <datalist id="dl-kanal">{suggKanal.map((v) => <option key={v} value={v} />)}</datalist>
              </div>

              {/* Richtung → exakt unter „Typ“ */}
              <div className="col-span-3 p-2">
                <div className="text-xs text-gray-600 mb-1">Richtung</div>
                <div className="grid grid-cols-2 gap-x-6 h-9 items-center">
                  <label className="inline-flex items-center gap-2" title="Meldung wurde empfangen">
                    <input
                      type="radio" name="richtung" value="ein"
                      checked={form.uebermittlungsart.richtung === "ein"}
                      onChange={() => set(["uebermittlungsart","richtung"], "ein")}
                    />
                    <span>Eingang</span>
                  </label>
                  <label className="inline-flex items-center gap-2" title="Meldung wurde gesendet">
                    <input
                      type="radio" name="richtung" value="aus"
                      checked={form.uebermittlungsart.richtung === "aus"}
                      onChange={() => set(["uebermittlungsart","richtung"], "aus")}
                    />
                    <span>Ausgang</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Information/Auftrag */}
          <div className="col-span-12 border-y-2 p-2">
            <div className="text-xs text-gray-600 mb-1">Information/Auftrag</div>
            <textarea
              name="information"
              className="border rounded px-2 py-2 w-full min-h-[160px]"
              value={form.information}
              onChange={(e) => set("information", e.target.value)}
              title="Sachverhalt / Meldetext"
            />
          </div>

          {/* Rückmeldungen untereinander */}
          <div className="col-span-12 border-t-2 p-2">
            <div className="text-xs text-gray-600 mb-1">Rückmeldung 1</div>
            <input
              name="rueckmeldung1"
              className="border rounded px-2 h-9 w-full"
              value={form.rueckmeldung1}
              onChange={(e) => set("rueckmeldung1", e.target.value)}
              title="erste Rückmeldung"
            />
          </div>
          <div className="col-span-12 border-t-2 p-2">
            <div className="text-xs text-gray-600 mb-1">Rückmeldung 2</div>
            <input
              name="rueckmeldung2"
              className="border rounded px-2 h-9 w-full"
              value={form.rueckmeldung2}
              onChange={(e) => set("rueckmeldung2", e.target.value)}
              title="zweite Rückmeldung"
            />
          </div>

          {/* ergeht an */}
          <div className="col-span-12 border-t-2 p-2">
            <div className="text-xs text-gray-600 mb-2">ergeht an:</div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Alle */}
              <label className="inline-flex items-center gap-2 mr-3" title="Alle Empfänger auswählen / abwählen">
                <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} />
                <span>Alle</span>
              </label>

              {/* Einzelne */}
              {ERGEHT_OPTIONS.map((key) => (
                <label key={key} className="inline-flex items-center gap-2 mr-3">
                  <input
                    tabIndex={-1}
                    type="checkbox"
                    name="ergehtAn"
                    value={key}
                    checked={form.ergehtAn.includes(key)}
                    onChange={() => {
                      const s = new Set(form.ergehtAn);
                      s.has(key) ? s.delete(key) : s.add(key);
                      set("ergehtAn", [...s]);
                    }}
                    title={`Empfänger ${key} ${form.ergehtAn.includes(key) ? "entfernen" : "hinzufügen"}`}
                  />
                  <span>{key}</span>
                </label>
              ))}

              <span className="ml-2 text-xs text-gray-600">sonstiger Empfänger:</span>
              <input
                name="ergehtAnText"
                className="border rounded px-2 h-9"
                value={form.ergehtAnText}
                onChange={(e) => set("ergehtAnText", e.target.value)}
                placeholder="Name/Gruppe"
              />
            </div>
          </div>

          {/* Maßnahmen */}
          <div className="col-span-12 border-t-2">
            <div className="grid grid-cols-12 bg-gray-50 border-b-2">
              <div className="col-span-6 p-2 font-semibold border-r">Maßnahme</div>
              <div className="col-span-5 p-2 font-semibold border-r">Verantwortlich</div>
              <div className="col-span-1 p-2 font-semibold text-center">Erledigt</div>
            </div>
            {form.massnahmen.map((m, i) => (
              <div key={i} className="grid grid-cols-12 border-t">
                <div className="col-span-6 p-2 border-r">
                  <input
                    name={`m_massnahme_${i}`}
                    className="w-full border rounded px-2 h-9"
                    value={m.massnahme}
                    onChange={(e) => {
                      const arr = [...form.massnahmen];
                      arr[i] = { ...m, massnahme: e.target.value };
                      set("massnahmen", arr);
                    }}
                    title={`Maßnahme ${i + 1}`}
                  />
                </div>
                <div className="col-span-5 p-2 border-r">
                  <input
                    name={`m_verantwortlich_${i}`}
                    className="w-full border rounded px-2 h-9"
                    list="dl-ver"
                    value={m.verantwortlich}
                    onChange={(e) => {
                      const arr = [...form.massnahmen];
                      arr[i] = { ...m, verantwortlich: e.target.value };
                      set("massnahmen", arr);
                    }}
                    title={`Verantwortlich ${i + 1}`}
                  />
                </div>
                <div className="col-span-1 p-2 flex items-center justify-center">
                  <input
                    tabIndex={-1}
                    type="checkbox"
                    name={`m_done_${i}`}
                    value="1"
                    checked={!!m.done}
                    onChange={(e) => {
                      const arr = [...form.massnahmen];
                      arr[i] = { ...m, done: e.target.checked };
                      set("massnahmen", arr);
                    }}
                    title="Erledigt umschalten"
                  />
                </div>
              </div>
            ))}
            <datalist id="dl-ver">{suggVer.map((v) => <option key={v} value={v} />)}</datalist>
          </div>
        </div>

        {/* Unsichtbarer Submit (Enter) */}
        <button type="submit" className="hidden">submit</button>
      </form>
    </div>
  );
}
