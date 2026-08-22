import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST?.trim() || "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");

createApp().listen(port, host, () => {
  console.log(`Local server listening on ${host}:${port}`);
});
