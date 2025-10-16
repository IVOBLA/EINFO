import { promises as fs } from "fs";
import path from "path";
import {
  User_deriveKey, User_encryptJSON, User_decryptJSON,
  User_hmacVerifyBlob, User_hashPassword, User_verifyPassword
} from "./User_crypto.mjs";

let _master = null;
let _paths  = null;

export const User_isUnlocked = ()=> !!_master;

// ---------- role helpers (object/legacy) ----------
function _normalizeRolesIn(objArray){
  if (!Array.isArray(objArray)) return [{ id: "Admin", label: "Administrator", capabilities: ["*"] }];
  const out = [];
  for (const r of objArray) {
    if (typeof r === "string") {
      out.push({ id:r, label:r, capabilities: [] });
    } else if (r && typeof r.id === "string") {
      out.push({ id: r.id, label: r.label || r.id, capabilities: Array.isArray(r.capabilities) ? r.capabilities : [] });
    }
  }
  // ensure Admin exists
  if (!out.some(r => r.id === "Admin")) {
    out.unshift({ id: "Admin", label: "Administrator", capabilities: ["*"] });
  }
  // cap to 11 total
  return out.slice(0, 11);
}

// Pfade inkl. Auth-Index
export function User_initStore(dataDir){
  _paths = {
    master:  path.join(dataDir, "User_master.json"),
    users:   path.join(dataDir, "User_users.enc.json"),
    roles:   path.join(dataDir, "User_roles.json"),
    fetcher: path.join(dataDir, "User_fetcher.enc.json"),
    authIdx: path.join(dataDir, "User_authIndex.json"),
  };
  return _paths;
}

// ---------- intern: Vault & Auth-Index ----------
async function _loadVault(){
  if(!_master) throw new Error("MASTER_LOCKED");
  const enc = JSON.parse(await fs.readFile(_paths.users,"utf8"));
  const v = User_decryptJSON(enc, _master.key);
  if (!v.globalFetcherCreds) v.globalFetcherCreds = { username:"", password:"" };
  return v;
}
async function _saveVault(v){
  if(!_master) throw new Error("MASTER_LOCKED");
  const enc = User_encryptJSON(v, _master.key);
  await fs.writeFile(_paths.users, JSON.stringify(enc, null, 2));
}
async function _loadAuthIndex(){
  try{ return JSON.parse(await fs.readFile(_paths.authIdx, "utf8")); }
  catch{ return { v:1, users:[] }; }
}
async function _saveAuthIndex(idx){
  await fs.writeFile(_paths.authIdx, JSON.stringify(idx, null, 2));
}
async function _rebuildAuthIndexFromVaultIfEmpty(){
  try{
    const idx = await _loadAuthIndex();
    if (Array.isArray(idx.users) && idx.users.length) return;
    if(!_master) return; // ohne Master kein Zugriff auf Vault
    const v = await _loadVault();
    const users = (v.users||[]).map(u=>({
      id:u.id, username:u.username, displayName:u.displayName, role:u.role, pass:u.pass
    }));
    await _saveAuthIndex({ v:1, users });
  }catch{}
}

// ---------- Master / Setup ----------
export async function User_setupMaster(password){
  try { await fs.access(_paths.master); throw new Error("MASTER_EXISTS"); } catch {}
  const {key, salt, params} = await User_deriveKey(password);
  const verify = User_hmacVerifyBlob(key);
  await fs.writeFile(_paths.master, JSON.stringify({v:1, salt, params, verify}, null, 2));
  _master = { key, saltB64:salt, params };

  // leerer Vault
  const empty = { v:1, users:[], nextId:1, globalFetcherCreds:{ username:"", password:"" } };
  await fs.writeFile(_paths.users, JSON.stringify(User_encryptJSON(empty, key), null, 2));

  // Standard-Rollen (Objektformat)
  const roles = [
    { id: "Admin", label: "Administrator", capabilities: ["*"] },
    { id: "Disponent", label: "Disponent", capabilities: ["einsatz:read"] },
    { id: "Mitarbeiter1", label: "Mitarbeiter1", capabilities: ["einsatz:read"] },
    { id: "Mitarbeiter2", label: "Mitarbeiter2", capabilities: ["einsatz:read"] },
    { id: "Mitarbeiter3", label: "Mitarbeiter3", capabilities: ["einsatz:read"] },
    { id: "Mitarbeiter4", label: "Mitarbeiter4", capabilities: ["einsatz:read"] },
    { id: "Mitarbeiter5", label: "Mitarbeiter5", capabilities: ["einsatz:read"] },
    { id: "Mitarbeiter6", label: "Mitarbeiter6", capabilities: ["einsatz:read"] },
    { id: "Mitarbeiter7", label: "Mitarbeiter7", capabilities: ["einsatz:read"] },
    { id: "Mitarbeiter8", label: "Mitarbeiter8", capabilities: ["einsatz:read"] },
    { id: "Mitarbeiter9", label: "Mitarbeiter9", capabilities: ["einsatz:read"] }
  ];
  await fs.writeFile(_paths.roles, JSON.stringify({v:1, roles}, null, 2));

  // leeren Auth-Index anlegen – der erste Admin wird beim User_create hinzugefügt
  await _saveAuthIndex({ v:1, users:[] });
  return true;
}

export async function User_unlockMaster(password){
  const meta = JSON.parse(await fs.readFile(_paths.master,"utf8"));
  const { key } = await User_deriveKey(password, meta.salt);
  if (User_hmacVerifyBlob(key) !== meta.verify) throw new Error("MASTER_INVALID");
  _master = { key, saltB64:meta.salt, params:meta.params };

  // Migration: falls Index fehlt/leer → aus Vault befüllen
  await _rebuildAuthIndexFromVaultIfEmpty();
  return true;
}
export function User_lockMaster(){ _master = null; }

