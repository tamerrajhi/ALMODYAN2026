import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    if (!isAdmin) return json(403, { error: "Forbidden - Admin only" });

    const { password = "123456" } = await req.json();

    // Get all active custom roles
    const { data: roles, error: rolesErr } = await adminClient
      .from("custom_roles")
      .select("id, role_name, role_name_en")
      .eq("is_active", true)
      .order("role_name");

    if (rolesErr) return json(500, { error: "Failed to fetch roles" });

    const results: { role: string; username: string; status: string; error?: string }[] = [];

    for (const role of roles || []) {
      // Create username from role_name_en (convert to lowercase, replace spaces with underscores)
      const baseUsername = (role.role_name_en || role.role_name)
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      
      const username = baseUsername;
      const email = `${username}@system.local`;
      const fullName = role.role_name;

      try {
        // Check if username already exists
        const { data: existing } = await adminClient
          .from("profiles")
          .select("id")
          .ilike("username", username)
          .maybeSingle();

        if (existing) {
          results.push({ role: role.role_name, username, status: "skipped", error: "User already exists" });
          continue;
        }

        // Create auth user
        const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
          },
        });

        if (createErr || !created.user) {
          results.push({ role: role.role_name, username, status: "error", error: createErr?.message || "Create failed" });
          continue;
        }

        const newUserId = created.user.id;

        // Update profile with username
        await adminClient
          .from("profiles")
          .update({
            username,
            full_name: fullName,
            email,
          })
          .eq("user_id", newUserId);

        // Assign custom role
        await adminClient.from("user_custom_roles").insert({
          user_id: newUserId,
          role_id: role.id,
        });

        results.push({ role: role.role_name, username, status: "created" });
      } catch (e) {
        results.push({ role: role.role_name, username, status: "error", error: String(e) });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const errors = results.filter(r => r.status === "error").length;

    return json(200, {
      success: true,
      summary: { total: results.length, created, skipped, errors },
      results,
    });
  } catch (e) {
    console.error("bulk-create-role-users error", e);
    return json(500, { error: "server_error", details: String(e) });
  }
});
