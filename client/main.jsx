import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import StatusPage from "./StatusPage.jsx";
import "./index.css";

function mount() {
  const el = document.getElementById("root");
  if (!el) return;
  const root = createRoot(el);
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/status") {
    root.render(<StatusPage />);
  } else {
    root.render(<App />);
  }
}
mount();
