import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryTable } from '@/lib/dataGateway';
import * as apiClient from '@/lib/apiClient';
import { Loader2, Printer, Package, AlertTriangle, Download, Gem, ArrowRightLeft, FileText, CheckCircle, BookOpen, Send, PackageCheck, ArrowRight, Clock, Search, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { toast } from 'sonner';
import JsBarcode from 'jsbarcode';
import jsPDF from 'jspdf';
import { createArabicWorkbook } from '@/lib/excelExport';
import { MoveItemsDialog } from '@/components/MoveItemsDialog';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { PostInvoiceAccountingResponse } from '@/types/invoice-posting.types';

const ITEM_STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  in_stock: { label: 'في المخزون', variant: 'default' },
  sold: { label: 'مباع', variant: 'secondary' },
  returned_to_supplier: { label: 'مسترجع', variant: 'destructive' },
  transferred: { label: 'محوّل', variant: 'outline' },
  reserved: { label: 'محجوز', variant: 'secondary' },
};

function getItemStatusBadge(status: string | null | undefined) {
  const s = status || 'in_stock';
  const info = ITEM_STATUS_MAP[s] || { label: s, variant: 'outline' as const };
  return <Badge variant={info.variant} data-testid={`badge-status-${s}`}>{info.label}</Badge>;
}

