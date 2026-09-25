import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockShelfAnalysis } from "../../../packages/shared/src/shelf-analysis.js";
import { createApp } from "./app.js";
import { redactAuditDetail } from "./audit.js";

const TEST_TOKEN = "test-token-with-at-least-24-characters";

afterEach(() => {
  delete process.env.LOCAL_SERVER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LOCAL_SERVER_ALLOWED_ORIGINS;
  delete process.env.LOCAL_SERVER_AUDIT_LOG;
  delete process.env.SHELF_AI_PROVIDER;
  delete process.env.OLLAMA_URL;
  delete process.env.OLLAMA_SHELF_MODEL;
  vi.unstubAllGlobals();
});

describe("local server", () => {
  it("returns a privacy-safe health response and security headers", async () => {
    const response = await request(createApp()).get("/health").set("x-request-id", "bad id with spaces").expect(200);
    expect(response.body).toEqual({ status: "ok", service: "local-diabetes-coaching-server", aiProvider: "openai", aiConfigured: false });
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

  describe("local Ollama shelf analysis", () => {
    const PHOTO_BASE64 = "U0VDUkVUUEhPVE8=";
    const photoDataUrl = `data:image/jpeg;base64,${PHOTO_BASE64}`;

    function useOllama(reply: () => Promise<Response>) {
      process.env.LOCAL_SERVER_API_KEY = TEST_TOKEN;
      process.env.SHELF_AI_PROVIDER = "ollama";
      const fetchMock = vi.fn(reply);
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    const ollamaMessage = (content: string, status = 200) => async () =>
      new Response(JSON.stringify({ message: { role: "assistant", content } }), { status, headers: { "content-type": "application/json" } });

    const analyze = (caption = "cereal shelf") =>
      request(createApp()).post("/v1/shelf-analysis/gpt").set("authorization", `Bearer ${TEST_TOKEN}`).send({ caption, photoDataUrl });

    it("reports the selected provider", async () => {
      process.env.SHELF_AI_PROVIDER = "ollama";
      const response = await request(createApp()).get("/health").expect(200);
      expect(response.body).toMatchObject({ aiProvider: "ollama", aiConfigured: true });
    });

    it("sends the photo to the local model with the strict schema and returns a validated analysis", async () => {
      const analysis = createMockShelfAnalysis({ caption: "cereal shelf" });
      const fetchMock = useOllama(ollamaMessage(JSON.stringify(analysis)));
      const response = await analyze().expect(200);
      expect(response.body).toEqual(analysis);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:11434/api/chat");
      const sent = JSON.parse(String(init.body));
      expect(sent).toMatchObject({ model: "qwen2.5vl:7b", stream: false, options: { temperature: 0 } });
      expect(sent.format.required).toEqual(["schemaVersion", "items", "limitations", "safetyNotice"]);
      expect(sent.messages[1].images).toEqual([PHOTO_BASE64]);
      expect(sent.messages[0].content).toContain("Do not diagnose");
    });

    it("honours a custom Ollama URL and model", async () => {
      process.env.OLLAMA_URL = "http://192.168.1.20:11434/";
      process.env.OLLAMA_SHELF_MODEL = "gemma3:4b";
      const fetchMock = useOllama(ollamaMessage(JSON.stringify(createMockShelfAnalysis({}))));
      await analyze().expect(200);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://192.168.1.20:11434/api/chat");
      expect(JSON.parse(String(init.body)).model).toBe("gemma3:4b");
    });

    it("rejects model output that is not valid JSON or does not match the schema", async () => {
      useOllama(ollamaMessage("Here is your analysis: lots of sugar"));
      expect((await analyze().expect(422)).body.error).toBe("INVALID_GPT_RESPONSE");
      useOllama(ollamaMessage(JSON.stringify({ schemaVersion: "1.0", items: [], limitations: [], safetyNotice: "ok" })));
      await analyze().expect(422);
      useOllama(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
      await analyze().expect(422);
    });

    it("fails safely when Ollama is not running or the model is not installed", async () => {
      useOllama(async () => { throw new TypeError("fetch failed"); });
      expect((await analyze().expect(502)).body.message).toContain("Ollama is running");
      useOllama(ollamaMessage("model not found", 404));
      await analyze().expect(502);
    });

    it("fails closed on an invalid OLLAMA_URL", async () => {
      const fetchMock = useOllama(ollamaMessage("{}"));
      for (const value of ["ftp://192.168.1.20", "http://user:pass@192.168.1.20:11434", "not a url"]) {
        process.env.OLLAMA_URL = value;
        expect((await analyze().expect(503)).body.message).toContain("OLLAMA_URL");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never writes the photo or caption to the audit log", async () => {
      const dir = await mkdtemp(join(tmpdir(), "audit-"));
      process.env.LOCAL_SERVER_AUDIT_LOG = join(dir, "audit.jsonl");
      useOllama(ollamaMessage(JSON.stringify(createMockShelfAnalysis({}))));
      await analyze("my private caption").expect(200);
      await vi.waitFor(async () => expect(await readFile(process.env.LOCAL_SERVER_AUDIT_LOG!, "utf8")).toContain("Ollama shelf analysis validated"));
      const log = await readFile(process.env.LOCAL_SERVER_AUDIT_LOG!, "utf8");
      expect(log).not.toContain(PHOTO_BASE64);
      expect(log).not.toContain("my private caption");
    });
  });
});
