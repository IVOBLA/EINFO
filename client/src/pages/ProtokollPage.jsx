// client/src/pages/ProtokollPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { initRolePolicy, canEditApp, hasRole } from "../auth/roleUtils";
import { useUserAuth } from "../components/User_AuthProvider.jsx";
import useOnlineRoles from "../hooks/useOnlineRoles.js";

const ERGEHT_OPTIONS = ["EL", "LtStb", "S1", "S2", "S3", "S4", "S5", "S6"];

const CONFIRM_ROLE_INFO = {
  LTSTB: { label: "LtStb", description: "Leiter Stab" },
  LTSTBSTV: { label: "LtStbStv", description: "Stellv. Leiter Stab" },
  S3: { label: "S3", description: null },
};
const CONFIRM_ROLES = Object.keys(CONFIRM_ROLE_INFO);
const ROLE_LABELS = Object.fromEntries(Object.entries(CONFIRM_ROLE_INFO).map(([key, value]) => [key, value.label]));
const DEFAULT_CONFIRM_ROLE_TEXT = (() => {
  const info = CONFIRM_ROLE_INFO.LTSTB;
  if (!info) return "LtStb (Leiter Stab)";
  return info.description ? `${info.label} (${info.description})` : info.label;
})();

const defaultConfirmation = () => ({
  confirmed: false,
  by: null,
  byRole: null,
  at: null,
});



const LS_KEYS = {
  anvon: "prot_sugg_anvon",
  kanal: "prot_sugg_kanalNr",
  verantwortlich: "prot_sugg_ver",
};







// 2) Maßnahme → Aufgabe anlegen (mit Herkunft & optional Ziel-Rolle)
function normRoleId(s) {
  const v = String(s || "").trim();
  if (!v) return null;
  const m = v.match(/\b(S[1-6]|EL|LTSTB)\b/i);
  if (m) return m[1].toUpperCase();
  return v.replace(/\s+/g, "").toUpperCase();
}

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
  anvon: { richtung: "", name: "" },
  infoTyp: "",
  information: "",
  rueckmeldung1: "",
  rueckmeldung2: "",
  ergehtAn: [],
  ergehtAnText: "",
  otherRecipientConfirmation: defaultConfirmation(),
  lagebericht: "",
  massnahmen: Array.from({ length: 5 }, () => ({
    massnahme: "",
    verantwortlich: "",
    done: false,
  })),
});

