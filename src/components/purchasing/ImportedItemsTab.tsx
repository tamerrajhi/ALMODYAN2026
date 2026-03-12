import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, ChevronLeft, ChevronRight, RefreshCw, Package, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { debounce } from '@/lib/utils';
import { listInvoiceJewelryItems, listUniqueInvoiceItems } from '@/domain/purchasing';
import { rebuildImportSummary } from '@/domain/purchasing/purchasingWriteService';

interface ImportedItemsTabProps {
  invoiceId: string;
  invoiceNumber: string;
  purchaseType?: 'general' | 'import';
}

const PAGE_SIZE = 50;

const ImportedItemsTab = ({ invoiceId, invoiceNumber, purchaseType }: ImportedItemsTabProps) => {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [isRebuilding, setIsRebuilding] = useState(false);

  // Debounced search handler
  const debouncedSetSearch = useCallback(
    debounce((value: string) => {
      setDebouncedSearch(value);
      setPage(0); // Reset to first page on search
    }, 300),
    []
  );

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    debouncedSetSearch(value);
  };

  const isImportType = purchaseType === 'import';

  const { data: paginatedResult, isLoading, refetch } = useQuery({
    queryKey: ['imported-items', invoiceId, page, debouncedSearch, purchaseType],
    queryFn: () => isImportType
      ? listUniqueInvoiceItems(invoiceId, page, debouncedSearch || undefined, PAGE_SIZE)
      : listInvoiceJewelryItems(invoiceId, page, debouncedSearch || undefined, PAGE_SIZE),
    enabled: !!invoiceId,
  });

  const items = paginatedResult?.items || [];
  const itemsCount = paginatedResult?.total || 0;
  const totalPages = Math.ceil(itemsCount / PAGE_SIZE);

  const handleRebuildSummary = async () => {
    setIsRebuilding(true);
    try {
      const result = await rebuildImportSummary(invoiceId);
      toast.success(`تم تحديث الملخص: ${result.itemsCount} قطعة بإجمالي ${result.totalCost.toLocaleString()} ر.س`);
      refetch();
      // Invalidate invoice query to refresh the summary line
      queryClient.invalidateQueries({ queryKey: ['purchase-invoice', invoiceId] });
    } catch (error: any) {
      console.error('Rebuild summary error:', error);
      if (error.message === 'NO_ITEMS_LINKED') {
        toast.error('لا توجد قطع مرتبطة بهذه الفاتورة');
      } else {
        toast.error('فشل في إعادة بناء الملخص');
      }
    } finally {
      setIsRebuilding(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return format(new Date(dateStr), 'yyyy/MM/dd HH:mm', { locale: language === 'ar' ? ar : enUS });
  };

  const formatCurrency = (amount: number | null) => {
    return (amount || 0).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    });
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'sold':
        return <Badge className="bg-green-500 text-white">مباع</Badge>;
      case 'reserved':
        return <Badge variant="secondary">محجوز</Badge>;
      case 'returned_to_supplier':
        return <Badge variant="destructive">مرتجع للمورد</Badge>;
      case 'transferred':
        return <Badge className="bg-blue-500 text-white">محوّل</Badge>;
      case 'returned':
        return <Badge variant="destructive">مرتجع</Badge>;
      case 'damaged':
        return <Badge variant="destructive">تالف</Badge>;
      case 'available':
      default:
        return <Badge variant="outline">متاح</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-4 h-4" />
            {language === 'ar' ? 'تفاصيل القطع المستوردة' : 'Imported Items Details'}
            {itemsCount !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {itemsCount} {language === 'ar' ? 'قطعة' : 'items'}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 w-full md:w-auto print:hidden">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={language === 'ar' ? 'بحث بالكود أو الموديل...' : 'Search by code or model...'}
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRebuildSummary}
              disabled={isRebuilding}
              className="gap-2 whitespace-nowrap"
            >
              {isRebuilding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {language === 'ar' ? 'إعادة بناء الملخص' : 'Rebuild Summary'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : items && items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>{language === 'ar' ? 'السيريال' : 'Serial No'}</TableHead>
                    <TableHead>{language === 'ar' ? 'كود القطعة' : 'Item Code'}</TableHead>
                    <TableHead>{language === 'ar' ? 'فاتورة المورد' : 'Supp Inv'}</TableHead>
                    <TableHead>{language === 'ar' ? 'الموديل' : 'Model'}</TableHead>
                    <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                    <TableHead className="text-left">{language === 'ar' ? 'التكلفة' : 'Cost'}</TableHead>
                    <TableHead className="text-center print:hidden">{language === 'ar' ? 'وزن الذهب' : 'G Weight'}</TableHead>
                    <TableHead className="text-center print:hidden">{language === 'ar' ? 'وزن الألماس' : 'D Weight'}</TableHead>
                    <TableHead className="print:hidden">{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                    <TableHead className="print:hidden">{language === 'ar' ? 'تاريخ الإنشاء' : 'Created'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-muted-foreground">
                        {page * PAGE_SIZE + index + 1}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">
                        {item.serialNo || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {item.itemCode || '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.suppInv || '-'}
                      </TableCell>
                      <TableCell>{item.model || '-'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {item.description || '-'}
                      </TableCell>
                      <TableCell className="text-left font-medium">
                        {formatCurrency(item.cost)}
                      </TableCell>
                      <TableCell className="text-center print:hidden">
                        {item.gWeight?.toFixed(3) || '-'}
                      </TableCell>
                      <TableCell className="text-center print:hidden">
                        {item.dWeight?.toFixed(3) || '-'}
                      </TableCell>
                      <TableCell className="print:hidden">{getStatusBadge(item.saleStatus)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground print:hidden">
                        {formatDate(item.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t print:hidden">
                <div className="text-sm text-muted-foreground">
                  {language === 'ar' 
                    ? `صفحة ${page + 1} من ${totalPages}` 
                    : `Page ${page + 1} of ${totalPages}`}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronRight className="w-4 h-4" />
                    {language === 'ar' ? 'السابق' : 'Previous'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    {language === 'ar' ? 'التالي' : 'Next'}
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {debouncedSearch 
              ? (language === 'ar' ? 'لا توجد نتائج للبحث' : 'No search results')
              : (language === 'ar' ? 'لا توجد قطع مستوردة لهذه الفاتورة' : 'No imported items for this invoice')}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ImportedItemsTab;
