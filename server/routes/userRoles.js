// server/routes/userRoles.js
import { Router } from "express";
import fs from "fs/promises";
import path from "path";

export default function userRolesRouter({ dataDir }) {
  const router = Router();
  const ROLES_FILE = path.join(dataDir, "User_roles.json");

  const APP_LEVELS = new Set(["none", "view", "edit"]);

  function parseCapToken(t) {
    if (!t) return null;
    const m = String(t).trim().match(/^([a-z0-9_-]+)[:.]([a-z]+)$/i);
    if (!m) return null;
    const app = m[1].toLowerCase();
    const level = m[2].toLowerCase();
    if (!APP_LEVELS.has(level)) return null;
    return { app, level };
  }
  function capsToApps(caps = []) {
    const out = {};
    for (const c of caps) {
      const p = parseCapToken(c);
      if (!p) continue;
      const cur = out[p.app];
      out[p.app] = (cur === "edit" || p.level === "edit") ? "edit" : p.level;
    }
    return out;
  }
  function toRoleObj(r) {
    if (typeof r === "string") return { id: r, label: r, apps: {} };
    const id   = r?.id ?? r?.label ?? "";
    const apps = r?.apps && Object.keys(r.apps).length ? { ...r.apps } : capsToApps(r?.capabilities || []);
    // nur gültige Level
    for (const k of Object.keys(apps)) if (!APP_LEVELS.has(apps[k])) delete apps[k];
    return { id, label: r?.label ?? id, apps };
  }
  async function readRolesVAny() {
    try {
      const txt = await fs.readFile(ROLES_FILE, "utf8");
      const raw = JSON.parse(txt);
      const rolesArr = Array.isArray(raw) ? raw : (Array.isArray(raw?.roles) ? raw.roles : []);
      return rolesArr.map(toRoleObj);
    } catch {
      return [];
    }
  }
  async function writeRolesV2(roles) {
    const payload = { v: 2, roles: roles.map(toRoleObj) };
    await fs.mkdir(path.dirname(ROLES_FILE), { recursive: true });
    await fs.writeFile(ROLES_FILE, JSON.stringify(payload, null, 2), "utf8");
  }

  // GET /api/user/roles
  router.get("/roles", async (_req, res) => {
    try {
      const roles = await readRolesVAny();
      res.set("Cache-Control", "no-store");
      res.status(200).json({ roles });
    } catch (e) {
      res.status(500).json({ error: "roles_not_available", detail: String(e?.message || e) });
    }
  });

  // PUT /api/user/roles
  router.put("/roles", async (req, res) => {
    try {
      const incoming = Array.isArray(req.body?.roles) ? req.body.roles : [];
      let roles = incoming.map(toRoleObj).filter(r => r.id);

      // Admin-Schutz: Admin immer vorhanden, mindestens 'edit' auf allen bekannten Apps
      if (!roles.some(r => r.id === "Admin")) {
        const knownApps = new Set();
        roles.forEach(r => Object.keys(r.apps || {}).forEach(a => knownApps.add(a)));
        if (knownApps.size === 0) ["einsatzboard", "aufgabenboard", "protokoll"].forEach(a => knownApps.add(a));
        roles.unshift({
          id: "Admin",
          label: "Administrator",
          apps: Object.fromEntries([...knownApps].map(a => [a, "edit"]))
        });
      }

      await writeRolesV2(roles);
      res.status(200).json({ v: 2, roles });
    } catch (e) {
      res.status(500).json({ error: "roles_write_failed", detail: String(e?.message || e) });
    }
  });

  return router;
}
