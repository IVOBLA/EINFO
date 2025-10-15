import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import AufgApp from "./pages/AufgApp.jsx";

import User_AuthProvider, { User_SessionGate } from "./components/User_AuthProvider.jsx";
import User_LoginPage from "./pages/User_LoginPage.jsx";
import User_AdminPanel from "./pages/User_AdminPanel.jsx";
import User_FirstStart from "./pages/User_FirstStart.jsx";

async function mount() {
  const el = document.getElementById("root");
  if (!el) return;
  const root = createRoot(el);
  const path = window.location.pathname.replace(/\/+$/, "");

  const withAuth = (node) => (
    <User_AuthProvider>
      <User_SessionGate fallback={<User_LoginPage/>}>{node}</User_SessionGate>
    </User_AuthProvider>
  );

  if (path === "/user-firststart") {
    root.render(<User_AuthProvider><User_FirstStart/></User_AuthProvider>);
    return;
  }
  if (path === "/user-login") {
    root.render(<User_AuthProvider><User_LoginPage/></User_AuthProvider>);
    return;
  }
  if (path === "/user-admin") {
    root.render(withAuth(<User_AdminPanel/>));
    return;
  }
  if (path === "/aufgaben" || path === "/aufg") {
    root.render(withAuth(<AufgApp />));
    return;
  }

  const { default: OldApp } = await import("./App.jsx");
  root.render(withAuth(<OldApp />));
}
mount();
