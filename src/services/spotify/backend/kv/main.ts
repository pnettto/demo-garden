import { Context, Hono } from "hono";
import { serveStatic } from "hono/deno";
const kv = Deno.env.get("DENO_DEPLOYMENT_ID")
  ? await Deno.openKv() // Deno Deploy
  : await Deno.openKv("./db/kv.db"); // Docker

export async function listEntries(c: Context) {
  const entries = [];
  const iter = kv.list({ prefix: [] }, { consistency: "strong" });
  for await (const entry of iter) {
    entries.push(entry);
  }
  console.log(`[KV-GUI] Listed ${entries.length} total entries.`);
  return c.json(entries);
}

export async function setEntry(c: Context) {
  const { key, value } = await c.req.json();
  if (!Array.isArray(key)) {
    return c.json({ error: "Key must be an array" }, 400);
  }
  await kv.set(key, value);
  return c.json({ success: true });
}

export async function deleteEntry(c: Context) {
  const { key } = await c.req.json();
  if (!Array.isArray(key)) {
    return c.json({ error: "Key must be an array" }, 400);
  }
  await kv.delete(key);
  return c.json({ success: true });
}

export function registerKvRoutes(app: Hono) {
  app.get("/kv/api/entries", listEntries);
  app.post("/kv/api/entries", setEntry);
  app.delete("/kv/api/entries", deleteEntry);
  app.use(
    "/kv/*",
    serveStatic({
      root: "./kv",
      rewriteRequestPath: (path: string) => path.replace(/^\/kv/, ""),
    }),
  );
}