// ---------- Rollen ----------
export async function User_getRoles(){
  try{
    const j = JSON.parse(await fs.readFile(_paths.roles, "utf8"));
    const arr = Array.isArray(j.roles) ? j.roles : [];
    return _normalizeRolesIn(arr);
  }catch{
    return _normalizeRolesIn(["Admin"]);
  }
}
export async function User_setRoles(roles){
  const norm = _normalizeRolesIn(roles);
  await fs.writeFile(_paths.roles, JSON.stringify({ v:1, roles: norm }, null, 2));
  return norm;
}

// ---------- Users (im Vault) ----------
export async function User_list(){
  const v = await _loadVault();
  return v.users.map(u=>({ id:u.id, username:u.username, displayName:u.displayName, role:u.role, createdAt:u.createdAt, updatedAt:u.updatedAt }));
}
export async function User_getByName(username){
  const v = await _loadVault();
  return v.users.find(u=>u.username.toLowerCase()===String(username).toLowerCase())||null;
}
export async function User_getById(id){
  const v = await _loadVault();
  return v.users.find(u=>u.id===Number(id))||null;
}
export async function User_create({username, password, displayName, role}){
  const v = await _loadVault();
  if(v.users.some(u=>u.username.toLowerCase()===String(username).toLowerCase())) throw new Error("USERNAME_EXISTS");
  const pass = await User_hashPassword(password);
  const user = { id:v.nextId++, username, displayName:displayName||username, role, pass, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  v.users.push(user);
  await _saveVault(v);

  // Auth-Index spiegeln
  const idx = await _loadAuthIndex();
  idx.users.push({ id:user.id, username:user.username, displayName:user.displayName, role:user.role, pass:user.pass });
  await _saveAuthIndex(idx);

  return { id:user.id, username:user.username, displayName:user.displayName, role:user.role };
}
export async function User_update(id, patch){
  const v = await _loadVault();
  const u = v.users.find(x=>x.id===Number(id));
  if(!u) throw new Error("NOT_FOUND");
  if(patch.username) u.username = patch.username;
  if(patch.displayName) u.displayName = patch.displayName;
  if(patch.role) u.role = patch.role;
  if(patch.password){ u.pass = await User_hashPassword(patch.password); }
  u.updatedAt = new Date().toISOString();
  await _saveVault(v);

  // Index nachziehen
  const idx = await _loadAuthIndex();
  const iu = idx.users.find(x=>x.id===Number(id));
  if(iu){
    if(patch.username)    iu.username    = u.username;
    if(patch.displayName) iu.displayName = u.displayName;
    if(patch.role)        iu.role        = u.role;
    if(patch.password)    iu.pass        = u.pass;
  }else{
    idx.users.push({ id:u.id, username:u.username, displayName:u.displayName, role:u.role, pass:u.pass });
  }
  await _saveAuthIndex(idx);
  return { id:u.id, username:u.username, displayName:u.displayName, role:u.role };
}
export async function User_remove(id){
  const v = await _loadVault();
  const n = v.users.length;
  v.users = v.users.filter(x=>x.id!==Number(id));
  if(v.users.length===n) throw new Error("NOT_FOUND");
  await _saveVault(v);

  const idx = await _loadAuthIndex();
  idx.users = idx.users.filter(x=>x.id!==Number(id));
  await _saveAuthIndex(idx);
  return true;
}
export async function User_authenticate(username, password){
  const u = await User_getByName(username);
  if(!u) return null;
  const ok = await User_verifyPassword(password, u.pass);
  return ok ? u : null;
}

// ---------- Login ohne Master (Auth-Index) ----------
export async function User_authenticateLoose(username, password){
  if(_master) return await User_authenticate(username, password);
  const idx = await _loadAuthIndex();
  const iu = idx.users.find(u=>u.username.toLowerCase()===String(username).toLowerCase());
  if(!iu) return null;
  const ok = await User_verifyPassword(password, iu.pass);
  return ok ? { id:iu.id, username:iu.username, displayName:iu.displayName, role:iu.role } : null;
}
export async function User_getByIdLoose(id){
  if(_master) return await User_getById(id);
  const idx = await _loadAuthIndex();
  const iu = idx.users.find(u=>u.id===Number(id));
  return iu ? { id:iu.id, username:iu.username, displayName:iu.displayName, role:iu.role } : null;
}

// ---------- Globale Fetcher-Creds (separate Datei, Master-pflichtig) ----------
export async function User_setGlobalFetcher({ username, password }){
  if(!_master) throw new Error("MASTER_LOCKED");
  if(!username || !password) throw new Error("MISSING");
  const obj = { v:1, updatedAt:new Date().toISOString(), creds:{ username, password } };
  const enc = User_encryptJSON(obj, _master.key);
  await fs.writeFile(_paths.fetcher, JSON.stringify(enc, null, 2));
  return { updatedAt: obj.updatedAt };
}
export async function User_getGlobalFetcher(){
  if(!_master) throw new Error("MASTER_LOCKED");
  try{
    const enc = JSON.parse(await fs.readFile(_paths.fetcher, "utf8"));
    return User_decryptJSON(enc, _master.key);
  }catch{ return null; }
}
export async function User_hasGlobalFetcher(){
  const it = await User_getGlobalFetcher().catch(()=>null);
  return !!(it?.creds?.username && it?.creds?.password);
}

// ---------- Meta ----------
export async function User_hasMaster(){
  if(!_paths) throw new Error("NOT_INIT");
  try{ await fs.access(_paths.master); return true; }
  catch{ return false; }
}
