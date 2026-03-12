import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { debounce } from '@/lib/utils';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Plus, Search, FileText, Loader2, Receipt, CreditCard, RotateCcw, Wallet, CalendarIcon, X } from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { useScreenPermissions } from '@/hooks/useScreenPermissions';
import { useBranches } from '@/hooks/useBranches';
import { useSuppliers } from '@/hooks/useSuppliers';
import { listPurchaseInvoices, type PurchaseInvoiceDTO, type PurchaseInvoiceFilters } from '@/domain/purchasing';

const PurchaseInvoicesPage = () => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState<'all' | 'general' | 'import'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  // Permission checks
  const { isAdmin, canViewScreen } = useScreenPermissions();
  const canCreateVoucher = isAdmin || canViewScreen('/purchasing/payment-vouchers');
  const canCreateInvoice = isAdmin || canViewScreen('/purchasing/invoices');
  const canViewReturns = isAdmin || canViewScreen('/purchasing/returns');

  const debouncedSetSearch = useCallback(
    debounce((value: string) => setDebouncedSearch(value), 400),
    []
  );

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    debouncedSetSearch(value);
  };

  // Fetch branches and suppliers for filters
  const { data: branches } = useBranches(true);
  const { data: suppliersData } = useSuppliers({ pageSize: 200 });

  // Build filters object for the read service
  const filters: PurchaseInvoiceFilters = {
    purchaseType: purchaseTypeFilter !== 'all' ? purchaseTypeFilter : undefined,
    status: statusFilter !== 'all' ? statusFilter as any : undefined,
    supplierId: supplierFilter !== 'all' ? supplierFilter : undefined,
    branchId: branchFilter !== 'all' ? branchFilter : undefined,
    dateFrom: dateFrom ? format(dateFrom, 'yyyy-MM-dd') : undefined,
    dateTo: dateTo ? format(dateTo, 'yyyy-MM-dd') : undefined,
    searchQuery: debouncedSearch || undefined,
  };

  const { data: invoices, isLoading, refetch } = useQuery({
    queryKey: ['purchase-invoices', filters],
    queryFn: () => listPurchaseInvoices(filters)
  });

  const filteredInvoices = invoices || [];

  const clearFilters = () => {
    setSearchTerm('');
    setDebouncedSearch('');
    setPurchaseTypeFilter('all');
    setStatusFilter('all');
    setSupplierFilter('all');
    setBranchFilter('all');
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const hasActiveFilters = purchaseTypeFilter !== 'all' || statusFilter !== 'all' || 
    supplierFilter !== 'all' || branchFilter !== 'all' || dateFrom || dateTo;

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'posted':
        return <Badge variant="default" className="bg-green-600">{language === 'ar' ? 'مرحّل' : 'Posted'}</Badge>;
      case 'paid':
        return <Badge variant="default" className="bg-green-500">{t.status.paid}</Badge>;
      case 'partial':
        return <Badge variant="secondary">{t.status.partial}</Badge>;
      case 'draft':
        return <Badge variant="outline">{language === 'ar' ? 'مسودة' : 'Draft'}</Badge>;
      case 'voided':
        return <Badge variant="destructive">{language === 'ar' ? 'ملغاة' : 'Voided'}</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">{language === 'ar' ? 'ملغاة' : 'Cancelled'}</Badge>;
      case 'returned':
        return <Badge variant="default" className="bg-orange-600">{language === 'ar' ? 'مرتجعة بالكامل' : 'Fully Returned'}</Badge>;
      case 'partially_returned':
        return <Badge variant="secondary" className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">{language === 'ar' ? 'مرتجعة جزئياً' : 'Partially Returned'}</Badge>;
      case 'pending':
      default:
        return <Badge variant="outline">{t.status.pending}</Badge>;
    }
  };

  const getPurchaseTypeBadge = (purchaseType: 'general' | 'import') => {
    if (purchaseType === 'import') {
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
          {language === 'ar' ? 'استيراد' : 'Import'}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
        {language === 'ar' ? 'عام' : 'General'}
      </Badge>
    );
  };

  const formatDate = (dateStr: string) => {
    return format(new Date(dateStr), 'yyyy/MM/dd', { locale: language === 'ar' ? ar : enUS });
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2
    });
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="page-header-rtl">
          <div>
            <h1 className="text-2xl font-bold">{t.purchaseInvoices.title}</h1>
            <p className="text-muted-foreground">{t.purchaseInvoices.subtitle}</p>
          </div>
        </div>

        <Card className="card-responsive bg-muted/30 border-dashed">
          <CardContent className="py-3 px-4">
            <div className="actions-rtl flex-wrap">
              {/* إدارة السندات - Manage Vouchers */}
              {canCreateVoucher && (
                <Button 
                  variant="outline" 
                  onClick={() => navigate('/purchasing/payment-vouchers')}
                  className="gap-2"
                >
                  <Wallet className="w-4 h-4" />
                  {language === 'ar' ? 'إدارة السندات' : 'Manage Vouchers'}
                </Button>
              )}

              {/* الإشعارات المدينة - Debit Notes / Purchase Returns */}
              {canViewReturns && (
                <Button 
                  variant="outline" 
                  onClick={() => navigate('/purchasing/returns')}
                  className="gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  {language === 'ar' ? 'الإشعارات المدينة' : 'Debit Notes'}
                </Button>
              )}

              {/* + إنشاء فاتورة - Create Invoice */}
              {canCreateInvoice && (
                <Button 
                  onClick={() => navigate('/purchasing/invoices/new')} 
                  className="gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {language === 'ar' ? 'إنشاء فاتورة' : 'Create Invoice'}
                </Button>
              )}

              {/* + إنشاء سند مورد - Create Supplier Voucher */}
              {canCreateVoucher && (
                <Button 
                  onClick={() => navigate('/purchasing/payment-vouchers?new=true')} 
                  className="gap-2 bg-primary"
                >
                  <CreditCard className="w-4 h-4" />
                  {language === 'ar' ? 'إنشاء سند مورد' : 'Create Supplier Voucher'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Search and Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {t.purchaseInvoices.list}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Filters Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4 mb-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={language === 'ar' ? 'بحث برقم الفاتورة، المورد، فاتورة المورد، الموديل...' : 'Search by invoice, supplier, model...'}
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'الحالة' : 'Status'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'جميع الحالات' : 'All Statuses'}</SelectItem>
                  <SelectItem value="pending">{t.status.pending}</SelectItem>
                  <SelectItem value="partial">{t.status.partial}</SelectItem>
                  <SelectItem value="paid">{t.status.paid}</SelectItem>
                </SelectContent>
              </Select>

              {/* Supplier Filter */}
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'المورد' : 'Supplier'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'جميع الموردين' : 'All Suppliers'}</SelectItem>
                  {suppliersData?.suppliers?.map(supplier => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.supplier_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Branch Filter */}
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'الفرع' : 'Branch'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'جميع الفروع' : 'All Branches'}</SelectItem>
                  {branches?.map(branch => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Date From */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, 'yyyy/MM/dd') : (language === 'ar' ? 'من تاريخ' : 'From Date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* Date To */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? format(dateTo, 'yyyy/MM/dd') : (language === 'ar' ? 'إلى تاريخ' : 'To Date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Purchase Type Filter + Clear Filters */}
            <div className="flex gap-2 mb-4 flex-wrap items-center">
              <Button
                variant={purchaseTypeFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPurchaseTypeFilter('all')}
              >
                {language === 'ar' ? 'الكل' : 'All'}
              </Button>
              <Button
                variant={purchaseTypeFilter === 'general' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPurchaseTypeFilter('general')}
                className="gap-1"
              >
                {language === 'ar' ? 'عام' : 'General'}
              </Button>
              <Button
                variant={purchaseTypeFilter === 'import' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPurchaseTypeFilter('import')}
                className="gap-1"
              >
                {language === 'ar' ? 'استيراد' : 'Import'}
              </Button>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="gap-1 text-muted-foreground"
                >
                  <X className="w-4 h-4" />
                  {language === 'ar' ? 'مسح الفلاتر' : 'Clear Filters'}
                </Button>
              )}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {t.common.noData}
              </div>
            ) : (
              <div className="table-container-rtl">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.purchaseInvoices.invoiceNumber}</TableHead>
                      <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                      <TableHead>{t.purchaseInvoices.supplier}</TableHead>
                      <TableHead>{t.purchaseInvoices.invoiceDate}</TableHead>
                      <TableHead>{t.purchaseInvoices.totalAmount}</TableHead>
                      <TableHead>{t.purchaseInvoices.remainingBalance}</TableHead>
                      <TableHead>{t.common.status}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.map((invoice) => (
                      <TableRow key={invoice.id} className="cursor-pointer hover-elevate" onClick={() => navigate(`/purchasing/invoices/${invoice.id}/view`)}>
                        <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                        <TableCell>{getPurchaseTypeBadge(invoice.purchaseType)}</TableCell>
                        <TableCell>{invoice.supplierName || '-'}</TableCell>
                        <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
                        <TableCell>{formatCurrency(invoice.totalAmount)}</TableCell>
                        <TableCell>
                          <span className={invoice.remainingAmount > 0 ? 'text-destructive font-medium' : 'text-green-600 font-medium'}>
                            {formatCurrency(invoice.remainingAmount)}
                          </span>
                        </TableCell>
                        <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </MainLayout>
  );
};

export default PurchaseInvoicesPage;
