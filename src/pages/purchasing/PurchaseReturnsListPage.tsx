import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, RotateCcw, FileText, Loader2, Package, Gem, CalendarIcon, X } from 'lucide-react';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { toast } from 'sonner';
import { queryTable } from '@/lib/dataGateway';
import { listPurchaseReturnsUnified } from '@/domain/purchasing/returnReadService';
import { voidPurchaseReturnAtomic } from '@/domain/purchasing/purchasingWriteService';
import type { PurchaseReturnDTO } from '@/domain/purchasing/dto';
import { cn } from '@/lib/utils';

const PurchaseReturnsListPage = () => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Idempotency ref for void action
  const voidRequestIdRef = useRef<string | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [returnTypeFilter, setReturnTypeFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  // Cancel dialog states
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const [selectedReturnType, setSelectedReturnType] = useState<'unique' | 'general'>('general');
  const [cancelReason, setCancelReason] = useState('');

  // Fetch purchase returns using unified DTO read service
  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['purchase-returns-unified'],
    queryFn: () => listPurchaseReturnsUnified(),
  });

  // Fetch suppliers for filter dropdown
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-filter'],
    queryFn: async () => {
      const { data, error } = await queryTable('suppliers', {
        select: 'id, supplier_name',
        filters: [{ type: 'eq', column: 'status', value: 'active' }],
        order: { column: 'supplier_name', ascending: true },
      });
      if (error) throw error;
      return data || [];
    },
  });

  // Cancel return mutation via atomic wrapper
  const cancelMutation = useMutation({
    mutationFn: async ({ returnId, reason }: { 
      returnId: string; 
      reason: string; 
    }) => {
      // Generate stable request ID per action
      if (!voidRequestIdRef.current) {
        voidRequestIdRef.current = crypto.randomUUID();
      }

      const result = await voidPurchaseReturnAtomic({
        client_request_id: voidRequestIdRef.current,
        void: {
          purchase_return_id: returnId,
          reason: reason || 'إلغاء من قائمة المرتجعات',
          voided_by: user?.email || 'system',
        },
      });
      
      if (!result.success) {
        throw new Error(result.error || 'فشل في إلغاء المرتجع');
      }
      return result;
    },
    onSuccess: (result) => {
      // Reset request ID on success
      voidRequestIdRef.current = null;
      queryClient.invalidateQueries({ queryKey: ['purchase-returns-unified'] });
      toast.success(
        language === 'ar' 
          ? `تم إلغاء المرتجع بنجاح${result.reversal_je_id ? ` - قيد العكس: ${result.reversal_je_id}` : ''}`
          : `Return voided successfully${result.reversal_je_id ? ` - Reversal JE: ${result.reversal_je_id}` : ''}`
      );
      setCancelDialogOpen(false);
      setSelectedReturnId(null);
      setSelectedReturnType('general');
      setCancelReason('');
    },
    onError: (error: Error) => {
      // Don't reset request ID on error (allow retry)
      toast.error(error.message || (language === 'ar' ? 'حدث خطأ' : 'An error occurred'));
    },
  });

  const handleCancelClick = (returnId: string, returnType: 'unique' | 'general') => {
    // Reset request ID when opening dialog for new void action
    voidRequestIdRef.current = null;
    setSelectedReturnId(returnId);
    setSelectedReturnType(returnType);
    setCancelDialogOpen(true);
  };

  const handleConfirmCancel = () => {
    if (selectedReturnId) {
      cancelMutation.mutate({ 
        returnId: selectedReturnId, 
        reason: cancelReason 
      });
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setReturnTypeFilter('all');
    setSupplierFilter('all');
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const hasActiveFilters = 
    searchQuery || 
    statusFilter !== 'all' || 
    returnTypeFilter !== 'all' || 
    supplierFilter !== 'all' || 
    dateFrom || 
    dateTo;

  // Filter returns (using DTO fields)
  const filteredReturns = useMemo(() => {
    return returns.filter((ret: PurchaseReturnDTO) => {
      // Search filter: return number or invoice number
      const matchesSearch = !searchQuery || 
        ret.returnNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ret.linkedInvoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ret.supplierName?.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Status filter
      const matchesStatus = statusFilter === 'all' || ret.status === statusFilter;
      
      // Return type filter
      const matchesType = returnTypeFilter === 'all' || ret.returnType === returnTypeFilter;
      
      // Supplier filter
      const matchesSupplier = supplierFilter === 'all' || ret.supplierId === supplierFilter;
      
      // Date range filter
      const returnDate = new Date(ret.returnDate);
      const matchesDateFrom = !dateFrom || returnDate >= dateFrom;
      const matchesDateTo = !dateTo || returnDate <= dateTo;
      
      return matchesSearch && matchesStatus && matchesType && matchesSupplier && matchesDateFrom && matchesDateTo;
    });
  }, [returns, searchQuery, statusFilter, returnTypeFilter, supplierFilter, dateFrom, dateTo]);

  // Calculate summary stats (DTOs have normalized amounts - never null)
  const stats = useMemo(() => ({
    total: returns.length,
    pending: returns.filter((r: PurchaseReturnDTO) => r.status === 'pending').length,
    approved: returns.filter((r: PurchaseReturnDTO) => r.status === 'approved' || r.status === 'completed' || (r.status as string) === 'confirmed').length,
    totalAmount: returns.filter((r: PurchaseReturnDTO) => r.status !== 'cancelled').reduce((sum: number, r: PurchaseReturnDTO) => sum + r.totalAmount, 0),
  }), [returns]);

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: language === 'ar' ? 'معلق' : 'Pending', variant: 'secondary' },
      approved: { label: language === 'ar' ? 'معتمد' : 'Approved', variant: 'default' },
      completed: { label: language === 'ar' ? 'مكتمل' : 'Completed', variant: 'default' },
      confirmed: { label: language === 'ar' ? 'مؤكد' : 'Confirmed', variant: 'default' },
      cancelled: { label: language === 'ar' ? 'ملغي' : 'Cancelled', variant: 'destructive' },
    };
    const config = statusConfig[status] || statusConfig.pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getReturnTypeBadge = (returnType: 'general' | 'unique') => {
    if (returnType === 'unique') {
      return (
        <Badge variant="outline" className="gap-1">
          <Gem className="w-3 h-3" />
          {language === 'ar' ? 'قطع' : 'Unique'}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1">
        <Package className="w-3 h-3" />
        {language === 'ar' ? 'كميات' : 'General'}
      </Badge>
    );
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="page-header-rtl">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RotateCcw className="w-6 h-6 text-orange-500" />
              {language === 'ar' ? 'مرتجعات المشتريات' : 'Purchase Returns'}
            </h1>
            <p className="text-muted-foreground">
              {language === 'ar' 
                ? 'إدارة مرتجعات المشتريات - لإنشاء مرتجع جديد، افتح فاتورة المشتريات واختر "إنشاء مرتجع"'
                : 'Manage purchase returns - To create a new return, open a purchase invoice and select "Create Return"'}
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="stats-grid">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'إجمالي المرتجعات' : 'Total Returns'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'معلقة' : 'Pending'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'مكتملة' : 'Completed'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'إجمالي القيمة' : 'Total Value'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600" dir="ltr">
                {formatCurrency(stats.totalAmount)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search */}
              <div className="relative lg:col-span-2">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={language === 'ar' ? 'بحث برقم المرتجع أو الفاتورة أو المورد...' : 'Search by return, invoice number or supplier...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ps-10"
                />
              </div>

              {/* Return Type Filter */}
              <Select value={returnTypeFilter} onValueChange={setReturnTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'نوع المرتجع' : 'Return Type'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All Types'}</SelectItem>
                  <SelectItem value="unique">{language === 'ar' ? 'قطع فريدة' : 'Unique Items'}</SelectItem>
                  <SelectItem value="general">{language === 'ar' ? 'كميات' : 'General/Qty'}</SelectItem>
                </SelectContent>
              </Select>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'الحالة' : 'Status'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="pending">{language === 'ar' ? 'معلق' : 'Pending'}</SelectItem>
                  <SelectItem value="approved">{language === 'ar' ? 'معتمد' : 'Approved'}</SelectItem>
                  <SelectItem value="confirmed">{language === 'ar' ? 'مؤكد' : 'Confirmed'}</SelectItem>
                  <SelectItem value="completed">{language === 'ar' ? 'مكتمل' : 'Completed'}</SelectItem>
                  <SelectItem value="cancelled">{language === 'ar' ? 'ملغي' : 'Cancelled'}</SelectItem>
                </SelectContent>
              </Select>

              {/* Supplier Filter */}
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'المورد' : 'Supplier'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'جميع الموردين' : 'All Suppliers'}</SelectItem>
                  {suppliers.map((sup) => (
                    <SelectItem key={sup.id} value={sup.id}>
                      {sup.supplier_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Date From */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-start font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="me-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, 'dd/MM/yyyy') : (language === 'ar' ? 'من تاريخ' : 'From Date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
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
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-start font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="me-2 h-4 w-4" />
                    {dateTo ? format(dateTo, 'dd/MM/yyyy') : (language === 'ar' ? 'إلى تاريخ' : 'To Date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button variant="ghost" onClick={clearFilters} className="gap-2">
                  <X className="w-4 h-4" />
                  {language === 'ar' ? 'مسح الفلاتر' : 'Clear Filters'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Returns Table */}
        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredReturns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{language === 'ar' ? 'لا توجد مرتجعات' : 'No returns found'}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{language === 'ar' ? 'رقم المرتجع' : 'Return No.'}</TableHead>
                    <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                    <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                    <TableHead>{language === 'ar' ? 'المورد' : 'Supplier'}</TableHead>
                    <TableHead>{language === 'ar' ? 'الفاتورة' : 'Invoice'}</TableHead>
                    <TableHead className="text-center">{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                    <TableHead className="text-center">{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                    <TableHead className="text-center">{language === 'ar' ? 'الإجراءات' : 'Actions'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReturns.map((ret: PurchaseReturnDTO) => (
                    <TableRow key={ret.id}>
                      <TableCell className="font-medium">{ret.returnNumber}</TableCell>
                      <TableCell>{getReturnTypeBadge(ret.returnType)}</TableCell>
                      <TableCell>
                        {format(new Date(ret.returnDate), 'dd/MM/yyyy', {
                          locale: language === 'ar' ? ar : undefined,
                        })}
                      </TableCell>
                      <TableCell>{ret.supplierName || '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ret.linkedInvoiceNumber || '-'}
                      </TableCell>
                      <TableCell className="text-center font-medium text-orange-600" dir="ltr">
                        -{formatCurrency(ret.totalAmount)}
                      </TableCell>
                      <TableCell className="text-center">{getStatusBadge(ret.status)}</TableCell>
                      <TableCell className="text-center">
                        <RowActionsMenu
                          onPreview={() => navigate(`/purchasing/returns/${ret.id}/view`)}
                          onCancel={ret.status === 'pending' || (ret.status as string) === 'confirmed' ? () => handleCancelClick(ret.id, ret.returnType) : undefined}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Cancel Confirmation Dialog */}
        <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {language === 'ar' ? 'تأكيد إلغاء المرتجع' : 'Confirm Cancellation'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {language === 'ar' 
                  ? 'سيتم إلغاء هذا المرتجع واستعادة الأصناف للمخزون وعكس القيد المحاسبي. هل أنت متأكد؟'
                  : 'This return will be cancelled, inventory will be restored, and journal entry reversed. Are you sure?'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 py-4">
              <Label>{language === 'ar' ? 'سبب الإلغاء (اختياري)' : 'Cancellation Reason (optional)'}</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={language === 'ar' ? 'أدخل سبب الإلغاء...' : 'Enter cancellation reason...'}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancelMutation.isPending}>
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleConfirmCancel}
                disabled={cancelMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  language === 'ar' ? 'تأكيد الإلغاء' : 'Confirm Cancel'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
};

export default PurchaseReturnsListPage;
