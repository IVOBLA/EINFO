import { useEffect, useMemo, useState } from "react";
import { initRolePolicy, canEditApp } from "../auth/roleUtils";

function short30(s) {
  const t = (s ?? "").toString();
  return t.length > 30 ? t.slice(0, 30) + "…" : t;
}

export default function ProtokollOverview() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    (async () => {
      try { await initRolePolicy(); setCanEdit(canEditApp("protokoll")); } catch { setCanEdit(false); }
    })();
    (async () => {
      try {
        const r = await fetch("/api/protocol", { credentials: "include" }).then(res => res.json());
        setData(Array.isArray(r?.items) ? r.items : []);
      } catch {
        setData([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const rows = useMemo(
    () => [...data].sort((a, b) => (Number(b.nr) || 0) - (Number(a.nr) || 0)),
    [data]
  );

return (
  <div className="p-3 md:p-4 max-w-[1400px] mx-auto h-full flex flex-col">
    {/* Kopf */}
    <div className="flex items-center justify-between gap-2 mb-3">
      <h1 className="text-xl md:text-2xl font-bold">Meldungsübersicht</h1>
      <div className="flex items-center gap-2">
        <a
          href="/api/protocol/csv/file"
          className="px-3 py-1.5 rounded-md border bg-white"
          title="protocol.csv herunterladen"
        >
          CSV
        </a>
        <button
          onClick={() => {
            if (!canEdit) return;
            window.location.hash = "/protokoll/neu";
          }}
          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
          title={canEdit ? undefined : "Keine Berechtigung (Meldestelle)"}
        >
          + Eintrag anlegen
        </button>
      </div>
    </div>

    {/* Tabelle */}
    <div className="flex-1 overflow-auto border rounded-lg bg-white">
      {loading ? (
        <div className="p-4 text-gray-500">Lade…</div>
      ) : (
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold border-b">
              <th style={{ width: 70 }} className="text-center" title="Druckanzahl">Drucke</th>
              <th style={{ width: 60 }}>NR</th>
              <th style={{ width: 110 }}>Datum</th>
              <th style={{ width: 80 }}>Zeit</th>
              <th style={{ width: 120 }}>Kanal</th>
              <th style={{ width: 110 }}>Richtung</th>
              <th style={{ width: 160 }}>An/Von</th>
              <th>Information</th>
              <th style={{ width: 260 }}>Meldungstyp</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-2">
            {rows.map((r) => {
              const u = r?.uebermittlungsart || {};
              const kanal = u.kanal ?? u.kanalNr ?? u.art ?? "";
              const richtungen = []
                .concat(u.ein ? "Eingang" : [])
                .concat(u.aus ? "Ausgang" : []);
              const richtung = richtungen.join(" / ");
              const printCount = Math.max(0, Number(r?.printCount) || 0);
              const printed = printCount > 0;
              const massnahmen = Array.isArray(r?.massnahmen) ? r.massnahmen : [];
              const relevantMeasures = massnahmen.filter((m) => {
                const text = `${m?.massnahme ?? ""} ${m?.verantwortlich ?? ""}`.trim();
                return text.length > 0;
              });
              const openTasks = relevantMeasures.some((m) => !m?.done);
              const confirmation = r?.otherRecipientConfirmation || {};
              const confirmedRole = String(confirmation?.byRole || "").toUpperCase();
              const confirmedByLtStbOrS3 = !!confirmation?.confirmed && (confirmedRole === "LTSTB" || confirmedRole === "S3");
              const showPrintCircle = openTasks || confirmedByLtStbOrS3;
              const printTitleParts = [`${printCount}× gedruckt`];
              if (openTasks) {
                printTitleParts.push("Offene Aufgaben vorhanden");
              } else if (confirmedByLtStbOrS3) {
                const label = confirmedRole === "LTSTB" ? "LtStb" : confirmedRole;
                printTitleParts.push(`Bestätigt durch ${label}`);
              }
              const printTitle = printTitleParts.join(" • ");
              const printCircleClass = openTasks
                ? "border-red-500 text-red-600"
                : "border-emerald-500 text-emerald-600";
              return (
                <tr
                  key={r.nr}
                  className="border-b align-top hover:bg-gray-50 cursor-pointer"
                  onClick={() => { window.location.hash = `/protokoll/edit/${r.nr}`; }}
                  title="Zum Bearbeiten öffnen"
                >
                  <td className="align-middle text-center">
                    {showPrintCircle ? (
                      <span
                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-semibold ${printCircleClass}`}
                        title={printTitle}
                        aria-label={printTitle}
                      >
                        {printCount}
                      </span>
                    ) : (
                      <span className="inline-block min-w-[2ch] text-sm font-semibold" title={printTitle} aria-label={printTitle}>
                        {printCount}
                      </span>
                    )}
                  </td>
                  <td className="font-semibold">{r.nr}</td>
                  <td>{r.datum}</td>
                  <td>{r.zeit}</td>
                  <td title={kanal}>{kanal}</td>
                  <td title={richtung}>{richtung}</td>
                  <td>{r.anvon}</td>
                  <td className="whitespace-pre-wrap">{short30(r.information)}</td>
                  <td className="whitespace-pre-wrap">{r.infoTyp || "—"}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="p-4 text-gray-500 italic">— keine Einträge —</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  </div>
);

}
