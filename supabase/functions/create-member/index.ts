// create-member: the only way to add a member (public sign-up is off). A
// studio admin gives an email and tier (and optionally a name) on the
// Members page; the member is invited by email, and the link brings them to
// the site to choose a password. The tier (and name) go into the new
// profile through the on_auth_user_created trigger.
//
// Deploy: supabase functions deploy create-member --project-ref qudgpawfxtfxbkpunrdy
import { createClient } from "npm:@supabase/supabase-js@2";

const TIERS = ["tier_1", "tier_2", "tier_3"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;

  // Only studio admins can create accounts. Ask the database as the caller.
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin, error: adminError } = await caller.rpc("is_admin");
  if (adminError || !isAdmin) return reply(403, { error: "not_admin" });

  const { email, full_name, tier } = await req.json().catch(() => ({}));
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  const cleanName = String(full_name ?? "").trim().slice(0, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || !TIERS.includes(tier)) {
    return reply(400, { error: "invalid_input" });
  }

  // The invite link lands on the members page, which sends invited members
  // on to set a password. The origin is already an allowed redirect URL.
  const origin = req.headers.get("Origin") ?? "https://eastvillagepottery.com";
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
    data: { tier, ...(cleanName && { full_name: cleanName }) },
    redirectTo: `${origin}/members/`,
  });

  if (error) {
    console.error(error);
    const code = error.code === "email_exists" || /already/i.test(error.message)
      ? "email_exists"
      : error.status === 429 || error.code?.startsWith("over_")
        ? "rate_limited"
        : "invite_failed";
    return reply(code === "invite_failed" ? 500 : 400, { error: code });
  }
  return reply(200, { id: data.user.id, email: cleanEmail });
});
