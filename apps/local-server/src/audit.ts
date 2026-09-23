import { appendFile } from "node:fs/promises";

export type AuditOutcome = "allowed" | "blocked" | "validated" | "failed";

export type AuditEvent = {
  at: string;
  route: string;
  method: string;
  outcome: AuditOutcome;
  requestId: string;
  statusCode: number;
  detail: string;
};

export function redactAuditDetail(detail: string) {
  return detail
    .replaceAll(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replaceAll(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[image redacted]")
    .replaceAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email redacted]");
}

export function formatAuditEventLine(event: AuditEvent) {
  return JSON.stringify({
    ...event,
    detail: redactAuditDetail(event.detail)
  });
}

export async function writeAuditEvent(event: AuditEvent) {
  const path = process.env.LOCAL_SERVER_AUDIT_LOG;
  if (!path) return;
  await appendFile(path, `${formatAuditEventLine(event)}\n`, { encoding: "utf8" });
}

export function recordAuditEvent(event: AuditEvent) {
  void writeAuditEvent(event).catch(() => {
    console.error("Local server audit write failed.");
  });
}

export function createRequestId() {
  return `req_${crypto.randomUUID()}`;
}
