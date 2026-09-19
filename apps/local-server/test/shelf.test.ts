import assert from "node:assert/strict";
import test from "node:test";
import { createMockShelfAnalysis } from "../../../packages/shared/src/shelf-analysis.js";
import { handleShelfMock, handleShelfValidate } from "../src/shelf.js";

function createResponse() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
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

test("returns a valid mock shelf analysis", async () => {
  const req = { body: { caption: "snack shelf photo", photoUri: "file:///photo.jpg" }, path: "/v1/shelf-analysis/mock", method: "POST", header: () => "req-1" } as any;
  const res = createResponse();
  await handleShelfMock(req, res as any);
  assert.equal(res.statusCode, 200);
  assert.equal((res.payload as { schemaVersion: string }).schemaVersion, "1.0");
});

test("rejects invalid shelf-analysis payloads", async () => {
  const req = { body: { invalid: true }, path: "/v1/shelf-analysis/validate", method: "POST", header: () => "req-2" } as any;
  const res = createResponse();
  await handleShelfValidate(req, res as any);
  assert.equal(res.statusCode, 422);
});

test("the shared mock analysis helper still returns the strict schema", () => {
  const analysis = createMockShelfAnalysis({ caption: "drink shelf" });
  assert.equal(analysis.schemaVersion, "1.0");
});
