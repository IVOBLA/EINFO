import React, { useState } from "react";
import { useUserAuth } from "../components/User_AuthProvider.jsx";

export default function User_LoginPage(){
  const { login } = useUserAuth();
  const [u,setU]=useState(""), [p,setP]=useState(""), [e,setE]=useState("");

  const onSubmit = async (ev)=>{
    ev.preventDefault();
    try{ await login(u,p); }
    catch(err){ setE(err.message||"Fehler"); }
  };

  const isLocked = String(e||"").toUpperCase().includes("MASTER_LOCKED");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="bg-white shadow rounded-2xl p-6 w-[360px]">
        <h1 className="text-xl font-semibold mb-4">Anmeldung</h1>
        <label className="block mb-2 text-sm">Benutzername</label>
        <input className="w-full border rounded px-3 py-2 mb-3" value={u} onChange={e=>setU(e.target.value)} autoFocus />
        <label className="block mb-2 text-sm">Passwort</label>
        <input className="w-full border rounded px-3 py-2 mb-3" type="password" value={p} onChange={e=>setP(e.target.value)} />
        {e && <div className="text-red-600 text-sm mb-2">{e}</div>}
        {isLocked && (
          <div className="text-sm text-blue-700 mb-2">
            Master ist gesperrt. <a className="underline" href="/user-firststart">Hier Master setzen/entsperren</a>.
          </div>
        )}
        <button className="w-full rounded-xl py-2 border bg-gray-900 text-white">Login</button>
        <p className="text-xs text-gray-500 mt-3">Gültig bis die Browser-Sitzung geschlossen wird.</p>
      </form>
    </div>
  );
}
