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
