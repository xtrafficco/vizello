export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const text = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

export function constantTimeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseSignature(value: string) {
  const result: Record<string, string> = {};
  for (const part of value.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timestampFresh(ts: string, maxAgeSeconds = 300): boolean {
  const value = Number(ts);
  return Number.isFinite(value) && Math.abs(Date.now() / 1000 - value) <= maxAgeSeconds;
}

export function internalAppLink(appUrl: string, link: unknown): string {
  const base = new URL(appUrl);
  if (base.protocol !== "https:") throw new Error("APP_URL must use HTTPS");
  const raw = typeof link === "string" ? link.trim() : "";
  if (!raw) return base.toString();
  if (raw.startsWith("#")) {
    if (!/^#[a-z][a-z0-9_-]{0,40}$/i.test(raw)) return base.toString();
    return base.origin + base.pathname + raw;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) return base.toString();
  const target = new URL(raw, base.origin);
  if (target.origin !== base.origin) return base.toString();
  return target.toString();
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[char]
  );
}

export async function readJson(req: Request, maxBytes = 256 * 1024): Promise<any> {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("payload too large");
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("payload too large");
  return raw ? JSON.parse(raw) : {};
}
