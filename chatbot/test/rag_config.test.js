import { describe, it, expect } from "vitest";
import {
  normalizeRagConfig,
  mergeTaskRagConfig,
  getDefaultRagForTask,
  DEFAULT_RAG_CONFIG,
  DEFAULT_RAG_BY_TASK
} from "../server/config.js";

describe("normalizeRagConfig", () => {
  it("returns defaults for null/undefined input", () => {
    expect(normalizeRagConfig(null)).toEqual(DEFAULT_RAG_CONFIG);
    expect(normalizeRagConfig(undefined)).toEqual(DEFAULT_RAG_CONFIG);
    expect(normalizeRagConfig("invalid")).toEqual(DEFAULT_RAG_CONFIG);
  });

  it("returns defaults for empty object", () => {
    const result = normalizeRagConfig({});
    expect(result).toEqual(DEFAULT_RAG_CONFIG);
  });

  it("preserves valid values", () => {
    const input = {
      enabled: false,
      knowledgeTopK: 15,
      knowledgeMaxChars: 5000,
      knowledgeScoreThreshold: 0.5,
      knowledgeUseMMR: false,
      sessionTopK: 10,
      sessionMaxChars: 2000,
      disasterSummaryMaxLength: 3000,
      totalMaxChars: 15000
    };
    const result = normalizeRagConfig(input);
    expect(result).toEqual(input);
  });

  it("clamps knowledgeTopK to 0..100", () => {
    expect(normalizeRagConfig({ knowledgeTopK: -5 }).knowledgeTopK).toBe(0);
    expect(normalizeRagConfig({ knowledgeTopK: 150 }).knowledgeTopK).toBe(100);
    expect(normalizeRagConfig({ knowledgeTopK: 50 }).knowledgeTopK).toBe(50);
  });

  it("clamps sessionTopK to 0..100", () => {
    expect(normalizeRagConfig({ sessionTopK: -1 }).sessionTopK).toBe(0);
    expect(normalizeRagConfig({ sessionTopK: 200 }).sessionTopK).toBe(100);
  });

  it("clamps knowledgeScoreThreshold to 0..1", () => {
    expect(normalizeRagConfig({ knowledgeScoreThreshold: -0.5 }).knowledgeScoreThreshold).toBe(0);
    expect(normalizeRagConfig({ knowledgeScoreThreshold: 2.0 }).knowledgeScoreThreshold).toBe(1);
    expect(normalizeRagConfig({ knowledgeScoreThreshold: 0.75 }).knowledgeScoreThreshold).toBe(0.75);
  });

  it("clamps maxChars fields to 0..50000", () => {
    expect(normalizeRagConfig({ knowledgeMaxChars: -100 }).knowledgeMaxChars).toBe(0);
    expect(normalizeRagConfig({ knowledgeMaxChars: 60000 }).knowledgeMaxChars).toBe(50000);
    expect(normalizeRagConfig({ sessionMaxChars: 99999 }).sessionMaxChars).toBe(50000);
    expect(normalizeRagConfig({ totalMaxChars: -1 }).totalMaxChars).toBe(0);
    expect(normalizeRagConfig({ disasterSummaryMaxLength: 100000 }).disasterSummaryMaxLength).toBe(50000);
  });

  it("handles NaN / non-numeric values by falling back to defaults", () => {
    expect(normalizeRagConfig({ knowledgeTopK: "abc" }).knowledgeTopK).toBe(DEFAULT_RAG_CONFIG.knowledgeTopK);
    expect(normalizeRagConfig({ knowledgeMaxChars: NaN }).knowledgeMaxChars).toBe(DEFAULT_RAG_CONFIG.knowledgeMaxChars);
    expect(normalizeRagConfig({ knowledgeScoreThreshold: "xyz" }).knowledgeScoreThreshold).toBe(DEFAULT_RAG_CONFIG.knowledgeScoreThreshold);
  });

  it("preserves boolean enabled field", () => {
    expect(normalizeRagConfig({ enabled: false }).enabled).toBe(false);
    expect(normalizeRagConfig({ enabled: true }).enabled).toBe(true);
    // non-boolean falls back to default
    expect(normalizeRagConfig({ enabled: "yes" }).enabled).toBe(DEFAULT_RAG_CONFIG.enabled);
  });

  it("preserves boolean knowledgeUseMMR field", () => {
    expect(normalizeRagConfig({ knowledgeUseMMR: false }).knowledgeUseMMR).toBe(false);
    expect(normalizeRagConfig({ knowledgeUseMMR: true }).knowledgeUseMMR).toBe(true);
  });
});

