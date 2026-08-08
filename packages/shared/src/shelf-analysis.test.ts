import { describe, expect, it } from "vitest";
import { createMockShelfAnalysis, formatShelfAnalysisSummary, ShelfAnalysisSchema } from "./shelf-analysis";

describe("shelf analysis helpers", () => {
  it("creates a valid mock shelf analysis response", () => {
    const analysis = createMockShelfAnalysis({ caption: "snack shelf photo", photoUri: "file:///tmp/photo.jpg" });
    expect(ShelfAnalysisSchema.parse(analysis).schemaVersion).toBe("1.0");
    expect(analysis.items[0].label).toContain("Snack");
    expect(formatShelfAnalysisSummary(analysis)).toContain("Confirm labels");
  });
});
