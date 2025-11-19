import express from "express";
import { randomBytes } from "crypto";
import {
  User_initStore, User_setupMaster, User_unlockMaster, User_lockMaster, User_isUnlocked,
  User_getRoles, User_setRoles, User_list, User_create, User_update, User_remove,
  User_setGlobalFetcher, User_getGlobalFetcher, User_hasMaster,
  User_authenticateLoose, User_getByIdLoose
} from "./User_store.mjs";

function readCookie(req, name){
  const h = req.headers.cookie || "";
  const found = h.split(";").map(s=>s.trim()).find(p=>p.startsWith(name+"="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

const _sessions = new Map(); // sid -> { userId, createdAt, lastSeen, roles:Set<string> }
const sessionDestroyListeners = new Set();

function notifySessionDestroyed(session) {
  if (!session) return;
  for (const listener of sessionDestroyListeners) {
    try {
      listener(session);
    } catch (err) {
      console.warn("[User_auth] session destroy listener error", err);
    }
  }
}

export function User_onSessionDestroyed(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  sessionDestroyListeners.add(listener);
  return () => {
    sessionDestroyListeners.delete(listener);
  };
}

const SESSION_IDLE_TIMEOUT_MS = (() => {
  const minuteCandidates = [
    process.env.USER_SESSION_IDLE_TIMEOUT_MIN,
    process.env.USER_SESSION_IDLE_TIMEOUT_MINUTES,
    process.env.SESSION_IDLE_TIMEOUT_MIN,
    process.env.SESSION_IDLE_TIMEOUT_MINUTES,
  ];
  for (const value of minuteCandidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed * 60_000;
    }
  }
  const rawMs = Number(process.env.USER_SESSION_IDLE_TIMEOUT_MS);
  if (Number.isFinite(rawMs) && rawMs > 0) {
    return rawMs;
  }
  return 15 * 60_000;
})();

const SESSION_SWEEP_INTERVAL_MS = (() => {
  const raw = Number(process.env.USER_SESSION_SWEEP_INTERVAL_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return Math.min(SESSION_IDLE_TIMEOUT_MS, 60_000);
})();

const ONLINE_ROLE_ACTIVE_LIMIT_MS = (() => {
  const minuteCandidates = [
    process.env.USER_ONLINE_ROLE_ACTIVE_MIN,
    process.env.USER_ONLINE_ROLE_ACTIVE_MINUTES,
    process.env.USER_ONLINE_ACTIVE_MINUTES,
  ];
  for (const value of minuteCandidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed * 60_000;
    }
  }
  const msCandidates = [
    process.env.USER_ONLINE_ROLE_ACTIVE_MS,
    process.env.USER_ONLINE_ACTIVE_MS,
    process.env.USER_ONLINE_ROLE_RECENT_MS,
  ];
  for (const value of msCandidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const fallback = 2 * 60_000; // 2 Minuten – synchronisiert S3-Fallback schneller
  const limit = Math.min(SESSION_IDLE_TIMEOUT_MS, fallback);
  return Math.max(15_000, limit);
})();

const SESSION_IDLE_TIMEOUT_SECONDS = Math.max(1, Math.floor(SESSION_IDLE_TIMEOUT_MS / 1000));

function sessionIsExpired(session, now = Date.now()) {
  if (!session) return true;
  const reference = session.lastSeen ?? session.createdAt ?? 0;
  return reference + SESSION_IDLE_TIMEOUT_MS <= now;
}

function sessionExpiryInfo(session, now = Date.now()) {
  if (!session) {
    const refIso = new Date(now).toISOString();
    return {
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      idleTimeoutSeconds: SESSION_IDLE_TIMEOUT_SECONDS,
      lastSeenIso: refIso,
      expiresAtIso: new Date(now + SESSION_IDLE_TIMEOUT_MS).toISOString(),
    };
  }
  const ref = session.lastSeen ?? session.createdAt ?? now;
  return {
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    idleTimeoutSeconds: SESSION_IDLE_TIMEOUT_SECONDS,
    lastSeenIso: new Date(ref).toISOString(),
    expiresAtIso: new Date(ref + SESSION_IDLE_TIMEOUT_MS).toISOString(),
  };
}

function cleanupExpiredSessions(now = Date.now()) {
  for (const [sid, session] of _sessions) {
    if (sessionIsExpired(session, now)) {
      _sessions.delete(sid);
      notifySessionDestroyed(session);
    }
  }
}

const cleanupInterval = setInterval(() => {
  cleanupExpiredSessions();
}, SESSION_SWEEP_INTERVAL_MS);
if (typeof cleanupInterval?.unref === "function") {
  cleanupInterval.unref();
}

function getActiveSession(sid) {
  if (!sid) return null;
  const session = _sessions.get(sid);
  if (!session) return null;
  if (sessionIsExpired(session)) {
    _sessions.delete(sid);
    notifySessionDestroyed(session);
    return null;
  }
  return session;
}

function normalizeRoleId(raw) {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim().toUpperCase();
  if (typeof raw?.id === "string") return raw.id.trim().toUpperCase();
  if (typeof raw?.role === "string") return raw.role.trim().toUpperCase();
  return "";
}

function extractRoleIds(userLike) {
  const out = new Set();
  if (!userLike) return [];
  const collect = (value) => {
    const id = normalizeRoleId(value);
    if (id) out.add(id);
  };
  collect(userLike?.role);
  if (Array.isArray(userLike?.roles)) {
    for (const entry of userLike.roles) collect(entry);
  }
  return [...out];
}
function userHasRole(userLike, roleId) {
  const target = normalizeRoleId(roleId);
  if (!target) return false;
  if (normalizeRoleId(userLike?.role) === target) return true;
  if (Array.isArray(userLike?.roles)) {
    for (const entry of userLike.roles) {
      if (normalizeRoleId(entry) === target) return true;
    }
  }
  return false;
}

function syncSessionRoles(session, userLike) {
  if (!session) return;
  const roleIds = extractRoleIds(userLike);
  session.roles = roleIds;
  session.primaryRole = roleIds[0] || null;
}

export function User_authMiddleware(options = {}){
  const secureCookies = options.secureCookies ?? (String(process.env.KANBAN_COOKIE_SECURE || "") === "1");
  return async (req,res,next)=>{
    const sid = readCookie(req, "User_sid");
    const session = getActiveSession(sid);
    if(session){
      session.lastSeen = Date.now();
      if (sid && res && typeof res.setHeader === "function" && !res.headersSent) {
        setSessionCookie(res, sid, { secure: secureCookies, maxAgeSeconds: SESSION_IDLE_TIMEOUT_SECONDS });
      }
      try{ req.user = await User_getByIdLoose(session.userId); }
      catch{ req.user = null; }
      syncSessionRoles(session, req.user);
      req.session = session;
      req.sessionId = sid;
      req.sessionInfo = sessionExpiryInfo(session);
    }
    else {
      req.session = null;
      req.sessionId = null;
      req.sessionInfo = null;
    }
    next();
  };
}
function setSessionCookie(res, sid, { secure=false, maxAgeSeconds=null } = {}){
  const flags = [
    `HttpOnly`,
    `Path=/`,
    `SameSite=Lax`,
    secure ? `Secure` : null,
    Number.isFinite(maxAgeSeconds) ? `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}` : null,
  ].filter(Boolean).join("; ");
  res.setHeader("Set-Cookie", `User_sid=${encodeURIComponent(sid)}; ${flags}`);
}

function requireUnlocked(_req,res,next){
  if(!User_isUnlocked()) return res.status(423).json({error:"MASTER_LOCKED"}); next();
}
export function User_requireAuth(req,res,next){
  if(!req.user) return res.status(401).json({error:"UNAUTHORIZED"}); next();
}
export function User_requireAdmin(req,res,next){
  if(!req.user) return res.status(401).json({error:"UNAUTHORIZED"});
  if(!userHasRole(req.user, "Admin")) return res.status(403).json({error:"FORBIDDEN"}); next();
}

export function User_createRouter({ dataDir, secureCookies=false }){
  User_initStore(dataDir);
  const r = express.Router();
  r.use(express.json({ limit:"1mb" }));

  // --- Master-Zustand (für UI) ---
  r.get("/master/state", async (_req,res)=>{
    try{ res.json({ hasMaster: await User_hasMaster() }); }
    catch{ res.json({ hasMaster:false }); }
  });

  // --- Master initial/entsperren ---
  r.post("/master/setup", async (req,res)=>{
    try{
      const { password, adminUser="admin", adminPass } = req.body||{};
      if(!password || !adminPass) return res.status(400).json({error:"MISSING"});
      await User_setupMaster(password);
      await User_create({ username:adminUser, password:adminPass, displayName:"Administrator", role:"Admin", roles:["Admin"] });
      res.json({ ok:true });
    }catch(e){ res.status(e.message==="MASTER_EXISTS"?409:500).json({error:e.message}); }
  });
  r.post("/master/unlock", async (req,res)=>{
    try{ await User_unlockMaster(req.body?.password); res.json({ok:true}); }
    catch(e){ res.status(401).json({error:e.message}); }
  });
  r.post("/master/lock", (_req,res)=>{ User_lockMaster(); res.json({ok:true}); });

  // --- Auth (ohne Master möglich) ---
  r.post("/login", async (req,res)=>{
    const { username, password } = req.body||{};
    const u = await User_authenticateLoose(username, password);
    if(!u) return res.status(401).json({error:"INVALID_CREDENTIALS"});
    const sid = randomBytes(24).toString("hex");
    const roles = extractRoleIds(u);
    const now = Date.now();
    _sessions.set(sid, { userId:u.id, createdAt:now, lastSeen:now, roles, primaryRole: roles[0] || null });
    setSessionCookie(res, sid, { secure: secureCookies, maxAgeSeconds: SESSION_IDLE_TIMEOUT_SECONDS });
    const session = _sessions.get(sid);
    res.json({
      id: u.id,
      username: u.username,
      role: u.role,
      roles: u.roles || [],
      displayName: u.displayName,
      session: sessionExpiryInfo(session, now),
    });
  });
  r.get("/me", (req,res)=>{
    if(!req.user) return res.status(401).json({error:"UNAUTHORIZED"});
    const { id, username, role, roles, displayName } = req.user;
    const session = req.session || getActiveSession(readCookie(req, "User_sid"));
    res.json({
      id,
      username,
      role,
      roles: Array.isArray(roles) ? roles : [],
      displayName,
      session: sessionExpiryInfo(session),
    });
  });
  r.post("/logout", (req,res)=>{
    const sid = readCookie(req, "User_sid");
    if(sid){
      const session = _sessions.get(sid);
      if (session) notifySessionDestroyed(session);
      _sessions.delete(sid);
    }
    setSessionCookie(res, "", { secure: secureCookies, maxAgeSeconds: 0 });
    res.json({ ok:true });
  });

  r.get("/online-roles", User_requireAuth, (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ roles: User_onlineRoleIds({ activeWithinMs: ONLINE_ROLE_ACTIVE_LIMIT_MS }) });
  });

  // --- Rollen & Benutzer (Admin + Master erforderlich) ---
  r.get("/roles", requireUnlocked, User_requireAdmin, async (_req,res)=> res.json({ roles: await User_getRoles() }));
  r.put("/roles", requireUnlocked, User_requireAdmin, async (req,res)=>{
    try{ res.json({ roles: await User_setRoles(req.body?.roles||[]) }); }
    catch(e){ res.status(400).json({error:e.message}); }
  });

  r.get("/users", requireUnlocked, User_requireAdmin, async (_req,res)=> res.json({ users: await User_list() }));
  r.post("/users", requireUnlocked, User_requireAdmin, async (req,res)=>{
    try{
      const { username, password, displayName, role, roles } = req.body||{};
      if(!username || !password) return res.status(400).json({error:"MISSING"});
      if(!role && (!Array.isArray(roles) || roles.length===0)) return res.status(400).json({error:"ROLE_REQUIRED"});
      const user = await User_create({ username, password, displayName, role, roles });
      res.json({ user });
    }catch(e){ res.status(400).json({error:e.message}); }
  });
  r.patch("/users/:id", requireUnlocked, User_requireAdmin, async (req,res)=>{
    try{ const user = await User_update(req.params.id, req.body||{}); res.json({ user }); }
    catch(e){ res.status(400).json({error:e.message}); }
  });
  r.delete("/users/:id", requireUnlocked, User_requireAdmin, async (req,res)=>{
    try{ await User_remove(req.params.id); res.json({ ok:true }); }
    catch(e){ res.status(404).json({error:e.message}); }
  });

  // --- Globale Fetcher-Creds (Admin + Master erforderlich) ---
  r.get("/fetcher", requireUnlocked, User_requireAdmin, async (_req,res)=>{
    const it = await User_getGlobalFetcher().catch(()=>null);
    res.json({
      has: !!(it?.creds?.username && it?.creds?.password),
      updatedAt: it?.updatedAt || null
    });
  });
  r.put("/fetcher", requireUnlocked, User_requireAdmin, async (req,res)=>{
    try{
      const { username, password } = req.body||{};
      const out = await User_setGlobalFetcher({ username, password });
      res.json({ ok:true, updatedAt: out.updatedAt });
    }catch(e){ res.status(400).json({ error:e.message||"SAVE_FAILED" }); }
  });

  return r;
}

function onlineRoleSet(options = {}) {
  cleanupExpiredSessions();
  const roles = new Set();
  const now = Date.now();
  const activeWithinMs = Number.isFinite(options?.activeWithinMs) && options.activeWithinMs > 0
    ? Number(options.activeWithinMs)
    : null;
  for (const session of _sessions.values()) {
    if (!session) continue;
    if (activeWithinMs) {
      const ref = Number(session.lastSeen ?? session.createdAt ?? 0);
      if (!Number.isFinite(ref) || ref + activeWithinMs <= now) {
        continue;
      }
    }
    if (Array.isArray(session.roles)) {
      for (const roleId of session.roles) {
        const norm = normalizeRoleId(roleId);
        if (norm) roles.add(norm);
      }
      continue;
    }
    const norm = normalizeRoleId(session.primaryRole || session.role);
    if (norm) roles.add(norm);
  }
  return roles;
}

export function User_onlineRoleIds(options = {}) {
  return [...onlineRoleSet(options)];
}

export function User_isAnyRoleOnline(roleIds = [], options = {}) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return false;
  const target = new Set(roleIds.map(normalizeRoleId).filter(Boolean));
  if (!target.size) return false;
  const online = onlineRoleSet(options);
  for (const id of target) {
    if (online.has(id)) return true;
  }
  return false;
}

export const USER_ONLINE_ROLE_ACTIVE_LIMIT_MS = ONLINE_ROLE_ACTIVE_LIMIT_MS;
export const User_hasRole = userHasRole;
