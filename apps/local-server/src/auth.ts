import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { recordAuditEvent } from "./audit.js";

function readPresentedToken(req: Request) {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return req.header("x-local-api-key")?.trim();
}

export function requireLocalServerAuth(req: Request, res: Response, next: NextFunction) {
  const configuredToken = process.env.LOCAL_SERVER_API_KEY?.trim();
  const requestId = typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";

  if (!configuredToken || configuredToken.length < 24) {
    res.setHeader("x-local-server-auth", "disabled");
    recordAuditEvent({
      at: new Date().toISOString(),
      route: req.path,
      method: req.method,
      outcome: "blocked",
      requestId,
      statusCode: 503,
      detail: "LOCAL_SERVER_API_KEY is missing or too short."
    });
    return res.status(503).json({
      error: "AUTH_NOT_CONFIGURED",
      message: "Set LOCAL_SERVER_API_KEY to a random token of at least 24 characters before using protected endpoints."
    });
  }

  const presentedToken = readPresentedToken(req);
  const presentedBuffer = Buffer.from(presentedToken ?? "");
  const configuredBuffer = Buffer.from(configuredToken);
  const tokenMatches = presentedBuffer.length === configuredBuffer.length && timingSafeEqual(presentedBuffer, configuredBuffer);
  if (!tokenMatches) {
    recordAuditEvent({
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
