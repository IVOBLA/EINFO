const BASE = "";

async function j(method, url, body){
  const res = await fetch(BASE+url,{
    method,
    headers:{ "Content-Type":"application/json" },
    body: body===undefined?undefined:JSON.stringify(body),
    cache:"no-store",
     credentials:"include",      // sendet Cookies in jedem Fall mit
  });
  if(!res.ok){ throw new Error(`HTTP ${res.status} ${await res.text().catch(()=>res.statusText)}`); }
  const ct = res.headers.get("content-type")||"";
  return ct.includes("application/json") ? res.json() : res.text();
}

// 🔐 Master-Unlock
export async function unlock(master) {
  const res = await fetch("/api/ff/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",           // Cookie setzen/mitnehmen
    body: JSON.stringify({ master }),
  });

  // Optional: Fehlermeldung nach vorne durchreichen
  if (!res.ok) {
    let msg = "Falsches Master-Passwort";
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new Error(msg);             // Wichtig: Fehler werfen => Modal zeigt Fehler & bleibt offen
  }
  return true;                        // Nur bei 200 zurückgeben
}

// Prüfen, ob Session aktiv
export async function checkUnlocked() {
  try {
    const res = await fetch("/api/ff/status", { credentials: "include", cache: "no-store" });
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    return !!(j && j.unlocked === true);  // Streng nur boolean unlocked
  } catch {
    return false;
  }
}

export async function fetchBoard(){ return j("GET","/api/board"); }
export async function fetchVehicles(){ return j("GET","/api/vehicles"); }
export async function fetchGroupAvailability(){ return j("GET", "/api/groups/availability"); }
export async function updateVehicleAvailability(id, available){
  return j("PATCH", `/api/vehicles/${encodeURIComponent(id)}/availability`, { available });
}
export async function updateGroupAvailability(name, available){
  return j("PATCH", `/api/groups/${encodeURIComponent(name)}/availability`, { available });
}
export async function fetchTypes(){ try{ return await j("GET","/api/types"); }catch{ return []; } }

export async function fetchAufgabenBoard(roleId = "", { signal } = {}) {
  const qs = roleId ? `?role=${encodeURIComponent(roleId)}` : "";
  const headers = roleId ? { "X-Role-Id": roleId } : {};
  const init = {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers,
  };
  if (signal) init.signal = signal;

  const res = await fetch(`/api/aufgaben${qs}`, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function fetchOnlineRoles() {
  const data = await j("GET", "/api/user/online-roles");
  if (Array.isArray(data?.roles)) return data.roles;
  if (Array.isArray(data)) return data;
  return [];
}

/**
 * createCard – akzeptiert zusätzliche Felder in `extra`
 * (latitude/longitude/location/description/timestamp oder lat/lng)
 */
export async function createCard(title,columnId="neu",toIndex=0,ort="",typ="",extra={}){
  const payload = { title, columnId, toIndex, ort, typ };
  if (extra && typeof extra === "object") {
    const { lat, lng, latitude, longitude, ...rest } = extra;
    if (Number.isFinite(latitude))  payload.latitude  = Number(latitude);
    if (Number.isFinite(longitude)) payload.longitude = Number(longitude);
    if (Number.isFinite(lat))       payload.latitude  = Number(lat);
    if (Number.isFinite(lng))       payload.longitude = Number(lng);
    Object.assign(payload, rest);
  }
  return j("POST","/api/cards", payload);
}

export async function updateCard(cardId, updates){
  return j("PATCH", `/api/cards/${encodeURIComponent(cardId)}`, updates);
}

export async function transitionCard({cardId,from,to,toIndex=0}){
  return j("POST",`/api/cards/${encodeURIComponent(cardId)}/move`,{ from,to,toIndex });
}

export async function assignVehicle(cardId,vehicleId){
  return j("POST",`/api/cards/${encodeURIComponent(cardId)}/assign`,{ vehicleId });
}

export async function unassignVehicle(cardId,vehicleId){
  return j("POST",`/api/cards/${encodeURIComponent(cardId)}/unassign`,{ vehicleId });
}

export async function setCardPersonnel(cardId,manualPersonnel){
  return j("PATCH",`/api/cards/${encodeURIComponent(cardId)}/personnel`,{ manualPersonnel });
}

export async function resetBoard(){ return j("POST","/api/reset",{}); }

// ---- Import (Button + Auto) ----
export async function triggerImport(){ return j("POST","/api/import/trigger",{}); }
export async function getAutoImportConfig(){ return j("GET","/api/import/auto-config"); }
export async function setAutoImportConfig({enabled,intervalSec}){
  return j("POST","/api/import/auto-config",{ enabled, intervalSec });
}

// ---- PDF URL helper ----
export function pdfExportUrl(){ return "/api/export/pdf"; }

// ---- NEU: Umkreissuche (Near)
export async function fetchNearby(cardId, radiusKm){
  const base = `cardId=${encodeURIComponent(cardId)}`;
  const has = Number.isFinite(Number(radiusKm)) && Number(radiusKm) > 0;
  const qs = has ? `${base}&radiusKm=${encodeURIComponent(radiusKm)}` : base;
  const r = await fetch(`/api/nearby?${qs}`, { credentials:"include", cache:"no-store" });
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  if (!r.ok) {
    if (r.status === 400 || r.status === 404) {
      return {
        ok: false,
        error: data?.error || "card has no coordinates",
        center: data?.center ?? null,
        radiusKm: data?.radiusKm ?? null,
        units: Array.isArray(data?.units) ? data.units : [],
      };
    }
    const err = new Error("fetchNearby failed");
    if (data) err.response = data;
    throw err;
  }
  return data;
}
export async function setVehiclePosition(id, lat, lng, incidentId=null, source="manual"){
  return j("PATCH", `/api/vehicles/${encodeURIComponent(id)}/position`, { lat:Number(lat), lng:Number(lng), incidentId, source });
}
export async function resetVehiclePosition(id){
  return j("DELETE", `/api/vehicles/${encodeURIComponent(id)}/position`);
}
