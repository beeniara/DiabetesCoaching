import assert from "node:assert/strict";
import test from "node:test";
import { requireLocalServerAuth } from "../src/auth.js";

function createResponse() {
  return {
    headers: {} as Record<string, string>,
    statusCode: 200,
    payload: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    }
  };
}

test("blocks requests when auth is missing", () => {
  const previous = process.env.LOCAL_SERVER_API_KEY;
  process.env.LOCAL_SERVER_API_KEY = "secret";
  const req = {
    path: "/v1/shelf-analysis/mock",
    method: "POST",
    header: (name: string) => (name === "x-request-id" ? "req-1" : undefined)
  } as any;
  const res = createResponse();
  let called = false;

  requireLocalServerAuth(req, res as any, () => {
    called = true;
  });

  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers["x-local-server-auth"], undefined);
  process.env.LOCAL_SERVER_API_KEY = previous;
});

test("allows requests with a matching bearer token", () => {
  const previous = process.env.LOCAL_SERVER_API_KEY;
  process.env.LOCAL_SERVER_API_KEY = "secret";
  const req = {
    path: "/v1/shelf-analysis/mock",
    method: "POST",
    header: (name: string) => {
      if (name === "authorization") return "Bearer secret";
      if (name === "x-request-id") return "req-2";
      return undefined;
    }
  } as any;
  const res = createResponse();
  let called = false;

  requireLocalServerAuth(req, res as any, () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(res.headers["x-local-server-auth"], "ok");
  process.env.LOCAL_SERVER_API_KEY = previous;
});
