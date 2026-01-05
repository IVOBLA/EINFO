// ============================================================
// NEUES FILE: /einfo/scripts/prepare_addresses_for_rag.js
// ============================================================
// Dieses Script wandelt die CSV-Adressdateien in RAG-optimierte
// Markdown-Dokumente um, gruppiert nach Ort/PLZ.
//
// WARUM:
// - Embeddings funktionieren besser mit natürlichem Text
// - Gruppierung reduziert Chunk-Anzahl drastisch (8000 → ~50)
// - Kontext bleibt erhalten ("Adresse in Reichenau")
// ============================================================

import fs from 'fs';
import path from 'path';

// Konfiguration
const INPUT_GEBAEUDE = './knowledge/gebaeude_mit_adresse_feldkirchen.txt';
const INPUT_PRIVAT = './knowledge/privatadressen_feldkirchen.txt';
const OUTPUT_DIR = './knowledge/adressen';

// CSV Parser (einfach, ohne externe Abhängigkeit)
function parseCSV(content, hasHeader = true) {
    const lines = content.trim().split('\n');
    const headers = hasHeader ? lines[0].split(',') : null;
    const data = [];
    
    for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (headers) {
            const obj = {};
            headers.forEach((h, idx) => {
                obj[h.trim()] = values[idx]?.trim() || '';
            });
            data.push(obj);
        } else {
            data.push(values);
        }
    }
    return data;
}

// Adresse in natürlichen Text umwandeln
function formatAdresse(row, isGebaeude = false) {
    let parts = [];
    
    if (isGebaeude) {
        // Gebäude-Format
        const strasse = row.ADDR_STRASSE || '';
        const nummer = row.ADDR_HAUSNUMMER || '';
        const plz = row.ADDR_PLZ || '';
        const ort = row.ADDR_ORT || '';
        const name = row.NAME || '';
        const typ = row.BUILDING || '';
        
        // Vollständige Adresse bauen
        let adresse = '';
        if (strasse && nummer) {
            adresse = `${strasse} ${nummer}`;
        } else if (nummer) {
            adresse = `Nr. ${nummer}`;
        }
        
        if (plz || ort) {
            adresse += adresse ? `, ${plz} ${ort}`.trim() : `${plz} ${ort}`.trim();
        }
        
        // Mit Koordinaten für Notfalleinsätze
        const lat = row.LAT;
        const lon = row.LON;
        
        if (name) {
            parts.push(`- **${name}**: ${adresse} (${lat}, ${lon})`);
            if (typ && typ !== 'yes') {
                parts[0] += ` [${typ}]`;
            }
        } else if (adresse) {
            parts.push(`- ${adresse} (${lat}, ${lon})`);
        }
    } else {
        // Privatadressen-Format
        const strasse = row.STRASSE || '';
        const nummer = row.HAUSNUMMER || '';
        const plz = row.PLZ || '';
        const ort = row.ORT || '';
        const lat = row.LAT;
        const lon = row.LON;
        
        let adresse = '';
        if (strasse && nummer) {
            adresse = `${strasse} ${nummer}`;
        } else if (nummer) {
            adresse = `Nr. ${nummer}`;
        }
        
        if (plz || ort) {
            adresse += adresse ? `, ${plz} ${ort}`.trim() : `${plz} ${ort}`.trim();
        }
        
        if (adresse) {
            parts.push(`- ${adresse} (${lat}, ${lon})`);
        }
    }
    
    return parts.join('');
}

