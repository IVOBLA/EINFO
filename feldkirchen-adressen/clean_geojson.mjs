import fs from "fs";

const inFile = "./bezirk_feldkirchen.geojson";
const outFile = "./bezirk_feldkirchen_clean.geojson";

let s = fs.readFileSync(inFile, "utf8").trim();

// Falls mehrere JSONs hintereinander drin sind: nur bis zum ersten gültigen JSON schneiden
// (häufigster Fall: am Ende hängt noch was dran)
function tryParsePrefix(str) {
  // suche die Position, an der das erste vollständige JSON endet:
  // wir zählen Klammern und stoppen bei Balance=0
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];

    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    } else {
      if (c === '"') { inString = true; continue; }
      if (c === "{") depth++;
      if (c === "}") depth--;
      if (depth === 0 && i > 0) {
        const candidate = str.slice(0, i + 1).trim();
        try {
          return JSON.parse(candidate);
        } catch {}
      }
    }
  }
  throw new Error("Konnte kein gültiges JSON-Objekt am Anfang der Datei finden.");
}

let obj;
try {
  obj = JSON.parse(s);
} catch {
  obj = tryParsePrefix(s);
}

fs.writeFileSync(outFile, JSON.stringify(obj));
console.log("OK -> geschrieben:", outFile);