export default function BatchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [isPostingAccounting, setIsPostingAccounting] = useState(false);
  const [isPostingMovements, setIsPostingMovements] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: batch, isLoading: batchLoading } = useQuery({
    queryKey: ['batch', id],
    queryFn: async () => {
      const { data, error } = await queryTable('unique_purchase_batches', {
        select: '*',
        filters: [{ type: 'eq', column: 'id', value: id }],
        single: true,
      });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ['batch-items', id],
    queryFn: async () => {
      const { data, error } = await apiClient.get<any[]>('/api/batch-items', { batch_id: id });
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!id,
  });

  const { data: linkedInvoices } = useQuery({
    queryKey: ['batch-invoices', id],
    queryFn: async () => {
      const { data, error } = await queryTable('unique_purchase_invoices', {
        select: 'id, invoice_number, supp_inv, journal_entry_id, status, subtotal, tax_amount, total_amount, invoice_date',
        filters: [{ type: 'eq', column: 'batch_id', value: id }],
        order: { column: 'created_at', ascending: true },
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!id,
  });

  const { data: supplier } = useQuery({
    queryKey: ['batch-supplier', batch?.supplier_id],
    queryFn: async () => {
      if (!batch?.supplier_id) return null;
      const { data, error } = await queryTable('suppliers', {
        select: 'id, name, name_en, phone, email, address, tax_number, supplier_code',
        filters: [{ type: 'eq', column: 'id', value: batch.supplier_id }],
        single: true,
      });
      if (error) return null;
      return data;
    },
    enabled: !!batch?.supplier_id,
  });

  const { data: errors } = useQuery({
    queryKey: ['batch-errors', id],
    queryFn: async () => {
      return [] as any[];
    },
    enabled: !!id,
  });

  const { data: existingMovements, isLoading: movementsLoading } = useQuery({
    queryKey: ['batch-movements', id],
    queryFn: async () => {
      const res = await fetch(`/api/batch-movement-count?batch_id=${id}`, { credentials: 'include' });
      if (!res.ok) return { count: 0 };
      const json = await res.json();
      return { count: json.count || 0 };
    },
    enabled: !!id,
  });

  const uniqueTypes = useMemo(() => {
    if (!items) return [];
    const types = [...new Set(items.map((i: any) => i.type).filter(Boolean))];
    return types.sort();
  }, [items]);

  const uniqueBranches = useMemo(() => {
    if (!items) return [];
    const branches = [...new Set(items.map((i: any) => i.branches?.branch_name).filter(Boolean))];
    return branches.sort();
  }, [items]);

  const uniqueStatuses = useMemo(() => {
    if (!items) return [];
    return [...new Set(items.map((i: any) => i.status || 'in_stock'))];
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    let result = items;
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      result = result.filter((item: any) =>
        (item.serial_no || '').toLowerCase().includes(q) ||
        (item.supp_inv || '').toLowerCase().includes(q) ||
        (item.model || '').toLowerCase().includes(q) ||
        (item.stockcode || '').toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') {
      result = result.filter((item: any) => (item.status || 'in_stock') === filterStatus);
    }
    if (filterType !== 'all') {
      result = result.filter((item: any) => item.type === filterType);
    }
    if (filterBranch !== 'all') {
      result = result.filter((item: any) => item.branches?.branch_name === filterBranch);
    }
    return result;
  }, [items, searchText, filterStatus, filterType, filterBranch]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, filterStatus, filterType, filterBranch, pageSize]);

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  const hasActiveFilters = searchText.trim() || filterStatus !== 'all' || filterType !== 'all' || filterBranch !== 'all';

  const clearAllFilters = () => {
    setSearchText('');
    setFilterStatus('all');
    setFilterType('all');
    setFilterBranch('all');
  };

  const hasInvoice = (linkedInvoices && linkedInvoices.length > 0);
  const needsInvoice = false;
  
  const hasAccountingPosted = hasInvoice && linkedInvoices?.every((inv: any) => inv.journal_entry_id);
  const needsAccountingPosting = false;

  // Check if movements need to be posted (Phase 2)
  const itemsCount = items?.length || 0;
  const movementsCount = existingMovements?.count || 0;
  const needsMovementsPosting = batch?.status === 'IMPORTED' && itemsCount > 0 && movementsCount < itemsCount;
  const hasMovementsPosted = movementsCount > 0 && movementsCount >= itemsCount;

  // Create invoice for batch via Edge Function
  const handleCreateInvoice = async () => {
    if (!id || !batch) return;
    
    setIsCreatingInvoice(true);
    try {
      const response = await fetch('/api/rpc/create_batch_invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ batch_id: id }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'فشل إنشاء الفاتورة');
      }

      if (result.already_exists) {
        if (result.relinked) {
          toast.success(`تم إعادة ربط الفاتورة الموجودة: ${result.invoice_number}`);
        } else {
          toast.info(`الفاتورة موجودة مسبقاً: ${result.invoice_number}`);
        }
      } else {
        toast.success(`تم إنشاء الفاتورة بنجاح: ${result.invoice_number}`, { duration: 5000 });
      }

      // Refresh data immediately
      await queryClient.invalidateQueries({ queryKey: ['batch', id] });
      await queryClient.invalidateQueries({ queryKey: ['batch-items', id] });
      await queryClient.invalidateQueries({ queryKey: ['batch-invoice'] });
    } catch (error) {
      console.error('Invoice creation error:', error);
      toast.error(error instanceof Error ? error.message : 'فشل إنشاء الفاتورة');
    } finally {
      setIsCreatingInvoice(false);
    }
  };

  const handlePostAccounting = async () => {
    toast.info('الترحيل المحاسبي تم تلقائياً أثناء الاستيراد');
  };

  // Post IMPORT movements for batch via Edge Function (Phase 2)
  const handlePostMovements = async () => {
    if (!id || !batch) return;
    
    setIsPostingMovements(true);
    try {
      const postRes = await fetch('/api/import/post-batch-movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: id }),
      });
      const { data, error } = await postRes.json();

      if (error) {
        throw new Error(error.message || 'فشل ترحيل حركات الاستيراد');
      }

      if (data.already_posted) {
        toast.info(`حركات الاستيراد موجودة مسبقاً (${data.skipped_count} حركة)`);
      } else if (data.success) {
        toast.success(`تم ترحيل ${data.created_count} حركة استيراد بنجاح`, { duration: 5000 });
      } else {
        throw new Error(data.error || 'فشل ترحيل حركات الاستيراد');
      }

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['batch-movements', id] });
      queryClient.invalidateQueries({ queryKey: ['batch-items', id] });
    } catch (error) {
      console.error('Movements posting error:', error);
      toast.error(error instanceof Error ? error.message : 'فشل ترحيل حركات الاستيراد');
    } finally {
      setIsPostingMovements(false);
    }
  };

  const generateBarcodeDataUrl = (text: string): string | null => {
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, text, {
        format: 'CODE128',
        width: 1.5,
        height: 40,
        displayValue: false,
        margin: 2,
      });
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  const printItemLabels = async (mode: 'all' | 'selected') => {
    if (!items || items.length === 0) return;

    const targetItems = mode === 'selected'
      ? items.filter((item: any) => selectedItems.includes(item.id))
      : items;

    if (targetItems.length === 0) {
      toast.warning('لا توجد قطع محددة للطباعة');
      return;
    }

    toast.info(`جاري إنشاء PDF لـ ${targetItems.length} قطعة...`);

    const pageW = 120;
    const pageH = 80;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pageW, pageH] });

    for (let i = 0; i < targetItems.length; i++) {
      const item = targetItems[i];
      if (i > 0) pdf.addPage([pageW, pageH], 'landscape');

      const barcodeDataUrl = generateBarcodeDataUrl(item.serial_no || 'N/A');
      if (barcodeDataUrl) {
        pdf.addImage(barcodeDataUrl, 'PNG', 10, 4, 100, 25);
      }

      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.text(item.serial_no || '', pageW / 2, 33, { align: 'center' });

      pdf.setDrawColor(200);
      pdf.line(5, 36, pageW - 5, 36);

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`MODEL: ${item.model || '-'}`, 8, 44);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text(`PRICE: ${Number(item.tag_price || 0).toLocaleString()} SAR`, 8, 52);
      pdf.text(`SUPP INV: ${item.supp_inv || '-'}`, 8, 60);
      pdf.text(`CLARITY: ${item.clarity || '-'}`, 8, 68);
    }

    pdf.save(`items-${batch?.batch_no}.pdf`);
    toast.success(`تم إنشاء ملف PDF لـ ${targetItems.length} قطعة`);
  };

  const exportToExcel = () => {
    if (!items || items.length === 0) {
      toast.warning('لا توجد قطع للتصدير');
      return;
    }

    const exportData = items.map((item) => ({
      'Serial No': item.serial_no || '',
      'Supp Ref': item.supp_ref || '',
      'Model': item.model || '',
      'Stock Code': item.stockcode || '',
      'Type': item.type || '',
      'Metal': item.metal || '',
      'Stone': item.stone || '',
      'Clarity': item.clarity || '',
      'G Weight': item.g_weight || 0,
      'D Weight': item.d_weight || 0,
      'B Weight': item.b_weight || 0,
      'Cost': item.cost || 0,
      'Tag Price': item.tag_price || 0,
      'Min Price': item.minimum_price || 0,
      'Description': item.description || '',
      'Branch': item.branches?.branch_name || '',
    }));

    createArabicWorkbook(
      exportData,
      'Items',
      `${batch?.batch_no || 'items'}-export.xlsx`
    );
    toast.success('تم تصدير الملف بنجاح');
  };

  const exportInvoicePdf = () => {
    if (!items || items.length === 0 || !linkedInvoices || linkedInvoices.length === 0) {
      toast.warning('لا توجد بيانات فاتورة للتصدير');
      return;
    }
    if (batch?.supplier_id && !supplier) {
      toast.warning('جاري تحميل بيانات المورد، يرجى الانتظار...');
      return;
    }

    toast.info('جاري إنشاء PDF للفاتورة...');

    const inv = linkedInvoices[0];
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const marginL = 15;
    const marginR = pageW - 15;
    let y = 20;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text('PURCHASE INVOICE', pageW / 2, y, { align: 'center' });
    y += 8;

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Invoice #: ${inv.invoice_number || '-'}`, marginL, y);
    pdf.text(`Date: ${inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-GB') : '-'}`, marginR, y, { align: 'right' });
    y += 6;
    pdf.text(`Batch #: ${batch?.batch_no || '-'}`, marginL, y);
    pdf.text(`SUPP INV: ${inv.supp_inv || '-'}`, marginR, y, { align: 'right' });
    y += 6;

    if (supplier) {
      pdf.text(`Supplier: ${supplier.name || supplier.name_en || '-'}`, marginL, y);
      if (supplier.tax_number) {
        pdf.text(`Tax #: ${supplier.tax_number}`, marginR, y, { align: 'right' });
      }
      y += 6;
      if (supplier.phone) {
        pdf.text(`Phone: ${supplier.phone}`, marginL, y);
        y += 6;
      }
    }

    y += 4;
    pdf.setDrawColor(180);
    pdf.line(marginL, y, marginR, y);
    y += 6;

    const cols = [
      { label: '#', x: marginL, w: 8 },
      { label: 'Serial No', x: marginL + 8, w: 30 },
      { label: 'SUPP INV', x: marginL + 38, w: 22 },
      { label: 'Model', x: marginL + 60, w: 18 },
      { label: 'Stockcode', x: marginL + 78, w: 18 },
      { label: 'Type', x: marginL + 96, w: 14 },
      { label: 'G', x: marginL + 110, w: 14 },
      { label: 'D', x: marginL + 124, w: 14 },
      { label: 'Cost', x: marginL + 138, w: 22 },
      { label: 'Tag Price', x: marginL + 160, w: 22 },
    ];

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setFillColor(240, 240, 240);
    pdf.rect(marginL, y - 4, marginR - marginL, 6, 'F');
    cols.forEach(col => {
      pdf.text(col.label, col.x + 1, y);
    });
    y += 5;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);

    let totalCost = 0;
    let totalTag = 0;

    items.forEach((item, idx) => {
      if (y > 270) {
        pdf.addPage();
        y = 20;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setFillColor(240, 240, 240);
        pdf.rect(marginL, y - 4, marginR - marginL, 6, 'F');
        cols.forEach(col => pdf.text(col.label, col.x + 1, y));
        y += 5;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.5);
      }

      const cost = Number(item.cost || 0);
      const tag = Number(item.tag_price || 0);
      totalCost += cost;
      totalTag += tag;

      const rowData = [
        String(idx + 1),
        item.serial_no || '',
        item.supp_inv || '-',
        item.model || '',
        item.stockcode || '',
        item.type || '',
        String(item.g_weight || 0),
        String(item.d_weight || 0),
        cost.toLocaleString(),
        tag.toLocaleString(),
      ];

      if (idx % 2 === 1) {
        pdf.setFillColor(248, 248, 248);
        pdf.rect(marginL, y - 3.5, marginR - marginL, 4.5, 'F');
      }

      cols.forEach((col, ci) => {
        pdf.text(String(rowData[ci]).substring(0, Math.floor(col.w / 1.8)), col.x + 1, y);
      });
      y += 4.5;
    });

    y += 4;
    pdf.setDrawColor(180);
    pdf.line(marginL, y, marginR, y);
    y += 8;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    const summaryX = marginR - 60;
    pdf.text('Subtotal:', summaryX, y);
    pdf.text(`${totalCost.toLocaleString()} SAR`, marginR, y, { align: 'right' });
    y += 6;

    const taxAmt = Number(inv.tax_amount || 0);
    pdf.text('VAT (15%):', summaryX, y);
    pdf.text(`${taxAmt.toLocaleString()} SAR`, marginR, y, { align: 'right' });
    y += 6;

    pdf.setFontSize(11);
    pdf.text('Total:', summaryX, y);
    pdf.text(`${Number(inv.total_amount || totalCost + taxAmt).toLocaleString()} SAR`, marginR, y, { align: 'right' });
    y += 8;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(`Items: ${items.length}`, marginL, y);
    pdf.text(`Generated: ${new Date().toLocaleString('en-GB')}`, marginR, y, { align: 'right' });

    pdf.save(`invoice-${inv.invoice_number || batch?.batch_no}.pdf`);
    toast.success('تم تصدير الفاتورة بنجاح');
  };

  const isItemActionable = (item: any) => item.status !== 'returned_to_supplier' && item.status !== 'sold';

  const toggleItemSelection = (itemId: string) => {
    const item = items?.find((i: any) => i.id === itemId);
    if (item && !isItemActionable(item)) return;
    setSelectedItems(prev => 
      prev.includes(itemId) 
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  const toggleSelectAll = () => {
    const actionablePageIds = paginatedItems.filter(isItemActionable).map((i: any) => i.id);
    if (actionablePageIds.length > 0 && actionablePageIds.every(id => selectedItems.includes(id))) {
      setSelectedItems(prev => prev.filter(id => !actionablePageIds.includes(id)));
    } else {
      setSelectedItems(prev => [...new Set([...prev, ...actionablePageIds])]);
    }
  };

  const handleMoveSuccess = () => {
    setSelectedItems([]);
    queryClient.invalidateQueries({ queryKey: ['batch-items', id] });
  };

  if (batchLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-gold" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="animate-fade-in">
        <div className="page-header flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="page-title">{batch?.batch_no}</h1>
            <p className="page-description">{batch?.uploaded_file_name}</p>
            {batch?.created_at && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <Clock className="w-3.5 h-3.5" />
                {new Date(batch.created_at).toLocaleDateString('ar-EG')} — {new Date(batch.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </p>
            )}
          </div>
          <Button variant="outline" onClick={() => navigate('/batches')} data-testid="button-back-batches">
            <ArrowRight className="w-4 h-4 ml-2" />
            رجوع للدفعات
          </Button>
        </div>

        {/* Actions Card */}
        <Card className="border-0 shadow-sm mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">الإجراءات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => printItemLabels('all')} data-testid="button-print-all">
              <Printer className="w-4 h-4 ml-2" />
              طباعة باركود الكل
            </Button>
            {selectedItems.length > 0 && (
              <Button variant="default" onClick={() => printItemLabels('selected')} data-testid="button-print-selected">
                <Printer className="w-4 h-4 ml-2" />
                طباعة المحدد ({selectedItems.length})
              </Button>
            )}
            <Button variant="outline" onClick={exportToExcel} data-testid="button-export-excel">
              <Download className="w-4 h-4 ml-2" />
              تصدير Excel
            </Button>
            <Button variant="outline" onClick={exportInvoicePdf} data-testid="button-export-invoice-pdf">
              <FileText className="w-4 h-4 ml-2" />
              طباعة الفاتورة PDF
            </Button>
            {selectedItems.length > 0 && (
              <Button variant="outline" onClick={() => setMoveDialogOpen(true)} data-testid="button-move-items">
                <ArrowRightLeft className="w-4 h-4 ml-2" />
                نقل إلى فرع آخر ({selectedItems.length})
              </Button>
            )}
            {needsMovementsPosting && (
              <Button 
                onClick={handlePostMovements} 
                disabled={isPostingMovements}
                variant="outline"
                data-testid="button-post-movements"
              >
                {isPostingMovements ? (
                  <><Loader2 className="w-4 h-4 ml-2 animate-spin" /> جاري الترحيل...</>
                ) : (
                  <><PackageCheck className="w-4 h-4 ml-2" /> ترحيل حركات الاستيراد</>
                )}
              </Button>
            )}
            {needsInvoice && (
              <Button 
                onClick={handleCreateInvoice} 
                disabled={isCreatingInvoice}
                data-testid="button-create-invoice"
              >
                {isCreatingInvoice ? (
                  <><Loader2 className="w-4 h-4 ml-2 animate-spin" /> جاري الإنشاء...</>
                ) : (
                  <><FileText className="w-4 h-4 ml-2" /> إنشاء فاتورة للدفعة</>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Status Alerts */}
        {hasMovementsPosted && (
          <Alert className="mb-6 border-green-500 bg-green-500/10">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-600">تم ترحيل حركات الاستيراد</AlertTitle>
            <AlertDescription>
              {movementsCount} حركة مخزون مسجّلة لهذه الدفعة.
            </AlertDescription>
          </Alert>
        )}

        {hasInvoice && hasAccountingPosted && (
          <Alert className="mb-6 border-success bg-success/10">
            <CheckCircle className="h-4 w-4 text-success" />
            <AlertTitle className="text-success">تم الترحيل المحاسبي</AlertTitle>
            <AlertDescription>
              <span>{linkedInvoices?.length} فاتورة مرتبطة بهذه الدفعة — جميعها مرحّلة.</span>
            </AlertDescription>
          </Alert>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{batch?.rows_total || items?.length || 0}</p>
              <p className="text-sm text-muted-foreground">إجمالي الصفوف</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-success">{batch?.rows_imported || items?.length || 0}</p>
              <p className="text-sm text-muted-foreground">تم الاستيراد</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-destructive">{batch?.rows_failed || 0}</p>
              <p className="text-sm text-muted-foreground">فشل</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-warning">{0}</p>
              <p className="text-sm text-muted-foreground">تم تخطيها (مكرر)</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="items">
          <TabsList className="mb-4">
            <TabsTrigger value="items" className="gap-2">
              <Package className="w-4 h-4" />
              القطع المستوردة ({items?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="clarity" className="gap-2">
              <Gem className="w-4 h-4" />
              الصفاء (Clarity)
            </TabsTrigger>
            <TabsTrigger value="errors" className="gap-2">
              <AlertTriangle className="w-4 h-4" />
              الأخطاء ({errors?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="items">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  data-testid="input-search-items"
                  placeholder="بحث: رقم تسلسلي، فاتورة مورد، MODEL، STOCKCODE، وصف..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pr-9"
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus} data-testid="select-filter-status">
                <SelectTrigger className="w-[150px]" data-testid="trigger-filter-status">
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  {uniqueStatuses.map((s: string) => (
                    <SelectItem key={s} value={s}>{ITEM_STATUS_MAP[s]?.label || s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {uniqueTypes.length > 1 && (
                <Select value={filterType} onValueChange={setFilterType} data-testid="select-filter-type">
                  <SelectTrigger className="w-[140px]" data-testid="trigger-filter-type">
                    <SelectValue placeholder="النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأنواع</SelectItem>
                    {uniqueTypes.map((t: string) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {uniqueBranches.length > 1 && (
                <Select value={filterBranch} onValueChange={setFilterBranch} data-testid="select-filter-branch">
                  <SelectTrigger className="w-[150px]" data-testid="trigger-filter-branch">
                    <SelectValue placeholder="الفرع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الفروع</SelectItem>
                    {uniqueBranches.map((b: string) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid="button-clear-filters">
                  <X className="w-4 h-4 ml-1" />
                  مسح الفلاتر
                </Button>
              )}
              {hasActiveFilters && (
                <span className="text-sm text-muted-foreground">
                  {filteredItems.length} / {items?.length || 0} قطعة
                </span>
              )}
            </div>
            {selectedItems.length > 0 && (
              <div className="mb-4 p-3 bg-muted rounded-md flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium">{selectedItems.length} قطعة محددة</span>
              </div>
            )}
            <Card className="border-0 shadow-md">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="data-table text-sm">
                    <thead className="sticky top-0">
                      <tr>
                        <th className="w-10">
                          <Checkbox 
                            checked={paginatedItems.filter(isItemActionable).length > 0 && paginatedItems.filter(isItemActionable).every((i: any) => selectedItems.includes(i.id))}
                            onCheckedChange={toggleSelectAll}
                            disabled={paginatedItems.filter(isItemActionable).length === 0}
                          />
                        </th>
                        <th>الرقم التسلسلي</th>
                        <th>فاتورة المورد</th>
                        <th>MODEL</th>
                        <th>STOCKCODE</th>
                        <th>الوصف</th>
                        <th>TYPE</th>
                        <th>الفرع</th>
                        <th>الصفاء</th>
                        <th>G</th>
                        <th>D</th>
                        <th>B</th>
                        <th>COST</th>
                        <th>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedItems.map((item: any) => (
                        <tr key={item.id} className={`${selectedItems.includes(item.id) ? 'bg-muted/50' : ''} ${!isItemActionable(item) ? 'opacity-50' : ''}`}>
                          <td>
                            <Checkbox 
                              checked={selectedItems.includes(item.id)}
                              onCheckedChange={() => toggleItemSelection(item.id)}
                              disabled={!isItemActionable(item)}
                            />
                          </td>
                          <td className="font-mono">{item.serial_no}</td>
                          <td className="font-mono text-gold">{item.supp_inv || '-'}</td>
                          <td>{item.model}</td>
                          <td>{item.stockcode}</td>
                          <td className="max-w-[150px] truncate" title={item.description || ''}>{item.description || '-'}</td>
                          <td>{item.type}</td>
                          <td>{item.branches?.branch_name || '-'}</td>
                          <td>{item.clarity || '-'}</td>
                          <td>{item.g_weight}</td>
                          <td>{item.d_weight}</td>
                          <td>{item.b_weight}</td>
                          <td>{item.cost}</td>
                          <td>{getItemStatusBadge(item.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            {filteredItems.length > 0 && (
              <div className="flex items-center justify-between flex-wrap gap-3 mt-4 px-1" data-testid="pagination-controls">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>عرض {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filteredItems.length)} من {filteredItems.length}</span>
                  {hasActiveFilters && items && <span>(إجمالي {items.length})</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))} data-testid="select-page-size">
                    <SelectTrigger className="w-[100px]" data-testid="trigger-page-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25 / صفحة</SelectItem>
                      <SelectItem value="50">50 / صفحة</SelectItem>
                      <SelectItem value="100">100 / صفحة</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" onClick={() => setCurrentPage(1)} disabled={currentPage === 1} data-testid="button-first-page">
                      <ChevronsRight className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} data-testid="button-prev-page">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <span className="text-sm px-2 min-w-[80px] text-center">{currentPage} / {totalPages}</span>
                    <Button variant="outline" size="icon" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} data-testid="button-next-page">
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} data-testid="button-last-page">
                      <ChevronsLeft className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="clarity">
            <Card className="border-0 shadow-md">
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-96">
                  <table className="data-table text-sm">
                    <thead className="sticky top-0">
                      <tr>
                        <th>الرقم التسلسلي</th>
                        <th>MODEL</th>
                        <th>STOCKCODE</th>
                        <th>الصفاء (Clarity)</th>
                        <th>الحجر</th>
                        <th>المعدن</th>
                        <th>D Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items?.map((item) => (
                        <tr key={item.id}>
                          <td className="font-mono">{item.serial_no}</td>
                          <td>{item.model}</td>
                          <td>{item.stockcode}</td>
                          <td className="font-semibold text-gold">{item.clarity || '-'}</td>
                          <td>{item.stone || '-'}</td>
                          <td>{item.metal || '-'}</td>
                          <td>{item.d_weight}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="errors">
            <Card className="border-0 shadow-md">
              <CardContent className="p-0">
                {errors && errors.length > 0 ? (
                  <div className="overflow-x-auto max-h-96">
                    <table className="data-table text-sm">
                      <thead className="sticky top-0">
                        <tr>
                          <th>رقم الصف</th>
                          <th>MODEL</th>
                          <th>STOCKCODE</th>
                          <th>رسالة الخطأ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {errors.map((error) => (
                          <tr key={error.id}>
                            <td>{error.row_number}</td>
                            <td>{error.model}</td>
                            <td>{error.stockcode}</td>
                            <td className="text-destructive">{error.error_message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-8 text-center text-muted-foreground">
                    لا توجد أخطاء في هذه الدفعة
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <MoveItemsDialog
          open={moveDialogOpen}
          onOpenChange={setMoveDialogOpen}
          selectedItems={selectedItems}
          currentBranchId={batch?.branch_id || undefined}
          onSuccess={handleMoveSuccess}
        />
      </div>
    </MainLayout>
  );
}
