import React, { useMemo, useState } from "react";
import { useUserAuth } from "../components/User_AuthProvider.jsx";

const LOGIN_TARGETS = [
  { key: "aufgaben", label: "Aufgaben", path: "/aufgaben" },
  { key: "meldestelle", label: "Meldestelle", path: "/#/protokoll" },
  { key: "status", label: "Status", path: "/status" },
  { key: "admin", label: "Admin", path: "/user-admin" },
  { key: "einsatzstellen", label: "Einsatzstellen", path: "/" }
];

const ENV_LOGIN_BASE_URL = import.meta.env.VITE_LOGIN_BASE_URL;

const sanitizeBaseUrl = (value) => {
  const str = String(value || "").trim();
  return str.replace(/\/+$/, "");
};

const buildTargetUrl = (baseUrl, path) => {
  if (!path) return baseUrl;
  if (/^https?:/i.test(path)) return path;
  return `${baseUrl}${path}`;
};

const resolveLoginBaseUrl = () => {
  if (typeof window !== "undefined") {
    const runtimeBase = window.__APP_LOGIN_BASE_URL__ ?? window.__APP_BASE_URL__;
    if (runtimeBase) return sanitizeBaseUrl(runtimeBase);
  }
  if (ENV_LOGIN_BASE_URL) return sanitizeBaseUrl(ENV_LOGIN_BASE_URL);
  if (typeof window !== "undefined") {
    return sanitizeBaseUrl(`${window.location.protocol}//${window.location.host}`);
  }
  return "";
};

export default function User_LoginPage(){
  const { login } = useUserAuth();
  const [u,setU]=useState(""), [p,setP]=useState(""), [e,setE]=useState("");
  const [targetKey, setTargetKey] = useState(() => LOGIN_TARGETS[0].key);
  const baseUrl = useMemo(() => resolveLoginBaseUrl(), []);
  const targets = useMemo(() => {
    const usableBase = baseUrl || "";
    return LOGIN_TARGETS.map((entry) => ({
      ...entry,
      url: usableBase ? buildTargetUrl(usableBase, entry.path) : entry.path
    }));
  }, [baseUrl]);
  const selectedTarget = targets.find((t) => t.key === targetKey) ?? targets[0];

  const onSubmit = async (ev)=>{
    ev.preventDefault();
    try{
      await login(u,p);
    }
    catch(err){
      setE(err.message||"Fehler");
      return;
    }
    if (!selectedTarget) return;
    const { url } = selectedTarget;
    if (url) {
      window.location.href = url;
    }
  };

  const isLocked = String(e||"").toUpperCase().includes("MASTER_LOCKED");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="bg-white shadow rounded-2xl p-6 w-[380px]">
        <h1 className="text-xl font-semibold mb-4">Anmeldung</h1>
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">Zuerst Ziel auswählen:</p>
          <div className="grid gap-2">
            {targets.map((target) => {
              const isActive = selectedTarget?.key === target.key;
              return (
                <button
                  key={target.key}
                  type="button"
                  onClick={() => setTargetKey(target.key)}
                  className={`text-left rounded-xl border px-3 py-2 transition focus:outline-none focus:ring-2 focus:ring-gray-400 ${
                    isActive
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 hover:border-gray-400"
                  }`}
                  aria-pressed={isActive}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{target.label}</span>
                    {isActive && <span className="text-xs uppercase tracking-wide">ausgewählt</span>}
                  </div>
                  {target.url && (
                    <div className={`text-xs mt-1 break-all ${isActive ? "text-gray-100" : "text-gray-500"}`}>
                      {target.url}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {selectedTarget && (
            <p className="text-xs text-gray-500 mt-2">
              Aktuelle Auswahl: <span className="font-medium text-gray-700">{selectedTarget.label}</span>
            </p>
          )}
        </div>
        <div className="h-px bg-gray-200 mb-4" />
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
        <button className="w-full rounded-xl py-2 border bg-gray-900 text-white">
          Login {selectedTarget ? `– ${selectedTarget.label}` : ""}
        </button>
        <p className="text-xs text-gray-500 mt-3">Gültig bis die Browser-Sitzung geschlossen wird.</p>
      </form>
    </div>
  );
}
