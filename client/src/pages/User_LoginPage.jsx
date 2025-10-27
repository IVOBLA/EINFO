import React, { useMemo, useState } from "react";
import { useUserAuth } from "../components/User_AuthProvider.jsx";

const LOGIN_TARGETS = [
  { key: "aufgaben", label: "Aufgaben", path: "/aufgaben" },
  { key: "meldestelle", label: "Meldestelle", path: "/#/protokoll" },
  { key: "einsatzstellen", label: "Einsatzstellen", path: "/" },
  { key: "admin", label: "Admin", path: "/user-admin" },
  { key: "status", label: "Status", path: "/status" }
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
  const [loadingKey, setLoadingKey] = useState(null);
  const baseUrl = useMemo(() => resolveLoginBaseUrl(), []);
  const targets = useMemo(() => {
    const usableBase = baseUrl || "";
    return LOGIN_TARGETS.map((entry) => ({
      ...entry,
      url: usableBase ? buildTargetUrl(usableBase, entry.path) : entry.path
    }));
  }, [baseUrl]);

  const onLogin = async (target) => {
    if (!target || loadingKey) return;
    setE("");
    setLoadingKey(target.key);
    try{
      await login(u,p);
      if (target.url) {
        window.location.href = target.url;
      }
    }
    catch(err){
      setE(err.message||"Fehler");
    }
    finally {
      setLoadingKey(null);
    }
  };

  const onSubmit = (ev)=>{
    ev.preventDefault();
    if (targets[0]) onLogin(targets[0]);
  };

  const isLocked = String(e||"").toUpperCase().includes("MASTER_LOCKED");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="bg-white shadow rounded-2xl p-6 w-[380px]">
        <h1 className="text-xl font-semibold mb-4">Anmeldung</h1>
        <label className="block mb-2 text-sm">Benutzername</label>
        <input
          className="w-full border rounded px-3 py-2 mb-3"
          value={u}
          onChange={e=>setU(e.target.value)}
          autoFocus
          autoComplete="username"
        />
        <label className="block mb-2 text-sm">Passwort</label>
        <input
          className="w-full border rounded px-3 py-2 mb-3"
          type="password"
          value={p}
          onChange={e=>setP(e.target.value)}
          autoComplete="current-password"
        />
        {e && <div className="text-red-600 text-sm mb-2">{e}</div>}
        {isLocked && (
          <div className="text-sm text-blue-700 mb-2">
            Master ist gesperrt. <a className="underline" href="/user-firststart">Hier Master setzen/entsperren</a>.
          </div>
        )}
        <div className="h-px bg-gray-200 my-4" />
        <div className="grid gap-2">
          {targets.map((target) => {
            const isBusy = loadingKey === target.key;
            const disabled = !!loadingKey && loadingKey !== target.key;
            return (
              <button
                key={target.key}
                type="button"
                onClick={() => onLogin(target)}
                disabled={disabled || isBusy}
                className="w-full rounded-xl py-2 border bg-gray-900 text-white transition hover:bg-gray-800 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isBusy ? `Login – ${target.label}…` : `Login – ${target.label}`}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 mt-3">Gültig bis die Browser-Sitzung geschlossen wird.</p>
      </form>
    </div>
  );
}
