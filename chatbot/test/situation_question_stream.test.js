import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createJsonBodyParser } from "../server/middleware/jsonBodyParser.js";
import { createSituationQuestionHandler, createSituationQuestionStreamHandler } from "../server/routes/situationQuestion.js";

describe("Situation Question Stream Endpoint", () => {
  let server;
  let baseUrl;
  const tokenChunks = ["Hello", " ", "World", "!"];

  beforeAll(async () => {
    const app = express();
    app.use(createJsonBodyParser());

    // Standard JSON endpoint (unchanged)
    app.post(
      "/api/situation/question",
      createSituationQuestionHandler({
        answerQuestion: async () => ({
          answer: "test answer",
          questionId: "q-1",
          question: "test",
          sources: [],
          confidence: 0.8,
          timestamp: Date.now(),
          role: "LTSTB",
          ragUsed: true
        }),
        logError: () => {},
      })
    );

    // SSE Stream endpoint
    app.post(
      "/api/situation/question/stream",
      createSituationQuestionStreamHandler({
        answerQuestion: async (_q, _r, _c, _b, options) => {
          // Simulate streaming tokens
          if (options?.onToken) {
            for (const chunk of tokenChunks) {
              options.onToken(chunk);
            }
          }
          return {
            answer: tokenChunks.join(""),
            questionId: "q-stream-1",
            question: "test stream",
            sources: [{ type: "knowledge", fileName: "test.txt", relevance: 90 }],
            confidence: 0.85,
            timestamp: Date.now(),
            role: "LTSTB",
            ragUsed: true
          };
        },
        logError: () => {},
      })
    );

    server = app.listen(0);
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("returns text/event-stream content type", async () => {
    const response = await fetch(`${baseUrl}/api/situation/question/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Test", role: "LTSTB" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("emits meta, token, and done events", async () => {
    const response = await fetch(`${baseUrl}/api/situation/question/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Test", role: "LTSTB" }),
    });

    const text = await response.text();

    // Check meta event
    expect(text).toContain("event: meta");
    expect(text).toContain('"role"');
    expect(text).toContain('"taskType"');

    // Check token events
    expect(text).toContain("event: token");
    expect(text).toContain('"t"');

    // Check done event
    expect(text).toContain("event: done");
    expect(text).toContain('"answer"');
    expect(text).toContain('"sources"');
    expect(text).toContain('"confidence"');
  });

  it("returns 400 when question is missing", async () => {
    const response = await fetch(`${baseUrl}/api/situation/question/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "LTSTB" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("question");
  });

  it("returns 400 when role is missing", async () => {
    const response = await fetch(`${baseUrl}/api/situation/question/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Test" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("role");
  });

  it("returns 503 JSON when analysis is in progress", async () => {
    const app2 = express();
    app2.use(createJsonBodyParser());
    app2.post(
      "/api/situation/question/stream",
      createSituationQuestionStreamHandler({
        answerQuestion: async () => ({}),
        logError: () => {},
        isAnalysisInProgress: () => true,
      })
    );

    const server2 = app2.listen(0);
    const { port } = server2.address();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/situation/question/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "Test", role: "LTSTB" }),
      });

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.analysisInProgress).toBe(true);
    } finally {
      await new Promise((resolve) => server2.close(resolve));
    }
  });

  it("emits error event when answerQuestion returns error", async () => {
    const app3 = express();
    app3.use(createJsonBodyParser());
    app3.post(
      "/api/situation/question/stream",
      createSituationQuestionStreamHandler({
        answerQuestion: async () => ({ error: "Testfehler", details: "details" }),
        logError: () => {},
      })
    );

    const server3 = app3.listen(0);
    const { port } = server3.address();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/situation/question/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "Test", role: "LTSTB" }),
      });

      expect(response.status).toBe(200); // SSE always 200 after headers
      const text = await response.text();
      expect(text).toContain("event: error");
      expect(text).toContain("Testfehler");
    } finally {
      await new Promise((resolve) => server3.close(resolve));
    }
  });

  // Legacy JSON endpoint still works
  it("legacy JSON endpoint still works", async () => {
    const response = await fetch(`${baseUrl}/api/situation/question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Test", role: "LTSTB" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.answer).toBe("test answer");
    expect(data.questionId).toBe("q-1");
  });
});
