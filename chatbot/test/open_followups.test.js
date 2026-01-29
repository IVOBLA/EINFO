import { describe, it, expect } from "vitest";
import { identifyOpenFollowUps } from "../server/sim_loop.js";

describe("identifyOpenFollowUps", () => {
  it("erkennt nr16-like Einträge mit externem Empfänger aus anvon", () => {
    const entry = {
      id: "1",
      nr: "16",
      datum: "2024-01-01",
      zeit: "10:00",
      uebermittlungsart: { aus: true },
      anvon: "An: Einsatzleitung",
      ergehtAn: ["LtStb"],
      information: "Benötigen wir Unterstützung?",
      rueckmeldung1: "",
      createdBy: "S2"
    };

    const result = identifyOpenFollowUps([entry]);

    expect(result).toHaveLength(1);
    expect(result[0].externalRecipients).toContain("Einsatzleitung");
    expect(result[0].ergehtAn).toEqual(["Einsatzleitung", "LtStb"]);
  });

  it("erkennt nr23-like Einträge mit externen Empfängern aus anvon oder ergehtAn", () => {
    const entry = {
      id: "2",
      nr: "23",
      datum: "2024-01-01",
      zeit: "11:00",
      uebermittlungsart: { aus: true },
      anvon: "An: Gemeinde",
      ergehtAn: ["EL"],
      information: "Könnt ihr Fahrzeuge bereitstellen?",
      rueckmeldung1: "",
      createdBy: "S3"
    };

    const result = identifyOpenFollowUps([entry]);

    expect(result).toHaveLength(1);
    expect(result[0].externalRecipients).toEqual(
      expect.arrayContaining(["Gemeinde", "EL"])
    );
  });

  it("filtert Einträge mit gesetzter Rueckmeldung", () => {
    const entry = {
      id: "3",
      nr: "16",
      datum: "2024-01-01",
      zeit: "10:00",
      uebermittlungsart: { aus: true },
      anvon: "An: Einsatzleitung",
      ergehtAn: ["LtStb"],
      information: "Benötigen wir Unterstützung?",
      rueckmeldung1: "pending",
      createdBy: "S2"
    };

    const result = identifyOpenFollowUps([entry]);

    expect(result).toHaveLength(0);
  });

  it("filtert Einträge, wenn alle Empfänger intern sind", () => {
    const entry = {
      id: "4",
      nr: "24",
      datum: "2024-01-01",
      zeit: "12:00",
      uebermittlungsart: { aus: true },
      anvon: "An: S2",
      ergehtAn: ["LTSTB"],
      information: "Müssen wir noch etwas klären?",
      rueckmeldung1: "",
      createdBy: "S4"
    };

    const result = identifyOpenFollowUps([entry]);

    expect(result).toHaveLength(0);
  });
});
