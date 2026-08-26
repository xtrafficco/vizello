import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// The publishable key is safe to ship to the browser. Never put a service-role
// key in this file: database access is enforced by Supabase RLS policies.
export const SUPABASE_URL = "https://bklvbhsaxcmrnjxjbzjh.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7ci7VKQf-aUPvfpckRhK9A_fRmf8JQa";
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const PROTECTED_PREFIXES = [
  "/admin",
  "/imobiliaria",
  "/morador-imob",
  "/proprietario",
  "/pagamento",
  "/condominio",
  "/morador",
  "/sindico",
  "/portaria",
];

function isProtectedPath(pathname) {
  return PROTECTED_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function safeNext(value) {
  if (!value || typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin || !isProtectedPath(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_) {
    return null;
  }
}

export function requestedPath() {
  return safeNext(new URLSearchParams(location.search).get("next"));
}

export function roleForPath(pathname) {
  const path = String(pathname || "").split(/[?#]/, 1)[0];
  if (path === "/morador" || path.startsWith("/morador/")) return "morador";
  if (path === "/sindico" || path.startsWith("/sindico/")) return "sindico";
  if (path === "/portaria" || path.startsWith("/portaria/")) return "portaria";
  return null;
}

export function redirectToLogin(next = `${location.pathname}${location.search}${location.hash}`) {
  const login = new URL("/login", location.origin);
  const target = safeNext(next);
  if (target && target !== "/login") login.searchParams.set("next", target);
  location.replace(`${login.pathname}${login.search}`);
}

// getUser() performs a network check, so this is safe to use as an auth gate.
// Never treat an unverified local session as authorization for protected UI.
export async function getAuthenticatedUser() {
  const { data, error } = await supabase.auth.getUser();
  return { user: data?.user || null, error: error || null };
}

export async function requireAuth() {
  const { user } = await getAuthenticatedUser();
  if (user) return user;
  redirectToLogin();
  return null;
}