// Hauptfunktion
async function prepareAddresses() {
    // Output-Verzeichnis erstellen
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    // === GEBÄUDE VERARBEITEN ===
    console.log('Verarbeite Gebäude...');
    const gebaeudeContent = fs.readFileSync(INPUT_GEBAEUDE, 'utf-8');
    const gebaeude = parseCSV(gebaeudeContent);
    
    // Nach Ort gruppieren
    const gebaeudeByOrt = {};
    gebaeude.forEach(row => {
        const ort = row.ADDR_ORT || 'Unbekannt';
        const plz = row.ADDR_PLZ || '';
        const key = `${plz}_${ort}`.replace(/\s+/g, '_');
        
        if (!gebaeudeByOrt[key]) {
            gebaeudeByOrt[key] = {
                ort: ort,
                plz: plz,
                adressen: [],
                benannteGebaeude: []
            };
        }
        
        const formatted = formatAdresse(row, true);
        if (formatted) {
            if (row.NAME) {
                gebaeudeByOrt[key].benannteGebaeude.push(formatted);
            } else {
                gebaeudeByOrt[key].adressen.push(formatted);
            }
        }
    });
    
    // === PRIVATADRESSEN VERARBEITEN ===
    console.log('Verarbeite Privatadressen...');
    const privatContent = fs.readFileSync(INPUT_PRIVAT, 'utf-8');
    const privat = parseCSV(privatContent);
    
    const privatByOrt = {};
    privat.forEach(row => {
        const ort = row.ORT || 'Unbekannt';
        const plz = row.PLZ || '';
        const key = `${plz}_${ort}`.replace(/\s+/g, '_');
        
        if (!privatByOrt[key]) {
            privatByOrt[key] = {
                ort: ort,
                plz: plz,
                adressen: []
            };
        }
        
        const formatted = formatAdresse(row, false);
        if (formatted) {
            privatByOrt[key].adressen.push(formatted);
        }
    });
    
    // === MARKDOWN-DATEIEN GENERIEREN ===
    console.log('Generiere Markdown-Dateien...');
    
    // Alle Orte sammeln
    const alleOrte = new Set([
        ...Object.keys(gebaeudeByOrt),
        ...Object.keys(privatByOrt)
    ]);
    
    let stats = { files: 0, gebaeude: 0, privat: 0 };
    
    for (const key of alleOrte) {
        const geb = gebaeudeByOrt[key] || { ort: '', plz: '', adressen: [], benannteGebaeude: [] };
        const priv = privatByOrt[key] || { ort: '', plz: '', adressen: [] };
        
        const ort = geb.ort || priv.ort;
        const plz = geb.plz || priv.plz;
        
        // Mindestens einige Adressen müssen vorhanden sein
        const total = geb.adressen.length + geb.benannteGebaeude.length + priv.adressen.length;
        if (total < 1) continue;
        
        // Markdown generieren
        let md = `# Adressen in ${ort}`;
        if (plz) md += ` (PLZ ${plz})`;
        md += '\n\n';
        md += `Bezirk Feldkirchen, Kärnten, Österreich\n\n`;
        
        // Wichtige/benannte Gebäude zuerst
        if (geb.benannteGebaeude.length > 0) {
            md += `## Wichtige Gebäude und Einrichtungen\n\n`;
            md += geb.benannteGebaeude.join('\n') + '\n\n';
            stats.gebaeude += geb.benannteGebaeude.length;
        }
        
        // Alle Gebäudeadressen
        if (geb.adressen.length > 0) {
            md += `## Gebäudeadressen\n\n`;
            md += geb.adressen.join('\n') + '\n\n';
            stats.gebaeude += geb.adressen.length;
        }
        
        // Privatadressen
        if (priv.adressen.length > 0) {
            md += `## Weitere Adressen\n\n`;
            md += priv.adressen.join('\n') + '\n\n';
            stats.privat += priv.adressen.length;
        }
        
        // Datei schreiben
        const filename = `adressen_${key.toLowerCase()}.md`;
        fs.writeFileSync(path.join(OUTPUT_DIR, filename), md, 'utf-8');
        stats.files++;
    }
    
    // Übersichtsdatei erstellen
    const uebersicht = `# Adressverzeichnis Bezirk Feldkirchen

Dieses Verzeichnis enthält alle Adressen im Bezirk Feldkirchen, Kärnten.

## Statistik
- **Dateien**: ${stats.files}
- **Gebäudeadressen**: ${stats.gebaeude}
- **Weitere Adressen**: ${stats.privat}
- **Gesamt**: ${stats.gebaeude + stats.privat}

## Verwendung
Für Adressabfragen im Einsatzfall. Koordinaten (LAT, LON) sind für 
GPS-Navigation und Kartenintegration verfügbar.

## Orte
${Array.from(alleOrte).sort().map(k => `- ${k.replace(/_/g, ' ')}`).join('\n')}
`;
    
    fs.writeFileSync(path.join(OUTPUT_DIR, '_uebersicht.md'), uebersicht, 'utf-8');
    
    console.log('\n=== FERTIG ===');
    console.log(`Dateien erstellt: ${stats.files}`);
    console.log(`Gebäudeadressen: ${stats.gebaeude}`);
    console.log(`Weitere Adressen: ${stats.privat}`);
    console.log(`Output: ${OUTPUT_DIR}/`);
}

prepareAddresses().catch(console.error);
