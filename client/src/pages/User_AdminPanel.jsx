import React, { useEffect, useMemo, useState } from "react";
import { useUserAuth } from "../components/User_AuthProvider.jsx";
import CornerHelpLogout from "../components/CornerHelpLogout.jsx";
import { FORBIDDEN_MESSAGE, notifyForbidden } from "../../forbidden.js";

function collectUserRoleIds(u) {
  const out = [];
  const add = (value) => {
    const raw = typeof value === "string"
      ? value
      : (value && typeof value.id === "string"
        ? value.id
        : (value && typeof value.role === "string"
          ? value.role
          : (value && typeof value.label === "string" ? value.label : "")));
    const trimmed = String(raw || "").trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  };
  if (!u) return out;
  add(u.role);
  if (Array.isArray(u.roles)) u.roles.forEach(add);
  return out;
}

const userHasAdminRole = (u) => collectUserRoleIds(u).some((id) => id.toUpperCase() === "ADMIN");

/** ---------------------------
 *  Kleine Fetch-Helpers
 *  ---------------------------
 *  Basis: /api/user
 *  - Liefert JSON oder wirft Fehler mit Status
 */
async function api(method, path, body) {
  const r = await fetch(`/api/user${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return { error: text }; } })() : {};
  if (!r.ok) {
    const e = new Error(data?.error || r.statusText);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}
const get   = (p)    => api("GET", p);
const post  = (p, b) => api("POST", p, b);
const put   = (p, b) => api("PUT", p, b);
const patch = (p, b) => api("PATCH", p, b);
const del   = (p)    => api("DELETE", p);

const normalizeAutoPrintScope = (value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["all", "alle", "alles", "gesamt", "voll"].includes(normalized)) return "all";
    if (["interval", "intervall", "window", "range", "zeitraum"].includes(normalized)) return "interval";
  }
  if (value === true) return "all";
  return "interval";
};

const createEmptyMailSchedule = () => ({
  id: null,
  label: "",
  to: "",
  subject: "",
  text: "",
  mode: "interval",
  intervalMinutes: "60",
  timeOfDay: "08:00",
  attachmentPath: "",
  enabled: true,
});

const createEmptyApiSchedule = () => ({
  id: null,
  label: "",
  url: "",
  method: "GET",
  body: "",
  mode: "interval",
  intervalMinutes: "60",
  timeOfDay: "08:00",
  enabled: true,
});

export default function User_AdminPanel() {
  const { user } = useUserAuth();

  // ---- UI/State (beibehalten) ----
  const [locked, setLocked]   = useState(false);  // 423 Master-Lock
  const [loading, setLoading] = useState(true);
  const [msg, setMsg]         = useState("");
  const [err, setErr]         = useState("");

  // Daten-Buckets
  const [roles, setRoles]             = useState([]); // Strings ODER Objekte {id,label,apps|capabilities}
  const [users, setUsers]             = useState([]);
  const [fetcherInfo, setFetcherInfo] = useState({ has:false, updatedAt:null });
  const [autoConfig, setAutoConfig]   = useState({ enabled:false, intervalSec:30, demoMode:false });
  const [savingAutoConfig, setSavingAutoConfig] = useState(false);
  const [autoPrintConfig, setAutoPrintConfig] = useState({ enabled:false, intervalMinutes:10, lastRunAt:null, entryScope:"interval", scope:"interval" });
  const [autoPrintDraft, setAutoPrintDraft] = useState({ enabled:false, intervalMinutes:"10", entryScope:"interval" });
  const [savingAutoPrintConfig, setSavingAutoPrintConfig] = useState(false);
  const [mailSchedules, setMailSchedules] = useState([]);
  const [mailScheduleDraft, setMailScheduleDraft] = useState(createEmptyMailSchedule());
  const [savingMailSchedule, setSavingMailSchedule] = useState(false);
  const [loadingMailSchedules, setLoadingMailSchedules] = useState(false);
  const [apiSchedules, setApiSchedules] = useState([]);
  const [apiScheduleDraft, setApiScheduleDraft] = useState(createEmptyApiSchedule());
  const [savingApiSchedule, setSavingApiSchedule] = useState(false);
  const [loadingApiSchedules, setLoadingApiSchedules] = useState(false);

  // ---- capabilities ↔ apps Konvertierung ----
  const parseCapToken = (t) => {
    if (!t) return null;
    const s = String(t).trim();
    // erlaubte Formate: "app:level" oder "app.level"
    const m = s.match(/^([a-z0-9_-]+)[:.]([a-z]+)$/i);
    if (!m) return null;
    const app = m[1].toLowerCase();
    const level = m[2].toLowerCase();
    if (!["none","view","edit"].includes(level)) return null;
    return { app, level };
  };
  const capsToApps = (caps = []) => {
    const out = {};
    for (const c of caps) {
      const p = parseCapToken(c);
      if (!p) continue;
      // bei Doppelungen „edit“ bevorzugen
      const cur = out[p.app];
      out[p.app] = (cur === "edit" || p.level === "edit") ? "edit" : p.level;
    }
    return out;
  };
  const appsToCaps = (apps = {}) =>
    Object.entries(apps)
      .filter(([,lvl]) => lvl && lvl !== "none")
      .map(([app,lvl]) => `${app}:${lvl}`);

  // ---- Robust: Rollen-Objekt ableiten (String/Objekt → Objekt mit apps) ----
  const toRoleObj = (r) => {
    if (typeof r === "string") return { id: r, label: r, apps: {} };
    const id   = r?.id ?? r?.label ?? "";
    const apps = r?.apps && Object.keys(r.apps).length ? { ...r.apps } : capsToApps(r?.capabilities || []);
    return { id, label: r?.label ?? id, apps };
  };

  // ---- Rollen-IDs extrahieren (String ODER Objekt) ----
  const roleIds = useMemo(() => (roles || []).map((r) => {
    if (typeof r === "string") return r;
    if (r && typeof r === "object") return r.id ?? r.label ?? "";
    return "";
  }).filter(Boolean), [roles]);

  // Chips (wie zuvor), nur auf stabile IDs
  const roleChips = useMemo(() => roleIds.map((id) => ({ key: id, label: id })), [roleIds]);

  // Vereinheitlichte App-Liste: bekannte Apps + was in JSON vorhanden ist
  const allApps = useMemo(() => {
    const known = new Set(["einsatzboard", "aufgabenboard", "protokoll"]);
    for (const r of (roles || [])) {
      const apps = (typeof r === "object" && r?.apps) ? Object.keys(r.apps) : (Array.isArray(r?.capabilities) ? Object.keys(capsToApps(r.capabilities)) : []);
      apps.forEach(a => known.add(a));
    }
    return Array.from(known);
  }, [roles]);

  const APP_LEVELS = ["none", "view", "edit"];

  // Role-App-Level updaten (im State)
  const updateRoleApp = (roleId, app, level) => {
    setRoles((prev) => {
      const list = Array.isArray(prev) ? prev.slice() : [];
      const idx = list.findIndex(x => (typeof x === "string" ? x : (x?.id ?? x?.label)) === roleId);
      if (idx < 0) return prev;
      const obj = toRoleObj(list[idx]);
      const nextLevel = APP_LEVELS.includes(level) ? level : "none";
      const apps = { ...(obj.apps || {}) };
      if (nextLevel === "none") delete apps[app]; else apps[app] = nextLevel;
      list[idx] = { ...obj, apps };
      return list;
    });
  };

  const resetMailScheduleDraft = () => setMailScheduleDraft(createEmptyMailSchedule());

  const startEditMailSchedule = (entry) => {
    if (!entry) {
      resetMailScheduleDraft();
      return;
    }
    setMailScheduleDraft({
      id: entry.id || null,
      label: entry.label || "",
      to: entry.to || "",
      subject: entry.subject || "",
      text: entry.text || "",
      mode: entry.mode === "time" ? "time" : "interval",
      intervalMinutes: String(entry.intervalMinutes ?? ""),
      timeOfDay: entry.timeOfDay || "08:00",
      attachmentPath: entry.attachmentPath || "",
      enabled: entry.enabled !== false,
    });
  };

  async function loadMailSchedules() {
    setLoadingMailSchedules(true);
    try {
      const res = await fetch("/api/mail/schedule", { credentials: "include", cache: "no-store" });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Zeitpläne konnten nicht geladen werden.");
      setMailSchedules(Array.isArray(js.schedules) ? js.schedules : []);
    } catch (ex) {
      setErr((prev) => prev || ex.message || "Fehler beim Laden der Mail-Zeitpläne");
    } finally {
      setLoadingMailSchedules(false);
    }
  }

  const resetApiScheduleDraft = () => setApiScheduleDraft(createEmptyApiSchedule());

  const startEditApiSchedule = (entry) => {
    if (!entry) {
      resetApiScheduleDraft();
      return;
    }
    setApiScheduleDraft({
      id: entry.id || null,
      label: entry.label || "",
      url: entry.url || "",
      method: entry.method || "GET",
      body: entry.body || "",
      mode: entry.mode === "time" ? "time" : "interval",
      intervalMinutes: String(entry.intervalMinutes ?? ""),
      timeOfDay: entry.timeOfDay || "08:00",
      enabled: entry.enabled !== false,
    });
  };

  async function loadApiSchedules() {
    setLoadingApiSchedules(true);
    try {
      const res = await fetch("/api/http/schedule", { credentials: "include", cache: "no-store" });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Zeitpläne konnten nicht geladen werden.");
      setApiSchedules(Array.isArray(js.schedules) ? js.schedules : []);
    } catch (ex) {
      setErr((prev) => prev || ex.message || "Fehler beim Laden der API-Zeitpläne");
    } finally {
      setLoadingApiSchedules(false);
    }
  }

  // ---- Laden wie gehabt ----
  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const r = await get("/roles");  // { roles: [...] }
      setRoles(r.roles || []);
      const u = await get("/users");  // { users: [...] }
      setUsers(u.users || []);
      setLocked(false);
      try {
        const fi = await get("/fetcher"); // { has, updatedAt }
        setFetcherInfo({
          has: !!(fi?.has || fi?.ok || fi?.present),
          updatedAt: fi?.updatedAt ?? fi?.ts ?? null
        });
      } catch (_) {/* optional */}
      try {
        const cfgRes = await fetch("/api/import/auto-config", { credentials: "include", cache: "no-store" });
        if (cfgRes.ok) {
          const cfg = await cfgRes.json().catch(() => ({}));
          setAutoConfig({
            enabled: !!cfg.enabled,
            intervalSec: Number(cfg.intervalSec) || 30,
            demoMode: !!cfg.demoMode,
          });
        }
      } catch (_) {/* optional */}
      try {
        const autoPrintRes = await fetch("/api/protocol/auto-print-config", { credentials: "include", cache: "no-store" });
        if (autoPrintRes.ok) {
          const cfg = await autoPrintRes.json().catch(() => ({}));
          const intervalMinutes = Number(cfg.intervalMinutes);
          const sanitizedInterval = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? Math.floor(intervalMinutes) : 10;
          const lastRunAt = Number(cfg.lastRunAt);
          const sanitizedLastRun = Number.isFinite(lastRunAt) && lastRunAt > 0 ? lastRunAt : null;
          const scopeRaw = typeof cfg.entryScope === "string"
            ? cfg.entryScope
            : (typeof cfg.scope === "string"
              ? cfg.scope
              : (typeof cfg.mode === "string" ? cfg.mode : null));
          const normalizedScope = normalizeAutoPrintScope(scopeRaw);
          const sanitized = {
            enabled: !!cfg.enabled,
            intervalMinutes: sanitizedInterval,
            lastRunAt: sanitizedLastRun,
            entryScope: normalizedScope,
            scope: normalizedScope,
          };
          setAutoPrintConfig(sanitized);
          setAutoPrintDraft({
            enabled: sanitized.enabled,
            intervalMinutes: String(sanitized.intervalMinutes || ""),
            entryScope: sanitized.entryScope,
          });
        }
      } catch (_) {/* optional */}
      try {
        await loadMailSchedules();
        await loadApiSchedules();
      } catch (_) {/* optional */}
    } catch (e) {
      if (e.status === 423) setLocked(true);
      else setErr(e.message || "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (user && !userHasAdminRole(user)) {
      notifyForbidden();
    }
  }, [user]);

  if (!user) return null;
  if (!userHasAdminRole(user)) {
    return (
      <div className="p-4 text-red-700">
        <CornerHelpLogout />
        {FORBIDDEN_MESSAGE}
      </div>
    );
  }

  // ---- Master-Setup/-Unlock (beibehalten) ----
  async function onMasterSetup(e) {
    e.preventDefault(); setErr(""); setMsg("");
    const f = e.target;
    try {
      await post("/master/setup", {
        password: f.master.value,
        adminUser: f.adminUser.value,
        adminPass: f.adminPass.value,
      });
      setMsg("Master gesetzt & Admin angelegt.");
      f.reset(); await refresh();
    } catch (ex) { setErr(ex.message || "Fehler"); }
  }
  async function onMasterUnlock(e) {
    e.preventDefault(); setErr(""); setMsg("");
    const f = e.target;
    try {
      await post("/master/unlock", { password: f.master.value });
      setMsg("Master entsperrt.");
      f.reset(); await refresh();
    } catch (ex) { setErr(ex.message || "Master ungültig"); }
  }

  // ---- Rollen speichern (JETZT: Objekte inkl. apps → capabilities) ----
  async function onSaveRoles() {
    setErr(""); setMsg("");
    // konsistente Objektstruktur
    const normalized = (roles || []).map(toRoleObj);
    // Admin schützen: mindestens edit auf allen bekannten Apps
    if (!normalized.some(r => r.id === "Admin")) {
      const adminApps = Object.fromEntries(allApps.map(a => [a, "edit"]));
      normalized.unshift({ id: "Admin", label: "Administrator", apps: adminApps });
    }
    try {
      const r = await put("/roles", { roles: normalized });
      const saved = Array.isArray(r?.roles) ? r.roles : normalized;
      setRoles(saved.map(toRoleObj));
      setMsg("Rollen gespeichert.");
    } catch (ex) {
      setErr(ex.message || "Fehler beim Speichern der Rollen");
    }
  }

  // ---- Rolle hinzufügen/entfernen (beibehalten, nur Objekt-Form) ----
  function onRemoveRole(name) {
    if (name === "Admin") return; // Admin darf nicht entfernt werden
    setRoles((arr) => (arr || []).filter((x) => {
      if (typeof x === "string") return x !== name;
      if (x && typeof x === "object") return (x.id ?? x.label) !== name;
      return true;
    }));
  }
  function onAddRole(name) {
    const n = String(name || "").trim();
    if (!n || n.toLowerCase() === "admin") return;
    setRoles((arr) => {
      const ids = new Set(roleIds);
      if (ids.has(n)) return arr;
      // neu direkt als Objekt mit leerer apps-Map
      return [...(arr || []), { id: n, label: n, apps: {} }];
    });
  }

  // ---- Benutzer anlegen / löschen (beibehalten) ----
  async function onCreateUser(e) {
    e.preventDefault(); setErr(""); setMsg("");
    const f = e.target;
    try {
      const selectedRoles = Array.from(f.roles?.selectedOptions || [])
        .map((opt) => String(opt.value || "").trim())
        .filter(Boolean);
      if (!selectedRoles.length) {
        setErr("Bitte mindestens eine Rolle wählen.");
        return;
      }
      await post("/users", {
        username: f.u.value,
        password: f.p.value,
        displayName: f.d.value,
        roles: selectedRoles,
      });
      f.reset();
      if (f.roles) {
        Array.from(f.roles.options || []).forEach((opt, idx) => {
          opt.selected = idx === 0;
        });
      }
      setMsg("Benutzer angelegt.");
      await refresh();
    } catch (ex) { setErr(ex.message || "Fehler beim Anlegen"); }
  }
  async function onDeleteUser(id, name) {
    if (!window.confirm(`Benutzer '${name}' wirklich löschen?`)) return;
    setErr(""); setMsg("");
    try {
      await del(`/users/${id}`);
      setMsg("Benutzer gelöscht.");
      await refresh();
    } catch (ex) { setErr(ex.message || "Löschen fehlgeschlagen"); }
  }

  // ---- Benutzer bearbeiten (ergänzt, beibehalten) ----
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ displayName: "", roles: [], password: "" });

  function startEdit(u) {
    setEditId(u.id);
    setEditForm({
      displayName: u.displayName ?? u.username ?? "",
      roles: (() => {
        const current = collectUserRoleIds(u);
        if (current.length) return current;
        if (roleIds.length) return [roleIds[0]];
        return [];
      })(),
      password: "",
    });
  }
  function cancelEdit() {
    setEditId(null);
    setEditForm({ displayName: "", roles: [], password: "" });
  }
  function changeEdit(key, val) {
    setEditForm((p) => ({ ...p, [key]: val }));
  }
  async function saveEdit(id) {
    if (!id) return;
    setErr(""); setMsg(""); setLoading(true);
    try {
      const roleSelection = Array.isArray(editForm.roles) ? editForm.roles.filter(Boolean) : [];
      if (!roleSelection.length) {
        setErr("Benutzer benötigt mindestens eine Rolle.");
        setLoading(false);
        return;
      }
      const payload = { displayName: editForm.displayName, roles: roleSelection };
      const pw = (editForm.password || "").trim();
      if (pw) payload.password = pw;
      await patch(`/users/${id}`, payload); // PATCH /api/user/users/:id
      setMsg("Benutzer aktualisiert.");
      await refresh();
      cancelEdit();
    } catch (ex) {
      setErr(ex.message || "Aktualisieren fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  async function toggleDemoMode() {
    if (savingAutoConfig) return;
    const nextValue = !autoConfig.demoMode;
    setErr(""); setMsg(""); setSavingAutoConfig(true);
    try {
      const res = await fetch("/api/import/auto-config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: autoConfig.enabled,
          intervalSec: autoConfig.intervalSec,
          demoMode: nextValue,
        }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Speichern fehlgeschlagen");
      setAutoConfig({
        enabled: !!js.enabled,
        intervalSec: Number(js.intervalSec) || autoConfig.intervalSec || 30,
        demoMode: !!js.demoMode,
      });
      setMsg(nextValue
        ? "Demomodus aktiviert. Fetcher wird beim Import nicht gestartet."
        : "Demomodus deaktiviert. Fetcher startet beim Import wieder.");
    } catch (ex) {
      setErr(ex.message || "Speichern fehlgeschlagen");
    } finally {
      setSavingAutoConfig(false);
    }
  }

  async function onSaveAutoPrintConfig() {
    if (savingAutoPrintConfig) return;
    const parsedMinutes = Number.parseInt(autoPrintDraft.intervalMinutes, 10);
    if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
      setErr("Intervall für den Auto-Druck muss eine Zahl ≥ 1 sein.");
      return;
    }
    const intervalMinutes = Math.max(1, parsedMinutes);
    const entryScope = normalizeAutoPrintScope(autoPrintDraft.entryScope);
    setErr("");
    setMsg("");
    setSavingAutoPrintConfig(true);
    try {
      const res = await fetch("/api/protocol/auto-print-config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !!autoPrintDraft.enabled,
          intervalMinutes,
          entryScope,
          scope: entryScope,
        }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Speichern fehlgeschlagen");
      const interval = Number(js.intervalMinutes);
      const sanitizedInterval = Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : intervalMinutes;
      const lastRunAt = Number(js.lastRunAt);
      const savedScope = normalizeAutoPrintScope(js.entryScope ?? js.scope ?? js.mode);
      const sanitized = {
        enabled: !!js.enabled,
        intervalMinutes: sanitizedInterval,
        lastRunAt: Number.isFinite(lastRunAt) && lastRunAt > 0 ? lastRunAt : null,
        entryScope: savedScope,
        scope: savedScope,
      };
      setAutoPrintConfig(sanitized);
      setAutoPrintDraft({
        enabled: sanitized.enabled,
        intervalMinutes: String(sanitized.intervalMinutes || ""),
        entryScope: sanitized.entryScope,
      });
      setMsg("Auto-Druck Einstellungen gespeichert.");
    } catch (ex) {
      setErr(ex.message || "Speichern fehlgeschlagen");
    } finally {
      setSavingAutoPrintConfig(false);
    }
  }

  async function onSaveMailSchedule(e) {
    e.preventDefault();
    if (savingMailSchedule) return;
    const parsedInterval = Number.parseInt(mailScheduleDraft.intervalMinutes, 10);
    const payload = {
      label: mailScheduleDraft.label || "",
      to: mailScheduleDraft.to,
      subject: mailScheduleDraft.subject,
      text: mailScheduleDraft.text,
      mode: mailScheduleDraft.mode === "time" ? "time" : "interval",
      intervalMinutes: Number.isFinite(parsedInterval) ? parsedInterval : mailScheduleDraft.intervalMinutes,
      timeOfDay: mailScheduleDraft.timeOfDay,
      attachmentPath: mailScheduleDraft.attachmentPath,
      enabled: !!mailScheduleDraft.enabled,
    };
    setErr("");
    setMsg("");
    setSavingMailSchedule(true);
    try {
      const url = mailScheduleDraft.id
        ? `/api/mail/schedule/${encodeURIComponent(mailScheduleDraft.id)}`
        : "/api/mail/schedule";
      const method = mailScheduleDraft.id ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Speichern fehlgeschlagen");
      setMailSchedules(Array.isArray(js.schedules) ? js.schedules : []);
      resetMailScheduleDraft();
      setMsg(mailScheduleDraft.id ? "Zeitplan aktualisiert." : "Zeitplan angelegt.");
    } catch (ex) {
      setErr(ex.message || "Speichern fehlgeschlagen");
    } finally {
      setSavingMailSchedule(false);
    }
  }

  async function onDeleteMailSchedule(id) {
    if (!id) return;
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/mail/schedule/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Löschen fehlgeschlagen");
      setMailSchedules(Array.isArray(js.schedules) ? js.schedules : []);
      if (mailScheduleDraft.id === id) resetMailScheduleDraft();
      setMsg("Zeitplan gelöscht.");
    } catch (ex) {
      setErr(ex.message || "Löschen fehlgeschlagen");
    }
  }

  async function onResetMailScheduleLastSent(id) {
    if (!id) return;
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/mail/schedule/${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetLastSent: true }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Aktualisierung fehlgeschlagen");
      setMailSchedules(Array.isArray(js.schedules) ? js.schedules : []);
      setMsg("Letzter Versandzeitpunkt zurückgesetzt.");
    } catch (ex) {
      setErr(ex.message || "Aktualisierung fehlgeschlagen");
    }
  }

  async function onSaveApiSchedule(e) {
    e.preventDefault();
    if (savingApiSchedule) return;
    setErr("");
    setMsg("");
    try {
      setSavingApiSchedule(true);
      const payload = {
        label: apiScheduleDraft.label,
        url: apiScheduleDraft.url,
        method: apiScheduleDraft.method,
        body: apiScheduleDraft.body,
        mode: apiScheduleDraft.mode,
        intervalMinutes: Number(apiScheduleDraft.intervalMinutes),
        timeOfDay: apiScheduleDraft.timeOfDay,
        enabled: !!apiScheduleDraft.enabled,
      };
      const editing = !!apiScheduleDraft.id;
      const res = await fetch(editing ? `/api/http/schedule/${encodeURIComponent(apiScheduleDraft.id)}` : "/api/http/schedule", {
        method: editing ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Speichern fehlgeschlagen");
      setApiSchedules(Array.isArray(js.schedules) ? js.schedules : []);
      resetApiScheduleDraft();
      setMsg(editing ? "API-Zeitplan aktualisiert." : "API-Zeitplan angelegt.");
    } catch (ex) {
      setErr(ex.message || "Speichern fehlgeschlagen");
    } finally {
      setSavingApiSchedule(false);
    }
  }

  async function onDeleteApiSchedule(id) {
    if (!id) return;
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/http/schedule/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Löschen fehlgeschlagen");
      setApiSchedules(Array.isArray(js.schedules) ? js.schedules : []);
      if (apiScheduleDraft.id === id) resetApiScheduleDraft();
      setMsg("API-Zeitplan gelöscht.");
    } catch (ex) {
      setErr(ex.message || "Löschen fehlgeschlagen");
    }
  }

  async function onResetApiScheduleLastRun(id) {
    if (!id) return;
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/http/schedule/${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetLastRun: true }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.error) throw new Error(js?.error || "Aktualisierung fehlgeschlagen");
      setApiSchedules(Array.isArray(js.schedules) ? js.schedules : []);
      setMsg("Letzter Aufrufzeitpunkt zurückgesetzt.");
    } catch (ex) {
      setErr(ex.message || "Aktualisierung fehlgeschlagen");
    }
  }

  // ---- Render ----
  const autoPrintLastRunLabel = autoPrintConfig.lastRunAt
    ? new Date(autoPrintConfig.lastRunAt).toLocaleString("de-AT", { hour12: false })
    : null;
  const mailScheduleLastRunLabel = (value) => {
    const ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    return new Date(ts).toLocaleString("de-AT", { hour12: false });
  };
  const editingMailSchedule = !!mailScheduleDraft.id;
  const apiScheduleLastRunLabel = (value) => {
    const ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    return new Date(ts).toLocaleString("de-AT", { hour12: false });
  };
  const editingApiSchedule = !!apiScheduleDraft.id;

  return (
    <div className="p-4 space-y-6">
      <CornerHelpLogout />
      <h1 className="text-2xl font-semibold">User Admin</h1>

      {(msg || err || locked) && (
        <div className="space-y-1">
          {locked && <div className="text-amber-700">Gesperrt (Master-Lock aktiv).</div>}
          {err && <div className="text-rose-700">{err}</div>}
          {msg && <div className="text-emerald-700">{msg}</div>}
        </div>
      )}

      {/* 1) Master initial setzen */}
      <details className="border rounded p-3">
        <summary className="cursor-pointer font-medium">Master-Key initial setzen</summary>
        <form onSubmit={onMasterSetup} className="mt-3 grid gap-2 max-w-xl">
          <input name="master" placeholder="Neuer Master-Key" className="border px-2 py-1 rounded" />
          <div className="grid grid-cols-2 gap-2">
            <input name="adminUser" placeholder="Admin Benutzer (z. B. admin)" className="border px-2 py-1 rounded" />
            <input name="adminPass" placeholder="Admin Passwort" className="border px-2 py-1 rounded" />
          </div>
          <button className="border rounded px-3 py-1 w-48">Setzen</button>
        </form>
      </details>

      {/* 2) Master entsperren */}
      <details className="border rounded p-3" open={locked}>
        <summary className="cursor-pointer font-medium">Master entsperren (nach Server-Neustart)</summary>
        <form onSubmit={onMasterUnlock} className="mt-3 grid gap-2 max-w-sm">
          <input name="master" placeholder="Master-Key" className="border px-2 py-1 rounded" />
          <button className="border rounded px-3 py-1 w-32">Entsperren</button>
        </form>
      </details>

      {/* 3) Rollen (Chips, wie bisher) */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Rollen (Admin + weitere)</summary>

        <div className="mt-3 flex flex-wrap gap-2">
          {roleChips.length === 0 && <span className="text-gray-500 text-sm">– keine Rollen geladen –</span>}
          {roleChips.map((c) => (
            <span key={c.key}
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${
                c.label === "Admin" ? "bg-slate-100 border-slate-300 text-slate-700" :
                "bg-gray-50 border-gray-300 text-gray-700"
              }`}>
              {c.label}
              {c.label !== "Admin" && (
                <button
                  type="button"
                  onClick={() => onRemoveRole(c.label)}
                  className="ml-1 text-gray-500 hover:text-red-600"
                  title="Rolle entfernen"
                >✕</button>
              )}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            id="addRole"
            placeholder="Rolle hinzufügen"
            className="border px-2 py-1 rounded"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddRole(e.currentTarget.value);
                e.currentTarget.value = "";
              }
            }}
          />
          <button
            type="button"
            className="border rounded px-3 py-1"
            onClick={() => {
              const el = document.getElementById("addRole");
              if (!el) return;
              const v = el.value.trim();
              if (!v) return;
              onAddRole(v);
              el.value = "";
            }}
          >
            Hinzufügen
          </button>

          <div className="ml-auto">
            <button className="border rounded px-3 py-1" onClick={onSaveRoles} disabled={locked || loading}>
              Rollen speichern
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-500 mt-2">
          Hinweis: <b>Admin</b> kann nicht gelöscht werden.
        </div>
      </details>

      {/* 3b) Rechte pro Rolle */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Rechte pro Rolle</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[720px] w-full text-sm border-separate border-spacing-y-2">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="px-2">Rolle</th>
                {allApps.map(app => (<th key={app} className="px-2 capitalize">{app}</th>))}
              </tr>
            </thead>
            <tbody>
              {roleIds.map((rid) => {
                const role = (roles || []).find(x => (typeof x === "string" ? x : (x?.id ?? x?.label)) === rid);
                const obj = toRoleObj(role);
                return (
                  <tr key={rid} className="bg-white shadow-sm rounded">
                    <td className="px-2 py-1 font-medium">{rid}</td>
                    {allApps.map(app => {
                      const cur = obj.apps?.[app] ?? "none";
                      return (
                        <td key={app} className="px-2 py-1">
                          <select
                            value={cur}
                            onChange={(e)=>updateRoleApp(rid, app, e.target.value)}
                            className="border rounded px-2 py-1"
                            disabled={locked || loading || rid === "Admin"}
                            title={rid === "Admin" ? "Admin ist immer edit" : undefined}
                          >
                            {APP_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <button type="button" className="border rounded px-3 py-1" onClick={onSaveRoles} disabled={locked || loading}>
            Rechte speichern
          </button>
        </div>
      </details>

      {/* 4) Benutzer */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Benutzer</summary>

        {/* Benutzer anlegen (robustes Rollen-Select) */}
        <form onSubmit={onCreateUser} className="mt-3 grid grid-cols-5 gap-2 items-start max-w-5xl">
          <input name="u" placeholder="username" className="border px-2 py-1 rounded" disabled={locked} />
          <input name="p" placeholder="passwort" className="border px-2 py-1 rounded" disabled={locked} />
          <input name="d" placeholder="Anzeigename" className="border px-2 py-1 rounded" disabled={locked} />
          <select
            key={roleIds.join("|")}
            name="roles"
            multiple
            size={Math.min(6, Math.max(roleIds.length || 0, 3))}
            className="border px-2 py-1 rounded min-h-[6rem]"
            defaultValue={roleIds.length ? [roleIds[0]] : []}
            disabled={locked}
          >
            {roleIds.map((id) => (<option key={id} value={id}>{id}</option>))}
          </select>
          <button className="border rounded px-3 py-1" disabled={locked}>Anlegen</button>
        </form>
        <div className="text-xs text-gray-500 mt-1">
          Mehrfachauswahl über Strg (Windows) bzw. ⌘ (macOS) möglich.
        </div>

        {/* Liste inkl. Edit */}
        <div className="mt-4">
          {users.length === 0 ? (
            <div className="text-sm text-gray-500">– keine Benutzer –</div>
          ) : (
            <table className="text-sm w-full max-w-5xl border-separate border-spacing-y-1">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="px-2">ID</th>
                  <th className="px-2">Benutzername</th>
                  <th className="px-2">Rollen</th>
                  <th className="px-2">Anzeigename</th>
                  <th className="px-2 w-40">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isEditing = editId === u.id;
                  const userRoleList = collectUserRoleIds(u);
                  const isAdminUser = userHasAdminRole(u);
                  return (
                    <tr key={u.id} className="bg-white border rounded">
                      <td className="px-2 py-1">{u.id}</td>
                      <td className="px-2 py-1">{u.username}</td>
                      <td className="px-2 py-1">
                        {isEditing ? (
                          <select
                            multiple
                            size={Math.min(4, Math.max(roleIds.length || 0, 2))}
                            value={editForm.roles}
                            onChange={(e)=>changeEdit("roles", Array.from(e.target.selectedOptions || []).map((opt) => String(opt.value || "").trim()).filter(Boolean))}
                            className="border rounded px-2 py-1 w-full min-h-[4rem]"
                            disabled={locked || loading}
                          >
                            {roleIds.map((id) => (<option key={id} value={id}>{id}</option>))}
                          </select>
                        ) : (userRoleList.length ? userRoleList.join(", ") : "—")}
                      </td>
                      <td className="px-2 py-1">
                        {isEditing ? (
                          <input
                            value={editForm.displayName}
                            onChange={(e)=>changeEdit("displayName", e.target.value)}
                            className="border rounded px-2 py-1 w-full"
                            disabled={locked || loading}
                          />
                        ) : (u.displayName || "—")}
                      </td>
                      <td className="px-2 py-1 space-x-2">
                        {isEditing ? (
                          <>
                            {/* optional neues Passwort inline */}
                            <input
                              type="password"
                              placeholder="neues Passwort (optional)"
                              value={editForm.password}
                              onChange={(e)=>changeEdit("password", e.target.value)}
                              className="border rounded px-2 py-1 w-40 mr-2"
                              disabled={locked || loading}
                            />
                            <button
                              className="px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              onClick={()=>saveEdit(u.id)}
                              disabled={locked || loading}
                              title="Änderungen speichern"
                            >Speichern</button>
                            <button
                              className="px-2 py-1 rounded border"
                              onClick={cancelEdit}
                              disabled={loading}
                              title="Abbrechen"
                            >Abbrechen</button>
                          </>
                        ) : (
                          <>
                            <button
                              className="px-2 py-1 rounded border"
                              onClick={()=>startEdit(u)}
                              disabled={locked || loading}
                              title="Benutzer bearbeiten"
                            >Bearbeiten</button>
                            <button
                              className="px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50"
                              onClick={() => onDeleteUser(u.id, u.username)}
                              disabled={locked || isAdminUser}
                              title={isAdminUser ? "Admin kann nicht gelöscht werden" : "Benutzer löschen"}
                            >Löschen</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </details>

      {/* 5) Import-Einstellungen */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Import-Einstellungen</summary>
        <div className="mt-3 space-y-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!autoConfig.demoMode}
              onChange={toggleDemoMode}
              disabled={locked || savingAutoConfig}
            />
            Demomodus (Fetcher beim Import nicht starten)
          </label>
          <div className="text-xs text-gray-500">
            Bei aktivem Demomodus wird der Fetcher für manuelle und automatische Importe nicht aufgerufen.
          </div>
        </div>
      </details>

      {/* 5b) Auto-Druck */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Auto-Druck (Protokoll)</summary>
        <div className="mt-3 space-y-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!autoPrintDraft.enabled}
              onChange={(e) => setAutoPrintDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
              disabled={locked || savingAutoPrintConfig}
            />
            Automatischen Druck aktivieren
          </label>
          <div className="flex items-center gap-3">
            <label htmlFor="autoPrintInterval" className="text-sm text-gray-700">
              Intervall (Minuten)
            </label>
            <input
              id="autoPrintInterval"
              type="number"
              min={1}
              className="border px-2 py-1 rounded w-24"
              value={autoPrintDraft.intervalMinutes}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9]/g, "");
                setAutoPrintDraft((prev) => ({ ...prev, intervalMinutes: value }));
              }}
              disabled={locked || savingAutoPrintConfig}
            />
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="autoPrintScope" className="text-sm text-gray-700">
              Umfang
            </label>
            <select
              id="autoPrintScope"
              className="border px-2 py-1 rounded w-64"
              value={autoPrintDraft.entryScope}
              onChange={(e) => {
                const value = normalizeAutoPrintScope(e.target.value);
                setAutoPrintDraft((prev) => ({ ...prev, entryScope: value }));
              }}
              disabled={locked || savingAutoPrintConfig}
            >
              <option value="interval">Nur Meldungen im Intervall</option>
              <option value="all">Alle Meldungen</option>
            </select>
          </div>
          <div className="text-xs text-gray-500">
            {autoPrintDraft.entryScope === "all"
              ? "Es werden alle vorhandenen Protokollmeldungen gedruckt."
              : "Es werden nur Meldungen gedruckt, die seit dem letzten Lauf erfasst wurden."}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>Letzter Lauf:</span>
            <span>{autoPrintLastRunLabel || "—"}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="border rounded px-3 py-1"
              onClick={onSaveAutoPrintConfig}
              disabled={locked || savingAutoPrintConfig}
            >
              Einstellungen speichern
            </button>
          </div>
        </div>
      </details>

      {/* 5c) Zeitgesteuerte Mails */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Zeitgesteuerter Mailversand</summary>
        <div className="mt-3 space-y-3 text-sm">
          <div className="text-xs text-gray-500">
            Versand an hinterlegte Empfänger mit festem Intervall oder täglicher Uhrzeit. Anhänge werden vom Serverpfad geladen.
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-separate border-spacing-y-2">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="px-2">Titel / Betreff</th>
                  <th className="px-2">Empfänger</th>
                  <th className="px-2">Rhythmus</th>
                  <th className="px-2">Anhang</th>
                  <th className="px-2">Letzter Versand</th>
                  <th className="px-2">Aktiv</th>
                  <th className="px-2">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {mailSchedules.length === 0 ? (
                  <tr>
                    <td className="px-2 py-2 text-gray-500" colSpan={7}>– keine Zeitpläne hinterlegt –</td>
                  </tr>
                ) : (
                  mailSchedules.map((entry) => (
                    <tr key={entry.id} className="bg-white shadow-sm rounded">
                      <td className="px-2 py-2 font-medium">{entry.label || entry.subject || "(ohne Titel)"}</td>
                      <td className="px-2 py-2">{entry.to}</td>
                      <td className="px-2 py-2">
                        {entry.mode === "time"
                          ? `täglich ${entry.timeOfDay || "–"}`
                          : `${entry.intervalMinutes || "–"} min`}
                      </td>
                      <td className="px-2 py-2 break-all">{entry.attachmentPath || "—"}</td>
                      <td className="px-2 py-2 text-xs text-gray-600">{mailScheduleLastRunLabel(entry.lastSentAt)}</td>
                      <td className="px-2 py-2 text-center">{entry.enabled !== false ? "Ja" : "Nein"}</td>
                      <td className="px-2 py-2 space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          className="px-2 py-1 rounded border"
                          onClick={() => startEditMailSchedule(entry)}
                          disabled={savingMailSchedule}
                        >
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded border"
                          onClick={() => onResetMailScheduleLastSent(entry.id)}
                          disabled={savingMailSchedule}
                        >
                          Zurücksetzen
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50"
                          onClick={() => onDeleteMailSchedule(entry.id)}
                          disabled={savingMailSchedule}
                        >
                          Löschen
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {loadingMailSchedules && (
            <div className="text-xs text-gray-500">Lade Zeitpläne …</div>
          )}
          <form onSubmit={onSaveMailSchedule} className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">Titel (optional)</label>
                <input
                  className="border px-2 py-1 rounded"
                  value={mailScheduleDraft.label}
                  onChange={(e) => setMailScheduleDraft((prev) => ({ ...prev, label: e.target.value }))}
                  disabled={savingMailSchedule}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">Empfänger</label>
                <input
                  className="border px-2 py-1 rounded"
                  type="email"
                  required
                  value={mailScheduleDraft.to}
                  onChange={(e) => setMailScheduleDraft((prev) => ({ ...prev, to: e.target.value }))}
                  disabled={savingMailSchedule}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">Betreff</label>
                <input
                  className="border px-2 py-1 rounded"
                  required
                  value={mailScheduleDraft.subject}
                  onChange={(e) => setMailScheduleDraft((prev) => ({ ...prev, subject: e.target.value }))}
                  disabled={savingMailSchedule}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">Mailtext</label>
                <textarea
                  className="border px-2 py-1 rounded min-h-[120px]"
                  required
                  value={mailScheduleDraft.text}
                  onChange={(e) => setMailScheduleDraft((prev) => ({ ...prev, text: e.target.value }))}
                  disabled={savingMailSchedule}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">Versandart</label>
                <select
                  className="border px-2 py-1 rounded"
                  value={mailScheduleDraft.mode}
                  onChange={(e) => setMailScheduleDraft((prev) => ({ ...prev, mode: e.target.value === "time" ? "time" : "interval" }))}
                  disabled={savingMailSchedule}
                >
                  <option value="interval">Intervall (Minuten)</option>
                  <option value="time">Uhrzeit (täglich)</option>
                </select>
              </div>
              {mailScheduleDraft.mode === "time" ? (
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-gray-700">Uhrzeit (HH:MM)</label>
                  <input
                    className="border px-2 py-1 rounded w-40"
                    type="time"
                    value={mailScheduleDraft.timeOfDay}
                    onChange={(e) => setMailScheduleDraft((prev) => ({ ...prev, timeOfDay: e.target.value }))}
                    disabled={savingMailSchedule}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-gray-700">Intervall (Minuten)</label>
                  <input
                    className="border px-2 py-1 rounded w-32"
                    type="number"
                    min={1}
                    value={mailScheduleDraft.intervalMinutes}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9]/g, "");
                      setMailScheduleDraft((prev) => ({ ...prev, intervalMinutes: value }));
                    }}
                    disabled={savingMailSchedule}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">Anhang (Serverpfad)</label>
                <input
                  className="border px-2 py-1 rounded"
                  placeholder="z. B. data/mail/anhang.pdf"
                  value={mailScheduleDraft.attachmentPath}
                  onChange={(e) => setMailScheduleDraft((prev) => ({ ...prev, attachmentPath: e.target.value }))}
                  disabled={savingMailSchedule}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!!mailScheduleDraft.enabled}
                  onChange={(e) => setMailScheduleDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                  disabled={savingMailSchedule}
                />
                Aktiv
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="border rounded px-3 py-1"
                  disabled={savingMailSchedule}
                >
                  {editingMailSchedule ? "Zeitplan speichern" : "Zeitplan anlegen"}
                </button>
                <button
                  type="button"
                  className="border rounded px-3 py-1"
                  onClick={resetMailScheduleDraft}
                  disabled={savingMailSchedule}
                >
                  Neu
                </button>
              </div>
            </div>
          </form>
        </div>
      </details>

      {/* 5d) Zeitgesteuerte API-Calls */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Zeitgesteuerte API-Calls</summary>
        <div className="mt-3 space-y-3 text-sm">
          <div className="text-xs text-gray-500">
            Ruft hinterlegte URLs im gewünschten Rhythmus auf (GET/POST/PUT/PATCH/DELETE). Antwortinhalt wird verworfen, Fehler werden protokolliert.
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-separate border-spacing-y-2">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="px-2">Titel</th>
                  <th className="px-2">URL</th>
                  <th className="px-2">Methode</th>
                  <th className="px-2">Rhythmus</th>
                  <th className="px-2">Letzter Aufruf</th>
                  <th className="px-2">Aktiv</th>
                  <th className="px-2">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {apiSchedules.length === 0 ? (
                  <tr>
                    <td className="px-2 py-2 text-gray-500" colSpan={7}>– keine Zeitpläne hinterlegt –</td>
                  </tr>
                ) : (
                  apiSchedules.map((entry) => (
                    <tr key={entry.id} className="bg-white shadow-sm rounded">
                      <td className="px-2 py-2 font-medium">{entry.label || "(ohne Titel)"}</td>
                      <td className="px-2 py-2 break-all">{entry.url}</td>
                      <td className="px-2 py-2">{entry.method || "GET"}</td>
                      <td className="px-2 py-2">
                        {entry.mode === "time"
                          ? `täglich ${entry.timeOfDay || "–"}`
                          : `${entry.intervalMinutes || "–"} min`}
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-600">{apiScheduleLastRunLabel(entry.lastRunAt)}</td>
                      <td className="px-2 py-2 text-center">{entry.enabled !== false ? "Ja" : "Nein"}</td>
                      <td className="px-2 py-2 space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          className="px-2 py-1 rounded border"
                          onClick={() => startEditApiSchedule(entry)}
                          disabled={savingApiSchedule}
                        >
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded border"
                          onClick={() => onResetApiScheduleLastRun(entry.id)}
                          disabled={savingApiSchedule}
                        >
                          Zurücksetzen
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50"
                          onClick={() => onDeleteApiSchedule(entry.id)}
                          disabled={savingApiSchedule}
                        >
                          Löschen
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {loadingApiSchedules && (
            <div className="text-xs text-gray-500">Lade Zeitpläne …</div>
          )}
          <form onSubmit={onSaveApiSchedule} className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">Titel (optional)</label>
                <input
                  className="border px-2 py-1 rounded"
                  value={apiScheduleDraft.label}
                  onChange={(e) => setApiScheduleDraft((prev) => ({ ...prev, label: e.target.value }))}
                  disabled={savingApiSchedule}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">URL</label>
                <input
                  className="border px-2 py-1 rounded"
                  type="url"
                  required
                  placeholder="https://example.com/webhook"
                  value={apiScheduleDraft.url}
                  onChange={(e) => setApiScheduleDraft((prev) => ({ ...prev, url: e.target.value }))}
                  disabled={savingApiSchedule}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">HTTP-Methode</label>
                <select
                  className="border px-2 py-1 rounded w-40"
                  value={apiScheduleDraft.method}
                  onChange={(e) => setApiScheduleDraft((prev) => ({ ...prev, method: e.target.value }))}
                  disabled={savingApiSchedule}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              {apiScheduleDraft.method && apiScheduleDraft.method !== "GET" && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-gray-700">Request-Body (optional, wird unverändert gesendet)</label>
                  <textarea
                    className="border px-2 py-1 rounded min-h-[80px]"
                    placeholder="z. B. JSON"
                    value={apiScheduleDraft.body}
                    onChange={(e) => setApiScheduleDraft((prev) => ({ ...prev, body: e.target.value }))}
                    disabled={savingApiSchedule}
                  />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-700">Aufrufart</label>
                <select
                  className="border px-2 py-1 rounded"
                  value={apiScheduleDraft.mode}
                  onChange={(e) => setApiScheduleDraft((prev) => ({ ...prev, mode: e.target.value === "time" ? "time" : "interval" }))}
                  disabled={savingApiSchedule}
                >
                  <option value="interval">Intervall (Minuten)</option>
                  <option value="time">Uhrzeit (täglich)</option>
                </select>
              </div>
              {apiScheduleDraft.mode === "time" ? (
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-gray-700">Uhrzeit (HH:MM)</label>
                  <input
                    className="border px-2 py-1 rounded w-40"
                    type="time"
                    value={apiScheduleDraft.timeOfDay}
                    onChange={(e) => setApiScheduleDraft((prev) => ({ ...prev, timeOfDay: e.target.value }))}
                    disabled={savingApiSchedule}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-gray-700">Intervall (Minuten)</label>
                  <input
                    className="border px-2 py-1 rounded w-32"
                    type="number"
                    min={1}
                    value={apiScheduleDraft.intervalMinutes}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9]/g, "");
                      setApiScheduleDraft((prev) => ({ ...prev, intervalMinutes: value }));
                    }}
                    disabled={savingApiSchedule}
                  />
                </div>
              )}
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!!apiScheduleDraft.enabled}
                  onChange={(e) => setApiScheduleDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                  disabled={savingApiSchedule}
                />
                Aktiv
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="border rounded px-3 py-1"
                  disabled={savingApiSchedule}
                >
                  {editingApiSchedule ? "Zeitplan speichern" : "Zeitplan anlegen"}
                </button>
                <button
                  type="button"
                  className="border rounded px-3 py-1"
                  onClick={resetApiScheduleDraft}
                  disabled={savingApiSchedule}
                >
                  Neu
                </button>
              </div>
            </div>
          </form>
        </div>
      </details>

      {/* 6) Globale Fetcher-Creds (beibehalten) */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Fetcher-Zugangsdaten (global)</summary>
        <div className="mt-3 text-sm">
          Status:{" "}
          {fetcherInfo.has ? (
            <b className="text-emerald-700">gesetzt</b>
          ) : (
            <b className="text-rose-700">fehlt</b>
          )}
          {fetcherInfo.updatedAt && (
            <> • zuletzt geändert: <code>{new Date(fetcherInfo.updatedAt).toLocaleString("de-AT",{hour12:false})}</code></>
          )}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(""); setMsg("");
            const f = e.target;
            try {
              await put("/fetcher", { username: f.u.value, password: f.p.value });
              f.reset();
              setMsg("Fetcher-Creds gespeichert (global).");
              await refresh();
            } catch (ex) { setErr(ex.message || "Speichern fehlgeschlagen"); }
          }}
          className="mt-3 grid grid-cols-3 gap-2 items-center max-w-4xl"
        >
          <input name="u" placeholder="Fetcher Benutzername" className="border px-2 py-1 rounded" disabled={locked} />
          <input name="p" placeholder="Fetcher Passwort" className="border px-2 py-1 rounded" disabled={locked} />
          <button className="border rounded px-3 py-1" disabled={locked}>Speichern</button>
        </form>
        <div className="text-xs text-gray-500 mt-2">
          Diese Zugangsdaten gelten für <b>alle Benutzer</b>. Start/Stopp nutzt immer den globalen Satz.
        </div>
      </details>
      {/* 7) Wartung: Initialsetup & Archive */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Wartung (Admin)</summary>
        <div className="mt-3 grid gap-2 max-w-xl">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="border rounded px-3 py-1"
              disabled={locked || loading}
              onClick={async () => {
               setErr(""); setMsg(""); setLoading(true);
                try {
                  const r = await post("/admin/initialsetup");
                  setMsg(r?.ok ? (r.message || "Initialsetup erfolgreich.") : "Initialsetup ausgeführt.");
                } catch (ex) {
                  setErr(ex.message || "Initialsetup fehlgeschlagen");
                } finally {
                  setLoading(false);
                }
              }}
              title='Kopiert *.csv & *.json aus "data/initial" nach "data" (überschreibt).'
            >
              Initialsetup
            </button>

                      <button
              type="button"
              className="border rounded px-3 py-1"
              disabled={locked || loading}
              onClick={async () => {
                setErr(""); setMsg(""); setLoading(true);
                try {
                  const r = await post("/admin/archive");
                  const fn = r?.file || r?.filename || "archive.zip";
                  setMsg(`Archiv erstellt: ${fn}`);

                  // ⬇️ Automatischer Download
                  const url = `/api/user/admin/archive/download/${encodeURIComponent(fn)}`;
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = fn;   // Hinweis für Browser
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                } catch (ex) {
                  setErr(ex.message || "Archiv-Erstellung fehlgeschlagen");
                } finally {
                  setLoading(false);
                }
              }}
              title='Packt *.csv & *.json aus "data" in eine ZIP unter "data/archive" (mit Zeitstempel) und lädt es herunter.'
            >
              Archive
            </button>
          </div>
          <div className="text-xs text-gray-500">
            Hinweis: Nur <b>Admin</b>. Initialsetup überschreibt bestehende Dateien im Datenverzeichnis.
          </div>
        </div>
      </details>
      {loading && <div className="text-sm text-gray-500">Lade…</div>}
    </div>
  );
}
