// server/utils/initialsetup.mjs
// Extracted initial-setup logic (delete CSVs + copy from initial/).
// Reused by admin maintenance route and protocol stab/hochfahren endpoint.

import path from "path";
import fs from "fs/promises";

const isDataFile = (f) => /\.(csv|json)$/i.test(f);
const toLowerSet = (arr) => new Set(arr.map((s) => String(s).toLowerCase()));
const SKIP_DIRS = toLowerSet(["archive", "initial", "user", "conf"]);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

async function collectDataFiles(root, skipDirs) {
  const result = [];
  async function walk(current, rel = "") {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const abs = path.join(current, e.name);
      const relPath = path.join(rel, e.name);
      if (e.isDirectory()) {
        if (skipDirs.has(e.name.toLowerCase())) continue;
        await walk(abs, relPath);
      } else if (e.isFile()) {
        if (isDataFile(e.name)) result.push({ abs, rel: relPath });
      }
    }
  }
  await walk(root, "");
  return result;
}

async function deleteCsvFiles(root, skipDirs = SKIP_DIRS) {
  let deleted = 0;
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const abs = path.join(current, e.name);
      if (e.isDirectory()) {
        if (skipDirs.has(e.name.toLowerCase())) continue;
        await walk(abs);
      } else if (e.isFile()) {
        if (e.name.toLowerCase().endsWith(".csv")) {
          try { await fs.unlink(abs); deleted++; } catch {}
        }
      }
    }
  }
  await walk(root);
  return deleted;
}

/**
 * Runs the initial-setup: deletes CSVs in dataDir, then copies all files
 * from dataDir/initial back into dataDir.
 *
 * @param {{ dataDir: string }} options
 * @returns {Promise<{ deletedCount: number, copiedCount: number }>}
 */
export async function runInitialSetup({ dataDir }) {
  const baseDir = path.resolve(dataDir);
  const initialDir = path.join(baseDir, "initial");

  await ensureDir(baseDir);
  await ensureDir(initialDir);

  const deletedCount = await deleteCsvFiles(baseDir);

  // Copy ALL (csv+json) from initial/
  const files = await collectDataFiles(initialDir, toLowerSet([]));
  for (const f of files) {
    const dest = path.join(baseDir, f.rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(f.abs, dest);
  }

  return { deletedCount, copiedCount: files.length };
}
