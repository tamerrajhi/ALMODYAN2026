import { forwardRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Gem } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { generateInvoiceZatcaQR, generateFullInvoiceZatcaQR, isB2BInvoice, ZATCA_CONFIG } from '@/lib/zatca';
import QRCode from 'qrcode';

interface InvoiceItem {
  id: string;
  sale_price?: number;
  return_price?: number;
  jewelry_items?: {
    item_code: string;
    model: string | null;
    description: string | null;
    type: string | null;
    metal: string | null;
    g_weight: number | null;
    d_weight: number | null;
    b_weight: number | null;
    clarity: string | null;
    stone: string | null;
    supp_ref?: string | null;
  };
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  invoice_date: string;
  due_date: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  subtotal: number | null;
  tax_amount: number | null;
  discount_amount: number | null;
  status: string;
  notes: string | null;
  customer?: { 
    full_name: string; 
    customer_code: string; 
    phone?: string;
    vat_number?: string | null;
    address?: string | null;
  };
  supplier?: { supplier_name: string };
  branch?: { branch_name: string };
}

interface PrintableInvoiceProps {
  invoice: Invoice;
  items: InvoiceItem[];
}

const invoiceTypeLabels: Record<string, string> = {
  sales: 'فاتورة مبيعات',
  purchase: 'فاتورة مشتريات',
  sales_return: 'مرتجع مبيعات',
  purchase_return: 'مرتجع مشتريات',
};

const statusLabels: Record<string, string> = {
  pending: 'معلقة',
  partial: 'مدفوعة جزئياً',
  paid: 'مدفوعة',
  cancelled: 'ملغاة',
};

