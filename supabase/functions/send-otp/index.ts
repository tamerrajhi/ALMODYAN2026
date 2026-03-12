import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendEmailViaResend(to: string, subject: string, html: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "PROVISTA <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error("Resend error:", error);
    throw new Error("Failed to send email");
  }
  
  return response.json();
}

interface SendOTPRequest {
  userId: string;
  email: string;
  method: "email" | "whatsapp";
  phone?: string;
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const handler = async (req: Request): Promise<Response> => {
  console.log("send-otp function called");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId, email, method, phone }: SendOTPRequest = await req.json();
    console.log(`Sending OTP via ${method} for user ${userId}`);

    // Generate OTP code
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete any existing OTP for this user
    await supabase
      .from("user_otp")
      .delete()
      .eq("user_id", userId);

    // Store OTP in database
    const { error: insertError } = await supabase
      .from("user_otp")
      .insert({
        user_id: userId,
        otp_code: otpCode,
        otp_type: method,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error("Error storing OTP:", insertError);
      throw new Error("Failed to store OTP");
    }

    const otpHtml = `
      <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #1a1a2e;">رمز التحقق الخاص بك</h2>
        <p>استخدم الرمز التالي لتسجيل الدخول:</p>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #d4af37; border-radius: 10px;">
          ${otpCode}
        </div>
        <p style="color: #666; margin-top: 20px;">هذا الرمز صالح لمدة 10 دقائق</p>
        <p style="color: #999; font-size: 12px;">إذا لم تطلب هذا الرمز، يرجى تجاهل هذا البريد</p>
      </div>
    `;

    if (method === "email") {
      // Send OTP via email
      const emailResponse = await sendEmailViaResend(email, "رمز التحقق - PROVISTA", otpHtml);
      console.log("Email sent successfully:", emailResponse);
    } else if (method === "whatsapp") {
      // WhatsApp would require Twilio or similar service
      const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      const twilioFrom = Deno.env.get("TWILIO_WHATSAPP_FROM");

      if (!twilioSid || !twilioToken || !twilioFrom) {
        console.log("Twilio not configured, falling back to email");
        // Fallback to email if Twilio not configured
        await sendEmailViaResend(email, "رمز التحقق - PROVISTA", otpHtml);
      } else {
        // Send via Twilio WhatsApp
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
        const formData = new URLSearchParams();
        formData.append("From", `whatsapp:${twilioFrom}`);
        formData.append("To", `whatsapp:${phone}`);
        formData.append("Body", `رمز التحقق الخاص بك في PROVISTA هو: ${otpCode}\n\nهذا الرمز صالح لمدة 10 دقائق`);

        const twilioResponse = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData,
        });

        if (!twilioResponse.ok) {
          console.error("Twilio error:", await twilioResponse.text());
          throw new Error("Failed to send WhatsApp message");
        }

        console.log("WhatsApp message sent successfully");
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "OTP sent successfully" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-otp function:", error);
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
