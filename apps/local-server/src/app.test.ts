import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { redactAuditDetail } from "./audit.js";

const TEST_TOKEN = "test-token-with-at-least-24-characters";

afterEach(() => {
  delete process.env.LOCAL_SERVER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LOCAL_SERVER_ALLOWED_ORIGINS;
});

describe("local server", () => {
  it("returns a privacy-safe health response and security headers", async () => {
    const response = await request(createApp()).get("/health").set("x-request-id", "bad id with spaces").expect(200);
    expect(response.body).toEqual({ status: "ok", service: "local-diabetes-coaching-server", openAiConfigured: false });
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toMatch(/^req_/);
  });

  it("fails closed when the local token is missing or too short", async () => {
    await request(createApp()).post("/v1/shelf-analysis/mock").send({ caption: "snack" }).expect(503);
    process.env.LOCAL_SERVER_API_KEY = "short";
    await request(createApp()).post("/v1/shelf-analysis/mock").set("authorization", "Bearer short").send({ caption: "snack" }).expect(503);
  });

  it("uses authenticated, schema-bounded mock analysis", async () => {
    process.env.LOCAL_SERVER_API_KEY = TEST_TOKEN;
    await request(createApp()).post("/v1/shelf-analysis/mock").set("authorization", "Bearer wrong-token-with-at-least-24").send({ caption: "snack" }).expect(401);
    const response = await request(createApp()).post("/v1/shelf-analysis/mock").set("authorization", `Bearer ${TEST_TOKEN}`).send({ caption: "snack" }).expect(200);
    expect(response.body.schemaVersion).toBe("1.0");
    await request(createApp()).post("/v1/shelf-analysis/mock").set("authorization", `Bearer ${TEST_TOKEN}`).send({ caption: "x".repeat(501) }).expect(422);
  });

  it("rejects malformed shelf payloads and unconfigured GPT calls", async () => {
    process.env.LOCAL_SERVER_API_KEY = TEST_TOKEN;
    await request(createApp()).post("/v1/shelf-analysis/validate").set("authorization", `Bearer ${TEST_TOKEN}`).send({ safetyNotice: "wrong" }).expect(422);
    await request(createApp()).post("/v1/shelf-analysis/gpt").set("authorization", `Bearer ${TEST_TOKEN}`).send({ photoDataUrl: "data:image/jpeg;base64,AAAA" }).expect(503);
  });

  it("allows only explicitly configured browser origins", async () => {
    process.env.LOCAL_SERVER_ALLOWED_ORIGINS = "https://local.example";
    const response = await request(createApp()).get("/health").set("origin", "https://local.example").expect(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://local.example");
  });

  it("redacts tokens, images, and email-like identifiers from audit details", () => {
    const redacted = redactAuditDetail("Bearer secret.token data:image/jpeg;base64,AAAA user@example.com");
    expect(redacted).toBe("Bearer [redacted] [image redacted] [email redacted]");
  });
});
