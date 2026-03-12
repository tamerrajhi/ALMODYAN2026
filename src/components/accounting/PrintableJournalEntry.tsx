import { forwardRef } from 'react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { referenceTypeLabels } from '@/lib/journal-entry-types';

interface JournalEntryLine {
  id?: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
  account?: {
    id: string;
    account_code: string;
    account_name: string;
  };
}

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  is_posted: boolean;
  total_debit: number;
  total_credit: number;
  created_at: string;
  journal_entry_lines?: JournalEntryLine[];
}

interface PrintableJournalEntryProps {
  entry: JournalEntry;
  companyName?: string;
}

const PrintableJournalEntry = forwardRef<HTMLDivElement, PrintableJournalEntryProps>(
  ({ entry, companyName = 'الشركة' }, ref) => {
    const formatCurrency = (amount: number | null | undefined) => {
      if (amount === null || amount === undefined) return '0.00';
      return amount.toLocaleString('ar-SA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    };

    const getOperationType = () => {
      return referenceTypeLabels[entry.reference_type || 'manual'] || 'يدوي';
    };

    return (
      <div ref={ref} className="p-8 bg-white text-black print:p-4" dir="rtl">
        {/* Header */}
        <div className="text-center mb-6 border-b-2 border-gray-800 pb-4">
          <h1 className="text-2xl font-bold mb-1">{companyName}</h1>
          <h2 className="text-xl font-semibold">قيد يومية</h2>
          <p className="text-sm text-gray-600">Journal Entry</p>
        </div>

        {/* Entry Info */}
        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div className="space-y-2">
            <div className="flex gap-2">
              <span className="font-bold min-w-24">رقم القيد:</span>
              <span className="font-mono">{entry.entry_number}</span>
            </div>
            <div className="flex gap-2">
              <span className="font-bold min-w-24">تاريخ القيد:</span>
              <span>{entry.entry_date ? format(new Date(entry.entry_date), 'yyyy/MM/dd', { locale: ar }) : '-'}</span>
            </div>
            <div className="flex gap-2">
              <span className="font-bold min-w-24">نوع العملية:</span>
              <span>{getOperationType()}</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              <span className="font-bold min-w-24">حالة القيد:</span>
              <span className={entry.is_posted ? 'text-green-700 font-semibold' : 'text-amber-600'}>
                {entry.is_posted ? 'مرحّل' : 'غير مرحّل'}
              </span>
            </div>
            {entry.reference_id && (
              <div className="flex gap-2">
                <span className="font-bold min-w-24">رقم المرجع:</span>
                <span className="font-mono text-xs">{entry.reference_id.slice(0, 8)}...</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="font-bold min-w-24">تاريخ الإنشاء:</span>
              <span>{entry.created_at ? format(new Date(entry.created_at), 'yyyy/MM/dd HH:mm') : '-'}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        {entry.description && (
          <div className="mb-4 p-3 bg-gray-50 border rounded">
            <span className="font-bold">البيان: </span>
            <span>{entry.description}</span>
          </div>
        )}

        {/* Entry Lines Table */}
        <table className="w-full border-collapse border border-gray-400 mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 p-2 text-right">رقم الحساب</th>
              <th className="border border-gray-400 p-2 text-right">اسم الحساب</th>
              <th className="border border-gray-400 p-2 text-right">البيان</th>
              <th className="border border-gray-400 p-2 text-left w-28">مدين</th>
              <th className="border border-gray-400 p-2 text-left w-28">دائن</th>
            </tr>
          </thead>
          <tbody>
            {entry.journal_entry_lines?.map((line, index) => (
              <tr key={line.id || index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="border border-gray-400 p-2 font-mono text-sm">
                  {line.account?.account_code || '-'}
                </td>
                <td className="border border-gray-400 p-2">
                  {line.account?.account_name || '-'}
                </td>
                <td className="border border-gray-400 p-2 text-sm">
                  {line.description || '-'}
                </td>
                <td className="border border-gray-400 p-2 text-left font-mono">
                  {(line.debit_amount ?? 0) > 0 ? formatCurrency(line.debit_amount) : '-'}
                </td>
                <td className="border border-gray-400 p-2 text-left font-mono">
                  {(line.credit_amount ?? 0) > 0 ? formatCurrency(line.credit_amount) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-200 font-bold">
              <td colSpan={3} className="border border-gray-400 p-2 text-right">
                الإجمالي
              </td>
              <td className="border border-gray-400 p-2 text-left font-mono">
                {formatCurrency(entry.total_debit)}
              </td>
              <td className="border border-gray-400 p-2 text-left font-mono">
                {formatCurrency(entry.total_credit)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Balance Check */}
        <div className={`p-3 rounded text-center font-bold ${
          Math.abs(entry.total_debit - entry.total_credit) < 0.01 
            ? 'bg-green-100 text-green-800' 
            : 'bg-red-100 text-red-800'
        }`}>
          {Math.abs(entry.total_debit - entry.total_credit) < 0.01 
            ? '✓ القيد متوازن' 
            : `✗ القيد غير متوازن - الفرق: ${formatCurrency(Math.abs(entry.total_debit - entry.total_credit))}`
          }
        </div>

        {/* Signature Section */}
        <div className="mt-8 pt-4 border-t grid grid-cols-3 gap-8 text-center">
          <div>
            <div className="border-b border-gray-400 mb-2 h-12"></div>
            <p className="text-sm font-medium">المُعد</p>
          </div>
          <div>
            <div className="border-b border-gray-400 mb-2 h-12"></div>
            <p className="text-sm font-medium">المراجع</p>
          </div>
          <div>
            <div className="border-b border-gray-400 mb-2 h-12"></div>
            <p className="text-sm font-medium">المدير المالي</p>
          </div>
        </div>

        {/* Print Footer */}
        <div className="mt-6 text-center text-xs text-gray-500 print:mt-4">
          <p>تاريخ الطباعة: {format(new Date(), 'yyyy/MM/dd HH:mm')}</p>
        </div>
      </div>
    );
  }
);

PrintableJournalEntry.displayName = 'PrintableJournalEntry';

export default PrintableJournalEntry;
