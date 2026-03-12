import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerifyOTPRequest {
  userId: string;
  otpCode: string;
}

const handler = async (req: Request): Promise<Response> => {
  console.log("verify-otp function called");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId, otpCode }: VerifyOTPRequest = await req.json();
    console.log(`Verifying OTP for user ${userId}`);

    // Get the OTP record
    const { data: otpRecord, error: fetchError } = await supabase
      .from("user_otp")
      .select("*")
      .eq("user_id", userId)
      .eq("verified", false)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching OTP:", fetchError);
      throw new Error("Failed to fetch OTP");
    }

    if (!otpRecord) {
      console.log("No OTP found for user");
      return new Response(
        JSON.stringify({ success: false, error: "لم يتم العثور على رمز التحقق" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Check if OTP is expired
    if (new Date(otpRecord.expires_at) < new Date()) {
      console.log("OTP expired");
      // Delete expired OTP
      await supabase.from("user_otp").delete().eq("id", otpRecord.id);
      
      return new Response(
        JSON.stringify({ success: false, error: "انتهت صلاحية رمز التحقق" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Verify OTP code
    if (otpRecord.otp_code !== otpCode) {
      console.log("Invalid OTP code");
      return new Response(
        JSON.stringify({ success: false, error: "رمز التحقق غير صحيح" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Mark OTP as verified and delete it
    await supabase.from("user_otp").delete().eq("id", otpRecord.id);

    console.log("OTP verified successfully");
    return new Response(
      JSON.stringify({ success: true, message: "تم التحقق بنجاح" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in verify-otp function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
