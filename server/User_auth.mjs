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

const _sessions = new Map(); // sid -> { userId, createdAt, lastSeen }

export function User_authMiddleware(){
  return async (req,res,next)=>{
    const sid = readCookie(req, "User_sid");
    if(sid && _sessions.has(sid)){
      const s = _sessions.get(sid);
      s.lastSeen = Date.now();
      try{ req.user = await User_getByIdLoose(s.userId); }
      catch{ req.user = null; }
    }
    next();
  };
}
function setSessionCookie(res, sid, secure=false){
  const flags = [
    `HttpOnly`,
    `Path=/`,
    `SameSite=Lax`,
    secure ? `Secure` : null,
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
  if(req.user.role!=="Admin") return res.status(403).json({error:"FORBIDDEN"}); next();
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
      await User_create({ username:adminUser, password:adminPass, displayName:"Administrator", role:"Admin" });
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
    _sessions.set(sid, { userId:u.id, createdAt:Date.now(), lastSeen:Date.now() });
    setSessionCookie(res, sid, secureCookies);
    res.json({ id:u.id, username:u.username, role:u.role, displayName:u.displayName });
  });
  r.get("/me", (req,res)=>{
    if(!req.user) return res.status(401).json({error:"UNAUTHORIZED"});
    const { id, username, role, displayName } = req.user;
    res.json({ id, username, role, displayName });
  });
  r.post("/logout", (req,res)=>{
    const sid = readCookie(req, "User_sid");
    if(sid) _sessions.delete(sid);
    setSessionCookie(res, "", secureCookies);
    res.json({ ok:true });
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
      const { username, password, displayName, role } = req.body||{};
      if(!username || !password || !role) return res.status(400).json({error:"MISSING"});
      const user = await User_create({ username, password, displayName, role });
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
