import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { json, text, readJson } from "../_shared/security.ts";

const publicKey = Deno.env.get("VAPID_PUBLIC") ?? "";
const privateKey = Deno.env.get("VAPID_PRIVATE") ?? "";
const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
const webhookSecret = Deno.env.get("WEBHOOK_SECRET") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null;

if (publicKey && privateKey && subject) webpush.setVapidDetails(subject, publicKey, privateKey);

function safeLink(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^#[a-z][a-z0-9_-]{0,40}$/i.test(raw) ? raw : "#inicio";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return text("method not allowed", 405);
  if (!webhookSecret || !admin || !publicKey || !privateKey || !subject) return text("not configured", 503);
  if (req.headers.get("x-webhook-secret") !== webhookSecret) return text("unauthorized", 401);
  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) return text("unsupported media type", 415);

  try {
    const payload = await readJson(req);
    const notification = payload?.record ?? payload;
    if (!notification || typeof notification.user_id !== "string") return text("bad request", 400);
    const { data: subscriptions, error } = await admin.from("push_subscriptions")
      .select("endpoint,p256dh,auth").eq("user_id", notification.user_id);
    if (error) throw error;
    if (!subscriptions?.length) return json({ status: "no_subscriptions" });
    const body = JSON.stringify({
      title: String(notification.titulo ?? "Vizello").slice(0, 80),
      body: String(notification.corpo ?? "").slice(0, 500),
      link: safeLink(notification.link),
      tag: String(notification.tipo ?? "vizello").slice(0, 80),
    });
    const results = await Promise.allSettled(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, body);
        return "sent";
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
          return "removed";
        }
        throw error;
      }
    }));
    return json({ status: "processed", sent: results.filter((r) => r.status === "fulfilled" && r.value === "sent").length });
  } catch (error) {
    console.error("push dispatch failed", error instanceof Error ? error.name : "unknown");
    return text("retry later", 500);
  }
});
