// src/components/FFMasterModal.jsx
import { useEffect, useState } from "react";

export default function FFMasterModal({ open, onClose, onConfirm }) {
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setMaster("");
      setError("");
      setBusy(false);
    }
  }, [open]);

  async function handleOk() {
    if (!master || master.length < 4) {
      setError("Bitte ein Passwort (≥ 4 Zeichen) eingeben.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm?.(master);
    } catch (e) {
      setError(e?.message || "Fehler");
      return;
    } finally {
      setBusy(false);
    }
  }

  // ⏎ Return-Taste soll gleich wie Klick auf Starten funktionieren
  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleOk();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white w-full max-w-sm rounded-xl shadow p-4">
        <h2 className="text-lg font-semibold mb-3">Passwort</h2>
        <p className="text-sm text-gray-600 mb-2">
          Geben Sie das Passwort ein!
        </p>
        <input
          className="w-full border rounded px-3 py-2"
          type="password"
          value={master}
          onChange={(e) => setMaster(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
        <div className="flex justify-end gap-2 mt-3">
          <button
            className="px-3 py-2 rounded border"
            onClick={onClose}
            disabled={busy}
          >
            Abbrechen
          </button>
          <button
            className="px-3 py-2 rounded bg-emerald-600 text-white"
            onClick={handleOk}
            disabled={busy}
          >
            Starten
          </button>
        </div>
      </div>
    </div>
  );
}
