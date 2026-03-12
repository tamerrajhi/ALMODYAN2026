import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const requestSchema = z.object({
  username: z.string().trim().min(1).max(50).regex(/^[a-z0-9_\.\-]+$/i),
  fullName: z.string().trim().min(1).max(120),
  password: z.string().min(6).max(200),
  customRoleId: z.string().uuid().optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
});

type RequestPayload = z.infer<typeof requestSchema>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return json(401, { error: "Unauthorized" });

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Validate caller
    const { data: caller, error: callerErr } = await adminClient.auth.getUser(token);
    if (callerErr || !caller?.user) return json(401, { error: "Unauthorized" });

    // Must be admin
    const { data: isAdmin, error: roleErr } = await adminClient
      .rpc("has_role", { _user_id: caller.user.id, _role: "admin" });

    if (roleErr) return json(500, { error: "Failed to validate role" });
    if (!isAdmin) return json(403, { error: "Forbidden" });

    const payload = requestSchema.parse(await req.json()) as RequestPayload;

    const normalizedUsername = payload.username.toLowerCase().replace(/\s+/g, "");
    const emailToUse = payload.email && payload.email.length > 0
      ? payload.email
      : `${normalizedUsername}_${Date.now()}@temp.local`;

    // Ensure username not taken
    const { data: existing } = await adminClient
      .from("profiles")
      .select("id")
      .ilike("username", normalizedUsername)
      .maybeSingle();

    if (existing) return json(409, { error: "username_exists" });

    // Create auth user without switching the caller session
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: emailToUse,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        full_name: payload.fullName,
      },
    });

    if (createErr || !created.user) {
      return json(400, { error: createErr?.message ?? "create_failed" });
    }

    const newUserId = created.user.id;

    // Update profile username + (optionally) store original email input
    await adminClient
      .from("profiles")
      .update({
        username: normalizedUsername,
        full_name: payload.fullName,
        email: emailToUse,
      })
      .eq("user_id", newUserId);

    // Assign custom role if provided
    if (payload.customRoleId) {
      await adminClient.from("user_custom_roles").insert({ 
        user_id: newUserId, 
        role_id: payload.customRoleId 
      });
    }

    return json(200, { success: true, userId: newUserId });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return json(400, { error: "validation_error", details: e.flatten() });
    }
    console.error("admin-create-user error", e);
    return json(500, { error: "server_error" });
  }
});
