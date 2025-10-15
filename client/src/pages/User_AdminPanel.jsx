import React, { useEffect, useMemo, useState } from "react";
import { useUserAuth } from "../components/User_AuthProvider.jsx";

/* Kleine Fetch-Helpers: wir wollen Statuscodes (423 etc.) unterscheiden */
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
    throw e;
  }
  return data;
}
const get  = (p) => api("GET", p);
const post = (p, b) => api("POST", p, b);
const put  = (p, b) => api("PUT", p, b);
const patch= (p, b) => api("PATCH", p, b);
const del  = (p)    => api("DELETE", p);

export default function User_AdminPanel() {
  const { user } = useUserAuth();

  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Daten
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [fetcherInfo, setFetcherInfo] = useState({ has: false, updatedAt: null });

  const roleChips = useMemo(() => roles.map((r) => ({ key: r.id || r, label: (r.label || r.id || r) })), [roles]);

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      // Rollen & Benutzer laden (können 423 liefern)
      const r = await get("/roles");          // { roles: [...] }
      setRoles(r.roles || []);
      const u = await get("/users");          // { users: [...] }
      setUsers(u.users || []);
      setLocked(false);
      try {
        const fi = await get("/fetcher");     // { has, updatedAt }
        setFetcherInfo(fi);
      } catch (_) {/* ignorieren */}
    } catch (e) {
      if (e.status === 423) {
        setLocked(true);
      } else {
        setErr(e.message || "Fehler beim Laden");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  if (!user) return null;
  if (user.role !== "Admin") {
    return <div className="p-4 text-red-700">403 – Nur für Admins</div>;
  }

  // === Actions ======================================================
  async function onMasterSetup(e) {
    e.preventDefault();
    setErr(""); setMsg("");
    const f = e.target;
    try {
      await post("/master/setup", {
        password: f.master.value,
        adminUser: f.adminUser.value,
        adminPass: f.adminPass.value,
      });
      setMsg("Master gesetzt & Admin angelegt.");
      f.reset();
      await refresh();
    } catch (ex) { setErr(ex.message || "Fehler"); }
  }
  async function onMasterUnlock(e) {
    e.preventDefault();
    setErr(""); setMsg("");
    const f = e.target;
    try {
      await post("/master/unlock", { password: f.master.value });
      setMsg("Master entsperrt.");
      f.reset();
      await refresh();
    } catch (ex) { setErr(ex.message || "Master ungültig"); }
  }

  // Rollen speichern (aus Chips)
  async function onSaveRoles() {
    setErr(""); setMsg("");
    // normalize to array of role objects
    const next = (Array.isArray(roles) ? roles : []).map(r => (typeof r === "string" ? {id:r, label:r, capabilities:[]} : r)).filter(r => r && r.id);
    if (!next.some(r => (r.id === "Admin"))) next.unshift({ id:"Admin", label:"Administrator", capabilities:["*"] });
    try {
      const r = await put("/roles", { roles: next });
      setRoles(r.roles || next);
      setMsg("Rollen gespeichert.");
    } catch (ex) { setErr(ex.message || "Fehler beim Speichern der Rollen"); }
  }
  function onRemoveRole(name) {
    if (name === "Admin") return; // Admin darf nicht entfernt werden
    setRoles((arr) => (arr || []).filter((x) => (x.id||x) !== name));
  }
  function onAddRole(name) {
    const n = String(name || "").trim();
    if (!n || n.toLowerCase() === "admin") return;
    setRoles((arr) => {
      const list = Array.isArray(arr) ? arr.slice() : [];
      if (list.some(r => (r.id||r) === n)) return list;
      list.push({ id:n, label:n, capabilities:[] });
      return list;
    });
  }

  // Benutzer anlegen / löschen
  async function onCreateUser(e) {
    e.preventDefault();
    setErr(""); setMsg("");
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

  // === UI ===========================================================
  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-semibold">User Admin</h1>

      {msg && <div className="text-green-700">{msg}</div>}
      {err && <div className="text-red-700">{err}</div>}

      {/* Hinweis, wenn Master gesperrt */}
      {locked && (
        <div className="p-3 rounded border border-amber-300 bg-amber-50 text-amber-800">
          Master ist gesperrt. Entsperre ihn, um Rollen & Benutzer zu verwalten.
        </div>
      )}

      {/* 1) Master initial setzen (nur beim ersten Mal sinnvoll) */}
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

      {/* 3) Rollen */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Rollen (Admin + bis zu 10 weitere)</summary>

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
          <button type="button" className="border rounded px-3 py-1"
            onClick={() => {
              const el = document.getElementById("addRole");
              if (el && el.value) { onAddRole(el.value); el.value = ""; }
            }}>
            Hinzufügen
          </button>
          <button type="button" className="border rounded px-3 py-1 ml-4" onClick={onSaveRoles} disabled={locked || loading}>
            Speichern
          </button>
        </div>

        <div className="text-xs text-gray-500 mt-2">
          Hinweis: <b>Admin</b> kann nicht gelöscht werden.
        </div>
      </details>

      {/* 4) Benutzer */}
      <details className="border rounded p-3" open>
        <summary className="cursor-pointer font-medium">Benutzer</summary>

        <form onSubmit={onCreateUser} className="mt-3 grid grid-cols-5 gap-2 items-center max-w-5xl">
          <input name="u" placeholder="username" className="border px-2 py-1 rounded" disabled={locked} />
          <input name="p" placeholder="passwort" className="border px-2 py-1 rounded" disabled={locked} />
          <input name="d" placeholder="Anzeigename" className="border px-2 py-1 rounded" disabled={locked} />
          <select name="r" className="border px-2 py-1 rounded" disabled={locked}>
            {roles.map((r) => (<option key={(r.id||r)} value={(r.id||r)}>{r.label || r.id || r}</option>))}
          </select>
          <button className="border rounded px-3 py-1" disabled={locked}>Anlegen</button>
        </form>

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
                {users.map((u) => (
                  <tr key={u.id} className="bg-white border rounded">
                    <td className="px-2 py-1">{u.id}</td>
                    <td className="px-2 py-1">{u.username}</td>
                    <td className="px-2 py-1">{u.role}</td>
                    <td className="px-2 py-1">{u.displayName}</td>
                    <td className="px-2 py-1">
                      <button
                        className="px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50"
                        onClick={() => onDeleteUser(u.id, u.username)}
                        disabled={locked || u.role === "Admin"}
                        title={u.role === "Admin" ? "Admin kann nicht gelöscht werden" : "Benutzer löschen"}
                      >Löschen</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      {/* 5) Globale Fetcher-Creds */}
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

      {loading && <div className="text-sm text-gray-500">Lade…</div>}
    </div>
  );
}
