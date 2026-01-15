import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createJsonBodyParser } from "../server/middleware/jsonBodyParser.js";
import { createSituationQuestionHandler } from "../server/routes/situationQuestion.js";

describe("Situation Question Endpoint", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const app = express();
    app.use(createJsonBodyParser());
    app.post(
      "/api/situation/question",
      createSituationQuestionHandler({
        answerQuestion: async () => ({ answer: "ok", questionId: "q-1" }),
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

  it("akzeptiert Content-Type: application/json", async () => {
    const response = await fetch(`${baseUrl}/api/situation/question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Test", role: "leitung" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.questionId).toBe("q-1");
  });

  it("akzeptiert doppelten Content-Type und role aus query", async () => {
    const response = await fetch(
      `${baseUrl}/api/situation/question?role=leitung`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json, application/json" },
        body: JSON.stringify({ question: "Test" }),
      }
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.questionId).toBe("q-1");
  });
});
