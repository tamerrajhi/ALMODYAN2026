import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const requestSchema = z.object({
  userId: z.string().uuid(),
});

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

    const payload = requestSchema.parse(await req.json());

    // Prevent self-deletion
    if (payload.userId === caller.user.id) {
      return json(400, { error: "cannot_delete_self" });
    }

    // Delete related data first (handled by cascade but let's be explicit)
    // user_roles, user_custom_roles, user_branches, permissions, profiles will be deleted by cascade
    
    // Delete the auth user (this will cascade to related tables)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(payload.userId);

    if (deleteError) {
      console.error("Delete user error:", deleteError);
      return json(400, { error: deleteError.message });
    }

    console.log(`User ${payload.userId} deleted by admin ${caller.user.id}`);

    return json(200, { success: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return json(400, { error: "validation_error", details: e.flatten() });
    }
    console.error("admin-delete-user error", e);
    return json(500, { error: "server_error" });
  }
});
