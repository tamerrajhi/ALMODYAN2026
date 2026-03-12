import { forwardRef } from 'react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Gem, ArrowLeftRight, Loader2 } from 'lucide-react';
import { useTransferDetails } from '@/hooks/useTransfersV2ReadModel';

// Phase D1: TransferReceipt uses unified read hook - NO direct database queries here
interface TransferReceiptProps {
  transferId: string;
  onClose?: () => void;
}

const TransferReceipt = forwardRef<HTMLDivElement, TransferReceiptProps>(
  ({ transferId }, ref) => {
    // Use unified read hook
    const { data, isLoading } = useTransferDetails(transferId);

    // Calculate totals from snapshots
    const totalWeight = data?.items.reduce((sum, item) => sum + (Number(item.weight_grams) || 0), 0) || 0;
    const totalCost = data?.items.reduce((sum, item) => sum + (Number(item.unit_cost) || 0), 0) || 0;

    if (isLoading) {
      return (
        <div ref={ref} className="bg-white text-black p-8 max-w-[800px] mx-auto flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
        </div>
      );
    }

    if (!data) {
      return (
        <div ref={ref} className="bg-white text-black p-8 max-w-[800px] mx-auto text-center">
          <p className="text-red-600">لم يتم العثور على بيانات النقل</p>
        </div>
      );
    }

    const { header, items } = data;
    const fromBranchName = header.from_branch?.branch_name || 'المستودع';
    const toBranchName = header.to_branch?.branch_name || '-';
    const transferDate = new Date(header.transfer_date);

    return (
      <div ref={ref} className="bg-white text-black p-8 max-w-[800px] mx-auto print:p-4" dir="rtl">
        {/* Header */}
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
          <div className="text-left">
            <h2 className="text-xl font-bold">إيصال نقل</h2>
            <p className="text-sm text-gray-600">Transfer Receipt</p>
            {header.transfer_code && (
              <p className="text-sm font-mono mt-1">{header.transfer_code}</p>
            )}
          </div>
        </div>

        {/* Transfer Info */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="space-y-2">
            <div className="flex justify-between border-b pb-1">
              <span className="font-medium">التاريخ:</span>
              <span>{format(transferDate, 'dd MMMM yyyy - hh:mm a', { locale: ar })}</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="font-medium">عدد القطع:</span>
              <span className="font-bold">{items.length}</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="font-medium">إجمالي الوزن:</span>
              <span>{totalWeight.toFixed(2)} جم</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="font-medium">إجمالي التكلفة:</span>
              <span className="font-bold">{totalCost.toLocaleString()} ر.س</span>
            </div>
          </div>
          <div className="space-y-2">
            {header.transferred_by && (
              <div className="flex justify-between border-b pb-1">
                <span className="font-medium">بواسطة:</span>
                <span>{header.transferred_by}</span>
              </div>
            )}
          </div>
        </div>

        {/* Transfer Direction */}
        <div className="bg-gray-50 border-2 border-gray-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-center gap-4">
            <div className="text-center flex-1">
              <p className="text-sm text-gray-500 mb-1">من فرع</p>
              <p className="text-lg font-bold">{fromBranchName}</p>
            </div>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100">
              <ArrowLeftRight className="w-6 h-6 text-amber-600" />
            </div>
            <div className="text-center flex-1">
              <p className="text-sm text-gray-500 mb-1">إلى فرع</p>
              <p className="text-lg font-bold">{toBranchName}</p>
            </div>
          </div>
        </div>

        {/* Items Table - ALL DATA FROM SNAPSHOTS */}
        <table className="w-full mb-6 border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 p-2 text-right">#</th>
              <th className="border border-gray-300 p-2 text-right">كود القطعة</th>
              <th className="border border-gray-300 p-2 text-right">الباركود</th>
              <th className="border border-gray-300 p-2 text-right">الموديل</th>
              <th className="border border-gray-300 p-2 text-right">فاتورة المورد</th>
              <th className="border border-gray-300 p-2 text-right">النوع</th>
              <th className="border border-gray-300 p-2 text-right">الوزن (جم)</th>
              <th className="border border-gray-300 p-2 text-right">التكلفة</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.item_id}>
                <td className="border border-gray-300 p-2 text-center">{index + 1}</td>
                {/* item_code from snapshot */}
                <td className="border border-gray-300 p-2 font-mono text-sm">
                  {item.item_code || '-'}
                </td>
                {/* stockcode from jewelry_items (display only) */}
                <td className="border border-gray-300 p-2 font-mono text-sm">
                  {item.stockcode || '-'}
                </td>
                {/* model from jewelry_items (display only) */}
                <td className="border border-gray-300 p-2">
                  {item.model || '-'}
                </td>
                <td className="border border-gray-300 p-2 text-sm">
                  {item.supp_inv || '-'}
                </td>
                {/* type from jewelry_items (display only) */}
                <td className="border border-gray-300 p-2">
                  {item.type || '-'}
                </td>
                {/* weight_grams from snapshot */}
                <td className="border border-gray-300 p-2 text-center">
                  {item.weight_grams != null ? Number(item.weight_grams).toFixed(2) : '-'}
                </td>
                {/* unit_cost from snapshot */}
                <td className="border border-gray-300 p-2 text-center">
                  {item.unit_cost != null ? Number(item.unit_cost).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold">
              <td colSpan={6} className="border border-gray-300 p-2 text-left">الإجمالي</td>
              <td className="border border-gray-300 p-2 text-center">{totalWeight.toFixed(2)}</td>
              <td className="border border-gray-300 p-2 text-center">{totalCost.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-8 mb-6 mt-12">
          <div className="text-center">
            <div className="border-t-2 border-gray-400 pt-2 mx-8">
              <p className="font-medium">توقيع المسلّم</p>
              <p className="text-sm text-gray-500">{fromBranchName}</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t-2 border-gray-400 pt-2 mx-8">
              <p className="font-medium">توقيع المستلم</p>
              <p className="text-sm text-gray-500">{toBranchName}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t-2 border-black pt-4 text-center text-sm text-gray-600">
          <p className="mb-2">هذا الإيصال دليل على نقل القطع المذكورة أعلاه</p>
          <p className="mt-4 text-xs">
            تم إصدار هذا الإيصال إلكترونياً بواسطة نظام Almodyan
          </p>
        </div>
      </div>
    );
  }
);

TransferReceipt.displayName = 'TransferReceipt';

export default TransferReceipt;