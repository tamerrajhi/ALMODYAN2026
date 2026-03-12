import { useState } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { 
  Search, 
  Plus, 
  Truck,
  Loader2,
  Edit,
  Eye,
  MoreHorizontal,
  Trash2,
  Ban,
  CheckCircle,
  Download,
  Users,
  TrendingUp,
  TrendingDown,
  Filter,
  ChevronLeft,
  ChevronRight,
  Building2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileSpreadsheet
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useSuppliers, useSupplierStats, useSupplierMutations, useCountries } from '@/hooks/useSuppliers';
import { Supplier, statusLabels, supplierTypeLabels } from '@/types/supplier.types';
import { SupplierFormDialog } from '@/components/suppliers/SupplierFormDialog';
import { SupplierViewDialog } from '@/components/suppliers/SupplierViewDialog';
import { useScreenPermissions } from '@/hooks/useScreenPermissions';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

type SortField = 'supplier_code' | 'supplier_name' | 'country' | 'city' | 'current_balance' | 'created_at' | 'updated_at';
type SortDirection = 'asc' | 'desc';

export default function SuppliersPage() {
  // Permissions
  const { isAdmin, getScreenPermission } = useScreenPermissions();
  const permissions = getScreenPermission('/suppliers');
  const canCreate = isAdmin || permissions?.can_create;
  const canEdit = isAdmin || permissions?.can_edit;
  const canDelete = isAdmin || permissions?.can_delete;

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'debit' | 'credit' | 'zero'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Dialog states
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);

  // Fetch data
  const { data, isLoading } = useSuppliers({
    search: searchQuery,
    country: countryFilter,
    status: statusFilter,
    balanceType: balanceFilter,
    page: currentPage,
    pageSize,
    sortField,
    sortDirection,
  });

  const { data: stats } = useSupplierStats();
  const { data: countries = [] } = useCountries();
  const { deleteSupplier, suspendSupplier } = useSupplierMutations();

  const suppliers = data?.suppliers || [];
  const totalPages = data?.totalPages || 1;
  const totalCount = data?.totalCount || 0;

  // Handlers
  const handleAddNew = () => {
    if (!canCreate) {
      toast.error('ليس لديك صلاحية لإضافة موردين');
      return;
    }
    setSelectedSupplier(null);
    setShowFormDialog(true);
  };

  const handleEdit = (supplier: Supplier) => {
    if (!canEdit) {
      toast.error('ليس لديك صلاحية لتعديل الموردين');
      return;
    }
    setSelectedSupplier(supplier);
    setShowFormDialog(true);
  };

  const handleView = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setShowViewDialog(true);
  };

  const handleDelete = (supplier: Supplier) => {
    if (!canDelete) {
      toast.error('ليس لديك صلاحية لحذف الموردين');
      return;
    }
    setSupplierToDelete(supplier);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (supplierToDelete) {
      await deleteSupplier.mutateAsync(supplierToDelete);
      setDeleteConfirmOpen(false);
      setSupplierToDelete(null);
    }
  };

  const handleSuspend = async (supplier: Supplier) => {
    if (!canEdit) {
      toast.error('ليس لديك صلاحية لتغيير حالة الموردين');
      return;
    }
    await suspendSupplier.mutateAsync({ supplier });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-4 h-4 opacity-50" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-4 h-4" /> 
      : <ArrowDown className="w-4 h-4" />;
  };

  const handleExport = () => {
    if (suppliers.length === 0) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }

    const exportData = suppliers.map(s => ({
      'رقم المورد': s.supplier_code,
      'اسم المورد': s.supplier_name,
      'الفئة': supplierTypeLabels[s.supplier_type] || '-',
      'السجل التجاري': s.commercial_register || '-',
      'الرقم الضريبي': s.vat_number || '-',
      'الدولة': s.country || '-',
      'المدينة': s.city || '-',
      'العنوان': s.address || '-',
      'الهاتف': s.mobile_phone || s.phone || '-',
      'البريد الإلكتروني': s.email || '-',
      'الرصيد الحالي': s.current_balance || 0,
      'الحالة': statusLabels[s.status],
      'تاريخ الإنشاء': format(new Date(s.created_at), 'yyyy-MM-dd'),
      'آخر تعديل': s.updated_at ? format(new Date(s.updated_at), 'yyyy-MM-dd') : '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الموردين');
    XLSX.writeFile(wb, `suppliers_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('تم تصدير البيانات بنجاح');
  };

  const statusColor: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    archived: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400',
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Truck className="w-6 h-6 text-primary" />
              إدارة الموردين
            </h1>
            <p className="text-muted-foreground text-sm">إدارة بيانات الموردين والأرصدة والمستندات</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExport}>
              <FileSpreadsheet className="w-4 h-4 ml-2" />
              تصدير Excel
            </Button>
            {canCreate && (
              <Button onClick={handleAddNew}>
                <Plus className="w-4 h-4 ml-2" />
                إضافة مورد
              </Button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي الموردين</p>
                  <p className="text-2xl font-bold">{stats?.totalSuppliers || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">الموردين النشطين</p>
                  <p className="text-2xl font-bold">{stats?.activeSuppliers || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي المديونية</p>
                  <p className="text-xl font-bold text-red-600">
                    {(stats?.totalDebit || 0).toLocaleString('ar-SA')} ر.س
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <TrendingDown className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي الدائنية</p>
                  <p className="text-xl font-bold text-green-600">
                    {(stats?.totalCredit || 0).toLocaleString('ar-SA')} ر.س
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="البحث بالاسم أو الكود أو الهاتف أو الرقم الضريبي..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pr-10"
                  />
                </div>
              </div>

              <div className="w-[150px]">
                <Select value={countryFilter} onValueChange={(v) => { setCountryFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger>
                    <Filter className="w-4 h-4 ml-2" />
                    <SelectValue placeholder="الدولة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الدول</SelectItem>
                    {countries.map((country) => (
                      <SelectItem key={country} value={country}>{country}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-[150px]">
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="الحالة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الحالات</SelectItem>
                    <SelectItem value="active">نشط</SelectItem>
                    <SelectItem value="suspended">موقوف</SelectItem>
                    <SelectItem value="archived">مؤرشف</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="w-[150px]">
                <Select value={balanceFilter} onValueChange={(v: any) => { setBalanceFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="الرصيد" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأرصدة</SelectItem>
                    <SelectItem value="debit">مدين (علينا)</SelectItem>
                    <SelectItem value="credit">دائن (لنا)</SelectItem>
                    <SelectItem value="zero">صفر</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Suppliers Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span>قائمة الموردين ({totalCount})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="p-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : suppliers.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Building2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>لا يوجد موردين</p>
                {canCreate && (
                  <Button variant="outline" className="mt-4" onClick={handleAddNew}>
                    <Plus className="w-4 h-4 ml-2" />
                    إضافة أول مورد
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort('supplier_code')}
                        >
                          <div className="flex items-center gap-1">
                            رقم المورد
                            {getSortIcon('supplier_code')}
                          </div>
                        </TableHead>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort('supplier_name')}
                        >
                          <div className="flex items-center gap-1">
                            اسم المورد
                            {getSortIcon('supplier_name')}
                          </div>
                        </TableHead>
                        <TableHead>الفئة</TableHead>
                        <TableHead>السجل التجاري</TableHead>
                        <TableHead>الرقم الضريبي</TableHead>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort('country')}
                        >
                          <div className="flex items-center gap-1">
                            الدولة
                            {getSortIcon('country')}
                          </div>
                        </TableHead>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort('city')}
                        >
                          <div className="flex items-center gap-1">
                            المدينة
                            {getSortIcon('city')}
                          </div>
                        </TableHead>
                        <TableHead>الهاتف</TableHead>
                        <TableHead>البريد</TableHead>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort('current_balance')}
                        >
                          <div className="flex items-center gap-1">
                            الرصيد
                            {getSortIcon('current_balance')}
                          </div>
                        </TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort('created_at')}
                        >
                          <div className="flex items-center gap-1">
                            تاريخ الإضافة
                            {getSortIcon('created_at')}
                          </div>
                        </TableHead>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort('updated_at')}
                        >
                          <div className="flex items-center gap-1">
                            آخر تعديل
                            {getSortIcon('updated_at')}
                          </div>
                        </TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {suppliers.map((supplier) => (
                        <TableRow key={supplier.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleView(supplier)}>
                          <TableCell className="font-mono">{supplier.supplier_code}</TableCell>
                          <TableCell className="font-medium">{supplier.supplier_name}</TableCell>
                          <TableCell>{supplierTypeLabels[supplier.supplier_type] || '-'}</TableCell>
                          <TableCell className="font-mono text-xs">{supplier.commercial_register || '-'}</TableCell>
                          <TableCell className="font-mono text-xs">{supplier.vat_number || '-'}</TableCell>
                          <TableCell>{supplier.country || '-'}</TableCell>
                          <TableCell>{supplier.city || '-'}</TableCell>
                          <TableCell dir="ltr" className="text-sm">{supplier.mobile_phone || supplier.phone || '-'}</TableCell>
                          <TableCell dir="ltr" className="text-xs truncate max-w-[150px]" title={supplier.email || ''}>
                            {supplier.email || '-'}
                          </TableCell>
                          <TableCell>
                            <span className={`font-medium ${
                              supplier.current_balance > 0 ? 'text-red-600' : 
                              supplier.current_balance < 0 ? 'text-emerald-600' : ''
                            }`}>
                              {(supplier.current_balance || 0).toLocaleString('ar-SA')} ر.س
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge className={statusColor[supplier.status]}>
                              {statusLabels[supplier.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(supplier.created_at), 'dd/MM/yyyy', { locale: ar })}
                          </TableCell>
                          <TableCell className="text-sm">
                            {supplier.updated_at 
                              ? format(new Date(supplier.updated_at), 'dd/MM/yyyy', { locale: ar })
                              : '-'
                            }
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleView(supplier)}>
                                  <Eye className="w-4 h-4 ml-2" />
                                  عرض
                                </DropdownMenuItem>
                                {canEdit && (
                                  <DropdownMenuItem onClick={() => handleEdit(supplier)}>
                                    <Edit className="w-4 h-4 ml-2" />
                                    تعديل
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                {canEdit && (
                                  <DropdownMenuItem onClick={() => handleSuspend(supplier)}>
                                    {supplier.status === 'active' ? (
                                      <>
                                        <Ban className="w-4 h-4 ml-2" />
                                        إيقاف
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle className="w-4 h-4 ml-2" />
                                        تفعيل
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                )}
                                {canDelete && (
                                  <DropdownMenuItem 
                                    onClick={() => handleDelete(supplier)}
                                    className="text-destructive"
                                  >
                                    <Trash2 className="w-4 h-4 ml-2" />
                                    حذف
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      عرض {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, totalCount)} من {totalCount}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => p - 1)}
                        disabled={currentPage === 1}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <span className="text-sm">
                        صفحة {currentPage} من {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => p + 1)}
                        disabled={currentPage === totalPages}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Form Dialog */}
      <SupplierFormDialog
        open={showFormDialog}
        onOpenChange={setShowFormDialog}
        supplier={selectedSupplier}
      />

      {/* View Dialog */}
      <SupplierViewDialog
        open={showViewDialog}
        onOpenChange={setShowViewDialog}
        supplier={selectedSupplier}
        onEdit={() => selectedSupplier && handleEdit(selectedSupplier)}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف المورد "{supplierToDelete?.supplier_name}"؟
              <br />
              لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
