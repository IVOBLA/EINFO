export function createSituationQuestionHandler({ answerQuestion, logError }) {
  return async (req, res) => {
    try {
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

      const answer = await answerQuestion(question, role, context || "aufgabenboard");

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
