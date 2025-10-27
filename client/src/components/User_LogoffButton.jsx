import React, { useState } from "react";
import { useUserAuth } from "./User_AuthProvider.jsx";

export default function User_LogoffButton({ className = "" }) {
  const { logout, user } = useUserAuth();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logout?.();
    } catch (err) {
      console.error(err);
    }
    try { sessionStorage.clear(); } catch {}
    try { localStorage.clear(); } catch {}
    setBusy(false);
    window.location.href = "/user-login";
  };

  const label = busy ? "LogOff…" : "LogOff";
  const title = user?.displayName ? `LogOff (${user.displayName})` : "LogOff";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={title}
      className={`px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white shadow ${busy ? "opacity-70 cursor-wait" : ""} ${className}`.trim()}
    >
      {label}
    </button>
  );
}
