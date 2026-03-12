import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, ExternalLink, Filter, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  PurchasingDrillDownType,
  PurchasingDrillDownFilters,
  InvoiceRecord,
  ReturnRecord,
  VendorRecord,
} from './types';
import { PURCHASING_RUNBOOKS } from './types';
import { PurchasingRunbookPanel } from './PurchasingRunbookPanel';
import { PurchasingDrillDownFiltersPanel } from './PurchasingDrillDownFilters';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: PurchasingDrillDownType;
}

const DRILL_DOWN_TITLES: Record<PurchasingDrillDownType, { en: string; ar: string }> = {
  draft_invoices: { en: 'Draft Invoices', ar: 'فواتير مسودة' },
  posted_no_je: { en: 'Posted without JE', ar: 'مرحلة بدون قيد' },
  returns_pending_post: { en: 'Returns Pending Posting', ar: 'مرتجعات في انتظار الترحيل' },
  returns_ref_mismatch: { en: 'Returns Reference Mismatch', ar: 'مرتجعات - عدم تطابق المرجع' },
  vendor_negative_balance: { en: 'Vendors with Negative Balance', ar: 'موردين برصيد سالب' },
  paid_with_remaining: { en: 'Paid but Remaining > 0', ar: 'مدفوع لكن المتبقي > 0' },
  missing_movements: { en: 'Missing Inventory Movements', ar: 'حركات مخزون مفقودة' },
  wrong_account_mapping: { en: 'Wrong Account Mapping', ar: 'خريطة حسابات خاطئة' },
};

export function PurchasingDrillDownDialog({ open, onOpenChange, type }: Props) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const isAr = language === 'ar';

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [filters, setFilters] = useState<PurchasingDrillDownFilters>({});
  const [showFilters, setShowFilters] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type });
      if (filters.supplier_id) params.set('supplier_id', filters.supplier_id);
      if (filters.branch_id) params.set('branch_id', filters.branch_id);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      
      const res = await fetch(`/api/purchasing-drilldown?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch drilldown data');
      const result = await res.json();
      setData(result || []);
    } catch (err) {
      console.error('Drilldown fetch error:', err);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [type, filters]);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  const handleClearFilters = () => {
    setFilters({});
  };

  const handleNavigate = (record: any) => {
    if (['draft_invoices', 'posted_no_je', 'paid_with_remaining'].includes(type)) {
      navigate(`/purchasing/invoices/${record.id}/view`);
      onOpenChange(false);
    } else if (['returns_pending_post', 'returns_ref_mismatch'].includes(type)) {
      navigate(`/purchasing/returns-hub/r/${record.id}`);
      onOpenChange(false);
    } else if (type === 'vendor_negative_balance') {
      // Could navigate to supplier detail page if exists
      toast.info(isAr ? 'عرض تفاصيل المورد' : 'View supplier details');
    }
  };

  const runbook = PURCHASING_RUNBOOKS[type];
  const title = DRILL_DOWN_TITLES[type];

  const renderInvoiceTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{isAr ? 'رقم الفاتورة' : 'Invoice #'}</TableHead>
          <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
          <TableHead>{isAr ? 'المورد' : 'Supplier'}</TableHead>
          <TableHead>{isAr ? 'الفرع' : 'Branch'}</TableHead>
          <TableHead className="text-right">{isAr ? 'المبلغ' : 'Amount'}</TableHead>
          <TableHead className="text-right">{isAr ? 'المتبقي' : 'Remaining'}</TableHead>
          <TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((record: InvoiceRecord) => (
          <TableRow key={record.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleNavigate(record)}>
            <TableCell className="font-mono">{record.invoice_number}</TableCell>
            <TableCell>{record.invoice_date}</TableCell>
            <TableCell>{record.supplier_name || '-'}</TableCell>
            <TableCell>{record.branch_name || '-'}</TableCell>
            <TableCell className="text-right">{record.total_amount?.toLocaleString()}</TableCell>
            <TableCell className="text-right">{record.remaining_amount?.toLocaleString()}</TableCell>
            <TableCell>
              <Badge variant={record.status === 'draft' ? 'secondary' : 'default'}>
                {record.status}
              </Badge>
            </TableCell>
            <TableCell>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderReturnTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{isAr ? 'رقم المرتجع' : 'Return #'}</TableHead>
          <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
          <TableHead>{isAr ? 'المورد' : 'Supplier'}</TableHead>
          <TableHead>{isAr ? 'الفرع' : 'Branch'}</TableHead>
          <TableHead className="text-right">{isAr ? 'المبلغ' : 'Amount'}</TableHead>
          <TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((record: ReturnRecord) => (
          <TableRow key={record.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleNavigate(record)}>
            <TableCell className="font-mono">{record.return_number}</TableCell>
            <TableCell>{record.return_date}</TableCell>
            <TableCell>{record.supplier_name || '-'}</TableCell>
            <TableCell>{record.branch_name || '-'}</TableCell>
            <TableCell className="text-right">{record.total_amount?.toLocaleString()}</TableCell>
            <TableCell>
              <Badge variant={record.status === 'draft' ? 'secondary' : 'default'}>
                {record.status}
              </Badge>
            </TableCell>
            <TableCell>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderVendorTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{isAr ? 'الكود' : 'Code'}</TableHead>
          <TableHead>{isAr ? 'الاسم' : 'Name'}</TableHead>
          <TableHead className="text-right">{isAr ? 'الرصيد المستحق' : 'Outstanding'}</TableHead>
          <TableHead className="text-right">{isAr ? 'حد الائتمان' : 'Credit Limit'}</TableHead>
          <TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((record: VendorRecord) => (
          <TableRow key={record.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleNavigate(record)}>
            <TableCell className="font-mono">{record.code}</TableCell>
            <TableCell>{record.name}</TableCell>
            <TableCell className="text-right text-red-600">{record.outstanding_balance?.toLocaleString()}</TableCell>
            <TableCell className="text-right">{record.credit_limit?.toLocaleString()}</TableCell>
            <TableCell>
              <Badge variant={record.is_active ? 'default' : 'secondary'}>
                {record.is_active ? (isAr ? 'نشط' : 'Active') : (isAr ? 'غير نشط' : 'Inactive')}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderTable = () => {
    if (['draft_invoices', 'posted_no_je', 'paid_with_remaining'].includes(type)) {
      return renderInvoiceTable();
    }
    if (['returns_pending_post', 'returns_ref_mismatch'].includes(type)) {
      return renderReturnTable();
    }
    if (type === 'vendor_negative_balance') {
      return renderVendorTable();
    }
    return (
      <div className="text-center text-muted-foreground py-8">
        {isAr ? 'لا توجد بيانات متاحة' : 'No data available'}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh]" dir={isAr ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{isAr ? title.ar : title.en}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{data.length} {isAr ? 'سجل' : 'records'}</Badge>
              <Button variant="ghost" size="icon" onClick={fetchData} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setShowFilters(!showFilters)}>
                <Filter className="h-4 w-4" />
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Filters Panel */}
        {showFilters && (
          <PurchasingDrillDownFiltersPanel
            type={type}
            filters={filters}
            onChange={setFilters}
            onSearch={fetchData}
            onClear={handleClearFilters}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Data Table */}
          <div className="lg:col-span-2">
            <ScrollArea className="h-[500px] border rounded-md">
              {loading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : data.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  {isAr ? 'لا توجد سجلات' : 'No records found'}
                </div>
              ) : (
                renderTable()
              )}
            </ScrollArea>
          </div>

          {/* Runbook Panel */}
          <div className="lg:col-span-1">
            <PurchasingRunbookPanel type={type} runbook={runbook} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
