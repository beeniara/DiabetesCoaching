import express from "express";
import cors from "cors";
import { ShelfAnalysisSchema } from "../../../packages/shared/src/shelf-analysis.js";

const app = express();
app.use(cors({ origin: false })); // Configure an explicit local-app origin before deployment.
app.use(express.json({ limit: "12mb" }));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "local-diabetes-coaching-server" }));

app.post("/v1/shelf-analysis/validate", (req, res) => {
  const parsed = ShelfAnalysisSchema.safeParse(req.body);
  if (!parsed.success) return res.status(422).json({ error: "INVALID_SHELF_ANALYSIS", details: parsed.error.flatten() });
  return res.json(parsed.data);
});

app.listen(Number(process.env.PORT ?? 8787), "0.0.0.0", () => console.log("Local server listening on port 8787"));
