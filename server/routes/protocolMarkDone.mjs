 import fs from "fs";
 import path from "path";
 import { fileURLToPath } from "url";
 const __filename = fileURLToPath(import.meta.url);
 const __dirname  = path.dirname(__filename);
 const DATA_DIR   = path.resolve(__dirname, "..", "data"); // => <repo>/server/data
 const JSON_FILE  = path.join(DATA_DIR, "protocol.json");

export async function markResponsibleDone(nr, roleId){
  try{
    const arr = JSON.parse(fs.readFileSync(JSON_FILE,"utf8"));
    const i   = arr.findIndex(x => Number(x?.nr) === Number(nr));
    if (i < 0) return;
    const it  = arr[i];
    if (Array.isArray(it.massnahmen)) {
      for (const m of it.massnahmen) {
        if (String(m?.verantwortlich||"").toUpperCase() === String(roleId).toUpperCase()) {
          m.done = true;
        }
      }
    }
    arr[i] = it;
    fs.writeFileSync(JSON_FILE, JSON.stringify(arr,null,2), "utf8");
  }catch{}
}
