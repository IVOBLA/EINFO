import { forbiddenError } from "../../forbidden.js";

export async function User_api(path, method="GET", body){
  const res = await fetch(`/api/user${path}`, {
    method,
    headers: body ? { "Content-Type":"application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include"
  });
  if(!res.ok){
    if (res.status === 403) throw forbiddenError();
    let txt; try{ txt = await res.json(); }catch{ txt = {error:res.statusText}; }
    throw new Error(txt.error || "API_ERROR");
  }
  return res.json();
}

export const User_login   = (u,p)=> User_api("/login","POST",{username:u,password:p});
export const User_me      = ()=> User_api("/me");
export const User_logout  = ()=> User_api("/logout","POST");
export const User_masterSetup  = (pw,adminUser,adminPass)=> User_api("/master/setup","POST",{password:pw,adminUser,adminPass});
export const User_masterUnlock = (pw)=> User_api("/master/unlock","POST",{password:pw});
export const User_getRoles     = ()=> User_api("/roles");
export const User_setRoles     = (roles)=> User_api("/roles","PUT",{roles});
export const User_listUsers    = ()=> User_api("/users");
export const User_createUser   = (u)=> User_api("/users","POST",u);
export const User_updateUser   = (id,patch)=> User_api(`/users/${id}`,"PATCH",patch);
export const User_updateMyFetcher = (patch)=> User_api("/me/fetcher","PATCH",patch);

// Admin: globaler Fetcher-Creds-Vault
export const User_getFetcherGlobal = () => User_api("/fetcher");
export const User_setFetcherGlobal = (creds) => User_api("/fetcher","PUT",creds);
export const User_masterState = ()=> User_api("/master/state");

