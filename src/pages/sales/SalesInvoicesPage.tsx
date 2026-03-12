import { useState, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileText,
  Plus,
  Search,
  Download,
  Eye,
  Printer,
  MoreHorizontal,
  Receipt,
  CreditCard,
  ClipboardCheck,
  Loader2,
  Calendar,
  Banknote,
  CheckCircle2,
  Clock,
  Pencil,
  FileCode,
  Store,
  ShoppingCart,
  Filter,
  TrendingUp,
  RotateCcw,
  FileX,
} from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import PrintableInvoice from '@/components/invoices/PrintableInvoice';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { ZatcaSubmitButton } from '@/components/zatca/ZatcaSubmitButton';
import { ZatcaStatusBadge } from '@/components/zatca/ZatcaStatusBadge';
import { useBranches } from '@/hooks/useBranches';
import { queryTable } from '@/lib/dataGateway';
import * as apiClient from '@/lib/apiClient';

interface SalesInvoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  invoice_date: string;
  due_date: string | null;
  customer_id: string | null;
  branch_id: string | null;
  sale_id?: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  discount_amount: number | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
  zatca_status: string | null;
  zatca_invoice_type: string | null;
  zatca_signed_xml: string | null;
  notes: string | null;
  customer?: { full_name: string; customer_code: string; vat_number?: string };
  branch?: { branch_name: string };
  sale?: { sale_code: string } | null;
}

interface SalesInvoicesPageProps {
  sourceMode?: 'pos' | 'erp' | 'all';
}

