import React, {createContext, useContext, useEffect, useState} from "react";
import { User_me, User_login, User_logout } from "../utils/User_auth";

const Ctx = createContext(null);
export const useUserAuth = ()=> useContext(Ctx);

export default function User_AuthProvider({children}){
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(()=>{ (async()=>{
    try{ const me = await User_me(); setUser(me); }catch{}
    setReady(true);
  })(); },[]);
  
// Spiegel den React-User in globale Orte (für roleUtils & Re-Loads)
useEffect(() => {
  if (typeof window !== "undefined") {
    window.__APP_AUTH__ = window.__APP_AUTH__ || {};
    window.__APP_AUTH__.user = user || null;
    if (user) {
      window.__USER__ = user;
      localStorage.setItem("auth.user", JSON.stringify(user));
    } else {
      delete window.__USER__;
      localStorage.removeItem("auth.user");
    }
  }
}, [user]);

  const login  = async (u,p)=> { const m = await User_login(u,p); setUser(m); return m; };
  const logout = async ()=> { await User_logout(); setUser(null); };

  return <Ctx.Provider value={{user, ready, login, logout}}>{children}</Ctx.Provider>;
}

export function User_SessionGate({ children, fallback }){
  const {user, ready} = useUserAuth();
  if(!ready) return null;
  if(!user)  return fallback ?? <div style={{padding:16}}>Bitte einloggen…</div>;
  return children;
}
