import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, Gem, Download, FileText, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import { toast } from 'sonner';
import { createArabicWorkbook } from '@/lib/excelExport';
import { addCairoFont } from '@/lib/fonts/cairo-font';

const STATUS_LABELS: Record<string, string> = {
  available: 'متاح',
  sold: 'مباع',
  reserved: 'محجوز',
  returned: 'مرتجع',
};

async function fetchAllFilteredItems(searchQuery: string, statusFilter: string, branchFilter: string) {
  const params = new URLSearchParams();
  if (searchQuery) params.set('search', searchQuery);
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (branchFilter !== 'all') params.set('branchId', branchFilter);
  const res = await fetch(`/api/inventory/imported-pieces/export?${params.toString()}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Export failed');
  return json.data || [];
}

export default function ImportedPiecesPage() {
  const { language } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isExporting, setIsExporting] = useState(false);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/branches');
      const data = await res.json();
      return Array.isArray(data) ? data : (data?.data || []);
    },
  });

  const { data: result, isLoading } = useQuery({
    queryKey: ['imported-pieces', searchQuery, statusFilter, branchFilter, currentPage, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (branchFilter !== 'all') params.set('branchId', branchFilter);
      params.set('page', String(currentPage));
      params.set('limit', String(pageSize));
      const res = await fetch(`/api/inventory/imported-pieces?${params.toString()}`);
      const json = await res.json();
      return json;
    },
  });

  const items = result?.data || [];
  const stats = result?.stats || { total: 0, available: 0, sold: 0, totalValue: 0 };
  const totalPages = result?.totalPages || 1;

  const handleFilterChange = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setCurrentPage(1);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (v: string) => {
    setPageSize(Number(v));
    setCurrentPage(1);
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'available':
        return <Badge variant="default" className="bg-green-600">{language === 'ar' ? 'متاح' : 'Available'}</Badge>;
      case 'sold':
        return <Badge variant="secondary">{language === 'ar' ? 'مباع' : 'Sold'}</Badge>;
      case 'reserved':
        return <Badge variant="outline" className="border-amber-500 text-amber-600">{language === 'ar' ? 'محجوز' : 'Reserved'}</Badge>;
      case 'returned':
        return <Badge variant="destructive">{language === 'ar' ? 'مرتجع' : 'Returned'}</Badge>;
      default:
        return <Badge variant="outline">{status || '-'}</Badge>;
    }
  };

  const getFilterDescription = () => {
    const parts: string[] = [];
    if (statusFilter !== 'all') parts.push(STATUS_LABELS[statusFilter] || statusFilter);
    if (branchFilter !== 'all') {
      const b = branches.find((br: any) => br.id === branchFilter);
      if (b) parts.push(b.name || b.branch_name);
    }
    if (searchQuery.trim()) parts.push(`"${searchQuery.trim()}"`);
    return parts.length > 0 ? parts.join(' - ') : 'الكل';
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    toast.info('جاري تجهيز ملف Excel...');
    try {
      const allItems = await fetchAllFilteredItems(searchQuery, statusFilter, branchFilter);
      const exportData = allItems.map((item: any) => ({
        'كود القطعة': item.item_code,
        'كود المخزون': item.stockcode || '',
        'الموديل': item.model || '',
        'الوصف': item.description || '',
        'النوع': item.type || '',
        'المعدن': item.metal || '',
        'الحجر': item.stone || '',
        'وزن الذهب': item.g_weight || 0,
        'وزن الألماس': item.d_weight || 0,
        'التكلفة': item.cost || 0,
        'سعر البيع': item.tag_price || 0,
        'الحد الأدنى': item.minimum_price || 0,
        'الحالة': STATUS_LABELS[item.sale_status] || item.sale_status || '',
        'الفرع': item.branch_name || '',
        'المورد': item.supplier_name || '',
        'فاتورة المورد': item.supp_inv || '',
        'تاريخ الإضافة': item.created_at ? format(new Date(item.created_at), 'yyyy-MM-dd') : '',
      }));

      createArabicWorkbook(
        exportData,
        'القطع المستوردة',
        `imported-pieces-${format(new Date(), 'yyyyMMdd')}.xlsx`
      );
      toast.success(`تم تصدير ${allItems.length} قطعة بنجاح`);
    } catch (error) {
      console.error('Excel export error:', error);
      toast.error('فشل تصدير Excel');
    } finally {
      setIsExporting(false);
    }
  };

  const exportToPdf = async () => {
    setIsExporting(true);
    toast.info('جاري تجهيز ملف PDF...');
    try {
      const allItems = await fetchAllFilteredItems(searchQuery, statusFilter, branchFilter);
      if (allItems.length === 0) {
        toast.warning('لا توجد بيانات للتصدير');
        return;
      }

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontLoaded = await addCairoFont(pdf);
      if (!fontLoaded) {
        toast.error('فشل تحميل الخط العربي - يرجى المحاولة مرة أخرى');
        return;
      }
      const fontName = 'Cairo';

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const marginL = 10;
      const marginR = pageW - 10;
      const marginTop = 22;
      const totalW = marginR - marginL;

      const arHeaders = ['#', 'كود القطعة', 'كود المخزون', 'الموديل', 'الوصف', 'النوع', 'وزن ذهب', 'وزن ألماس', 'التكلفة', 'سعر البيع', 'فاتورة مورد', 'الفرع', 'الحالة'];
      const ratios = [2.5, 10, 8, 8, 15, 6, 6, 6, 8, 8, 8, 8, 6.5];
      const ratioSum = ratios.reduce((a, b) => a + b, 0);
      const colWidths = ratios.map(r => (r / ratioSum) * totalW);
      const rowH = 7;

      const rtlText = (text: string, x: number, y: number, opts?: any) => {
        const isArabic = /[\u0600-\u06FF]/.test(text);
        if (isArabic && fontLoaded) {
          pdf.setFont(fontName, 'normal');
        }
        pdf.text(text, x, y, opts);
      };

      const drawHeader = (pageNum: number) => {
        pdf.setFillColor(240, 240, 240);
        pdf.rect(0, 0, pageW, 18, 'F');
        pdf.setFont(fontName, 'normal');
        pdf.setFontSize(14);
        rtlText('تقرير القطع المستوردة', marginR, 9, { align: 'right' });
        pdf.setFontSize(8);
        const filterDesc = getFilterDescription();
        rtlText(`الفلتر: ${filterDesc} | الإجمالي: ${allItems.length} قطعة | صفحة ${pageNum}`, marginR, 15, { align: 'right' });
        pdf.setFont(fontName, 'normal');
        pdf.text(`${format(new Date(), 'yyyy-MM-dd HH:mm')}`, marginL, 15);
      };

      const drawTableHeader = (y: number) => {
        pdf.setFillColor(55, 65, 81);
        pdf.rect(marginL, y, totalW, rowH, 'F');
        pdf.setFont(fontName, 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(255, 255, 255);
        let xPos = marginL + 1;
        arHeaders.forEach((h, i) => {
          rtlText(h, xPos + colWidths[i] / 2, y + 5, { align: 'center' });
          xPos += colWidths[i];
        });
        pdf.setTextColor(0, 0, 0);
        return y + rowH;
      };

      let pageNum = 1;
      drawHeader(pageNum);
      let y = drawTableHeader(marginTop);

      allItems.forEach((item: any, idx: number) => {
        if (y + rowH > pageH - 12) {
          pdf.addPage();
          pageNum++;
          drawHeader(pageNum);
          y = drawTableHeader(marginTop);
        }

        if (idx % 2 === 0) {
          pdf.setFillColor(248, 249, 250);
          pdf.rect(marginL, y, totalW, rowH, 'F');
        }

        pdf.setFontSize(6.5);
        let xPos = marginL + 1;
        const statusText = STATUS_LABELS[item.sale_status] || item.sale_status || '';
        const row = [
          String(idx + 1),
          item.item_code || '',
          item.stockcode || '',
          item.model || '',
          (item.description || '').substring(0, 25),
          item.type || '',
          (item.g_weight || 0).toFixed(2),
          (item.d_weight || 0).toFixed(2),
          (item.cost || 0).toLocaleString(),
          (item.tag_price || 0).toLocaleString(),
          item.supp_inv || '',
          item.branch_name || '',
          statusText,
        ];

        row.forEach((cell, i) => {
          pdf.setFont(fontName, 'normal');
          const maxW = colWidths[i] - 2;
          let truncated = cell;
          if (pdf.getTextWidth(cell) > maxW) {
            while (truncated.length > 1 && pdf.getTextWidth(truncated + '..') > maxW) {
              truncated = truncated.substring(0, truncated.length - 1);
            }
            truncated = truncated + '..';
          }
          rtlText(truncated, xPos + colWidths[i] / 2, y + 5, { align: 'center' });
          xPos += colWidths[i];
        });

        y += rowH;
      });

      const totalCost = allItems.reduce((sum: number, i: any) => sum + (i.cost || 0), 0);
      const totalTag = allItems.reduce((sum: number, i: any) => sum + (i.tag_price || 0), 0);

      if (y + 14 > pageH - 10) {
        pdf.addPage();
        pageNum++;
        drawHeader(pageNum);
        y = marginTop + 5;
      }

      y += 6;
      pdf.setFont(fontName, 'normal');
      pdf.setFontSize(10);
      rtlText(`إجمالي القطع: ${allItems.length}`, marginR, y, { align: 'right' });
      rtlText(`إجمالي التكلفة: ${totalCost.toLocaleString()} ر.س`, marginR - 80, y, { align: 'right' });
      rtlText(`إجمالي سعر البيع: ${totalTag.toLocaleString()} ر.س`, marginR - 170, y, { align: 'right' });

      pdf.save(`imported-pieces-${format(new Date(), 'yyyyMMdd')}.pdf`);
      toast.success(`تم تصدير ${allItems.length} قطعة بنجاح`);
    } catch (error) {
      console.error('PDF export error:', error);
      toast.error('فشل تصدير PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, stats.total);

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Gem className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">
                {language === 'ar' ? 'قطع مستوردة للبيع' : 'Imported Pieces for Sale'}
              </h1>
              <p className="text-muted-foreground">
                {language === 'ar' ? 'عرض وإدارة القطع المستوردة من ملفات Excel' : 'View and manage pieces imported from Excel files'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={exportToExcel} variant="outline" disabled={isExporting} data-testid="button-export-excel">
              {isExporting ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Download className="h-4 w-4 ml-2" />}
              {language === 'ar' ? 'تصدير Excel' : 'Export Excel'}
            </Button>
            <Button onClick={exportToPdf} variant="outline" disabled={isExporting} data-testid="button-export-pdf">
              {isExporting ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <FileText className="h-4 w-4 ml-2" />}
              {language === 'ar' ? 'تصدير PDF' : 'Export PDF'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">{language === 'ar' ? 'إجمالي القطع' : 'Total Pieces'}</div>
              <div className="text-2xl font-bold" data-testid="text-stat-total">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">{language === 'ar' ? 'متاح للبيع' : 'Available'}</div>
              <div className="text-2xl font-bold text-green-600" data-testid="text-stat-available">{stats.available}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">{language === 'ar' ? 'مباع' : 'Sold'}</div>
              <div className="text-2xl font-bold text-blue-600" data-testid="text-stat-sold">{stats.sold}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">{language === 'ar' ? 'إجمالي التكلفة' : 'Total Cost'}</div>
              <div className="text-2xl font-bold" data-testid="text-stat-cost">{stats.totalValue.toLocaleString()} SAR</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={language === 'ar' ? 'بحث بالكود أو الموديل أو الوصف...' : 'Search by code, model, or description...'}
                    value={searchQuery}
                    onChange={handleSearchChange}
                    className="pl-10"
                    data-testid="input-search"
                  />
                </div>
              </div>
              <Select value={statusFilter} onValueChange={handleFilterChange(setStatusFilter)}>
                <SelectTrigger className="w-[150px]" data-testid="select-status-filter">
                  <SelectValue placeholder={language === 'ar' ? 'الحالة' : 'Status'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="available">{language === 'ar' ? 'متاح' : 'Available'}</SelectItem>
                  <SelectItem value="sold">{language === 'ar' ? 'مباع' : 'Sold'}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={branchFilter} onValueChange={handleFilterChange(setBranchFilter)}>
                <SelectTrigger className="w-[180px]" data-testid="select-branch-filter">
                  <SelectValue placeholder={language === 'ar' ? 'الفرع' : 'Branch'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'كل الفروع' : 'All Branches'}</SelectItem>
                  {branches.map((branch: any) => (
                    <SelectItem key={branch.id} value={branch.id}>{branch.name || branch.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{language === 'ar' ? 'كود القطعة' : 'Item Code'}</TableHead>
                      <TableHead>{language === 'ar' ? 'كود المخزون' : 'Stock Code'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الموديل' : 'Model'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                      <TableHead>{language === 'ar' ? 'وزن الذهب (جم)' : 'Gold (g)'}</TableHead>
                      <TableHead>{language === 'ar' ? 'التكلفة' : 'Cost'}</TableHead>
                      <TableHead>{language === 'ar' ? 'سعر البيع' : 'Tag Price'}</TableHead>
                      <TableHead>{language === 'ar' ? 'فاتورة المورد' : 'Supp Invoice'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الفرع' : 'Branch'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                          {language === 'ar' ? 'لا توجد قطع مستوردة' : 'No imported pieces found'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((item: any) => (
                        <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                          <TableCell className="font-mono font-medium">{item.item_code}</TableCell>
                          <TableCell>{item.stockcode || '-'}</TableCell>
                          <TableCell>{item.model || '-'}</TableCell>
                          <TableCell className="max-w-[200px] truncate" title={item.description}>{item.description || '-'}</TableCell>
                          <TableCell>{(item.g_weight || 0).toFixed(2)}</TableCell>
                          <TableCell>{(item.cost || 0).toLocaleString()}</TableCell>
                          <TableCell>{(item.tag_price || 0).toLocaleString()}</TableCell>
                          <TableCell className="font-mono text-xs">{item.supp_inv || '-'}</TableCell>
                          <TableCell>{item.branch_name || '-'}</TableCell>
                          <TableCell>{getStatusBadge(item.sale_status)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {stats.total > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3 px-1" data-testid="pagination-controls">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{language === 'ar' ? `عرض ${startItem}–${endItem} من ${stats.total}` : `Showing ${startItem}–${endItem} of ${stats.total}`}</span>
            </div>
            <div className="flex items-center gap-2">
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange} data-testid="select-page-size">
                <SelectTrigger className="w-[110px]" data-testid="trigger-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25 / {language === 'ar' ? 'صفحة' : 'page'}</SelectItem>
                  <SelectItem value="50">50 / {language === 'ar' ? 'صفحة' : 'page'}</SelectItem>
                  <SelectItem value="100">100 / {language === 'ar' ? 'صفحة' : 'page'}</SelectItem>
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
      </div>
    </MainLayout>
  );
}
