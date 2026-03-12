import { useNavigate } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AffectedRecord } from '@/lib/accounting-health-records';

interface IssueRecordsTableProps {
  records: AffectedRecord[];
  isLoading?: boolean;
  showExtraColumns?: boolean;
}

export function IssueRecordsTable({ records, isLoading, showExtraColumns }: IssueRecordsTableProps) {
  const navigate = useNavigate();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
      case 'posted':
      case 'paid':
      case 'completed':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'pending':
      case 'draft':
        return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
      case 'cancelled':
        return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'discrepancy':
        return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const handleOpenDocument = (record: AffectedRecord) => {
    if (record.linkPath && record.linkPath !== '#') {
      navigate(record.linkPath);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <FileText className="w-12 h-12 mb-4 opacity-50" />
        <p>لا توجد سجلات</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right w-[50px]">#</TableHead>
            <TableHead className="text-right">رقم المستند</TableHead>
            <TableHead className="text-right">نوع المستند</TableHead>
            <TableHead className="text-right">العميل/المورد</TableHead>
            <TableHead className="text-right">التاريخ</TableHead>
            <TableHead className="text-right">المبلغ</TableHead>
            <TableHead className="text-right">الحالة</TableHead>
            {showExtraColumns && (
              <>
                <TableHead className="text-right">تفاصيل إضافية</TableHead>
              </>
            )}
            <TableHead className="text-center w-[80px]">فتح</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record, index) => (
            <TableRow key={record.id} className="hover:bg-muted/50">
              <TableCell className="text-muted-foreground">{index + 1}</TableCell>
              <TableCell className="font-medium">{record.documentNumber}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {record.documentTypeLabel}
                </Badge>
              </TableCell>
              <TableCell>{record.customerOrSupplier || '-'}</TableCell>
              <TableCell>{formatDate(record.date)}</TableCell>
              <TableCell className="font-medium">{formatCurrency(record.amount)}</TableCell>
              <TableCell>
                <Badge 
                  variant="outline" 
                  className={cn('text-xs', getStatusColor(record.status))}
                >
                  {record.statusLabel}
                </Badge>
              </TableCell>
              {showExtraColumns && record.extraData && (
                <TableCell className="text-sm text-muted-foreground">
                  {record.extraData.difference !== undefined && (
                    <span>الفرق: {formatCurrency(record.extraData.difference)}</span>
                  )}
                  {record.extraData.debit !== undefined && (
                    <span>مدين: {formatCurrency(record.extraData.debit)} | دائن: {formatCurrency(record.extraData.credit)}</span>
                  )}
                  {record.extraData.paymentMethod && (
                    <span>طريقة الدفع: {record.extraData.paymentMethod}</span>
                  )}
                </TableCell>
              )}
              <TableCell className="text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenDocument(record)}
                  disabled={!record.linkPath || record.linkPath === '#'}
                  className="h-8 w-8 p-0"
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
