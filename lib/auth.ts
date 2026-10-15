// Acesso de usuário único: senha (APP_PASSWORD) + cookie de sessão assinado com HMAC (SESSION_SECRET).
// Em desenvolvimento local (STORE=file) sem APP_PASSWORD definido, o acesso fica liberado.
const COOKIE = "bolsa_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const sessionCookieName = COOKIE;
export const sessionMaxAge = MAX_AGE_S;

/** Só em desenvolvimento local, sem senha e com armazenamento em arquivos. Em produção o acesso NUNCA fica aberto. */
export function authDisabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.APP_PASSWORD && process.env.STORE !== "supabase";
}

export async function makeSession(): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Defina SESSION_SECRET");
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  return `${exp}.${await hmac(secret, String(exp))}`;
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  if (authDisabled()) return true;
  const secret = process.env.SESSION_SECRET;
  if (!secret || !value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = await hmac(secret, exp);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(input: string): Promise<boolean> {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return false;
  // comparação em tempo constante
  const a = await hmac("pw", input), b = await hmac("pw", pw);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
