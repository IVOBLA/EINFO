// src/components/FFCredsModal.jsx
import { useEffect, useState } from "react";

export default function FFCredsModal({ open, onClose, onSaved }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [master,   setMaster]   = useState("");

  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");
  const [hasCreds, setHasCreds] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const j = await fetch("/api/ff/creds").then(r=>r.json());
        setHasCreds(Boolean(j.has));
      } catch {}
    })();
  }, [open]);

  useEffect(() => {
    if (!open) { setUsername(""); setPassword(""); setMaster(""); setError(""); setBusy(false); }
  }, [open]);

  async function save() {
    setBusy(true); setError("");
    try {
      if (!username || !password) throw new Error("Benutzername/Passwort erforderlich");
      if (!master || master.length < 4) throw new Error("Master-Passwort (≥ 4 Zeichen) erforderlich");

      const r = await fetch("/api/ff/creds", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ username, password, master })
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || "Speichern fehlgeschlagen");
      }
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e.message || "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return !open ? null : (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white w-full max-w-md rounded-xl shadow p-4">
        <h2 className="text-lg font-semibold mb-3">{hasCreds ? "Zugang ändern" : "Zugang speichern"}</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Benutzername</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={username}
              onChange={e=>setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Passwort</label>
            <input
              className="w-full border rounded px-3 py-2"
              type="password"
              value={password}
              onChange={e=>setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Master-Passwort</label>
            <input
              className="w-full border rounded px-3 py-2"
              type="password"
              value={master}
              onChange={e=>setMaster(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-gray-500 mt-1">
              Zugang wird ausschließlich <strong>verschlüsselt</strong> gespeichert (AES-256-GCM).
              Das Master-Passwort wird nicht abgelegt.
            </p>
          </div>

          {error && <div className="text-red-600 text-sm">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button className="px-3 py-2 rounded border" onClick={onClose} disabled={busy}>Abbrechen</button>
            <button className="px-3 py-2 rounded bg-emerald-600 text-white" onClick={save} disabled={busy || !username || !password || !master}>
              Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