export default function ProtokollPage({ mode = "create", editNr = null }) {

  const { user } = useUserAuth() || {};
  const [creatingTask, setCreatingTask] = useState(false);
  const { roles: onlineRoles } = useOnlineRoles();
  const ltStbOnline = useMemo(
    () => onlineRoles.some((roleId) => roleId === "LTSTB" || roleId === "LTSTBSTV"),
    [onlineRoles]
  );


  // ---- Rechte ---------------------------------------------------------------
  const [canEdit, setCanEdit] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmRoleIds, setConfirmRoleIds] = useState([]);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await initRolePolicy();
        if (!mounted) return;
        const baseCanEdit = canEditApp("protokoll", user);
        const s3Fallback = !ltStbOnline && hasRole("S3", user);
        setCanEdit(baseCanEdit || s3Fallback);
        setIsAdmin(hasRole("Admin", user));
        setConfirmRoleIds(
          CONFIRM_ROLES.filter((roleId) => {
            if (!hasRole(roleId, user)) return false;
            if (roleId === "S3" && ltStbOnline) return false;
            return true;
          })
        );
      } catch {
        if (!mounted) return;
        setCanEdit(false);
        setIsAdmin(false);
        setConfirmRoleIds([]);
      }
    })();
    return () => { mounted = false; };
  }, [ltStbOnline, user]);


 // ---- Modus/NR -------------------------------------------------------------
  const [nr, setNr] = useState(() => {
    const n = Number(editNr);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const isEditMode = Number.isFinite(Number(nr)) && Number(nr) > 0;
  const [loading, setLoading] = useState(isEditMode);
  const [lockStatus, setLockStatus] = useState(() => (isEditMode ? "pending" : "not-needed"));
  const [lockError, setLockError] = useState(null);
  const lockRefreshTimerRef = useRef(null);
  const lockReleaseRef = useRef(null);
  const lockStateRef = useRef({ nr: null, hasLock: false });

  // ---- UI -------------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [id, setId] = useState(null);
  const [errors, setErrors] = useState({});
  const anvonInputRef = useRef(null);
  const anvonDirAnRef = useRef(null);
  const infoTypInfoRef = useRef(null); // ← Erstfokus „Information“
  const datumRef = useRef(null);
  const zeitRef = useRef(null);
  const richtungEinRef = useRef(null);
  const informationRef = useRef(null);
  const ergehtAnTextRef = useRef(null);
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

  useEffect(() => {
    if (isEditMode && canEdit) {
      setLockStatus("pending");
      setLockError(null);
      return;
    }
    setLockStatus("not-needed");
    setLockError(null);
    if (lockRefreshTimerRef.current) {
      clearTimeout(lockRefreshTimerRef.current);
      lockRefreshTimerRef.current = null;
    }
    lockStateRef.current = { nr: null, hasLock: false };
    lockReleaseRef.current = null;
  }, [isEditMode, nr, canEdit]);

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
  const hasEditLock = !isEditMode || lockStatus === "acquired";
  const clearError = (key) => {
    if (!key) return;
    setErrors((prev) => {
      if (!prev || !prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  const set = (path, value) => {
    const parts = Array.isArray(path) ? path : String(path).split(".");
    setForm((prev) => {
      const prevConfirm = prev?.otherRecipientConfirmation || defaultConfirmation();
      const prevRoleUpper = String(prevConfirm.byRole || "").toUpperCase();
      const confirmed = !!prevConfirm.confirmed;
      if (!canEdit || !hasEditLock || (confirmed && !confirmRoleSet.has(prevRoleUpper))) return prev;
      const next = structuredClone(prev);
      let ref = next;
      for (let i = 0; i < parts.length - 1; i++) ref = ref[parts[i]];
      ref[parts.at(-1)] = value;
      return next;
    });
  };

  const confirmRoleSet = useMemo(() => new Set(confirmRoleIds.map((r) => String(r || "").toUpperCase())), [confirmRoleIds]);
  const confirmationState = form.otherRecipientConfirmation || defaultConfirmation();
  const confirmationRoleUpper = String(confirmationState.byRole || "").toUpperCase();
  const entryConfirmed = !!confirmationState.confirmed;
  const confirmationDetails = entryConfirmed
    ? (() => {
        const roleInfo = CONFIRM_ROLE_INFO[confirmationRoleUpper];
        const roleLabel = roleInfo?.label || confirmationState.byRole || confirmationRoleUpper || "unbekannt";
        const roleDisplay = roleInfo
          ? roleInfo.description
            ? `${roleLabel} (${roleInfo.description})`
            : roleLabel
          : confirmationState.byRole || confirmationRoleUpper || DEFAULT_CONFIRM_ROLE_TEXT;
        const by = confirmationState.by || null;
        const when = confirmationState.at ? new Date(confirmationState.at) : null;
        const whenText = when && !Number.isNaN(when.valueOf()) ? when.toLocaleString("de-DE") : null;
        return { roleLabel, roleDisplay, by, whenText };
      })()
    : null;
  const lockedByOtherRole = entryConfirmed && !confirmRoleSet.has(confirmationRoleUpper);
  const lockedByOtherUser = isEditMode && lockStatus === "blocked";
  const isS3 = hasRole("S3", user);
const s3BlockedByLtStb = isS3 && ltStbOnline;
  const canModify = canEdit && hasEditLock && !lockedByOtherRole && !s3BlockedByLtStb;
  const lockInfoText = lockedByOtherRole && confirmationDetails
    ? `Bestätigt durch ${confirmationDetails.roleLabel}${confirmationDetails.by ? ` (${confirmationDetails.by})` : ""}${confirmationDetails.whenText ? ` am ${confirmationDetails.whenText}` : ""}`
    : null;
  const lockBlockedInfoText = lockedByOtherUser
    ? `Gerade in Bearbeitung durch ${lockError?.lockedBy || lockError?.lock?.lockedBy || "Unbekannt"}`
    : null;
  const confirmationDisplayLines = confirmationDetails
    ? [
        confirmationDetails.roleDisplay,
        [confirmationDetails.by, confirmationDetails.whenText].filter(Boolean).join(" – ") || null,
      ].filter(Boolean)
    : [];
  const canS3OverrideLtStbConfirmation =
    confirmRoleSet.has("S3") &&
    !ltStbOnline &&
    (confirmationRoleUpper === "LTSTB" || confirmationRoleUpper === "LTSTBSTV");
  const showConfirmationControl = confirmRoleSet.size > 0;
  const showModificationDenied = () => {
    if (lockBlockedInfoText) {
      showToast?.("error", `${lockBlockedInfoText} – Änderungen sind derzeit gesperrt.`);
    } else if (lockInfoText) {
      showToast?.("error", `${lockInfoText} – Änderungen nur durch diese Rolle möglich.`);
    } else {
      showToast?.("error", "Keine Berechtigung (Meldestelle)");
    }
  };

  const userConfirmRole = (() => {
    if (confirmRoleSet.has(confirmationRoleUpper)) return confirmationRoleUpper;
    for (const id of confirmRoleIds) {
      const upper = String(id || "").toUpperCase();
      if (upper) return upper;
    }
    return null;
  })();
  const canToggleConfirmation = entryConfirmed
    ? confirmRoleSet.has(confirmationRoleUpper) || canS3OverrideLtStbConfirmation
    : confirmRoleSet.size > 0;
  const confirmationToggleTitle = entryConfirmed
    ? confirmRoleSet.has(confirmationRoleUpper) || canS3OverrideLtStbConfirmation
      ? "Bestätigung zurücknehmen"
      : "Nur die bestätigende Rolle darf zurücksetzen"
    : confirmRoleSet.size > 0
      ? "Bestätigung setzen"
      : "Bestätigung nur durch berechtigte Rolle möglich";

  const handleConfirmationToggle = (checked) => {
    if (!canEdit) { showModificationDenied(); return; }
    if (!checked && !entryConfirmed) return;
    if (checked && !confirmRoleSet.size) {
      showToast?.("error", "Keine Berechtigung zum Bestätigen");
      return;
    }
    const targetRole = checked ? userConfirmRole : confirmationRoleUpper;
    if (checked && !targetRole) {
      showToast?.("error", "Keine Berechtigung zum Bestätigen");
      return;
    }
    if (!checked && confirmationRoleUpper && !(confirmRoleSet.has(confirmationRoleUpper) || canS3OverrideLtStbConfirmation)) {
      showToast?.("error", "Nur die bestätigende Rolle darf zurücksetzen");
      return;
    }
    setForm((prev) => {
      const next = structuredClone(prev);
      if (!checked) {
        next.otherRecipientConfirmation = defaultConfirmation();
      } else {
        const displayName = user?.displayName || user?.username || (user?.id != null ? `ID ${user.id}` : null);
        next.otherRecipientConfirmation = {
          confirmed: true,
          by: displayName,
          byRole: targetRole,
          at: Date.now(),
        };
      }
      return next;
    });
  };

  useEffect(() => {
    if (!isEditMode || !canEdit) return;
    const currentNr = Number(nr);
    if (!Number.isFinite(currentNr) || currentNr <= 0) return;

    let cancelled = false;

    const releaseLock = async () => {
      if (!lockStateRef.current.hasLock || lockStateRef.current.nr !== currentNr) return;
      lockStateRef.current = { nr: null, hasLock: false };
      try {
        await fetch(`/api/protocol/${currentNr}/lock`, {
          method: "DELETE",
          credentials: "include",
        }).catch(() => {});
      } catch {}
    };

    lockReleaseRef.current = releaseLock;

    const acquire = async ({ silent = false } = {}) => {
      try {
        const res = await fetch(`/api/protocol/${currentNr}/lock`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 423) {
            lockStateRef.current = { nr: null, hasLock: false };
            if (!cancelled) {
              setLockStatus("blocked");
              setLockError({ lockedBy: data?.lockedBy || data?.lock?.lockedBy || "Unbekannt" });
            }
          } else if (!silent) {
            const message = data?.error || `Sperren fehlgeschlagen (${res.status})`;
            if (!cancelled) {
              setLockStatus("error");
              setLockError({ message });
            }
          }
          return false;
        }

        if (cancelled) return true;
        lockStateRef.current = { nr: currentNr, hasLock: true };
        setLockStatus("acquired");
        setLockError(null);
        return true;
      } catch (err) {
        if (!silent && !cancelled) {
          setLockStatus("error");
          setLockError({ message: err?.message || String(err) });
        }
        return false;
      }
    };

    const scheduleRefresh = () => {
      if (cancelled) return;
      if (lockRefreshTimerRef.current) {
        clearTimeout(lockRefreshTimerRef.current);
        lockRefreshTimerRef.current = null;
      }
      lockRefreshTimerRef.current = setTimeout(async () => {
        const ok = await acquire({ silent: true });
        if (cancelled) return;
        if (ok || (lockStateRef.current.hasLock && lockStateRef.current.nr === currentNr)) {
          scheduleRefresh();
        }
      }, 60000);
    };

    (async () => {
      const ok = await acquire({ silent: false });
      if (ok) scheduleRefresh();
    })();

    return () => {
      cancelled = true;
      if (lockRefreshTimerRef.current) {
        clearTimeout(lockRefreshTimerRef.current);
        lockRefreshTimerRef.current = null;
      }
      lockReleaseRef.current = null;
      releaseLock();
    };
  }, [isEditMode, nr, canEdit]);

  // ---- Datensatz laden (Edit) -----------------------------------------------
  useEffect(() => {
    if (!isEditMode) {
      setLoading(false);
      setTimeout(() => infoTypInfoRef.current?.focus(), 0); // Erstfokus
      return;
    }
    const n = Number(nr);
    if (!Number.isFinite(n) || n <= 0) return;

    if (canEdit && lockStatus !== "acquired" && lockStatus !== "blocked") return;

    (async () => {
      try {
        const r = await fetch(`/api/protocol/${n}`, { credentials: "include" }).then((res) =>
          res.json()
        );
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
            otherRecipientConfirmation: (() => {
              const src = it.otherRecipientConfirmation;
              if (!src || typeof src !== "object") return defaultConfirmation();
              if (!src.confirmed) return defaultConfirmation();
              const ts = Number.isFinite(src.at) ? Number(src.at) : Number(new Date(src.at).valueOf());
              return {
                confirmed: true,
                by: src.by || null,
                byRole: src.byRole || null,
                at: Number.isFinite(ts) ? ts : null,
              };
            })(),
            lagebericht: it.lagebericht || "",
            massnahmen: Array.from({ length: 5 }, (_, i) => {
              const m = it.massnahmen?.[i] || {};
              return { massnahme: m.massnahme || "", verantwortlich: m.verantwortlich || "", done: !!m.done };
            }),
          });
          setErrors({});
          setId(it.id || null);
          setTimeout(() => infoTypInfoRef.current?.focus(), 0); // Erstfokus nach Laden
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [isEditMode, nr, lockStatus, canEdit]);

  useEffect(() => {
    if (!isEditMode) return;
    if (lockStatus === "blocked" || lockStatus === "error") {
      setLoading(false);
    }
  }, [isEditMode, lockStatus]);

  useEffect(() => {
    if (!isEditMode) return;
    if (lockStatus === "error" && lockError?.message) {
      showToast?.("error", lockError.message);
    }
  }, [isEditMode, lockStatus, lockError]);

  useEffect(() => {
    if (!isEditMode) return;
    if (lockStatus !== "blocked") return;
    const name = lockError?.lockedBy || lockError?.lock?.lockedBy || "Unbekannt";
    showToast?.("error", `Gerade in Bearbeitung durch ${name} – Änderungen nicht möglich.`);
  }, [isEditMode, lockStatus, lockError]);

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
         if (!canModify) { showModificationDenied(); return; }
                if (keylockRef.current) return;
        keylockRef.current = true;
        later(async () => { blurActive(); await new Promise(r => setTimeout(r,0)); handleSaveClose().finally(()=> keylockRef.current=false); });
        return;
      }
      if (isCtrl && ((e.shiftKey && key === "s") || key === "enter")) {
        e.preventDefault(); e.stopPropagation();
         if (!canModify) { showModificationDenied(); return; }
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
  const [printingKind, setPrintingKind] = useState(null);
  const printFrameRef = useRef(null);

  function buildRecipients() {
    const base = Array.isArray(form?.ergehtAn) ? [...form.ergehtAn] : [];
    const extra = (form?.ergehtAnText || "").trim();
    if (extra) base.push(extra);
    return base;
  }

  const startPdfPrint = (fileUrl) => {
    const src = `${fileUrl}#toolbar=0&navpanes=0&scrollbar=0`;
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
  };

  const handlePrint = async () => {
    if (!canEdit) { showToast?.("error", "Keine Berechtigung zum Drucken/Speichern"); return; }
        if (printing) return;
    setPrintingKind("data");
    const recipients = buildRecipients();
    if (!recipients.length) {
      showToast?.("error", "Bitte Empfänger wählen oder 'Sonstiger Empfänger' ausfüllen.");
      return;
    }

    setPrinting(true);
    try {
      // 1) Speichern → NR sicherstellen
      const nrSaved = await saveCore();
      if (!nrSaved) return;
      setNr(nrSaved);

      // 2) Datensatz holen
      const rItem = await fetch(`/api/protocol/${nrSaved}`, { credentials: "include" }).then((res) =>
        res.json()
      );
      const item = rItem?.item;
      if (!item) throw new Error("Datensatz für Druck nicht gefunden");

      showToast?.("info", "PDF wird serverseitig erzeugt …");

      // 3) PDF erzeugen
      const r = await fetch(`/api/protocol/${nrSaved}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ recipients, data: item }),
      }).then((res) => res.json());

      if (!r?.ok || !r?.fileUrl) throw new Error(r?.error || "PDF-Erzeugung fehlgeschlagen");

      // 4) PDF laden und einmal drucken
      startPdfPrint(r.fileUrl);

      const pages = Number(r?.pages) || recipients.length;
      showToast?.("success", `Druck gestartet (${pages} Seite${pages > 1 ? "n" : ""})`);
    } catch (e) {
      showToast?.("error", `Drucken fehlgeschlagen: ${e.message || e}`);
    } finally {
      setPrintingKind(null);
      setPrinting(false);
    }
  };

  const handlePrintBlank = async () => {
    if (!isAdmin) return;
    if (printing) return;
    setPrinting(true);
    setPrintingKind("blank");
    try {
      const blankItem = {
        datum: "",
        zeit: "",
        infoTyp: "__blank__",
        uebermittlungsart: { kanalNr: "", ein: false, aus: false },
        anvon: "",
        information: "",
        rueckmeldung1: "",
        rueckmeldung2: "",
        ergehtAn: [],
        ergehtAnText: "",
        massnahmen: Array.from({ length: 5 }, () => ({ massnahme: "", verantwortlich: "", done: false })),
      };
      const r = await fetch(`/api/protocol/blank/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ recipients: [""], data: blankItem }),
      }).then((res) => res.json());
      if (!r?.ok || !r?.fileUrl) throw new Error(r?.error || "PDF-Erzeugung fehlgeschlagen");
      startPdfPrint(r.fileUrl);
      const pages = Number(r?.pages) || 1;
      showToast?.("success", `Leeres Formular – Druck gestartet (${pages} Seite${pages > 1 ? "n" : ""})`);
    } catch (e) {
      showToast?.("error", `Leeres Formular konnte nicht gedruckt werden: ${e.message || e}`);
    } finally {
      setPrintingKind(null);
      setPrinting(false);
    }
  };

  const handleCancel = () => {
    try {
      const maybePromise = lockReleaseRef.current?.();
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.catch(() => {});
      }
    } catch {}
    window.location.hash = "/protokoll";
  };

  // ---- Speichern (FormData + State-Merge) ----
  const saveCore = async () => {
    if (!canModify) return nr;
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
    const domInfoTyp = fd?.get("infoTyp");
    snapshot.infoTyp       = (domInfoTyp !== null && domInfoTyp !== undefined ? domInfoTyp : (form.infoTyp || "")).toString();
    const snapshotConfirm = snapshot.otherRecipientConfirmation || {};
    if (snapshotConfirm.confirmed) {
      const ts = Number.isFinite(snapshotConfirm.at) ? Number(snapshotConfirm.at) : Number(new Date(snapshotConfirm.at).valueOf());
      snapshot.otherRecipientConfirmation = {
        confirmed: true,
        by: snapshotConfirm.by || null,
        byRole: snapshotConfirm.byRole || null,
        at: Number.isFinite(ts) ? ts : Date.now(),
      };
    } else {
      snapshot.otherRecipientConfirmation = defaultConfirmation();
    }

    // „Ergeht an“ (mehrfach)
    const eaDom = fd ? Array.from(fd.getAll("ergehtAn")).map(String) : form.ergehtAn;
    snapshot.ergehtAn = (eaDom.length ? eaDom : form.ergehtAn).map((v) => String(v || "").trim()).filter(Boolean);

    // Maßnahmen
    snapshot.massnahmen = snapshot.massnahmen.map((m, i) => {
      const domDone = fd ? fd.get(`m_done_${i}`) !== null : m.done;
      return {
        massnahme:      (fd?.get(`m_massnahme_${i}`)      || m.massnahme      || "").toString(),
        verantwortlich: (fd?.get(`m_verantwortlich_${i}`) || m.verantwortlich || "").toString(),
        done: !!domDone,
      };
    });

    snapshot.datum = String(snapshot.datum || "").trim();
    snapshot.zeit = String(snapshot.zeit || "").trim();
    snapshot.infoTyp = String(snapshot.infoTyp || "").trim();
    snapshot.anvon.name = String(snapshot.anvon?.name || "").trim();
    snapshot.anvon.richtung = String(snapshot.anvon?.richtung || "").trim();
    snapshot.uebermittlungsart.richtung = String(snapshot.uebermittlungsart?.richtung || "").trim();
    snapshot.uebermittlungsart.kanalNr = String(snapshot.uebermittlungsart?.kanalNr || "").trim();
    snapshot.ergehtAnText = String(snapshot.ergehtAnText || "").trim();
    if (snapshot.otherRecipientConfirmation.confirmed) {
      snapshot.otherRecipientConfirmation.by = snapshot.otherRecipientConfirmation.by || null;
      snapshot.otherRecipientConfirmation.byRole = snapshot.otherRecipientConfirmation.byRole || null;
      snapshot.otherRecipientConfirmation.at = Number.isFinite(snapshot.otherRecipientConfirmation.at)
        ? Number(snapshot.otherRecipientConfirmation.at)
        : Date.now();
    } else {
      snapshot.otherRecipientConfirmation = defaultConfirmation();
    }

    const validationErrors = {};
    if (!snapshot.datum) validationErrors.datum = true;
    if (!snapshot.zeit) validationErrors.zeit = true;
    if (!snapshot.infoTyp) validationErrors.infoTyp = true;
    if (!snapshot.anvon.name) validationErrors.anvonName = true;
    if (!snapshot.anvon.richtung) validationErrors.anvonDir = true;
    if (!snapshot.uebermittlungsart.richtung) validationErrors.richtung = true;
    if (!String(snapshot.information || "").trim()) validationErrors.information = true;
    const recipientsCheck = [...snapshot.ergehtAn];
    if (snapshot.ergehtAnText) recipientsCheck.push(snapshot.ergehtAnText);
    if (!recipientsCheck.length) validationErrors.ergehtAn = true;

    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      const focusOrder = ["datum", "zeit", "infoTyp", "anvonName", "anvonDir", "richtung", "information", "ergehtAn"];
      const firstKey = focusOrder.find((key) => validationErrors[key]);
      const focusMap = {
        datum: datumRef,
        zeit: zeitRef,
        infoTyp: infoTypInfoRef,
        anvonName: anvonInputRef,
        anvonDir: anvonDirAnRef,
        richtung: richtungEinRef,
        information: informationRef,
        ergehtAn: ergehtAnTextRef,
      };
      const targetRef = focusMap[firstKey];
      if (targetRef?.current) setTimeout(() => targetRef.current?.focus(), 0);
      showToast?.("error", "Bitte alle Pflichtfelder ausfüllen.");
      return null;
    }

    setErrors({});

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
        credentials: "include",
        body: JSON.stringify(payload),
      }).then(res => res.json());
      if (!r?.ok) throw new Error(r?.error || "Speichern fehlgeschlagen");
      setNr(r.nr); setId(r.id || id || null);
      return r.nr;
    } else {
      const r = await fetch("/api/protocol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      }).then(res => res.json());
      if (!r?.ok) throw new Error(r?.error || "Speichern fehlgeschlagen");
      setNr(r.nr); setId(r.id || null);
      return r.nr;
    }
  };

  const handleSaveClose = async () => {
    if (!canModify) { showModificationDenied(); return; }
        if (saving) return;
    setSaving(true);
    try { const nrSaved = await saveCore(); if (nrSaved) window.location.hash = "/protokoll"; }
    catch (e) { showToast("error", "Fehler beim Speichern: " + e.message, 4000); }
    finally { setSaving(false); }
  };

  const handleSaveNew = async () => {
    if (!canModify) { showModificationDenied(); return; }
        if (saving) return;
    setSaving(true);
    try {
      const nrSaved = await saveCore();
      if (nrSaved) {
        showToast("success", `Gespeichert (NR ${nrSaved}) – neuer Eintrag`);
        setForm(initialForm()); setErrors({}); setNr(null); setId(null);
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
  const onSubmit = (e) => { e.preventDefault(); if (!canModify) { showModificationDenied(); return; } handleSaveClose(); };

  if (loading) return <div className="p-4">Lade…</div>;

  // „Alle“-Checkbox (in Tabreihenfolge)
  const allSelected = ERGEHT_OPTIONS.every((k) => form.ergehtAn.includes(k));
  const toggleAll = (checked) => {
    if (!canModify) return;
    clearError("ergehtAn");
    set("ergehtAn", checked ? [...ERGEHT_OPTIONS] : []);
  };

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
            <button type="button" onClick={handleSaveNew} disabled={saving || !canModify} className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60" title="Speichern und neue Maske (Strg+Shift+S oder Strg+Enter)">Speichern/Neu</button>
            <button type="button" onClick={handleSaveClose} disabled={saving || !canModify} className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60" title="Speichern und schließen (Strg+S)">{saving ? "Speichern…" : "Speichern"}</button>
            {/* ➕ Drucken */}
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing}
              className="px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-60"
              title="Formular drucken – Anzahl gemäß 'ergeht an' + 'Sonstiger Empfänger'"
            >
              {printing && printingKind === "data" ? "Drucken…" : "Drucken"}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={handlePrintBlank}
                disabled={printing}
                className="px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-60"
                title="Leeres Formular drucken"
              >
                {printing && printingKind === "blank" ? "Drucken…" : "Leer drucken"}
              </button>
            )}
          </div>
        </div>
      </div>

      {lockedByOtherUser && lockBlockedInfoText && (
        <div className="mx-2 md:mx-0 mt-3 px-3 py-2 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
          {lockBlockedInfoText} – Änderungen sind derzeit gesperrt.
        </div>
      )}

      {lockedByOtherRole && lockInfoText && (
        <div className="mx-2 md:mx-0 mt-3 px-3 py-2 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
          {lockInfoText} – Änderungen nur durch diese Rolle möglich.
        </div>
      )}

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
          <div className="col-span-9 px-6 py-4 border-b-2">
            <div className="text-3xl font-extrabold tracking-wide">MELDUNG/INFORMATION</div>
          </div>
          <div className="col-span-3 border-l-2">
            <div className="px-2 py-1 text-[10px] text-gray-600 border-b-2">PROTOKOLL-NR</div>
            <div className="px-2 py-1.5 text-center text-xl font-semibold">{nr ?? "—"}</div>
          </div>

          {/* Datum/Uhrzeit + Typ (6/3/3) */}
          <div className="col-span-12 border-y-2 p-2">
            <div className="grid grid-cols-12 gap-0">
              {/* Datum */}
              <div className="col-span-6 border-r-2 p-2">
                <div className="text-[11px] text-gray-600 mb-1">Datum</div>
                <input
                  ref={datumRef}
                  name="datum" type="text"
                  className={`border rounded px-2 h-6 text-[13px] w-full ${errors.datum ? "border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500" : ""}`}
                  placeholder="yyyy-mm-dd"
                  value={form.datum}
                  onChange={(e) => { clearError("datum"); set("datum", e.target.value); }}
                  onBlur={(e) => set("datum", normDate(e.target.value))}
                  title="Datum (auch 101025 oder 10.10.2025 möglich)"
                />
              </div>
              {/* Uhrzeit */}
              <div className="col-span-3 border-r-2 p-2">
                <div className="text-[11px] text-gray-600 mb-1">Uhrzeit</div>
                <input
                  ref={zeitRef}
                  name="zeit" type="text"
                  className={`border rounded px-2 h-6 text-[13px] w-full ${errors.zeit ? "border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500" : ""}`}
                  placeholder="hh:mm"
                  value={form.zeit}
                  onChange={(e) => { clearError("zeit"); set("zeit", e.target.value); }}
                  onBlur={(e) => set("zeit", normTime(e.target.value))}
                  title="Uhrzeit (915, 09:15 oder 0915 möglich)"
                />
              </div>
              {/* Typ → exakt über Richtung */}
              <div className="col-span-3 p-2">
                <div className="text-[11px] text-gray-600 mb-1">Typ</div>
                <div className={`grid grid-cols-3 gap-x-4 h-6 items-center text-[13px] ${errors.infoTyp ? "outline outline-2 outline-red-500 rounded-md" : ""}`}>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      ref={infoTypInfoRef}
                      type="radio" name="infoTyp" value="Information" required
                      checked={form.infoTyp === "Information"}
                      onChange={() => { clearError("infoTyp"); set("infoTyp", "Information"); }}
                    />
                    <span>Info</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio" name="infoTyp" value="Auftrag"
                      checked={form.infoTyp === "Auftrag"}
                      onChange={() => { clearError("infoTyp"); set("infoTyp", "Auftrag"); }}
                    />
                    <span>Auftrag</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio" name="infoTyp" value="Lagemeldung"
                      checked={form.infoTyp === "Lagemeldung"}
                      onChange={() => { clearError("infoTyp"); set("infoTyp", "Lagemeldung"); }}
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
                <div className="text-[11px] text-gray-600 mb-1">An/Von</div>
                <div className="flex items-center gap-2.5">
                  <input
                    ref={anvonInputRef}
                    name="anvonName"
                    className={`border rounded px-2 h-6 text-[13px] w-full flex-1 ${errors.anvonName ? "border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500" : ""}`}
                    placeholder="Name / Stelle"
                    required
                    list="dl-anvon"
                    value={form.anvon.name}
                    onChange={(e) => {
                      clearError("anvonName");
                      let v = e.target.value;
                      const raw = v.trim();
                      if (/^an\s*:/i.test(raw)) { clearError("anvonDir"); set(["anvon","richtung"], "an");  v = raw.replace(/^an\s*:/i, "").trim(); }
                      else if (/^von\s*:/i.test(raw)) { clearError("anvonDir"); set(["anvon","richtung"], "von"); v = raw.replace(/^von\s*:/i, "").trim(); }
                      set(["anvon","name"], v);
                    }}
                    title='Optional mit Präfix "an: …" oder "von: …"'
                  />
                  <div className={`flex items-center gap-2.5 pl-2 min-w-[128px] shrink-0 text-[13px] ${errors.anvonDir ? "outline outline-2 outline-red-500 rounded-md" : ""}`}>
                    <label className="inline-flex items-center gap-1.5">
                      <input ref={anvonDirAnRef} type="radio" name="anvonDir" value="an" required
                        checked={form.anvon.richtung === "an"}
                        onChange={() => { clearError("anvonDir"); set(["anvon","richtung"], "an"); }} />
                      <span>An</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input type="radio" name="anvonDir" value="von"
                        checked={form.anvon.richtung === "von"}
                        onChange={() => { clearError("anvonDir"); set(["anvon","richtung"], "von"); }} />
                      <span>Von</span>
                    </label>
                  </div>
                </div>
                <datalist id="dl-anvon">{suggAnvon.map((v) => <option key={v} value={v} />)}</datalist>
              </div>

              {/* Kanal */}
              <div className="col-span-3 border-r-2 p-2">
                <div className="text-[11px] text-gray-600 mb-1">Kanal</div>
                <input
                  name="kanalNr"
                  className="border rounded px-2 h-6 text-[13px] w-full"
                  list="dl-kanal"
                  value={form.uebermittlungsart.kanalNr}
                  onChange={(e) => set(["uebermittlungsart","kanalNr"], e.target.value)}
                  title="z. B. Funkkanal, Telefonnummer, E-Mail-Kürzel …"
                />
                <datalist id="dl-kanal">{suggKanal.map((v) => <option key={v} value={v} />)}</datalist>
              </div>

              {/* Richtung → exakt unter „Typ“ */}
              <div className="col-span-3 p-2">
                <div className="text-[11px] text-gray-600 mb-1">Richtung</div>
                <div className={`grid grid-cols-2 gap-x-4 h-6 items-center text-[13px] ${errors.richtung ? "outline outline-2 outline-red-500 rounded-md" : ""}`}>
                  <label className="inline-flex items-center gap-1.5" title="Meldung wurde empfangen">
                    <input
                      ref={richtungEinRef}
                      type="radio" name="richtung" value="ein"
                      checked={form.uebermittlungsart.richtung === "ein"}
                      onChange={() => { clearError("richtung"); set(["uebermittlungsart","richtung"], "ein"); }}
                    />
                    <span>Eingang</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5" title="Meldung wurde gesendet">
                    <input
                      type="radio" name="richtung" value="aus"
                      checked={form.uebermittlungsart.richtung === "aus"}
                      onChange={() => { clearError("richtung"); set(["uebermittlungsart","richtung"], "aus"); }}
                    />
                    <span>Ausgang</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Information/Auftrag */}
          <div className="col-span-12 border-y-2 p-2">
            <div className="text-[11px] text-gray-600 mb-1">Information/Auftrag</div>
            <textarea
              ref={informationRef}
              name="information"
              className={`border rounded px-2 py-2 w-full min-h-[360px] md:min-h-[420px] text-[15px] leading-relaxed ${errors.information ? "border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500" : ""}`}
              value={form.information}
              onChange={(e) => { clearError("information"); set("information", e.target.value); }}
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
            <div className={`flex flex-wrap items-center gap-3 rounded-md ${errors.ergehtAn ? "ring-2 ring-red-500" : ""}`}>
              {/* Alle */}
              <label className="inline-flex items-center gap-2 mr-3 text-sm" title="Alle Empfänger auswählen / abwählen">
                <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} disabled={!canModify} />
                <span>Alle</span>
              </label>

              {/* Einzelne */}
              {ERGEHT_OPTIONS.map((key) => (
                <label key={key} className="inline-flex items-center gap-2 mr-3 text-sm">
                  <input
                    tabIndex={-1}
                    type="checkbox"
                    name="ergehtAn"
                    value={key}
                    checked={form.ergehtAn.includes(key)}
                    onChange={() => {
                      clearError("ergehtAn");
                      const s = new Set(form.ergehtAn);
                      s.has(key) ? s.delete(key) : s.add(key);
                      set("ergehtAn", [...s]);
                    }}
                    disabled={!canModify}
                    title={`Empfänger ${key} ${form.ergehtAn.includes(key) ? "entfernen" : "hinzufügen"}`}
                  />
                  <span>{key}</span>
                </label>
              ))}

              <span className="ml-2 text-xs text-gray-600">sonstiger Empfänger:</span>
              <input
                ref={ergehtAnTextRef}
                name="ergehtAnText"
                className={`border rounded px-2 h-9 ${errors.ergehtAn ? "border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500" : ""}`}
                value={form.ergehtAnText}
                onChange={(e) => { clearError("ergehtAn"); set("ergehtAnText", e.target.value); }}
                placeholder="Name/Gruppe"
                readOnly={!canModify}
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
  <div className="flex items-center gap-2">
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
    <button
      type="button"
      className="px-2 h-9 text-xs rounded border bg-white hover:bg-gray-50"
      title="Als Aufgabe anlegen (mit Protokoll-Bezug)"
      onClick={() => createTaskFromMeasure(i)}
      disabled={creatingTask}
    >
      →
    </button>
  </div>
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

          <div className="col-span-12 border-t-2 p-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {showConfirmationControl ? (
                <>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={entryConfirmed}
                      onChange={(e) => handleConfirmationToggle(e.target.checked)}
                      disabled={!canEdit || !canToggleConfirmation}
                      title={confirmationToggleTitle}
                    />
                    <span>bestätigt:</span>
                  </label>
                  {entryConfirmed && confirmationDisplayLines.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-red-600">
                      {confirmationDisplayLines.map((line, idx) => (
                        <span key={idx} className={idx === 0 ? "text-sm font-semibold" : undefined}>
                          {line}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : entryConfirmed && confirmationDisplayLines.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-red-600 text-xs">
                  {confirmationDisplayLines.map((line, idx) => (
                    <span key={idx} className={idx === 0 ? "font-semibold" : undefined}>
                      {line}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">{DEFAULT_CONFIRM_ROLE_TEXT}</span>
                  <span>Bestätigung nur durch berechtigte Rolle möglich</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Unsichtbarer Submit (Enter) */}
        <button type="submit" className="hidden">submit</button>
      </form>
    </div>
  );
}
