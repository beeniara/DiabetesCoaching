import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { requireLocalServerAuth } from "./auth.js";
import { createRequestId, recordAuditEvent } from "./audit.js";
import { SHELF_ANALYSIS_SYSTEM_INSTRUCTIONS } from "./gpt4o.js";
import { getShelfAiProvider, isShelfAiConfigured } from "./shelf-ai.js";
import { handleShelfGpt, handleShelfMock, handleShelfValidate } from "./shelf.js";

function allowedOrigins() {
  return (process.env.LOCAL_SERVER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function createRateLimiter() {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const windowMs = 60000;
  const maxRequests = Math.max(10, Number.parseInt(process.env.LOCAL_SERVER_RATE_LIMIT_PER_MINUTE ?? "60", 10) || 60);
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      res.setHeader("retry-after", Math.ceil((bucket.resetAt - now) / 1000).toString());
      return res.status(429).json({ error: "RATE_LIMITED", message: "Too many local-server requests. Retry later." });
    }
    return next();
  };
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const presentedId = req.header("x-request-id")?.trim();
    const requestId = presentedId && /^[A-Za-z0-9_-]{1,80}$/.test(presentedId) ? presentedId : createRequestId();
    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    next();
  });
  const origins = allowedOrigins();
  app.use(cors({
    origin: origins.length > 0 ? origins : false,
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization", "content-type", "x-request-id", "x-local-api-key"],
    maxAge: 600
  }));
  app.use(express.json({ limit: "9mb", strict: true }));

  app.get("/health", (req, res) => {
    recordAuditEvent({
      at: new Date().toISOString(),
      route: req.path,
      method: req.method,
      outcome: "validated",
      requestId: res.locals.requestId,
      statusCode: 200,
      detail: "Health check"
    });
    return res.json({ status: "ok", service: "local-diabetes-coaching-server", aiProvider: getShelfAiProvider(), aiConfigured: isShelfAiConfigured() });
  });

  app.use("/v1", createRateLimiter(), requireLocalServerAuth);
  app.get("/v1/shelf-analysis/instructions", (_req, res) => res.json({
    systemInstructions: SHELF_ANALYSIS_SYSTEM_INSTRUCTIONS,
    aiProvider: getShelfAiProvider(),
    aiConfigured: isShelfAiConfigured()
  }));
  app.post("/v1/shelf-analysis/validate", handleShelfValidate);
  app.post("/v1/shelf-analysis/mock", handleShelfMock);
  app.post("/v1/shelf-analysis/gpt", handleShelfGpt);

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    if (status === 413) return res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
    if (error instanceof SyntaxError) return res.status(400).json({ error: "INVALID_JSON" });
    return res.status(500).json({ error: "SERVER_ERROR" });
  });

  return app;
}
