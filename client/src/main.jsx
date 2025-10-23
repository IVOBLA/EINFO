import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import StatusPage from "./StatusPage.jsx";
import "./index.css";

import User_AuthProvider, { User_SessionGate } from "./components/User_AuthProvider.jsx";
import User_LoginPage from "./pages/User_LoginPage.jsx";
import User_AdminPanel from "./pages/User_AdminPanel.jsx";
import User_FirstStart from "./pages/User_FirstStart.jsx";

function mount() {
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
  if (path === "/status") {
    root.render(withAuth(<StatusPage />));
  } else {
    root.render(withAuth(<App />));
  }
}
mount();
