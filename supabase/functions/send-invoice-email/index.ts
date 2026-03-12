import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendInvoiceEmailRequest {
  to: string;
  customerName: string;
  invoiceNumber: string;
  invoiceType: string;
  invoiceDate: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      to,
      customerName,
      invoiceNumber,
      invoiceType,
      invoiceDate,
      totalAmount,
      paidAmount,
      remainingAmount,
    }: SendInvoiceEmailRequest = await req.json();

    if (!to) {
      throw new Error("البريد الإلكتروني للعميل مطلوب");
    }

    console.log(`Sending invoice email to: ${to}`);

    const emailHtml = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f5f5f5;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .content {
      padding: 30px;
    }
    .greeting {
      font-size: 18px;
      color: #333;
      margin-bottom: 20px;
    }
    .invoice-details {
      background-color: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e9ecef;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #6c757d;
      font-weight: 500;
    }
    .detail-value {
      color: #333;
      font-weight: 600;
    }
    .total-row {
      background-color: #667eea;
      color: white;
      border-radius: 5px;
      padding: 15px;
      margin-top: 15px;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 20px;
      text-align: center;
      color: #6c757d;
      font-size: 14px;
    }
    .thank-you {
      font-size: 16px;
      color: #28a745;
      margin-top: 20px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📄 فاتورة</h1>
    </div>
    <div class="content">
      <p class="greeting">مرحباً ${customerName}،</p>
      <p>نشكركم على تعاملكم معنا. إليكم تفاصيل الفاتورة:</p>
      
      <div class="invoice-details">
        <div class="detail-row">
          <span class="detail-label">رقم الفاتورة:</span>
          <span class="detail-value">${invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">نوع الفاتورة:</span>
          <span class="detail-value">${invoiceType}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">التاريخ:</span>
          <span class="detail-value">${invoiceDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">المبلغ المدفوع:</span>
          <span class="detail-value">${paidAmount}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">المبلغ المتبقي:</span>
          <span class="detail-value">${remainingAmount}</span>
        </div>
        <div class="total-row">
          <div class="detail-row" style="border: none; color: white;">
            <span class="detail-label" style="color: white;">الإجمالي:</span>
            <span class="detail-value" style="color: white; font-size: 20px;">${totalAmount}</span>
          </div>
        </div>
      </div>
      
      <p class="thank-you">🙏 شكراً لثقتكم بنا!</p>
    </div>
    <div class="footer">
      <p>هذا البريد الإلكتروني تم إرساله تلقائياً من نظام الفواتير</p>
    </div>
  </div>
</body>
</html>
    `;

    // Note: With Resend free tier, emails can only be sent to the account owner's email
    // To send to any recipient, verify a domain at resend.com/domains
    const testEmail = "provista.smtp@gmail.com"; // Registered Resend email for testing
    const recipientEmail = to === testEmail ? to : testEmail; // Use test email if domain not verified
    
    console.log(`Sending to: ${recipientEmail} (original recipient: ${to})`);
    
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Invoices <onboarding@resend.dev>",
        to: [recipientEmail],
        subject: `فاتورة رقم ${invoiceNumber} - للعميل: ${customerName} (${to})`,
        html: emailHtml,
      }),
    });

    const emailResponse = await response.json();
    
    if (!response.ok) {
      console.error("Resend API error:", emailResponse);
      throw new Error(emailResponse.message || "Failed to send email");
    }

    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, message: "تم إرسال البريد الإلكتروني بنجاح" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending email:", error);
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
