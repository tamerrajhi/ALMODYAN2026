import { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileText, Zap, AlertTriangle, Check } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export interface InvoiceForAllocation {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
}

export interface AllocationEntry {
  invoiceId: string;
  amount: number;
}

interface InvoiceAllocationsPickerProps {
  invoices: InvoiceForAllocation[];
  paymentAmount: number;
  allocations: AllocationEntry[];
  onAllocationsChange: (allocations: AllocationEntry[]) => void;
  disabled?: boolean;
}

export default function InvoiceAllocationsPicker({
  invoices,
  paymentAmount,
  allocations,
  onAllocationsChange,
  disabled = false,
}: InvoiceAllocationsPickerProps) {
  const { t } = useLanguage();

  // Local state for input values (strings for better UX)
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  // Initialize input values from allocations
  useEffect(() => {
    const newInputValues: Record<string, string> = {};
    allocations.forEach((alloc) => {
      newInputValues[alloc.invoiceId] = alloc.amount.toString();
    });
    setInputValues(newInputValues);
  }, [allocations]);

  // Calculate totals
  const allocatedTotal = useMemo(() => {
    return allocations.reduce((sum, a) => sum + a.amount, 0);
  }, [allocations]);

  const unallocatedRemainder = useMemo(() => {
    return Math.max(0, paymentAmount - allocatedTotal);
  }, [paymentAmount, allocatedTotal]);

  const isOverAllocated = allocatedTotal > paymentAmount + 0.01;

  // Handle allocation amount change
  const handleAllocationChange = (invoiceId: string, value: string) => {
    setInputValues((prev) => ({ ...prev, [invoiceId]: value }));

    const numericValue = parseFloat(value) || 0;
    const invoice = invoices.find((inv) => inv.id === invoiceId);

    if (!invoice) return;

    // Clamp to remaining amount
    const clampedValue = Math.min(numericValue, invoice.remainingAmount);

    // Update allocations
    const newAllocations = allocations.filter((a) => a.invoiceId !== invoiceId);
    if (clampedValue > 0) {
      newAllocations.push({ invoiceId, amount: clampedValue });
    }
    onAllocationsChange(newAllocations);
  };

  // Handle toggle invoice selection
  const handleToggleInvoice = (invoiceId: string) => {
    const isSelected = allocations.some((a) => a.invoiceId === invoiceId);

    if (isSelected) {
      // Remove allocation
      onAllocationsChange(allocations.filter((a) => a.invoiceId !== invoiceId));
      setInputValues((prev) => {
        const newValues = { ...prev };
        delete newValues[invoiceId];
        return newValues;
      });
    } else {
      // Add with remaining amount (clamped by unallocated)
      const invoice = invoices.find((inv) => inv.id === invoiceId);
      if (invoice) {
        const allocAmount = Math.min(invoice.remainingAmount, unallocatedRemainder);
        if (allocAmount > 0) {
          onAllocationsChange([...allocations, { invoiceId, amount: allocAmount }]);
          setInputValues((prev) => ({ ...prev, [invoiceId]: allocAmount.toString() }));
        }
      }
    }
  };

  // Auto-allocate from oldest to newest
  const handleAutoAllocate = () => {
    if (paymentAmount <= 0) return;

    let remaining = paymentAmount;
    const newAllocations: AllocationEntry[] = [];
    const newInputValues: Record<string, string> = {};

    // Sort by date (oldest first)
    const sortedInvoices = [...invoices].sort(
      (a, b) => new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime()
    );

    for (const invoice of sortedInvoices) {
      if (remaining <= 0) break;
      if (invoice.remainingAmount <= 0) continue;

      const allocAmount = Math.min(invoice.remainingAmount, remaining);
      newAllocations.push({ invoiceId: invoice.id, amount: allocAmount });
      newInputValues[invoice.id] = allocAmount.toString();
      remaining -= allocAmount;
    }

    onAllocationsChange(newAllocations);
    setInputValues(newInputValues);
  };

  // Clear all allocations
  const handleClearAll = () => {
    onAllocationsChange([]);
    setInputValues({});
  };

  // Validation check for individual invoice
  const getValidationError = (invoiceId: string): string | null => {
    const allocation = allocations.find((a) => a.invoiceId === invoiceId);
    if (!allocation) return null;

    const invoice = invoices.find((inv) => inv.id === invoiceId);
    if (!invoice) return null;

    if (allocation.amount > invoice.remainingAmount + 0.01) {
      return 'يتجاوز المتبقي';
    }
    return null;
  };

  if (invoices.length === 0) {
    return (
      <Alert className="border-muted">
        <FileText className="h-4 w-4" />
        <AlertDescription>لا توجد فواتير مفتوحة لهذا المورد</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">مبلغ السداد:</span>{' '}
            <span className="font-bold">{paymentAmount.toLocaleString()} ر.س</span>
          </div>
          <div>
            <span className="text-muted-foreground">تم توزيعه:</span>{' '}
            <span className={cn('font-bold', isOverAllocated ? 'text-destructive' : 'text-green-600')}>
              {allocatedTotal.toLocaleString()} ر.س
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">المتبقي للتوزيع:</span>{' '}
            <span className="font-bold">{unallocatedRemainder.toLocaleString()} ر.س</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAutoAllocate}
            disabled={disabled || paymentAmount <= 0}
            className="gap-1"
          >
            <Zap className="h-3 w-3" />
            توزيع تلقائي
          </Button>
          {allocations.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={disabled}
            >
              مسح الكل
            </Button>
          )}
        </div>
      </div>

      {/* Over-allocation warning */}
      {isOverAllocated && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            إجمالي التوزيعات ({allocatedTotal.toLocaleString()}) يتجاوز مبلغ الدفعة ({paymentAmount.toLocaleString()})
          </AlertDescription>
        </Alert>
      )}

      {/* Invoices Table */}
      <div className="border rounded-lg max-h-[300px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>رقم الفاتورة</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead className="text-left">الإجمالي</TableHead>
              <TableHead className="text-left">المتبقي</TableHead>
              <TableHead className="text-left w-[140px]">مبلغ التوزيع</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => {
              const isSelected = allocations.some((a) => a.invoiceId === invoice.id);
              const validationError = getValidationError(invoice.id);

              return (
                <TableRow
                  key={invoice.id}
                  className={cn(isSelected && 'bg-primary/5')}
                >
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleToggleInvoice(invoice.id)}
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-sm">{invoice.invoiceNumber}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(invoice.invoiceDate), 'yyyy/MM/dd')}
                  </TableCell>
                  <TableCell className="text-left font-mono">
                    {invoice.totalAmount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-left font-mono font-medium text-primary">
                    {invoice.remainingAmount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-left">
                    {isSelected ? (
                      <div className="space-y-1">
                        <Input
                          type="number"
                          min="0"
                          max={invoice.remainingAmount}
                          step="0.01"
                          value={inputValues[invoice.id] || ''}
                          onChange={(e) => handleAllocationChange(invoice.id, e.target.value)}
                          disabled={disabled}
                          className={cn(
                            'h-8 w-full font-mono',
                            validationError && 'border-destructive'
                          )}
                        />
                        {validationError && (
                          <p className="text-xs text-destructive">{validationError}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Selected count */}
      {allocations.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-green-600" />
          <span>تم اختيار {allocations.length} فاتورة</span>
        </div>
      )}
    </div>
  );
}
