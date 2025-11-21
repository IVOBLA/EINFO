import React, { useEffect, useState } from "react";
import CornerHelpLogout from "../components/CornerHelpLogout.jsx";
import { User_masterSetup, User_masterState } from "../utils/User_auth.js";

export default function User_FirstStart(){
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try{
        const s = await User_masterState();
        if (s?.hasMaster) { window.location.href = "/user-login"; return; }
      }catch{}
      setReady(true);
    })();
  }, []);

  if (!ready) return null; // nichts blitzen lassen

  async function onSetup(e){
    e.preventDefault(); setErr(""); setMsg("");
    const f = e.target;
    try{
      await User_masterSetup(f.master.value, f.adminUser.value, f.adminPass.value);
      setMsg("Master gesetzt & Admin angelegt. Weiter zu /user-login.");
    }catch(ex){ setErr(ex.message||"Fehler"); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <CornerHelpLogout
        helpHref="/Hilfe.pdf"
        onAdd={() => { window.location.href = "/user-login"; }}
        addTitle="Zur Anmeldung"
      />
      <div className="bg-white shadow rounded-2xl p-6 w-[520px] space-y-6">
        <h1 className="text-xl font-semibold">Erststart</h1>
        {msg && <div className="text-green-700 text-sm">{msg}</div>}
        {err && <div className="text-red-700 text-sm">{err}</div>}

        <details className="border rounded p-3" open>
          <summary className="cursor-pointer font-medium">1) Master-Key initial setzen (einmalig)</summary>
          <form onSubmit={onSetup} className="mt-3 grid gap-2">
            <input name="master" placeholder="Neuer Master-Key" className="border rounded px-3 py-2" />
            <input name="adminUser" placeholder="Admin Benutzer (z. B. admin)" className="border rounded px-3 py-2" />
            <input name="adminPass" placeholder="Admin Passwort" className="border rounded px-3 py-2" />
            <button className="border rounded px-3 py-2 bg-gray-900 text-white">Master setzen & Admin anlegen</button>
          </form>
        </details>

        <div className="text-sm text-gray-600">
          Hinweis: Diese Seite ist nur sichtbar, solange noch kein Master/kein Admin existiert.
        </div>
      </div>
    </div>
  );
}
