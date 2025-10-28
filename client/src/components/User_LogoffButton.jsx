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

  const title = user?.displayName
    ? `Abmelden (${user.displayName})`
    : "Abmelden";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={title}
      aria-label={title}
      className={[busy ? "cursor-wait" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="sr-only">{title}</span>
      {busy ? (
        <svg
          className="animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            className="opacity-40"
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M21 12a9 9 0 0 1-9 9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17 16l4-4-4-4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 12h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
