import type { NextFunction, Request, Response } from "express";
import { writeAuditEvent } from "./audit.js";

function readPresentedToken(req: Request) {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return req.header("x-local-api-key")?.trim();
}

export function requireLocalServerAuth(req: Request, res: Response, next: NextFunction) {
  const configuredToken = process.env.LOCAL_SERVER_API_KEY?.trim();
  const requestId = req.header("x-request-id") ?? "unknown";

  if (!configuredToken) {
    res.setHeader("x-local-server-auth", "disabled");
    void writeAuditEvent({
      at: new Date().toISOString(),
      route: req.path,
      method: req.method,
      outcome: "blocked",
      requestId,
      statusCode: 503,
      detail: "LOCAL_SERVER_API_KEY is not configured."
    });
    return res.status(503).json({
      error: "AUTH_NOT_CONFIGURED",
      message: "Set LOCAL_SERVER_API_KEY on the local server before using protected endpoints."
    });
  }

  const presentedToken = readPresentedToken(req);
  if (!presentedToken || presentedToken !== configuredToken) {
    void writeAuditEvent({
      at: new Date().toISOString(),
      route: req.path,
      method: req.method,
      outcome: "blocked",
      requestId,
      statusCode: 401,
      detail: "Missing or invalid local server token."
    });
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  res.setHeader("x-local-server-auth", "ok");
  next();
}
