import assert from "node:assert/strict";
import { test } from "vitest";
import { formatAuditEventLine, redactAuditDetail } from "../src/audit.js";

test("redacts bearer tokens from audit details", () => {
  const redacted = redactAuditDetail("token Bearer abc123 and Bearer xyz-456");
  assert.equal(redacted, "token Bearer [redacted] and Bearer [redacted]");
});

test("formats audit events as redacted json lines", () => {
  const line = formatAuditEventLine({
    at: "2026-08-08T10:00:00Z",
    route: "/v1/shelf-analysis/mock",
    method: "POST",
    outcome: "validated",
    requestId: "req-1",
    statusCode: 200,
    detail: "Bearer secret"
  });
  assert.match(line, /Bearer \[redacted\]/);
});
