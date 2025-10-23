// /client/src/sound.js
let unlocked = localStorage.getItem("soundEnabled") === "1";
let audio = null;

// Optional: WebAudio für zuverlässiges Abspielen
const AC = window.AudioContext || window.webkitAudioContext;
const ctx = AC ? new AC() : null;

export function initSound() {
  if (!audio) {
    audio = new Audio("/sounds/bahnhof.mp3"); // deine Datei
    audio.preload = "auto";
  }
  // Einmalige Freischaltung an die erste User-Geste hängen
  const unlock = async () => {
    try {
      if (ctx && ctx.state !== "running") await ctx.resume();
      if (audio) {
        audio.muted = true;
        await audio.play();     // erlaubt, weil muted
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      }
      unlocked = true;
      localStorage.setItem("soundEnabled", "1");
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.dispatchEvent(new CustomEvent("sound:unlocked"));
    } catch {
      // wenn’s noch blockiert ist, lassen wir die Listener weiter aktiv
    }
  };
  if (!unlocked) {
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }
}

export async function playGong() {
  if (!audio) initSound();
  if (!unlocked) {
    // Button/Hint anzeigen lassen
    window.dispatchEvent(new CustomEvent("sound:needsUnlock"));
    return;
  }
  try {
    audio.currentTime = 0;
    await audio.play();
  } catch {}
}

export function isSoundUnlocked() { return unlocked; }
