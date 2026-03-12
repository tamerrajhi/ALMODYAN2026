import React, { forwardRef, useState, useEffect } from 'react';
import { format } from 'date-fns';
import QRCode from 'qrcode';

interface JournalEntryLine {
  id: string;
  account_code: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  description: string | null;
}

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  total_debit: number;
  total_credit: number;
  lines?: JournalEntryLine[];
}

interface CompanySettings {
  company_name: string;
  company_name_en: string | null;
  logo_url: string | null;
  commercial_registration: string | null;
  tax_number: string | null;
  address: string | null;
  address_en: string | null;
  city: string | null;
  city_en: string | null;
  country: string | null;
  country_en: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  postal_code: string | null;
}

interface PrintablePaymentVoucherProps {
  payment: {
    id: string;
    payment_number: string;
    payment_date: string;
    amount: number;
    payment_method: string;
    notes: string | null;
    supplier?: { supplier_name: string } | null;
    invoice?: { invoice_number: string; total_amount?: number } | null;
    created_at?: string;
  };
  journalEntry?: JournalEntry | null;
  companySettings?: CompanySettings | null;
  createdByName?: string;
}

const paymentMethodLabels: Record<string, string> = {
  cash: 'نقداً',
  bank: 'تحويل بنكي',
  check: 'شيك',
  credit_card: 'بطاقة ائتمان',
};

const paymentMethodLabelsEn: Record<string, string> = {
  cash: 'Cash',
  bank: 'Bank Transfer',
  check: 'Check',
  credit_card: 'Credit Card',
};

