// /client/src/components/SoundGate.jsx
import { useEffect, useState } from "react";
import { initSound, isSoundUnlocked } from "../sound";

export default function SoundGate() {
  const [needs, setNeeds] = useState(!isSoundUnlocked());

  useEffect(() => {
    initSound();
    const onNeed = () => setNeeds(true);
    const onOk = () => setNeeds(false);
    window.addEventListener("sound:needsUnlock", onNeed);
    window.addEventListener("sound:unlocked", onOk);
    return () => {
      window.removeEventListener("sound:needsUnlock", onNeed);
      window.removeEventListener("sound:unlocked", onOk);
    };
  }, []);

  if (!needs) return null;
  return (
    <button
      onClick={() => {/* erster Klick triggert initSound-Listener */}}
      className="fixed bottom-4 right-4 px-3 py-2 rounded bg-blue-600 text-white shadow"
      title="Ton aktivieren"
    >
      🔊 Ton aktivieren
    </button>
  );
}
