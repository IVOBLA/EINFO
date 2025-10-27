import React, { useEffect, useMemo, useState } from "react";
import { useUserAuth } from "../components/User_AuthProvider.jsx";
import CornerHelpLogout from "../components/CornerHelpLogout.jsx";

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
    } catch (e) {
      if (e.status === 423) setLocked(true);
      else setErr(e.message || "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  if (!user) return null;
  if (user.role !== "Admin") {
    return (
      <div className="p-4 text-red-700">
        <CornerHelpLogout />
        403 – Nur für Admins
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
      await post("/users", {
        username: f.u.value,
        password: f.p.value,
        displayName: f.d.value,
        role: f.r.value,
      });
      f.reset();
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
  const [editForm, setEditForm] = useState({ displayName: "", role: "", password: "" });

  function startEdit(u) {
    setEditId(u.id);
    setEditForm({
      displayName: u.displayName ?? u.username ?? "",
      role: u.role ?? (roleIds[0] || ""),
      password: "",
    });
  }
  function cancelEdit() {
    setEditId(null);
    setEditForm({ displayName: "", role: "", password: "" });
  }
  function changeEdit(key, val) {
    setEditForm((p) => ({ ...p, [key]: val }));
  }
  async function saveEdit(id) {
    if (!id) return;
    setErr(""); setMsg(""); setLoading(true);
    try {
      const payload = { displayName: editForm.displayName, role: editForm.role };
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

  // ---- Render ----
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
        <form onSubmit={onCreateUser} className="mt-3 grid grid-cols-5 gap-2 items-center max-w-5xl">
          <input name="u" placeholder="username" className="border px-2 py-1 rounded" disabled={locked} />
          <input name="p" placeholder="passwort" className="border px-2 py-1 rounded" disabled={locked} />
          <input name="d" placeholder="Anzeigename" className="border px-2 py-1 rounded" disabled={locked} />
          <select name="r" className="border px-2 py-1 rounded" disabled={locked}>
            {roleIds.map((id) => (<option key={id} value={id}>{id}</option>))}
          </select>
          <button className="border rounded px-3 py-1" disabled={locked}>Anlegen</button>
        </form>

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
                  <th className="px-2">Rolle</th>
                  <th className="px-2">Anzeigename</th>
                  <th className="px-2 w-40">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isEditing = editId === u.id;
                  return (
                    <tr key={u.id} className="bg-white border rounded">
                      <td className="px-2 py-1">{u.id}</td>
                      <td className="px-2 py-1">{u.username}</td>
                      <td className="px-2 py-1">
                        {isEditing ? (
                          <select
                            value={editForm.role}
                            onChange={(e)=>changeEdit("role", e.target.value)}
                            className="border rounded px-2 py-1"
                            disabled={locked || loading}
                          >
                            {roleIds.map((id) => (<option key={id} value={id}>{id}</option>))}
                          </select>
                        ) : (u.role || "—")}
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
                              disabled={locked || u.role === "Admin"}
                              title={u.role === "Admin" ? "Admin kann nicht gelöscht werden" : "Benutzer löschen"}
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

      {/* 5) Globale Fetcher-Creds (beibehalten) */}
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
      {/* 6) Wartung: Initialsetup & Archive */}
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
