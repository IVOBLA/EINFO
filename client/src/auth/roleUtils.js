// client/src/auth/roleUtils.js
let ROLE_MAP = null;
let INIT_P;

function currentUser() {
  try {
    const w = typeof window !== "undefined" ? window : {};
    const ls = w.localStorage, ss = w.sessionStorage;
    const candidates = [
      () => w.__USER__,
      () => w.__APP_AUTH__?.user,
      () => ls && JSON.parse(ls.getItem("auth.user") || "null"),
      () => ls && JSON.parse(ls.getItem("user") || "null"),
      () => ss && JSON.parse(ss.getItem("auth.user") || "null"),
      () => ss && JSON.parse(ss.getItem("user") || "null"),
    ];
    for (const f of candidates) { const u = f?.(); if (u) return u; }
  } catch {}
  return null;
}

// client/src/auth/roleUtils.js
async function fetchRolesOnce() {
  if (ROLE_MAP) return ROLE_MAP;
  if (INIT_P)   return INIT_P;

  INIT_P = (async () => {
    async function get(url) {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      return Array.isArray(j) ? j : (j.roles || []);
    }

    let roles = [];
    try { roles = await get("/api/user/roles"); }
    catch { roles = []; }

    // <<< WICHTIG: fallback, wenn die API KEIN apps-Objekt liefert >>>
    const hasApps = Array.isArray(roles) && roles.some(r => r && typeof r.apps === "object");
    if (!hasApps) {
      try { roles = await get("/User_roles.json"); } catch {}
    }

    const map = new Map();
    for (const r of roles || []) {
      if (!r || !r.id) continue;
      map.set(String(r.id).toUpperCase(), {
        id: r.id,
        label: r.label || r.id,
        apps: r.apps || {},
      });
    }
    ROLE_MAP = map;
    return map;
  })();

  return INIT_P;
}

function userRoleIds(u) {
  const ids = [];
  if (!u) return ids;
  if (u.role) {
    if (typeof u.role === "string") ids.push(u.role);
    else if (typeof u.role?.id === "string") ids.push(u.role.id);
  }
  if (Array.isArray(u.roles)) {
    for (const r of u.roles) {
      if (typeof r === "string") ids.push(r);
      else if (typeof r?.id === "string") ids.push(r.id);
    }
  }
  return ids.map(s => String(s).trim().toUpperCase());
}

// Public API
export async function initRolePolicy() { await fetchRolesOnce(); }

export function canEditApp(appId, userLike) {
  const u = userLike ?? currentUser();
  if (!ROLE_MAP) return false; // bis initRolePolicy() lief: vorsichtshalber read-only
  const ids = userRoleIds(u);
  const key = String(appId);
  for (const id of ids) {
    const role = ROLE_MAP.get(id);
    const level = role?.apps?.[key]; // "edit" | "view"
    if (level === "edit") return true;
  }
  return false;
}

export function isReadOnlyApp(appId, userLike) {
  return !canEditApp(appId, userLike);
}

export function hasRole(roleId, userLike) {
  const target = String(roleId || "").trim().toUpperCase();
  if (!target) return false;
  const ids = userRoleIds(userLike ?? currentUser());
  return ids.includes(target);
}