export default function SalesInvoicesPage({ sourceMode = 'all' }: SalesInvoicesPageProps) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const isRTL = language === 'ar';
  
  const isSourceLocked = sourceMode !== 'all';
  
  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSerial, setDebouncedSerial] = useState('');
  const serialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [documentTypeFilter, setDocumentTypeFilter] = useState<string>('all'); // invoices | returns | all
  const [sourceFilter, setSourceFilter] = useState<string>(sourceMode === 'pos' ? 'pos' : sourceMode === 'erp' ? 'regular' : 'all'); // pos | regular | all
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all'); // pending | partial | paid | all
  const [documentStatusFilter, setDocumentStatusFilter] = useState<string>('all'); // draft | approved | cancelled | all
  const [zatcaFilter, setZatcaFilter] = useState<string>('all');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();

  const isSerialSearch = useMemo(() => {
    const term = searchTerm.trim().toUpperCase();
    return /^(FSETN|FSETE|FSETR|FSETB)\d{0,6}$/i.test(term);
  }, [searchTerm]);

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    const term = value.trim().toUpperCase();
    const looksLikeSerial = /^(FSETN|FSETE|FSETR|FSETB)\d{0,6}$/i.test(term);
    if (looksLikeSerial && term.length >= 3) {
      if (serialTimerRef.current) clearTimeout(serialTimerRef.current);
      serialTimerRef.current = setTimeout(() => setDebouncedSerial(value.trim()), 400);
    } else {
      if (serialTimerRef.current) clearTimeout(serialTimerRef.current);
      setDebouncedSerial('');
    }
  };
  
  // Print states
  const [selectedInvoiceForPrint, setSelectedInvoiceForPrint] = useState<SalesInvoice | null>(null);
  const [invoiceItemsForPrint, setInvoiceItemsForPrint] = useState<any[]>([]);
  const printRef = useRef<HTMLDivElement>(null);
  const [isPrintLoading, setIsPrintLoading] = useState(false);

  // Fetch branches
  const { data: branches = [] } = useBranches(true);

  // Fetch sales invoices AND sales returns
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['sales-invoices', sourceMode, paymentStatusFilter, zatcaFilter, customerFilter, branchFilter, startDate, endDate, debouncedSerial],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (paymentStatusFilter !== 'all') params.payment_status = paymentStatusFilter;
      if (zatcaFilter !== 'all') params.zatca_status = zatcaFilter;
      if (customerFilter !== 'all') params.customer_id = customerFilter;
      if (branchFilter !== 'all') params.branch_id = branchFilter;
      if (startDate) params.start_date = format(startDate, 'yyyy-MM-dd');
      if (endDate) params.end_date = format(endDate, 'yyyy-MM-dd');
      if (debouncedSerial) params.serial_search = debouncedSerial;

      if (sourceMode === 'pos') {
        const qs = new URLSearchParams(params).toString();
        const res = await fetch(`/api/pos/sales-invoices${qs ? '?' + qs : ''}`, { credentials: 'include' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to fetch POS invoices');
        }
        return await res.json();
      }
      const { data, error } = await apiClient.get<SalesInvoice[]>('/api/sales-invoices-list', params);
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // Fetch customers for filter
  const { data: customers = [] } = useQuery({
    queryKey: ['customers-list'],
    queryFn: async () => {
      const { data, error } = await queryTable<any[]>('customers', { select: 'id, name, code', order: { column: 'name', ascending: true } });
      if (error) throw new Error(error.message);
      return (data || []).map(c => ({ id: c.id, full_name: c.name, customer_code: c.code }));
    },
  });

  // Filter by search, document type, and source
  const filteredInvoices = invoices.filter(invoice => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = isSerialSearch ? true :
      invoice.invoice_number.toLowerCase().includes(searchLower) ||
      invoice.customer?.full_name?.toLowerCase().includes(searchLower) ||
      invoice.customer?.customer_code?.toLowerCase().includes(searchLower) ||
      invoice.customer?.vat_number?.toLowerCase().includes(searchLower) ||
      (invoice.sale?.sale_code?.toLowerCase().includes(searchLower));
    
    // Document type filter (invoices vs returns) - using invoice_type field
    let matchesDocumentType = true;
    if (documentTypeFilter === 'invoices') {
      matchesDocumentType = invoice.invoice_type === 'sales';
    } else if (documentTypeFilter === 'returns') {
      matchesDocumentType = invoice.invoice_type === 'sales_return';
    }
    
    // Source filter (POS vs Regular)
    let matchesSource = true;
    if (sourceFilter === 'pos') {
      matchesSource = invoice.sale_id !== null && invoice.sale_id !== undefined;
    } else if (sourceFilter === 'regular') {
      matchesSource = invoice.sale_id === null || invoice.sale_id === undefined;
    }

    // Document status filter
    let matchesDocStatus = true;
    if (documentStatusFilter !== 'all') {
      if (documentStatusFilter === 'draft') {
        matchesDocStatus = invoice.status === 'pending' || invoice.status === 'draft';
      } else if (documentStatusFilter === 'approved') {
        matchesDocStatus = invoice.status === 'paid' || invoice.status === 'partial';
      } else if (documentStatusFilter === 'cancelled') {
        matchesDocStatus = invoice.status === 'cancelled';
      }
    }
    
    return matchesSearch && matchesDocumentType && matchesSource && matchesDocStatus;
  });

  // Stats
  const stats = {
    total: filteredInvoices.length,
    pending: filteredInvoices.filter(i => i.status === 'pending').length,
    partial: filteredInvoices.filter(i => i.status === 'partial').length,
    paid: filteredInvoices.filter(i => i.status === 'paid').length,
    totalAmount: filteredInvoices.reduce((sum, i) => sum + (i.total_amount || 0), 0),
    paidAmount: filteredInvoices.reduce((sum, i) => sum + (i.paid_amount || 0), 0),
    remainingAmount: filteredInvoices.reduce((sum, i) => sum + (i.remaining_amount || 0), 0),
  };

  // Payment status badge
  const paymentStatusBadge = (status: string) => {
    const config: Record<string, { className: string; label: string }> = {
      pending: { 
        className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400', 
        label: isRTL ? 'غير مدفوعة' : 'Unpaid' 
      },
      partial: { 
        className: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400', 
        label: isRTL ? 'جزئية' : 'Partial' 
      },
      paid: { 
        className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400', 
        label: isRTL ? 'مدفوعة' : 'Paid' 
      },
      cancelled: { 
        className: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400', 
        label: isRTL ? 'ملغاة' : 'Cancelled' 
      },
    };
    const { className, label } = config[status] || { className: '', label: status };
    return <Badge variant="outline" className={className}>{label}</Badge>;
  };

  // Source badge
  const sourceBadge = (hasSaleId: boolean) => {
    if (hasSaleId) {
      return (
        <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400">
          <Store className="w-3 h-3 ml-1" />
          POS
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400">
        <ShoppingCart className="w-3 h-3 ml-1" />
        {isRTL ? 'عادي' : 'Regular'}
      </Badge>
    );
  };

  const handleExport = () => {
    const exportData = filteredInvoices.map((inv) => ({
      [t.salesInvoices.reference]: inv.invoice_number,
      [isRTL ? 'المصدر' : 'Source']: inv.sale_id ? 'POS' : (isRTL ? 'عادي' : 'Regular'),
      [t.salesInvoices.customerName]: inv.customer?.full_name || '-',
      [t.salesInvoices.issueDate]: format(new Date(inv.invoice_date), 'yyyy-MM-dd'),
      [t.salesInvoices.dueDate]: inv.due_date ? format(new Date(inv.due_date), 'yyyy-MM-dd') : '-',
      [t.salesInvoices.totalValue]: inv.total_amount,
      [t.salesInvoices.balance]: inv.remaining_amount,
      [isRTL ? 'حالة الدفع' : 'Payment Status']: inv.status,
      [t.salesInvoices.authorityStatus]: inv.zatca_status || 'not_submitted',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t.salesInvoices.title);
    XLSX.writeFile(wb, `${t.salesInvoices.title}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  // Handle View Invoice (Read-Only)
  const handleView = (invoice: SalesInvoice) => {
    navigate(sourceMode === 'pos' ? `/pos/invoices/${invoice.id}/view` : `/sales/invoices/${invoice.id}/view`);
  };

  // Handle Edit Invoice
  const handleEdit = (invoice: SalesInvoice) => {
    navigate(`/sales/invoices/${invoice.id}`);
  };

  // Handle Create Return from invoice row
  const handleCreateReturn = (invoice: SalesInvoice) => {
    const isPOS = invoice.sale_id !== null && invoice.sale_id !== undefined;
    if (isPOS) {
      navigate(`/pos/return?invoice_id=${invoice.id}`);
    } else {
      navigate(`/sales/returns/new?invoice_id=${invoice.id}`);
    }
  };

  const canCreateReturn = (invoice: SalesInvoice): boolean => {
    if (invoice.invoice_type === 'sales_return') return false;
    const status = invoice.status?.toLowerCase();
    if (status === 'voided' || status === 'cancelled' || status === 'void') return false;
    return status === 'posted';
  };

  // Handle Print Invoice
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: selectedInvoiceForPrint ? `فاتورة-${selectedInvoiceForPrint.invoice_number}` : 'فاتورة',
    onAfterPrint: () => {
      setSelectedInvoiceForPrint(null);
      setInvoiceItemsForPrint([]);
    },
  });

  const preparePrint = async (invoice: SalesInvoice) => {
    setIsPrintLoading(true);
    try {
      // Fetch invoice items for printing (POS invoices use sale_items)
      const { data: items, error } = invoice.sale_id
        ? await apiClient.get<any[]>('/api/sales-invoice-items', { sale_id: invoice.sale_id })
        : await apiClient.get<any[]>('/api/sales-invoice-items', { invoice_id: invoice.id });
      if (error) throw new Error(error.message);

      if (!items || items.length === 0) {
        toast.error('لا توجد أصناف لهذه الفاتورة للطباعة');
        return;
      }

      // Fetch customer data only if customer_id exists
      let customerData = null;
      if (invoice.customer_id) {
        const { data, error: customerError } = await apiClient.get<any>('/api/customer-by-id/' + invoice.customer_id);
        if (customerError) throw new Error(customerError.message);
        customerData = data;
      }

      const invoiceForPrint = {
        ...invoice,
        customer: customerData || invoice.customer,
      };

      setSelectedInvoiceForPrint(invoiceForPrint as SalesInvoice);
      setInvoiceItemsForPrint(items);

      // Print بعد التأكد من رندر الـ ref
      requestAnimationFrame(() => {
        setTimeout(() => {
          handlePrint();
        }, 50);
      });
    } catch (error: any) {
      console.error('Error preparing print:', error);
      toast.error(t.common?.error || 'حدث خطأ أثناء تحضير الطباعة');
    } finally {
      setIsPrintLoading(false);
    }
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('');
    setDebouncedSerial('');
    if (serialTimerRef.current) clearTimeout(serialTimerRef.current);
    setDocumentTypeFilter('all');
    if (!isSourceLocked) setSourceFilter('all');
    setPaymentStatusFilter('all');
    setDocumentStatusFilter('all');
    setZatcaFilter('all');
    setCustomerFilter('all');
    setBranchFilter('all');
    setStartDate(undefined);
    setEndDate(undefined);
  };

  const hasActiveFilters = searchTerm || documentTypeFilter !== 'all' || 
    (!isSourceLocked && sourceFilter !== 'all') || 
    paymentStatusFilter !== 'all' || documentStatusFilter !== 'all' || zatcaFilter !== 'all' || 
    customerFilter !== 'all' || branchFilter !== 'all' || startDate || endDate;

  return (
    <>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Tabs: فواتير / مرتجعات */}
        <div className="flex items-center gap-1 border-b">
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
            data-testid="tab-invoices"
          >
            {isRTL ? 'فواتير' : 'Invoices'}
          </button>
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground"
            data-testid="tab-returns"
            onClick={() => navigate(sourceMode === 'pos' ? '/pos/returns' : '/sales/returns?mode=erp')}
          >
            {isRTL ? 'مرتجعات' : 'Returns'}
          </button>
        </div>

        {/* Header with Actions */}
        <div className="page-header-rtl">
          <div>
            <h1 className="page-title">
              {sourceMode === 'pos' 
                ? (isRTL ? 'فواتير نقاط البيع' : 'POS Invoices')
                : sourceMode === 'erp'
                  ? (isRTL ? 'فواتير المبيعات العامة' : 'General Sales Invoices')
                  : t.salesInvoices.title}
            </h1>
            <p className="page-description">
              {sourceMode === 'pos'
                ? (isRTL ? 'عرض وإدارة فواتير نقاط البيع' : 'View and manage POS invoices')
                : sourceMode === 'erp'
                  ? (isRTL ? 'عرض وإدارة فواتير المبيعات العامة' : 'View and manage general sales invoices')
                  : t.salesInvoices.subtitle}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {sourceMode === 'pos' && (
            <Button onClick={() => navigate('/pos')}>
              <Store className="w-4 h-4 ml-2" />
              {isRTL ? 'شاشة نقطة البيع' : 'POS Screen'}
            </Button>
          )}
          {sourceMode !== 'pos' && (
            <>
              <Button variant="outline" onClick={() => navigate('/sales/receipts')}>
                <Receipt className="w-4 h-4 ml-2" />
                {t.salesInvoices.manageReceipts}
              </Button>
              <Button variant="outline" onClick={() => navigate('/sales/credit-notes')}>
                <CreditCard className="w-4 h-4 ml-2" />
                {t.salesInvoices.creditNotes}
              </Button>
              <Button onClick={() => navigate('/sales/invoices/new')}>
                <Plus className="w-4 h-4 ml-2" />
                {t.salesInvoices.createInvoice}
              </Button>
              <Button variant="outline" onClick={() => navigate('/sales/receipts?new=true')}>
                <Plus className="w-4 h-4 ml-2" />
                {t.salesInvoices.createReceipt}
              </Button>
            </>
          )}
          <Button variant="outline" onClick={handleExport} disabled={filteredInvoices.length === 0}>
            <Download className="w-4 h-4 ml-2" />
            {t.common.export}
          </Button>
          {sourceMode !== 'pos' && (
            <Button variant="outline">
              <ClipboardCheck className="w-4 h-4 ml-2" />
              {t.salesInvoices.addToAudit}
            </Button>
          )}
        </div>

        {/* Enhanced KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total Amount Card */}
          <Card className="border-l-4 border-l-blue-500 dark:border-l-blue-400">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold text-muted-foreground">
                {isRTL ? 'إجمالي المبيعات' : 'Total Sales'}
              </CardTitle>
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {formatCurrency(stats.totalAmount)}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {stats.total} {isRTL ? 'فاتورة' : 'invoices'}
              </p>
            </CardContent>
          </Card>

          {/* Collected Amount Card */}
          <Card className="border-l-4 border-l-green-500 dark:border-l-green-400">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold text-muted-foreground">
                {isRTL ? 'المبالغ المحصلة' : 'Collected Amount'}
              </CardTitle>
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-full">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                {formatCurrency(stats.paidAmount)}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {stats.paid} {isRTL ? 'مدفوعة بالكامل' : 'fully paid'}
              </p>
            </CardContent>
          </Card>

          {/* Remaining Amount Card */}
          <Card className="border-l-4 border-l-orange-500 dark:border-l-orange-400">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold text-muted-foreground">
                {isRTL ? 'المبالغ المتبقية' : 'Remaining Balance'}
              </CardTitle>
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-full">
                <Clock className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                {formatCurrency(stats.remainingAmount)}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {stats.pending + stats.partial} {isRTL ? 'فاتورة معلقة' : 'pending invoices'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters Section */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="w-4 h-4" />
                {isRTL ? 'الفلاتر' : 'Filters'}
              </CardTitle>
              <Button 
                variant={hasActiveFilters ? "destructive" : "outline"} 
                size="sm" 
                onClick={clearFilters}
                className="flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                {isRTL ? 'إعادة تعيين الفلاتر' : 'Reset Filters'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Row 1: Most Used Filters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Document Type Filter */}
              <Select value={documentTypeFilter} onValueChange={setDocumentTypeFilter}>
                <SelectTrigger>
                  {documentTypeFilter === 'all' ? (
                    <span className="text-muted-foreground">{isRTL ? 'نوع العملية' : 'Document Type'}</span>
                  ) : (
                    <SelectValue />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="invoices">{isRTL ? 'فواتير' : 'Invoices'}</SelectItem>
                  <SelectItem value="returns">{isRTL ? 'مرتجعات' : 'Returns'}</SelectItem>
                </SelectContent>
              </Select>

              {/* Source Filter - hidden when sourceMode is locked */}
              {!isSourceLocked && (
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger>
                    {sourceFilter === 'all' ? (
                      <span className="text-muted-foreground">{isRTL ? 'مصدر العملية' : 'Source'}</span>
                    ) : (
                      <SelectValue />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                    <SelectItem value="pos">POS</SelectItem>
                    <SelectItem value="regular">{isRTL ? 'مبيعات عادية' : 'Regular Sales'}</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {/* Payment Status Filter */}
              <Select value={paymentStatusFilter} onValueChange={setPaymentStatusFilter}>
                <SelectTrigger>
                  {paymentStatusFilter === 'all' ? (
                    <span className="text-muted-foreground">{isRTL ? 'حالة الدفع' : 'Payment Status'}</span>
                  ) : (
                    <SelectValue />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="paid">{isRTL ? 'مدفوعة' : 'Paid'}</SelectItem>
                  <SelectItem value="partial">{isRTL ? 'جزئية' : 'Partial'}</SelectItem>
                  <SelectItem value="pending">{isRTL ? 'غير مدفوعة' : 'Unpaid'}</SelectItem>
                </SelectContent>
              </Select>

              {/* Document Status Filter */}
              <Select value={documentStatusFilter} onValueChange={setDocumentStatusFilter}>
                <SelectTrigger>
                  {documentStatusFilter === 'all' ? (
                    <span className="text-muted-foreground">{isRTL ? 'حالة المستند' : 'Document Status'}</span>
                  ) : (
                    <SelectValue />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="draft">{isRTL ? 'مسودة' : 'Draft'}</SelectItem>
                  <SelectItem value="approved">{isRTL ? 'معتمدة' : 'Approved'}</SelectItem>
                  <SelectItem value="cancelled">{isRTL ? 'ملغاة' : 'Cancelled'}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Row 2: Date & Entity Filters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Start Date */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-start text-right font-normal w-full">
                    <Calendar className="ml-2 h-4 w-4" />
                    {startDate ? format(startDate, 'yyyy/MM/dd') : (isRTL ? 'من تاريخ' : 'From Date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    locale={language === 'ar' ? ar : undefined}
                  />
                </PopoverContent>
              </Popover>

              {/* End Date */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-start text-right font-normal w-full">
                    <Calendar className="ml-2 h-4 w-4" />
                    {endDate ? format(endDate, 'yyyy/MM/dd') : (isRTL ? 'إلى تاريخ' : 'To Date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    locale={language === 'ar' ? ar : undefined}
                  />
                </PopoverContent>
              </Popover>

              {/* Customer Filter */}
              <Select value={customerFilter} onValueChange={setCustomerFilter}>
                <SelectTrigger>
                  {customerFilter === 'all' ? (
                    <span className="text-muted-foreground">{isRTL ? 'العميل' : 'Customer'}</span>
                  ) : (
                    <SelectValue />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Branch Filter */}
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger>
                  {branchFilter === 'all' ? (
                    <span className="text-muted-foreground">{isRTL ? 'الفرع' : 'Branch'}</span>
                  ) : (
                    <SelectValue />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Row 3: Search & ZATCA */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={isRTL ? 'بحث برقم الفاتورة، اسم العميل، الرقم الضريبي، أو السيريال (FSET...)...' : 'Search by invoice #, customer, VAT #, or serial (FSET...)...'}
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pr-10"
                />
              </div>

              {/* ZATCA Status Filter */}
              <Select value={zatcaFilter} onValueChange={setZatcaFilter}>
                <SelectTrigger>
                  {zatcaFilter === 'all' ? (
                    <span className="text-muted-foreground">{isRTL ? 'حالة ZATCA' : 'ZATCA Status'}</span>
                  ) : (
                    <SelectValue />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="not_submitted">{t.salesInvoices.notSubmitted}</SelectItem>
                  <SelectItem value="submitted">{t.salesInvoices.submitted}</SelectItem>
                  <SelectItem value="approved">{t.salesInvoices.approved}</SelectItem>
                  <SelectItem value="rejected">{t.salesInvoices.rejected}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Invoices Table */}
        <Card>
          <CardContent className="p-0">
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">{isRTL ? 'رقم الفاتورة' : 'Invoice #'}</TableHead>
                    <TableHead className="font-semibold">{isRTL ? 'النوع' : 'Type'}</TableHead>
                    {sourceMode !== 'pos' && (
                      <TableHead className="font-semibold">{isRTL ? 'المصدر' : 'Source'}</TableHead>
                    )}
                    <TableHead className="font-semibold">{t.salesInvoices.customerName}</TableHead>
                    <TableHead className="font-semibold">{isRTL ? 'تاريخ الإصدار' : 'Issue Date'}</TableHead>
                    <TableHead className="font-semibold text-left">{isRTL ? 'القيمة الإجمالية' : 'Total'}</TableHead>
                    <TableHead className="font-semibold text-left">{isRTL ? 'الرصيد' : 'Balance'}</TableHead>
                    <TableHead className="font-semibold">{isRTL ? 'حالة الدفع' : 'Payment'}</TableHead>
                    <TableHead className="font-semibold">{isRTL ? 'ZATCA' : 'ZATCA'}</TableHead>
                    {sourceMode !== 'pos' && (
                      <TableHead className="font-semibold">{t.salesInvoices.options}</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={sourceMode === 'pos' ? 8 : 10} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : filteredInvoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={sourceMode === 'pos' ? 8 : 10} className="text-center py-8 text-muted-foreground">
                        {t.salesInvoices.noInvoices}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredInvoices.map((invoice) => {
                      const isPOS = invoice.sale_id !== null && invoice.sale_id !== undefined;
                      const isReturn = invoice.invoice_type === 'sales_return';
                      
                      return (
                        <TableRow 
                          key={invoice.id} 
                          className={`hover:bg-muted/50 ${isReturn ? 'bg-red-50/50 dark:bg-red-900/10' : ''} ${sourceMode === 'pos' ? 'cursor-pointer' : ''}`}
                          onClick={sourceMode === 'pos' ? () => handleView(invoice) : undefined}
                          data-testid={`row-invoice-${invoice.id}`}
                        >
                          <TableCell className="font-mono font-medium">
                            <span className={isReturn ? 'text-red-600 dark:text-red-400' : ''}>
                              {invoice.invoice_number}
                            </span>
                            {isPOS && invoice.sale?.sale_code && (
                              <div className="text-xs text-muted-foreground font-normal mt-0.5">
                                {isRTL ? 'رقم العملية (POS): ' : 'POS Txn: '}{invoice.sale.sale_code}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {isReturn ? (
                              <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400">
                                <FileX className="w-3 h-3 ml-1" />
                                {isRTL ? 'مرتجع' : 'Return'}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400">
                                <FileText className="w-3 h-3 ml-1" />
                                {isRTL ? 'فاتورة' : 'Invoice'}
                              </Badge>
                            )}
                          </TableCell>
                          {sourceMode !== 'pos' && (
                            <TableCell>
                              {sourceBadge(isPOS)}
                            </TableCell>
                          )}
                          <TableCell>{invoice.customer?.full_name || '-'}</TableCell>
                          <TableCell>{format(new Date(invoice.invoice_date), 'yyyy/MM/dd')}</TableCell>
                          <TableCell className={`text-left font-mono font-semibold ${isReturn ? 'text-red-600 dark:text-red-400' : ''}`}>
                            {formatCurrency(Math.abs(invoice.total_amount))}
                            {isReturn && <span className="text-xs mr-1">-</span>}
                          </TableCell>
                          <TableCell className="text-left font-mono font-semibold text-orange-600 dark:text-orange-400">
                            {invoice.remaining_amount > 0 ? formatCurrency(invoice.remaining_amount) : '-'}
                          </TableCell>
                          <TableCell>{paymentStatusBadge(invoice.status)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <ZatcaStatusBadge status={invoice.zatca_status} />
                              {sourceMode === 'pos' && (
                                <>
                                  <ZatcaSubmitButton
                                    invoiceId={invoice.id}
                                    invoiceType={invoice.zatca_invoice_type as 'standard' | 'simplified' || 'simplified'}
                                    zatcaStatus={invoice.zatca_status}
                                  />
                                  {canCreateReturn(invoice) && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" data-testid={`button-pos-actions-${invoice.id}`}>
                                          <MoreHorizontal className="w-4 h-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                          onClick={() => handleCreateReturn(invoice)}
                                          data-testid={`action-create-return-${invoice.id}`}
                                        >
                                          <RotateCcw className="w-4 h-4 ml-2" />
                                          {isRTL ? 'إنشاء مرتجع' : 'Create Return'}
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </>
                              )}
                            </div>
                          </TableCell>
                          {sourceMode !== 'pos' ? (
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <ZatcaSubmitButton
                                  invoiceId={invoice.id}
                                  invoiceType={invoice.zatca_invoice_type as 'standard' | 'simplified' || 'simplified'}
                                  zatcaStatus={invoice.zatca_status}
                                />
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                      <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleView(invoice)}>
                                      <Eye className="w-4 h-4 ml-2" />
                                      {t.common.view}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem 
                                      onClick={() => handleEdit(invoice)}
                                      disabled={invoice.status !== 'draft' && invoice.status !== 'pending'}
                                      className={(invoice.status !== 'draft' && invoice.status !== 'pending') ? 'opacity-50 cursor-not-allowed' : ''}
                                    >
                                      <Pencil className="w-4 h-4 ml-2" />
                                      {t.common.edit}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem 
                                      onClick={() => preparePrint(invoice)}
                                      disabled={isPrintLoading}
                                    >
                                      {isPrintLoading ? (
                                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                      ) : (
                                        <Printer className="w-4 h-4 ml-2" />
                                      )}
                                      {t.common.print}
                                    </DropdownMenuItem>
                                    {canCreateReturn(invoice) && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => handleCreateReturn(invoice)}
                                          data-testid={`action-create-return-${invoice.id}`}
                                        >
                                          <RotateCcw className="w-4 h-4 ml-2" />
                                          {isRTL ? 'إنشاء مرتجع' : 'Create Return'}
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                    {invoice.zatca_signed_xml && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem>
                                          <FileCode className="w-4 h-4 ml-2" />
                                          {t.zatca?.viewXml || 'عرض XML'}
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hidden Printable Invoice Component */}
      {selectedInvoiceForPrint && (
        <div style={{ display: 'none' }}>
          <PrintableInvoice
            ref={printRef}
            invoice={{
              id: selectedInvoiceForPrint.id,
              invoice_number: selectedInvoiceForPrint.invoice_number,
              invoice_type: 'sales',
              invoice_date: selectedInvoiceForPrint.invoice_date,
              due_date: selectedInvoiceForPrint.due_date,
              total_amount: selectedInvoiceForPrint.total_amount,
              paid_amount: selectedInvoiceForPrint.paid_amount,
              remaining_amount: selectedInvoiceForPrint.remaining_amount,
              subtotal: selectedInvoiceForPrint.subtotal,
              tax_amount: selectedInvoiceForPrint.tax_amount,
              discount_amount: selectedInvoiceForPrint.discount_amount,
              status: selectedInvoiceForPrint.status,
              notes: selectedInvoiceForPrint.notes,
              customer: selectedInvoiceForPrint.customer as any,
              branch: selectedInvoiceForPrint.branch,
            }}
            items={invoiceItemsForPrint.map((item: any) => ({
              id: item.id,
              sale_price:
                item.sale_price ?? (item.unit_price || 0) * (item.quantity || 0),
              jewelry_items: item.jewelry_items,
            }))}
          />
        </div>
      )}
    </>
  );
}
