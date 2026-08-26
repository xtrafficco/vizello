import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { escapeHtml, internalAppLink, json, text, readJson } from "../_shared/security.ts";

const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
const emailFrom = Deno.env.get("EMAIL_FROM") ?? "";
const appUrl = Deno.env.get("APP_URL") ?? "";
const webhookSecret = Deno.env.get("WEBHOOK_SECRET") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null;

Deno.serve(async (req) => {
  if (req.method !== "POST") return text("method not allowed", 405);
  if (!resendKey || !emailFrom || !appUrl || !webhookSecret || !admin) return text("not configured", 503);
  if (req.headers.get("x-webhook-secret") !== webhookSecret) return text("unauthorized", 401);
  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) return text("unsupported media type", 415);
  try {
    const payload = await readJson(req);
    const notification = payload?.record ?? payload;
    if (!notification || typeof notification.user_id !== "string") return text("bad request", 400);
    const { data, error } = await admin.auth.admin.getUserById(notification.user_id);
    if (error) throw error;
    const to = data.user?.email;
    if (!to) return json({ status: "no_email" });
    const link = internalAppLink(appUrl, notification.link);
    const title = String(notification.titulo ?? "Nova notificação").slice(0, 160);
    const body = String(notification.corpo ?? "").slice(0, 4000);
    const html = "<div style=\"font-family:system-ui,sans-serif;max-width:520px;margin:auto\">" +
      "<div style=\"background:#0f2b3d;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:800\">🏢 Vizello</div>" +
      "<div style=\"border:1px solid #e3ebf0;border-top:0;border-radius:0 0 12px 12px;padding:20px\">" +
      "<h2 style=\"margin:0 0 8px;color:#12232e\">" + escapeHtml(title) + "</h2>" +
      (body ? "<p style=\"color:#5f7683;line-height:1.5;white-space:pre-line\">" + escapeHtml(body) + "</p>" : "") +
      "<a href=\"" + escapeHtml(link) + "\" style=\"display:inline-block;margin-top:12px;background:#0f6f8c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700\">Abrir no app</a>" +
      "</div></div>";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from: emailFrom, to, subject: title, html }),
    });
    if (!response.ok) {
      console.error("resend failed", response.status);
      return text("retry later", 502);
    }
    return json({ status: "sent" });
  } catch (error) {
    console.error("email dispatch failed", error instanceof Error ? error.name : "unknown");
    return text("retry later", 500);
  }
});