const PrintableInvoice = forwardRef<HTMLDivElement, PrintableInvoiceProps>(
  ({ invoice, items }, ref) => {
    const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
    const discountAmount = invoice.discount_amount || 0;
    const hasDiscount = discountAmount > 0;
    const subtotal = invoice.subtotal || 0;
    const taxAmount = invoice.tax_amount || 0;
    const netSubtotal = Math.round((subtotal - discountAmount) * 100) / 100;

    const isSalesType = invoice.invoice_type === 'sales' || invoice.invoice_type === 'sales_return';

    const itemsSubtotal = items.reduce((sum, it) => sum + (Number(it.sale_price || it.return_price) || 0), 0);
    const discountRate = hasDiscount && itemsSubtotal > 0 ? discountAmount / itemsSubtotal : 0;
    const itemDiscounts = items.map((item) => {
      const price = Number(item.sale_price || item.return_price) || 0;
      return Math.round(price * discountRate * 100) / 100;
    });
    const roundedSum = itemDiscounts.reduce((s, d) => s + d, 0);
    const remainder = Math.round((discountAmount - roundedSum) * 100) / 100;
    if (remainder !== 0 && itemDiscounts.length > 0) {
      let maxIdx = 0;
      items.forEach((it, i) => {
        const p = Number(it.sale_price || it.return_price) || 0;
        const mp = Number(items[maxIdx].sale_price || items[maxIdx].return_price) || 0;
        if (p > mp) maxIdx = i;
      });
      itemDiscounts[maxIdx] = Math.round((itemDiscounts[maxIdx] + remainder) * 100) / 100;
    }

    const isSalesInvoice = invoice.invoice_type === 'sales' || invoice.invoice_type === 'sales_return';
    const isFullInvoice = isSalesInvoice && isB2BInvoice(invoice.customer?.vat_number);
    
    useEffect(() => {
      if (!isSalesInvoice) return;
      
      const generateQR = async () => {
        const invoiceDate = new Date(invoice.invoice_date);
        const qrTax = invoice.tax_amount || 0;
        
        let zatcaData: string;
        
        if (isFullInvoice && invoice.customer?.vat_number) {
          zatcaData = generateFullInvoiceZatcaQR(
            invoiceDate,
            invoice.total_amount,
            qrTax,
            invoice.customer.full_name,
            invoice.customer.vat_number
          );
        } else {
          zatcaData = generateInvoiceZatcaQR(invoiceDate, invoice.total_amount, qrTax);
        }

        try {
          const url = await QRCode.toDataURL(zatcaData, {
            width: 120,
            margin: 1,
            errorCorrectionLevel: 'M',
            color: {
              dark: '#000000',
              light: '#ffffff',
            },
          });
          setQrCodeUrl(url);
        } catch (err) {
          console.error('Error generating ZATCA QR code:', err);
        }
      };

      generateQR();
    }, [invoice, isSalesInvoice, isFullInvoice]);

    return (
      <div ref={ref} className="bg-white text-black invoice-a4-container invoice-print-container" dir="rtl">
        {/* Header with QR Code */}
        <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <Gem className="w-8 h-8 text-slate-900" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Almodyan</h1>
              <p className="text-sm text-gray-600">نظام إدارة المجوهرات</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-left">
              {isFullInvoice ? (
                <>
                  <h2 className="text-xl font-bold text-green-700">فاتورة ضريبية</h2>
                  <p className="text-sm text-gray-600">Tax Invoice (B2B)</p>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold">{invoiceTypeLabels[invoice.invoice_type] || invoice.invoice_type}</h2>
                  <p className="text-sm text-gray-600">Invoice</p>
                </>
              )}
            </div>
            {qrCodeUrl && isSalesInvoice && (
              <div className="flex flex-col items-center">
                <img src={qrCodeUrl} alt="ZATCA QR Code" className="w-24 h-24" />
                <p className="text-[8px] text-gray-500 mt-1">
                  {isFullInvoice ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة'}
                </p>
              </div>
            )}
          </div>
        </div>
        
        {/* Seller Info (for B2B) */}
        {isFullInvoice && (
          <div className="bg-gray-50 p-4 rounded-lg mb-6 border">
            <h3 className="font-bold text-sm mb-2 text-gray-700">بيانات البائع / Seller Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">الاسم:</span>
                <span className="font-medium mr-2">{ZATCA_CONFIG.sellerName}</span>
              </div>
              <div>
                <span className="text-gray-600">الرقم الضريبي:</span>
                <span className="font-mono font-medium mr-2">{ZATCA_CONFIG.vatNumber}</span>
              </div>
            </div>
          </div>
        )}

        {/* Invoice Info */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="space-y-2">
            <div className="flex justify-between border-b pb-1">
              <span className="font-medium">رقم الفاتورة:</span>
              <span className="font-mono">{invoice.invoice_number}</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="font-medium">التاريخ:</span>
              <span>{format(new Date(invoice.invoice_date), 'dd MMMM yyyy', { locale: ar })}</span>
            </div>
            {invoice.due_date && (
              <div className="flex justify-between border-b pb-1">
                <span className="font-medium">تاريخ الاستحقاق:</span>
                <span>{format(new Date(invoice.due_date), 'dd MMMM yyyy', { locale: ar })}</span>
              </div>
            )}
            {invoice.branch?.branch_name && (
              <div className="flex justify-between border-b pb-1">
                <span className="font-medium">الفرع:</span>
                <span>{invoice.branch.branch_name}</span>
              </div>
            )}
            <div className="flex justify-between border-b pb-1">
              <span className="font-medium">الحالة:</span>
              <span>{statusLabels[invoice.status] || invoice.status}</span>
            </div>
          </div>
          <div className="space-y-2">
            {invoice.customer ? (
              <>
                <div className="flex justify-between border-b pb-1">
                  <span className="font-medium">{isFullInvoice ? 'اسم المشتري:' : 'العميل:'}</span>
                  <span>{invoice.customer.full_name}</span>
                </div>
                <div className="flex justify-between border-b pb-1">
                  <span className="font-medium">كود العميل:</span>
                  <span className="font-mono">{invoice.customer.customer_code}</span>
                </div>
                {isFullInvoice && invoice.customer.vat_number && (
                  <div className="flex justify-between border-b pb-1 bg-green-50 px-2 -mx-2">
                    <span className="font-medium text-green-700">الرقم الضريبي للمشتري:</span>
                    <span className="font-mono font-medium text-green-700">{invoice.customer.vat_number}</span>
                  </div>
                )}
                {invoice.customer.phone && (
                  <div className="flex justify-between border-b pb-1">
                    <span className="font-medium">الهاتف:</span>
                    <span>{invoice.customer.phone}</span>
                  </div>
                )}
                {isFullInvoice && invoice.customer.address && (
                  <div className="flex justify-between border-b pb-1">
                    <span className="font-medium">العنوان:</span>
                    <span className="text-sm">{invoice.customer.address}</span>
                  </div>
                )}
              </>
            ) : invoice.supplier ? (
              <div className="flex justify-between border-b pb-1">
                <span className="font-medium">المورد:</span>
                <span>{invoice.supplier.supplier_name}</span>
              </div>
            ) : (
              <div className="flex justify-between border-b pb-1">
                <span className="font-medium">العميل:</span>
                <span>عميل عام</span>
              </div>
            )}
          </div>
        </div>

        {/* Items Table */}
        {items.length > 0 && (
          <table className="w-full mb-6 border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 p-2 text-right">#</th>
                <th className="border border-gray-300 p-2 text-right">رمز الباركود</th>
                <th className="border border-gray-300 p-2 text-right">الوصف</th>
                <th className="border border-gray-300 p-2 text-right">فاتورة المورد</th>
                <th className="border border-gray-300 p-2 text-right">وضوح الماس</th>
                <th className="border border-gray-300 p-2 text-right">الأوزان</th>
                {hasDiscount && isSalesType && (
                  <th className="border border-gray-300 p-2 text-right text-gray-500">السعر الأصلي</th>
                )}
                <th className="border border-gray-300 p-2 text-right">السعر</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const ji = item.jewelry_items;
                const originalPrice = Number(item.sale_price || item.return_price) || 0;
                const lineDiscount = isSalesType ? (itemDiscounts[index] || 0) : 0;
                const netPrice = Math.round((originalPrice - lineDiscount) * 100) / 100;
                const description = ji?.description || [ji?.type, ji?.metal].filter(Boolean).join(' ') || ji?.model || '-';
                
                const weightsDisplay = [
                  ji?.g_weight ? `G: ${ji.g_weight.toFixed(3)}` : null,
                  ji?.d_weight ? `D: ${ji.d_weight.toFixed(3)}` : null,
                  ji?.b_weight ? `B: ${ji.b_weight.toFixed(3)}` : null,
                ].filter(Boolean).join('\n');
                
                return (
                  <tr key={item.id}>
                    <td className="border border-gray-300 p-2 text-center">{index + 1}</td>
                    <td className="border border-gray-300 p-2 font-mono text-xs">{ji?.item_code || '-'}</td>
                    <td className="border border-gray-300 p-2">
                      <div className="font-medium">{description}</div>
                      {ji?.model && ji?.model !== description && (
                        <div className="text-xs text-gray-500">{ji.model}</div>
                      )}
                    </td>
                    <td className="border border-gray-300 p-2 text-sm">
                      {ji?.supp_ref || '-'}
                    </td>
                    <td className="border border-gray-300 p-2 text-center font-medium">
                      {ji?.clarity || '-'}
                    </td>
                    <td className="border border-gray-300 p-2 text-xs whitespace-pre-line">
                      {weightsDisplay || '-'}
                    </td>
                    {hasDiscount && isSalesType && (
                      <td className="border border-gray-300 p-2 text-gray-400 line-through">
                        {formatCurrency(originalPrice)}
                      </td>
                    )}
                    <td className="border border-gray-300 p-2 font-medium">
                      {formatCurrency(hasDiscount && isSalesType ? netPrice : originalPrice)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {isSalesType && (
              <tfoot>
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={hasDiscount ? 7 : 6} className="border border-gray-300 p-2 text-left">الإجمالي</td>
                  <td className="border border-gray-300 p-2">{formatCurrency(netSubtotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}

        {/* Totals */}
        <div className="flex justify-end mb-6">
          <div className="w-72 space-y-2">
            {isSalesType ? (
              <>
                {hasDiscount && (
                  <>
                    <div className="flex justify-between border-b pb-1 text-gray-500">
                      <span>المجموع قبل الخصم:</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="flex justify-between border-b pb-1 text-red-600">
                      <span>الخصم:</span>
                      <span className="font-medium">-{formatCurrency(discountAmount)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between border-b pb-1">
                  <span>الإجمالي (بدون ضريبة):</span>
                  <span className="font-medium">{formatCurrency(netSubtotal)}</span>
                </div>
                {taxAmount > 0 && (
                  <div className="flex justify-between border-b pb-1">
                    <span>ضريبة القيمة المضافة (15%):</span>
                    <span className="font-medium">{formatCurrency(taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-b-2 border-black pb-2 text-lg font-bold">
                  <span>الإجمالي شامل الضريبة:</span>
                  <span>{formatCurrency(invoice.total_amount)}</span>
                </div>
              </>
            ) : (
              <>
                {invoice.subtotal && invoice.subtotal !== invoice.total_amount && (
                  <div className="flex justify-between border-b pb-1">
                    <span>المجموع الفرعي:</span>
                    <span className="font-medium">{formatCurrency(invoice.subtotal)}</span>
                  </div>
                )}
                {hasDiscount && (
                  <div className="flex justify-between border-b pb-1 text-red-600">
                    <span>الخصم:</span>
                    <span className="font-medium">-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                {taxAmount > 0 && (
                  <div className="flex justify-between border-b pb-1">
                    <span>ضريبة القيمة المضافة (15%):</span>
                    <span className="font-medium">{formatCurrency(taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-b-2 border-black pb-2 text-lg font-bold">
                  <span>الإجمالي:</span>
                  <span>{formatCurrency(invoice.total_amount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-sm text-green-700">
              <span>المدفوع:</span>
              <span className="font-medium">{formatCurrency(invoice.paid_amount)}</span>
            </div>
            <div className="flex justify-between text-sm text-amber-700">
              <span>المتبقي:</span>
              <span className="font-medium">{formatCurrency(invoice.remaining_amount)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div className="border-t pt-4 mb-6">
            <p className="font-medium mb-1">ملاحظات:</p>
            <p className="text-sm text-gray-600">{invoice.notes}</p>
          </div>
        )}

        {/* VAT Info - only show for non-B2B since B2B already shows it above */}
        {!isFullInvoice && (
          <div className="border-t pt-4 mb-4 text-sm">
            <div className="flex justify-between">
              <span className="font-medium">الرقم الضريبي / VAT Number:</span>
              <span className="font-mono">{ZATCA_CONFIG.vatNumber}</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t-2 border-black pt-4 text-center text-sm text-gray-600">
          <p className="mb-2">شكراً لتعاملكم معنا</p>
          <p>Thank you for your business</p>
          {isSalesInvoice && (
            <>
              <p className="mt-4 text-xs">
                {isFullInvoice 
                  ? 'فاتورة ضريبية صادرة وفقاً لمتطلبات هيئة الزكاة والضريبة والجمارك'
                  : 'فاتورة ضريبية مبسطة صادرة وفقاً لمتطلبات هيئة الزكاة والضريبة والجمارك'
                }
              </p>
              <p className="text-xs text-gray-400">
                {isFullInvoice
                  ? 'Tax Invoice issued in compliance with ZATCA requirements'
                  : 'Simplified Tax Invoice issued in compliance with ZATCA requirements'
                }
              </p>
            </>
          )}
        </div>
      </div>
    );
  }
);

PrintableInvoice.displayName = 'PrintableInvoice';

export default PrintableInvoice;