const PrintablePaymentVoucher = forwardRef<HTMLDivElement, PrintablePaymentVoucherProps>(
  ({ payment, journalEntry, companySettings, createdByName }, ref) => {
    const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat('ar-SA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    };

    // Generate QR code with voucher verification data
    useEffect(() => {
      const generateQR = async () => {
        const qrData = JSON.stringify({
          type: 'PAYMENT_VOUCHER',
          voucher_no: payment.payment_number,
          date: payment.payment_date,
          supplier: payment.supplier?.supplier_name || '-',
          amount: payment.amount,
          currency: 'SAR',
          ref_id: payment.id,
          timestamp: new Date().toISOString(),
        });

        try {
          const url = await QRCode.toDataURL(qrData, {
            width: 100,
            margin: 1,
            color: {
              dark: '#000000',
              light: '#ffffff',
            },
          });
          setQrCodeUrl(url);
        } catch (err) {
          console.error('Error generating QR code:', err);
        }
      };

      generateQR();
    }, [payment]);

    const company = companySettings || {
      company_name: 'اسم الشركة',
      company_name_en: 'Company Name',
      logo_url: null,
      commercial_registration: null,
      tax_number: null,
      address: null,
      city: null,
      country: 'المملكة العربية السعودية',
      phone: null,
      email: null,
    };

    return (
      <div 
        ref={ref} 
        className="bg-white text-black invoice-a4-container print:p-0" 
        style={{ 
          direction: 'rtl', 
          fontFamily: 'Arial, sans-serif',
          boxSizing: 'border-box',
        }}
      >
        {/* ============ HEADER / LETTERHEAD ============ */}
        <div className="border-b-2 border-gray-800 pb-4 mb-6">
          <div className="flex justify-between items-start">
            {/* Company Info - Right */}
            <div className="flex-1 text-right">
              {company.logo_url && (
                <img 
                  src={company.logo_url} 
                  alt="Company Logo" 
                  className="h-16 mb-2"
                />
              )}
              <h1 className="text-xl font-bold text-gray-900">{company.company_name}</h1>
              {company.company_name_en && (
                <p className="text-sm text-gray-600" style={{ direction: 'ltr' }}>{company.company_name_en}</p>
              )}
              {company.commercial_registration && (
                <p className="text-xs text-gray-600">س.ت: {company.commercial_registration}</p>
              )}
              {company.tax_number && (
                <p className="text-xs text-gray-600">الرقم الضريبي: {company.tax_number}</p>
              )}
            </div>

            {/* Document Title - Center */}
            <div className="flex-1 text-center">
              <div className="inline-block border-2 border-gray-800 px-6 py-3 rounded">
                <h2 className="text-xl font-bold">سند صرف</h2>
                <p className="text-sm text-gray-600">Payment Voucher</p>
              </div>
            </div>

            {/* QR Code & Voucher Info - Left */}
            <div className="flex-1 flex flex-col items-start gap-2" style={{ direction: 'ltr' }}>
              {qrCodeUrl && (
                <img 
                  src={qrCodeUrl} 
                  alt="QR Code" 
                  className="w-20 h-20 border border-gray-300"
                />
              )}
              <div className="text-xs text-gray-600">
                <p><strong>Voucher No:</strong> {payment.payment_number}</p>
                <p><strong>Date:</strong> {format(new Date(payment.payment_date), 'yyyy/MM/dd')}</p>
              </div>
            </div>
          </div>

          {/* Company Contact Info */}
          <div className="flex justify-between mt-3 pt-2 border-t border-gray-300 text-xs text-gray-600">
            <div className="flex gap-4">
              {company.address && <span>📍 {company.address}</span>}
              {company.city && <span>{company.city}</span>}
            </div>
            <div className="flex gap-4" style={{ direction: 'ltr' }}>
              {company.phone && <span>📞 {company.phone}</span>}
              {company.email && <span>✉️ {company.email}</span>}
            </div>
          </div>
        </div>

        {/* ============ VOUCHER INFORMATION ============ */}
        <div className="mb-6 p-4 border border-gray-300 rounded bg-gray-50">
          <h3 className="font-bold text-sm mb-3 pb-2 border-b border-gray-300">بيانات السند - Voucher Details</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">رقم السند:</span>
              <span className="font-mono font-bold">{payment.payment_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">التاريخ:</span>
              <span>{format(new Date(payment.payment_date), 'yyyy/MM/dd')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">المورد:</span>
              <span className="font-bold">{payment.supplier?.supplier_name || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">طريقة الدفع:</span>
              <span>{paymentMethodLabels[payment.payment_method] || payment.payment_method}</span>
            </div>
            {payment.invoice?.invoice_number && (
              <div className="flex justify-between">
                <span className="text-gray-600">الفاتورة المرتبطة:</span>
                <span className="font-mono">{payment.invoice.invoice_number}</span>
              </div>
            )}
            {createdByName && (
              <div className="flex justify-between">
                <span className="text-gray-600">أنشئ بواسطة:</span>
                <span>{createdByName}</span>
              </div>
            )}
          </div>
        </div>

        {/* ============ AMOUNT BOX ============ */}
        <div className="mb-6 p-6 border-2 border-gray-800 rounded text-center bg-gray-100">
          <p className="text-sm text-gray-600 mb-1">المبلغ المدفوع / Amount Paid</p>
          <p className="text-3xl font-bold">{formatCurrency(payment.amount)} ر.س</p>
          <p className="text-sm text-gray-500 mt-1" style={{ direction: 'ltr' }}>SAR {formatCurrency(payment.amount)}</p>
        </div>

        {/* ============ PAYMENT DETAILS TABLE ============ */}
        <div className="mb-6 border border-gray-300 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-200">
              <tr>
                <th className="p-2 text-right border-b border-gray-300 font-bold">البيان / Description</th>
                <th className="p-2 text-center border-b border-gray-300 font-bold w-40">المبلغ / Amount</th>
                <th className="p-2 text-right border-b border-gray-300 font-bold">ملاحظات / Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-gray-200">
                  دفعة للمورد: {payment.supplier?.supplier_name || '-'}
                  {payment.invoice?.invoice_number && (
                    <span className="text-gray-500 text-xs block">
                      مقابل الفاتورة: {payment.invoice.invoice_number}
                    </span>
                  )}
                </td>
                <td className="p-3 border-b border-gray-200 text-center font-mono font-bold">
                  {formatCurrency(payment.amount)}
                </td>
                <td className="p-3 border-b border-gray-200 text-gray-600">
                  {payment.notes || '-'}
                </td>
              </tr>
            </tbody>
            <tfoot className="bg-gray-100">
              <tr>
                <td className="p-3 text-right font-bold">الإجمالي / Total</td>
                <td className="p-3 text-center font-mono font-bold text-lg">
                  {formatCurrency(payment.amount)} ر.س
                </td>
                <td className="p-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ============ JOURNAL ENTRY SECTION ============ */}
        {journalEntry && journalEntry.lines && journalEntry.lines.length > 0 && (
          <div className="mb-6 border border-gray-300 rounded overflow-hidden">
            <div className="bg-gray-700 text-white p-3">
              <h3 className="font-bold text-sm">
                القيد المحاسبي - Journal Entry
                <span className="font-mono mr-4 text-gray-300">{journalEntry.entry_number}</span>
              </h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-200">
                <tr>
                  <th className="p-2 text-right border-b border-gray-300 font-bold w-28">رقم الحساب</th>
                  <th className="p-2 text-right border-b border-gray-300 font-bold">اسم الحساب</th>
                  <th className="p-2 text-center border-b border-gray-300 font-bold w-32">مدين / Debit</th>
                  <th className="p-2 text-center border-b border-gray-300 font-bold w-32">دائن / Credit</th>
                </tr>
              </thead>
              <tbody>
                {journalEntry.lines.map((line, index) => (
                  <tr key={line.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-2 font-mono text-gray-700">{line.account_code}</td>
                    <td className="p-2">{line.account_name}</td>
                    <td className="p-2 text-center font-mono">
                      {line.debit_amount > 0 ? formatCurrency(line.debit_amount) : '-'}
                    </td>
                    <td className="p-2 text-center font-mono">
                      {line.credit_amount > 0 ? formatCurrency(line.credit_amount) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-200 font-bold">
                <tr>
                  <td colSpan={2} className="p-2 text-right">الإجمالي / Total</td>
                  <td className="p-2 text-center font-mono">{formatCurrency(journalEntry.total_debit)}</td>
                  <td className="p-2 text-center font-mono">{formatCurrency(journalEntry.total_credit)}</td>
                </tr>
              </tfoot>
            </table>
            {/* Balance Check */}
            <div className={`p-2 text-center text-xs ${
              journalEntry.total_debit === journalEntry.total_credit 
                ? 'bg-green-100 text-green-800' 
                : 'bg-red-100 text-red-800'
            }`}>
              {journalEntry.total_debit === journalEntry.total_credit 
                ? '✓ القيد متوازن - Entry is balanced'
                : '⚠ القيد غير متوازن - Entry is NOT balanced'
              }
            </div>
          </div>
        )}

        {/* ============ SIGNATURE SECTION ============ */}
        <div className="mt-8 pt-4 border-t-2 border-gray-800">
          <h3 className="text-sm font-bold mb-4 text-center text-gray-600">التوقيعات والاعتمادات - Signatures & Approvals</h3>
          <div className="grid grid-cols-4 gap-4 text-center text-sm">
            <div className="border border-gray-300 rounded p-3">
              <div className="h-12 border-b border-gray-300 mb-2"></div>
              <p className="font-bold">أعده / Prepared By</p>
              <p className="text-xs text-gray-500 mt-1">الاسم: ________________</p>
              <p className="text-xs text-gray-500">التاريخ: ___/___/______</p>
            </div>
            <div className="border border-gray-300 rounded p-3">
              <div className="h-12 border-b border-gray-300 mb-2"></div>
              <p className="font-bold">راجعه / Checked By</p>
              <p className="text-xs text-gray-500 mt-1">الاسم: ________________</p>
              <p className="text-xs text-gray-500">التاريخ: ___/___/______</p>
            </div>
            <div className="border border-gray-300 rounded p-3">
              <div className="h-12 border-b border-gray-300 mb-2"></div>
              <p className="font-bold">اعتمده / Approved By</p>
              <p className="text-xs text-gray-500 mt-1">الاسم: ________________</p>
              <p className="text-xs text-gray-500">التاريخ: ___/___/______</p>
            </div>
            <div className="border border-gray-300 rounded p-3">
              <div className="h-12 border-b border-gray-300 mb-2"></div>
              <p className="font-bold">استلمه / Received By</p>
              <p className="text-xs text-gray-500 mt-1">الاسم: ________________</p>
              <p className="text-xs text-gray-500">التاريخ: ___/___/______</p>
            </div>
          </div>
        </div>

        {/* ============ FOOTER ============ */}
        <div className="mt-8 pt-4 border-t border-gray-300 text-center text-xs text-gray-500">
          <div className="flex justify-between items-center">
            <div>
              <p>تم الطباعة: {format(new Date(), 'yyyy/MM/dd HH:mm:ss')}</p>
            </div>
            <div>
              <p>المرجع الداخلي: {payment.id.substring(0, 8).toUpperCase()}</p>
            </div>
            <div>
              <p>صفحة 1 من 1</p>
            </div>
          </div>
          <p className="mt-2 text-gray-400">
            هذا المستند صادر من النظام المحاسبي - This document is generated from the accounting system
          </p>
        </div>
      </div>
    );
  }
);

PrintablePaymentVoucher.displayName = 'PrintablePaymentVoucher';

export default PrintablePaymentVoucher;
