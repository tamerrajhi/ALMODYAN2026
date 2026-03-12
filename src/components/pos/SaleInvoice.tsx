import { forwardRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Gem } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { generateInvoiceZatcaQR, generateFullInvoiceZatcaQR, isB2BInvoice, ZATCA_CONFIG } from '@/lib/zatca';
import QRCode from 'qrcode';

interface InvoiceItem {
  item_code: string;
  model: string | null;
  description: string | null;
  type: string | null;
  metal: string | null;
  g_weight: number | null;
  d_weight: number | null;
  b_weight: number | null;
  clarity: string | null;
  sale_price: number;
  supp_ref?: string | null;
}

interface Customer {
  customer_code: string;
  full_name: string;
  phone: string | null;
  vat_number?: string | null;
  address?: string | null;
}

interface SaleInvoiceProps {
  saleCode: string;
  saleDate: Date;
  branchName: string;
  customer: Customer | null;
  items: InvoiceItem[];
  totalAmount: number;
  discountAmount: number;
  taxAmount: number;
  finalAmount: number;
  paymentMethod: string;
  cashAmount?: number;
  cardAmount?: number;
  notes?: string;
  soldBy: string;
}

const SaleInvoice = forwardRef<HTMLDivElement, SaleInvoiceProps>(
  ({ saleCode, saleDate, branchName, customer, items, totalAmount, discountAmount, taxAmount, finalAmount, paymentMethod, cashAmount, cardAmount, notes, soldBy }, ref) => {
    const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

    const hasDiscount = discountAmount > 0;
    const itemsSubtotal = items.reduce((sum, it) => sum + (Number(it.sale_price) || 0), 0);
    const discountRate = hasDiscount && itemsSubtotal > 0 ? discountAmount / itemsSubtotal : 0;
    const itemDiscounts = items.map((item, idx) => {
      const raw = Number(item.sale_price) * discountRate;
      return Math.round(raw * 100) / 100;
    });
    const roundedSum = itemDiscounts.reduce((s, d) => s + d, 0);
    const remainder = Math.round((discountAmount - roundedSum) * 100) / 100;
    if (remainder !== 0 && itemDiscounts.length > 0) {
      let maxIdx = 0;
      items.forEach((it, i) => { if (Number(it.sale_price) > Number(items[maxIdx].sale_price)) maxIdx = i; });
      itemDiscounts[maxIdx] = Math.round((itemDiscounts[maxIdx] + remainder) * 100) / 100;
    }

    const netSubtotal = Math.round((totalAmount - discountAmount) * 100) / 100;
    
    // Determine if this is a B2B (full) or B2C (simplified) invoice
    const isFullInvoice = isB2BInvoice(customer?.vat_number);

    // Generate ZATCA-compliant QR code
    useEffect(() => {
      const generateQR = async () => {
        let zatcaData: string;
        
        if (isFullInvoice && customer?.vat_number) {
          // B2B Full Tax Invoice - include buyer info
          zatcaData = generateFullInvoiceZatcaQR(
            saleDate, 
            finalAmount, 
            taxAmount,
            customer.full_name,
            customer.vat_number
          );
        } else {
          // B2C Simplified Tax Invoice
          zatcaData = generateInvoiceZatcaQR(saleDate, finalAmount, taxAmount);
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
    }, [saleDate, finalAmount, taxAmount, customer, isFullInvoice]);

    return (
      <div ref={ref} className="bg-white text-black invoice-a4-container invoice-print-container" dir="rtl">
        {/* Header with QR Code */}
        <div className="flex items-center justify-between border-b-2 border-black pb-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <Gem className="w-5 h-5 text-slate-900" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Almodyan</h1>
              <p className="text-xs text-gray-600">نظام إدارة المجوهرات</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-left">
              {isFullInvoice ? (
                <>
                  <h2 className="text-base font-bold text-green-700">فاتورة ضريبية</h2>
                  <p className="text-xs text-gray-600">Tax Invoice</p>
                </>
              ) : (
                <>
                  <h2 className="text-base font-bold">فاتورة بيع</h2>
                  <p className="text-xs text-gray-600">Sales Invoice</p>
                </>
              )}
            </div>
            {qrCodeUrl && (
              <div className="flex flex-col items-center">
                <img src={qrCodeUrl} alt="ZATCA QR Code" className="w-16 h-16" />
              </div>
            )}
          </div>
        </div>

        {/* Seller Info (for B2B) */}
        {isFullInvoice && (
          <div className="bg-gray-50 p-2 rounded mb-2 border text-xs">
            <div className="flex justify-between">
              <span><span className="text-gray-600">البائع:</span> <span className="font-medium">{ZATCA_CONFIG.sellerName}</span></span>
              <span><span className="text-gray-600">الرقم الضريبي:</span> <span className="font-mono font-medium">{ZATCA_CONFIG.vatNumber}</span></span>
            </div>
          </div>
        )}

        {/* Invoice Info */}
        <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
          <div className="space-y-1">
            <div className="flex justify-between border-b border-gray-200 pb-0.5">
              <span className="font-medium">رقم الفاتورة:</span>
              <span className="font-mono">{saleCode}</span>
            </div>
            <div className="flex justify-between border-b border-gray-200 pb-0.5">
              <span className="font-medium">التاريخ:</span>
              <span>{format(saleDate, 'dd/MM/yyyy hh:mm a', { locale: ar })}</span>
            </div>
            <div className="flex justify-between border-b border-gray-200 pb-0.5">
              <span className="font-medium">الفرع:</span>
              <span>{branchName}</span>
            </div>
            <div className="flex justify-between border-b border-gray-200 pb-0.5">
              <span className="font-medium">البائع:</span>
              <span>{soldBy}</span>
            </div>
          </div>
          <div className="space-y-1">
            {customer ? (
              <>
                <div className="flex justify-between border-b border-gray-200 pb-0.5">
                  <span className="font-medium">{isFullInvoice ? 'المشتري:' : 'العميل:'}</span>
                  <span>{customer.full_name}</span>
                </div>
                <div className="flex justify-between border-b border-gray-200 pb-0.5">
                  <span className="font-medium">كود:</span>
                  <span className="font-mono">{customer.customer_code}</span>
                </div>
                {isFullInvoice && customer.vat_number && (
                  <div className="flex justify-between border-b border-gray-200 pb-0.5 bg-green-50 px-1 -mx-1">
                    <span className="font-medium text-green-700">الرقم الضريبي:</span>
                    <span className="font-mono text-green-700">{customer.vat_number}</span>
                  </div>
                )}
                <div className="flex justify-between border-b border-gray-200 pb-0.5">
                  <span className="font-medium">الهاتف:</span>
                  <span>{customer.phone || '-'}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between border-b border-gray-200 pb-0.5">
                <span className="font-medium">العميل:</span>
                <span>عميل عام</span>
              </div>
            )}
          </div>
        </div>

        {/* Items Table */}
        <table className="w-full mb-2 border-collapse text-[10px]">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-1 text-right">#</th>
              <th className="border border-gray-300 p-1 text-right">الباركود</th>
              <th className="border border-gray-300 p-1 text-right">الوصف</th>
              <th className="border border-gray-300 p-1 text-right">فاتورة المورد</th>
              <th className="border border-gray-300 p-1 text-right">الوضوح</th>
              <th className="border border-gray-300 p-1 text-right">الأوزان</th>
              {hasDiscount && (
                <th className="border border-gray-300 p-1 text-right text-gray-500">السعر الأصلي</th>
              )}
              <th className="border border-gray-300 p-1 text-right">السعر</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const itemDiscount = itemDiscounts[index] || 0;
              const netPrice = Math.round((item.sale_price - itemDiscount) * 100) / 100;
              const description = item.description || [item.type, item.metal].filter(Boolean).join(' ') || item.model || '-';
              const weightsDisplay = [
                item.g_weight ? `G:${Number(item.g_weight).toFixed(2)}` : null,
                item.d_weight ? `D:${Number(item.d_weight).toFixed(2)}` : null,
                item.b_weight ? `B:${Number(item.b_weight).toFixed(2)}` : null,
              ].filter(Boolean).join(' ');
              
              return (
                <tr key={item.item_code}>
                  <td className="border border-gray-300 p-1 text-center">{index + 1}</td>
                  <td className="border border-gray-300 p-1 font-mono text-[9px]">{item.item_code}</td>
                  <td className="border border-gray-300 p-1">{description}</td>
                  <td className="border border-gray-300 p-1 text-[9px]">{item.supp_ref || '-'}</td>
                  <td className="border border-gray-300 p-1 text-center">{item.clarity || '-'}</td>
                  <td className="border border-gray-300 p-1 text-[9px]">{weightsDisplay || '-'}</td>
                  {hasDiscount && (
                    <td className="border border-gray-300 p-1 text-gray-400 line-through">{formatCurrency(item.sale_price)}</td>
                  )}
                  <td className="border border-gray-300 p-1 font-medium">{formatCurrency(hasDiscount ? netPrice : item.sale_price)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-medium text-[10px]">
              <td colSpan={hasDiscount ? 7 : 6} className="border border-gray-300 p-1 text-left">الإجمالي</td>
              <td className="border border-gray-300 p-1">{formatCurrency(netSubtotal)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-2">
          <div className="w-56 space-y-0.5 text-xs">
            {hasDiscount && (
              <>
                <div className="flex justify-between border-b border-gray-200 pb-0.5 text-gray-500">
                  <span>المجموع قبل الخصم:</span>
                  <span>{formatCurrency(totalAmount)}</span>
                </div>
                <div className="flex justify-between border-b border-gray-200 pb-0.5 text-red-600">
                  <span>الخصم:</span>
                  <span>-{formatCurrency(discountAmount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between border-b border-gray-200 pb-0.5">
              <span>الإجمالي (بدون ضريبة):</span>
              <span className="font-medium">{formatCurrency(netSubtotal)}</span>
            </div>
            <div className="flex justify-between border-b border-gray-200 pb-0.5">
              <span>ضريبة القيمة المضافة (15%):</span>
              <span>{formatCurrency(taxAmount)}</span>
            </div>
            <div className="flex justify-between border-b-2 border-black pb-1 text-sm font-bold">
              <span>الإجمالي شامل الضريبة:</span>
              <span>{formatCurrency(finalAmount)}</span>
            </div>
            <div className="flex justify-between text-gray-600 pt-0.5">
              <span>الدفع:</span>
              <span>
                {paymentMethod === 'split' 
                  ? `مقسم (نقدي: ${formatCurrency(cashAmount || 0)} / بطاقة: ${formatCurrency(cardAmount || 0)})`
                  : paymentMethod === 'cash' ? 'نقداً' : paymentMethod === 'card' ? 'بطاقة' : paymentMethod}
              </span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {notes && (
          <div className="border-t border-gray-200 pt-1 mb-2 text-xs">
            <span className="font-medium">ملاحظات: </span>
            <span className="text-gray-600">{notes}</span>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-300 pt-2 text-center text-[10px] text-gray-600">
          {!isFullInvoice && (
            <p className="mb-1">الرقم الضريبي: <span className="font-mono">{ZATCA_CONFIG.vatNumber}</span></p>
          )}
          <p>شكراً لتعاملكم معنا | Thank you for your business</p>
          <p className="text-[9px] text-gray-400 mt-1">
            {isFullInvoice ? 'فاتورة ضريبية - ZATCA' : 'فاتورة ضريبية مبسطة - ZATCA'}
          </p>
        </div>
      </div>
    );
  }
);

SaleInvoice.displayName = 'SaleInvoice';

export default SaleInvoice;