import { forwardRef, useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils';
import { generateZatcaQRData } from '@/lib/zatca';
import QRCode from 'qrcode';

interface SaleItem {
  item_code: string;
  item_name: string;
  return_quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_amount?: number;
  line_total: number;
  return_reason?: string;
  supp_ref?: string | null;
}

interface CompletedReturn {
  returnCode: string;
  returnDate: Date;
  branchName: string;
  originalInvoice: string;
  customerName?: string;
  items: SaleItem[];
  subtotalBeforeTax: number;
  taxAmount: number;
  totalAmount: number;
  refundMethod: string;
  returnReason: string;
  processedBy: string;
  returnType?: 'partial' | 'full';
  companyName?: string;
  vatNumber?: string;
}

interface POSReturnReceiptProps {
  return: CompletedReturn;
}

const POSReturnReceipt = forwardRef<HTMLDivElement, POSReturnReceiptProps>(
  ({ return: returnData }, ref) => {
    const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

    useEffect(() => {
      const generateQR = async () => {
        try {
          const qrData = generateZatcaQRData({
            sellerName: returnData.companyName || returnData.branchName,
            vatNumber: returnData.vatNumber || '300000000000003',
            timestamp: returnData.returnDate,
            totalWithVat: returnData.totalAmount,
            vatAmount: returnData.taxAmount,
          });
          const url = await QRCode.toDataURL(qrData, {
            width: 120,
            margin: 1,
            errorCorrectionLevel: 'M',
          });
          setQrCodeUrl(url);
        } catch (error) {
          console.error('Error generating QR code:', error);
        }
      };
      generateQR();
    }, [returnData]);

    const refundMethodText = {
      cash: 'نقداً',
      card: 'بطاقة',
      store_credit: 'رصيد للعميل',
    }[returnData.refundMethod] || returnData.refundMethod;

    const returnTypeText = returnData.returnType === 'full' ? 'مرتجع كلي' : 'مرتجع جزئي';

    return (
      <div ref={ref} className="bg-white text-black p-4 text-sm" style={{ width: '80mm', fontFamily: 'Cairo, sans-serif' }}>
        {/* Header */}
        <div className="text-center mb-4">
          <div className="bg-red-100 border-2 border-red-500 rounded-lg py-2 px-3 mb-2">
            <h2 className="text-lg font-bold text-red-700">إشعار مرتجع POS</h2>
            <p className="text-xs text-red-600">POS RETURN RECEIPT</p>
          </div>
          {returnData.branchName && (
            <p className="text-sm font-medium">{returnData.branchName}</p>
          )}
        </div>

        {/* Return Info */}
        <div className="border-t border-b border-dashed py-2 mb-3 space-y-1 text-xs">
          <div className="flex justify-between">
            <span>رقم المرتجع:</span>
            <span className="font-mono font-bold text-red-600">{returnData.returnCode}</span>
          </div>
          <div className="flex justify-between">
            <span>التاريخ:</span>
            <span>{returnData.returnDate.toLocaleDateString('ar-SA')}</span>
          </div>
          <div className="flex justify-between">
            <span>الوقت:</span>
            <span>{returnData.returnDate.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="flex justify-between bg-gray-100 p-1 rounded">
            <span className="font-medium">الفاتورة الأصلية:</span>
            <span className="font-mono font-bold">{returnData.originalInvoice}</span>
          </div>
          <div className="flex justify-between">
            <span>نوع المرتجع:</span>
            <span className="font-medium">{returnTypeText}</span>
          </div>
          {returnData.customerName && (
            <div className="flex justify-between">
              <span>العميل:</span>
              <span>{returnData.customerName}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>الكاشير:</span>
            <span className="font-medium">{returnData.processedBy}</span>
          </div>
        </div>

        {/* Items */}
        <div className="mb-3">
          <div className="text-xs font-bold mb-2 bg-gray-200 p-1 rounded text-center">
            الأصناف المرتجعة ({returnData.items.length})
          </div>
          {returnData.items.map((item, index) => (
            <div key={index} className="border-b border-dotted py-1 text-xs">
              <div className="font-medium">{item.item_name || item.item_code}</div>
              <div className="text-gray-500 text-[10px]">{item.item_code}</div>
              {item.supp_ref && (
                <div className="text-gray-500 text-[10px]">فاتورة المورد: {item.supp_ref}</div>
              )}
              <div className="flex justify-between text-gray-600">
                <span>{item.return_quantity} × {formatCurrency(item.unit_price)}</span>
                <span>{formatCurrency(item.line_total)}</span>
              </div>
              {item.discount_amount && item.discount_amount > 0 && (
                <div className="flex justify-between text-gray-500 text-[10px]">
                  <span>الخصم:</span>
                  <span>-{formatCurrency(item.discount_amount)}</span>
                </div>
              )}
              {item.tax_amount && item.tax_amount > 0 && (
                <div className="flex justify-between text-gray-500 text-[10px]">
                  <span>الضريبة (15%):</span>
                  <span>{formatCurrency(item.tax_amount)}</span>
                </div>
              )}
              {item.return_reason && (
                <div className="text-xs text-gray-500 italic">السبب: {item.return_reason}</div>
              )}
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t border-dashed pt-2 space-y-1 text-xs">
          <div className="flex justify-between">
            <span>عدد الأصناف:</span>
            <span>{returnData.items.length}</span>
          </div>
          <div className="flex justify-between">
            <span>الإجمالي قبل الضريبة:</span>
            <span>{formatCurrency(returnData.subtotalBeforeTax)}</span>
          </div>
          <div className="flex justify-between">
            <span>ضريبة القيمة المضافة (15%):</span>
            <span>{formatCurrency(returnData.taxAmount)}</span>
          </div>
          <div className="flex justify-between font-bold text-base border-t border-double border-black pt-2 mt-2 bg-red-50 p-2 rounded">
            <span>المبلغ المسترد:</span>
            <span className="text-red-700">{formatCurrency(returnData.totalAmount)}</span>
          </div>
        </div>

        {/* Refund Method */}
        <div className="border-t border-dashed mt-3 pt-2 text-xs">
          <div className="flex justify-between bg-blue-50 p-2 rounded">
            <span className="font-medium">طريقة رد المبلغ:</span>
            <span className="font-bold text-blue-700">{refundMethodText}</span>
          </div>
        </div>

        {/* Return Reason */}
        {returnData.returnReason && (
          <div className="border-t border-dashed mt-3 pt-2 text-xs">
            <div className="font-medium mb-1">سبب الإرجاع:</div>
            <div className="text-gray-600 bg-gray-50 p-2 rounded">{returnData.returnReason}</div>
          </div>
        )}

        {/* QR Code */}
        {qrCodeUrl && (
          <div className="flex justify-center mt-4 pt-3 border-t border-dashed">
            <img src={qrCodeUrl} alt="QR Code" className="w-28 h-28" />
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-4 pt-3 border-t border-dashed text-xs text-gray-500">
          <p className="font-medium">شكراً لتعاملكم معنا</p>
          <p className="text-[10px] mt-1">هذا الإيصال دليل على إرجاع البضاعة</p>
          <p className="text-[10px] mt-1">This receipt is proof of merchandise return</p>
        </div>
      </div>
    );
  }
);

POSReturnReceipt.displayName = 'POSReturnReceipt';

export default POSReturnReceipt;