import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ExternalLink,
  BookOpen,
  Calendar,
  FileText,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useJournalEntryDetails, type JournalEntryDetails } from '@/hooks/useItemMovements';

interface JournalEntryPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journalEntryId: string | null;
}

const statusConfig: Record<string, { ar: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  posted: { ar: 'مرحّل', variant: 'default' },
  draft: { ar: 'مسودة', variant: 'outline' },
  reversed: { ar: 'ملغي', variant: 'destructive' },
};

export function JournalEntryPreviewDialog({
  open,
  onOpenChange,
  journalEntryId,
}: JournalEntryPreviewDialogProps) {
  const navigate = useNavigate();
  const { data: entry, isLoading, error } = useJournalEntryDetails(journalEntryId);

  const handleOpenEntry = () => {
    if (journalEntryId) {
      onOpenChange(false);
      navigate(`/accounting/journal-entries`);
    }
  };

  const isBalanced = entry ? Math.abs(entry.total_debit - entry.total_credit) < 0.01 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            معاينة القيد المحاسبي
          </DialogTitle>
          <DialogDescription>
            تفاصيل القيد المرتبط بحركة المخزون
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {isLoading ? (
            <LoadingSkeleton />
          ) : error ? (
            <ErrorState onRetry={handleOpenEntry} />
          ) : !entry ? (
            <EmptyState />
          ) : (
            <EntryContent 
              entry={entry} 
              isBalanced={isBalanced}
              onOpenEntry={handleOpenEntry} 
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
      <Separator />
      <Skeleton className="h-32" />
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-center py-8">
      <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
      <p className="text-muted-foreground mb-4">تعذر تحميل تفاصيل القيد</p>
      <Button variant="outline" onClick={onRetry}>
        <ExternalLink className="h-4 w-4 ml-2" />
        فتح صفحة القيود
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-8">
      <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <p className="text-muted-foreground">لا توجد بيانات للقيد</p>
    </div>
  );
}

interface EntryContentProps {
  entry: JournalEntryDetails;
  isBalanced: boolean;
  onOpenEntry: () => void;
}

function EntryContent({ entry, isBalanced, onOpenEntry }: EntryContentProps) {
  const statusInfo = statusConfig[entry.status || ''] || { ar: entry.status || '-', variant: 'outline' as const };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm text-muted-foreground">رقم القيد</p>
          <p className="text-xl font-bold font-mono">{entry.entry_number}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusInfo.variant}>{statusInfo.ar}</Badge>
          {isBalanced ? (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              <CheckCircle2 className="h-3 w-3 ml-1" />
              متوازن
            </Badge>
          ) : (
            <Badge variant="destructive">
              <AlertCircle className="h-3 w-3 ml-1" />
              غير متوازن
            </Badge>
          )}
        </div>
      </div>

      <Separator />

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex items-start gap-2">
          <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">التاريخ</p>
            <p className="font-medium">
              {format(new Date(entry.entry_date), 'yyyy/MM/dd', { locale: ar })}
            </p>
          </div>
        </div>
        {entry.description && (
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">الوصف</p>
              <p className="font-medium line-clamp-2">{entry.description}</p>
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Journal Lines Table */}
      <div>
        <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          بنود القيد
        </h4>
        <div className="border rounded-lg overflow-x-auto">
          <Table className="min-w-[500px]">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-right">الحساب</TableHead>
                <TableHead className="text-right w-[140px]">مدين</TableHead>
                <TableHead className="text-right w-[140px]">دائن</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div>
                      <span className="font-mono text-xs text-muted-foreground ml-2">
                        {line.account_code}
                      </span>
                      <span>{line.account_name}</span>
                    </div>
                    {line.description && (
                      <p className="text-xs text-muted-foreground mt-1">{line.description}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {line.debit_amount > 0 ? formatCurrency(line.debit_amount) : '-'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {line.credit_amount > 0 ? formatCurrency(line.credit_amount) : '-'}
                  </TableCell>
                </TableRow>
              ))}
              {/* Totals Row */}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell>الإجمالي</TableCell>
                <TableCell className="text-right text-primary">
                  {formatCurrency(entry.total_debit)}
                </TableCell>
                <TableCell className="text-right text-primary">
                  {formatCurrency(entry.total_credit)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Action */}
      <div className="pt-2">
        <Button onClick={onOpenEntry} className="w-full">
          <ExternalLink className="h-4 w-4 ml-2" />
          فتح صفحة القيود
        </Button>
      </div>
    </>
  );
}

export default JournalEntryPreviewDialog;
