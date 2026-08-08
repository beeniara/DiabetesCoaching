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

function redactDetail(detail: string) {
  return detail.replaceAll(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}

export async function writeAuditEvent(event: AuditEvent) {
  const line = JSON.stringify({
    ...event,
    detail: redactDetail(event.detail)
  });
  const path = process.env.LOCAL_SERVER_AUDIT_LOG;
  if (!path) return;
  await appendFile(path, `${line}\n`, { encoding: "utf8" });
}

export function createRequestId() {
  return `req_${crypto.randomUUID()}`;
}
