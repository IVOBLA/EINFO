export function createSituationQuestionHandler({ answerQuestion, logError, isAnalysisInProgress }) {
  return async (req, res) => {
    try {
      // NEU: Prüfe ob KI-Analyse läuft (LLM-Lock)
      if (isAnalysisInProgress && isAnalysisInProgress()) {
        return res.status(503).json({
          ok: false,
          error: "KI-Analyse läuft gerade - bitte warten",
          analysisInProgress: true
        });
      }

      const body = req.body || {};
      const question = body.question;
      const role = body.role ?? req.query?.role;
      const context = body.context;
      const contentType = req.headers?.["content-type"];
      const bodyKeys = body ? Object.keys(body) : [];

      if (process.env.DEBUG_SITUATION === "1" || !question) {
        console.log(
          `[Situation Question] content-type=${contentType} bodyKeys=${bodyKeys.join(",")}`
        );
      }

      if (!question) {
        return res.status(400).json({
          ok: false,
          error: "question fehlt",
          debug: {
            bodyType: typeof req.body,
            bodyKeys,
            hasQuestion: "question" in body,
            contentType,
          },
        });
      }

      if (!role) {
        return res.status(400).json({ ok: false, error: "role fehlt" });
      }

      // bbox aus Request (optional, überschreibt scenario_config bbox)
      const requestBbox = Array.isArray(body.bbox) && body.bbox.length === 4
        ? body.bbox
        : null;

      const answer = await answerQuestion(question, role, context || "aufgabenboard", requestBbox);

      if (answer.error) {
        return res.status(answer.isActive === false ? 503 : 500).json({
          ok: false,
          ...answer,
        });
      }

      return res.json({ ok: true, ...answer });
    } catch (err) {
      logError("Situationsfrage Fehler", { error: String(err) });
      return res.status(500).json({ ok: false, error: String(err) });
    }
  };
}

/**
 * SSE-Streaming endpoint for situation questions.
 * Events: meta, token, done, error
 */
export function createSituationQuestionStreamHandler({ answerQuestion, logError, isAnalysisInProgress }) {
  return async (req, res) => {
    const body = req.body || {};
    const question = body.question;
    const role = body.role ?? req.query?.role;
    const context = body.context;

    // Validate BEFORE setting SSE headers (so errors are normal JSON)
    if (isAnalysisInProgress && isAnalysisInProgress()) {
      return res.status(503).json({
        ok: false,
        error: "KI-Analyse läuft gerade - bitte warten",
        analysisInProgress: true
      });
    }

    if (!question) {
      return res.status(400).json({ ok: false, error: "question fehlt" });
    }

    if (!role) {
      return res.status(400).json({ ok: false, error: "role fehlt" });
    }

    // bbox aus Request (optional)
    const requestBbox = Array.isArray(body.bbox) && body.bbox.length === 4
      ? body.bbox
      : null;

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const taskType = "situation-question";
    const questionId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    function sendSSE(event, data) {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Client disconnected
      }
    }

    // Send meta event
    sendSSE("meta", { questionId, role, taskType });

    let clientDisconnected = false;
    req.on("close", () => { clientDisconnected = true; });

    try {
      const result = await answerQuestion(question, role, context || "aufgabenboard", requestBbox, {
        onToken: (token) => {
          if (!clientDisconnected) {
            sendSSE("token", { t: token });
          }
        }
      });

      if (result.error) {
        sendSSE("error", { message: result.error, details: result.details });
      } else {
        sendSSE("done", {
          questionId: result.questionId || questionId,
          question: result.question,
          answer: result.answer,
          sources: result.sources,
          confidence: result.confidence,
          timestamp: result.timestamp,
          role: result.role,
          ragUsed: result.ragUsed
        });
      }
    } catch (err) {
      logError("Situationsfrage Stream Fehler", { error: String(err) });
      sendSSE("error", { message: String(err) });
    }

    res.end();
  };
}
