import { applyBboxFilterToLocations } from "./geo_search.js";

const bbox = [10, 10, 20, 20];
const locations = [
  { id: "in-1", type: "address", lat: 12, lon: 12 },
  { id: "in-2", type: "address", lat: 11, lon: 18 },
  { id: "in-3", type: "address", lat: 19, lon: 19 },
  { id: "out-1", type: "address", lat: 9, lon: 12 },
  { id: "out-2", type: "address", lat: 21, lon: 12 },
  { id: "no-geo", type: "address" }
];

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ ${message}`);
}

const filtered = applyBboxFilterToLocations(locations, {
  bbox,
  applyBbox: true,
  docTypes: ["address"]
});

const filteredIds = filtered.map((loc) => loc.id);
assert(filtered.length === 3, "BBOX aktiv: nur 3 Treffer im BBOX-Bereich");
assert(!filteredIds.includes("no-geo"), "BBOX aktiv: Treffer ohne Geo werden verworfen");
assert(filteredIds.includes("in-1") && filteredIds.includes("in-2") && filteredIds.includes("in-3"), "BBOX aktiv: alle In-BBOX Treffer enthalten");

const unfiltered = applyBboxFilterToLocations(locations, {
  bbox,
  applyBbox: false,
  docTypes: ["address"]
});

assert(unfiltered.length === 6, "BBOX inaktiv: alle Treffer bleiben erhalten");

if (!process.exitCode) {
  console.log("🎉 Alle BBOX-Dev-Tests erfolgreich.");
}
