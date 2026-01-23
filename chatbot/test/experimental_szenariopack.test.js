import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEinfo = (activeRoles = []) => {
  vi.doMock("../server/einfo_io.js", () => ({
    readEinfoInputs: vi.fn(async () => ({
      roles: { active: activeRoles, missing: [] },
      board: [],
      aufgaben: [],
      protokoll: []
    }))
  }));
};

describe("Experimental ScenarioPack", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.EINFO_EXPERIMENTAL_SCENARIOPACK;
  });

  it("Adapter nutzt ohne ENV-Flag die bestehenden Exporte", async () => {
    const base = await import("../server/sim_loop.js");
    const adapter = await import("../server/experimental_szenariopack/api/sim_loop_adapter.js");
    expect(adapter.stepSimulation).toBe(base.stepSimulation);
  });

  it("Engine erzeugt pro Tick mindestens Protokoll + Aufgabe", async () => {
    mockEinfo([]);
    const { startSimulation, stepSimulation } = await import(
      "../server/experimental_szenariopack/api/sim_loop_szenariopack.js"
    );
    await startSimulation();
    const result = await stepSimulation();
    expect(result.ok).toBe(true);
    expect(result.operations.protokoll.create.length).toBeGreaterThan(0);
    expect(result.operations.aufgaben.create.length).toBeGreaterThan(0);
  });

  it("NLU-Heuristik erkennt Wetterabfrage", async () => {
    const { parseHeuristik } = await import("../server/experimental_szenariopack/nlu/heuristik.js");
    const result = parseHeuristik("Wie wird das Wetter?");
    expect(result.absicht).toBe("WETTER_ABFRAGE");
  });

  it("User-Plan beeinflusst Verlauf (Trigger bei Pegel >= 460)", async () => {
    mockEinfo([]);
    const { startSimulation, stepSimulation, handleUserFreitext } = await import(
      "../server/experimental_szenariopack/api/sim_loop_szenariopack.js"
    );
    await startSimulation();
    await handleUserFreitext({
      role: "USER",
      text: "Wenn Pegel >= 460 dann Evak vorbereiten"
    });

    let triggered = false;
    for (let i = 0; i < 40; i += 1) {
      const result = await stepSimulation();
      const tasks = result.operations.aufgaben.create;
      if (tasks.some((task) => String(task.title).toLowerCase().includes("evak"))) {
        triggered = true;
        break;
      }
    }

    expect(triggered).toBe(true);
  });

  it("ActiveRoles-Schutz: keine Operationen für aktive Rollen oder Meldestelle", async () => {
    mockEinfo(["S2", "LTSTB", "MS"]);
    const { startSimulation, stepSimulation } = await import(
      "../server/experimental_szenariopack/api/sim_loop_szenariopack.js"
    );
    await startSimulation();
    const result = await stepSimulation();
    const ops = result.operations;

    const activeSet = new Set(["S2", "LTSTB", "MS"]);
    const roleFields = [
      ...ops.aufgaben.create.map((task) => task.assignedBy),
      ...ops.aufgaben.create.map((task) => task.responsible),
      ...ops.protokoll.create.map((entry) => entry.anvon)
    ].filter(Boolean);

    for (const role of roleFields) {
      expect(activeSet.has(String(role).toUpperCase())).toBe(false);
      expect(String(role).toUpperCase()).not.toContain("MELDESTELLE");
      expect(String(role).toUpperCase()).not.toBe("MS");
    }
  });
});
