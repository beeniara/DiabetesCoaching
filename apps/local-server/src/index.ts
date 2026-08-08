import express from "express";
import cors from "cors";
import { requireLocalServerAuth } from "./auth.js";
import { handleShelfGpt, handleShelfMock, handleShelfValidate } from "./shelf.js";
import { createRequestId, writeAuditEvent } from "./audit.js";
import { isOpenAiConfigured, SHELF_ANALYSIS_SYSTEM_INSTRUCTIONS } from "./gpt4o.js";

const app = express();
app.use((req, res, next) => {
  const requestId = req.header("x-request-id") ?? createRequestId();
  res.setHeader("x-request-id", requestId);
  next();
});
app.use(cors({ origin: false })); // Configure an explicit local-app origin before deployment.
app.use(express.json({ limit: "12mb" }));
app.get("/health", (req, res) => {
  void writeAuditEvent({
    at: new Date().toISOString(),
    route: req.path,
    method: req.method,
    outcome: "validated",
    requestId: req.header("x-request-id") ?? "unknown",
    statusCode: 200,
    detail: "Health check"
  });
  return res.json({ status: "ok", service: "local-diabetes-coaching-server", openAiConfigured: isOpenAiConfigured() });
});

app.use("/v1", requireLocalServerAuth);

app.get("/v1/shelf-analysis/instructions", (_req, res) => res.json({
  systemInstructions: SHELF_ANALYSIS_SYSTEM_INSTRUCTIONS,
  openAiConfigured: isOpenAiConfigured()
}));

app.post("/v1/shelf-analysis/validate", handleShelfValidate);
app.post("/v1/shelf-analysis/mock", handleShelfMock);
app.post("/v1/shelf-analysis/gpt", handleShelfGpt);

app.listen(Number(process.env.PORT ?? 8787), "0.0.0.0", () => console.log("Local server listening on port 8787"));
