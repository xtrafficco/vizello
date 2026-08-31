// Criptografia AES-GCM para os tokens do Mercado Pago em repouso.
// A chave vem do secret MP_TOKEN_ENC_KEY (base64 de 32 bytes aleatórios).
// Gerar uma chave: `openssl rand -base64 32`
//
// O banco nunca vê o token em texto puro: a edge function cifra antes de
// gravar (encryptSecret) e decifra só na memória quando precisa cobrar
// (decryptSecret). Formato do ciphertext: "v1:" + base64(iv[12] || ct).

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function importKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("MP_TOKEN_ENC_KEY") || "";
  const bytes = b64ToBytes(raw);
  if (bytes.length !== 32) throw new Error("MP_TOKEN_ENC_KEY deve ser base64 de 32 bytes");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) return "";
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return "v1:" + bytesToB64(packed);
}

export async function decryptSecret(payload: string): Promise<string> {
  if (!payload) return "";
  const raw = payload.startsWith("v1:") ? payload.slice(3) : payload;
  const packed = b64ToBytes(raw);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const key = await importKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