describe("mergeTaskRagConfig", () => {
  it("returns normalized base when override is null", () => {
    const base = { knowledgeTopK: 10, knowledgeMaxChars: 5000 };
    const result = mergeTaskRagConfig(base, null);
    expect(result.knowledgeTopK).toBe(10);
    expect(result.knowledgeMaxChars).toBe(5000);
    // Missing fields filled from defaults
    expect(result.enabled).toBe(DEFAULT_RAG_CONFIG.enabled);
    expect(result.sessionTopK).toBe(DEFAULT_RAG_CONFIG.sessionTopK);
  });

  it("override values take precedence", () => {
    const base = { knowledgeTopK: 10, sessionTopK: 5 };
    const override = { knowledgeTopK: 20, sessionTopK: 15 };
    const result = mergeTaskRagConfig(base, override);
    expect(result.knowledgeTopK).toBe(20);
    expect(result.sessionTopK).toBe(15);
  });

  it("override values are clamped", () => {
    const base = {};
    const override = { knowledgeTopK: 999, knowledgeScoreThreshold: 5.0 };
    const result = mergeTaskRagConfig(base, override);
    expect(result.knowledgeTopK).toBe(100);
    expect(result.knowledgeScoreThreshold).toBe(1);
  });

  it("override does not remove base values when missing", () => {
    const base = { knowledgeTopK: 10, sessionMaxChars: 2000 };
    const override = { knowledgeTopK: 15 };
    const result = mergeTaskRagConfig(base, override);
    expect(result.knowledgeTopK).toBe(15);
    expect(result.sessionMaxChars).toBe(2000);
  });
});

describe("getDefaultRagForTask", () => {
  it("returns task-specific defaults for known tasks", () => {
    const sqDefaults = getDefaultRagForTask("situation-question");
    expect(sqDefaults.knowledgeTopK).toBe(12);
    expect(sqDefaults.knowledgeMaxChars).toBe(8000);
    expect(sqDefaults.totalMaxChars).toBe(12000);
  });

  it("returns base defaults for unknown tasks", () => {
    const unknownDefaults = getDefaultRagForTask("unknown-task");
    expect(unknownDefaults).toEqual(DEFAULT_RAG_CONFIG);
  });

  it("merges task defaults with base (retains base values not overridden)", () => {
    const chatDefaults = getDefaultRagForTask("chat");
    expect(chatDefaults.knowledgeTopK).toBe(6);
    // enabled and knowledgeUseMMR come from base
    expect(chatDefaults.enabled).toBe(true);
    expect(chatDefaults.knowledgeUseMMR).toBe(true);
    expect(chatDefaults.knowledgeScoreThreshold).toBe(DEFAULT_RAG_CONFIG.knowledgeScoreThreshold);
  });

  it("has valid defaults for all defined task types", () => {
    for (const taskType of Object.keys(DEFAULT_RAG_BY_TASK)) {
      const defaults = getDefaultRagForTask(taskType);
      expect(defaults.enabled).toBe(true);
      expect(defaults.knowledgeTopK).toBeGreaterThan(0);
      expect(defaults.totalMaxChars).toBeGreaterThan(0);
    }
  });
});

describe("RAG config integration", () => {
  it("enabled=false should be preserved through normalize", () => {
    const config = normalizeRagConfig({ enabled: false });
    expect(config.enabled).toBe(false);
    // Other values still have defaults
    expect(config.knowledgeTopK).toBe(DEFAULT_RAG_CONFIG.knowledgeTopK);
  });

  it("merge preserves enabled=false override", () => {
    const result = mergeTaskRagConfig(
      { enabled: true, knowledgeTopK: 10 },
      { enabled: false }
    );
    expect(result.enabled).toBe(false);
    expect(result.knowledgeTopK).toBe(10);
  });
});
