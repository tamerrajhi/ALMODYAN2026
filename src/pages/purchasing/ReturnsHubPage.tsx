/**
 * Returns Hub Page
 * 
 * Unified returns list reading from v_returns_hub view
 * Single source of truth for all purchase returns (unique + general)
 * P3-A: New canonical list, does not modify legacy screens
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { queryTable } from '@/lib/dataGateway';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  Search, 
  RotateCcw, 
  Loader2, 
  Package, 
  Gem, 
  CalendarIcon, 
  X,
  Eye,
  AlertTriangle,
  BookOpen,
  Copy,
  Database,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { cn } from '@/lib/utils';

// Type for v_returns_hub view row
interface ReturnsHubRow {
  return_number: string;
  return_type: 'unique' | 'general';
  canonical_id: string;
  status: string;
  branch_id: string | null;
  supplier_id: string | null;
  return_date: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  mirror_exists: boolean;
  has_je: boolean;
  journal_entry_id: string | null;
  expected_movement_count: number | null;
  actual_movement_count: number | null;
  has_drift: boolean | null;
  drift_type: string | null;
  created_at: string | null;
}

const ReturnsHubPage = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [returnTypeFilter, setReturnTypeFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [driftOnlyFilter, setDriftOnlyFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  // Fetch returns from v_returns_hub view
  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['returns-hub-view'],
    queryFn: async () => {
      const { data, error } = await queryTable('v_returns_hub', {
        select: '*',
        order: { column: 'created_at', ascending: false },
      });
      
      if (error) throw error;
      return (data || []) as ReturnsHubRow[];
    },
  });

  // Fetch suppliers for filter
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-hub-filter'],
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

  // Fetch branches for filter
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-for-hub-filter'],
    queryFn: async () => {
      const { data, error } = await queryTable('branches', {
        select: 'id, branch_name',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'branch_name', ascending: true },
      });
      if (error) throw error;
      return data || [];
    },
  });

  // Build supplier/branch lookup maps
  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    suppliers.forEach((s) => { map[s.id] = s.supplier_name; });
    return map;
  }, [suppliers]);

  const branchMap = useMemo(() => {
    const map: Record<string, string> = {};
    branches.forEach((b: { id: string; branch_name: string }) => { map[b.id] = b.branch_name; });
    return map;
  }, [branches]);

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setReturnTypeFilter('all');
    setSupplierFilter('all');
    setBranchFilter('all');
    setDriftOnlyFilter(false);
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const hasActiveFilters = 
    searchQuery || 
    statusFilter !== 'all' || 
    returnTypeFilter !== 'all' || 
    supplierFilter !== 'all' ||
    branchFilter !== 'all' ||
    driftOnlyFilter || 
    dateFrom || 
    dateTo;

  // Filter returns
  const filteredReturns = useMemo(() => {
    return returns.filter((ret) => {
      // Search filter
      const matchesSearch = !searchQuery || 
        ret.return_number?.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Status filter
      const matchesStatus = statusFilter === 'all' || ret.status === statusFilter;
      
      // Return type filter
      const matchesType = returnTypeFilter === 'all' || ret.return_type === returnTypeFilter;
      
      // Supplier filter
      const matchesSupplier = supplierFilter === 'all' || ret.supplier_id === supplierFilter;

      // Branch filter
      const matchesBranch = branchFilter === 'all' || ret.branch_id === branchFilter;
      
      // Drift only filter
      const matchesDrift = !driftOnlyFilter || ret.has_drift === true;
      
      // Date range filter
      const returnDate = ret.return_date ? new Date(ret.return_date) : (ret.created_at ? new Date(ret.created_at) : null);
      const matchesDateFrom = !dateFrom || !returnDate || returnDate >= dateFrom;
      const matchesDateTo = !dateTo || !returnDate || returnDate <= dateTo;
      
      return matchesSearch && matchesStatus && matchesType && matchesSupplier && matchesBranch && matchesDrift && matchesDateFrom && matchesDateTo;
    });
  }, [returns, searchQuery, statusFilter, returnTypeFilter, supplierFilter, branchFilter, driftOnlyFilter, dateFrom, dateTo]);

  // Stats
  const stats = useMemo(() => ({
    total: returns.length,
    unique: returns.filter((r) => r.return_type === 'unique').length,
    general: returns.filter((r) => r.return_type === 'general').length,
    withDrift: returns.filter((r) => r.has_drift === true).length,
    withJE: returns.filter((r) => r.has_je === true).length,
    totalAmount: returns.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0),
  }), [returns]);

  const formatCurrency = (amount: number | null) => {
    if (amount === null) return '-';
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return format(new Date(dateStr), 'dd/MM/yyyy', {
      locale: language === 'ar' ? ar : undefined,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: language === 'ar' ? 'معلق' : 'Pending', variant: 'secondary' },
      approved: { label: language === 'ar' ? 'معتمد' : 'Approved', variant: 'default' },
      completed: { label: language === 'ar' ? 'مكتمل' : 'Completed', variant: 'default' },
      confirmed: { label: language === 'ar' ? 'مؤكد' : 'Confirmed', variant: 'default' },
      cancelled: { label: language === 'ar' ? 'ملغي' : 'Cancelled', variant: 'destructive' },
      voided: { label: language === 'ar' ? 'ملغي' : 'Voided', variant: 'destructive' },
    };
    const config = statusConfig[status] || { label: status, variant: 'outline' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getReturnTypeBadge = (returnType: 'unique' | 'general') => {
    if (returnType === 'unique') {
      return (
        <Badge variant="outline" className="gap-1 bg-purple-50 text-purple-700 border-purple-200">
          <Gem className="w-3 h-3" />
          {language === 'ar' ? 'قطع' : 'Unique'}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1 bg-blue-50 text-blue-700 border-blue-200">
        <Package className="w-3 h-3" />
        {language === 'ar' ? 'كميات' : 'General'}
      </Badge>
    );
  };

  const getDriftBadge = (hasDrift: boolean | null, driftType: string | null) => {
    if (hasDrift !== true) return null;
    
    const driftLabels: Record<string, { ar: string; en: string; className: string }> = {
      movement_mismatch: { 
        ar: 'فرق حركة', 
        en: 'Movement Mismatch',
        className: 'bg-orange-50 text-orange-700 border-orange-200',
      },
      branch_not_cleared: { 
        ar: 'فرع غير مُخلى', 
        en: 'Branch Not Cleared',
        className: 'bg-red-50 text-red-700 border-red-200',
      },
    };
    
    const config = driftType && driftLabels[driftType] 
      ? driftLabels[driftType] 
      : { ar: 'انحراف', en: 'Drift', className: 'bg-yellow-50 text-yellow-700 border-yellow-200' };
    
    return (
      <Badge variant="outline" className={cn("gap-1", config.className)}>
        <AlertTriangle className="w-3 h-3" />
        {language === 'ar' ? config.ar : config.en}
      </Badge>
    );
  };

  const handleRowClick = (row: ReturnsHubRow) => {
    navigate(`/purchasing/returns-hub/${row.return_type}/${row.canonical_id}`);
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="w-6 h-6 text-orange-500" />
              {language === 'ar' ? 'مركز المرتجعات' : 'Returns Hub'}
            </h1>
            <p className="text-muted-foreground">
              {language === 'ar' 
                ? 'عرض موحد لجميع مرتجعات المشتريات من v_returns_hub'
                : 'Unified view of all purchase returns from v_returns_hub'}
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'الإجمالي' : 'Total'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Gem className="w-3 h-3 text-purple-500" />
                {language === 'ar' ? 'قطع فريدة' : 'Unique'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{stats.unique}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Package className="w-3 h-3 text-blue-500" />
                {language === 'ar' ? 'كميات' : 'General'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.general}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-orange-500" />
                {language === 'ar' ? 'انحراف' : 'Drift'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.withDrift}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <BookOpen className="w-3 h-3 text-green-500" />
                {language === 'ar' ? 'مع قيد' : 'With JE'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.withJE}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'إجمالي القيمة' : 'Total Value'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-orange-600" dir="ltr">
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
                  placeholder={language === 'ar' ? 'بحث برقم المرتجع...' : 'Search by return number...'}
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
                  <SelectItem value="confirmed">{language === 'ar' ? 'مؤكد' : 'Confirmed'}</SelectItem>
                  <SelectItem value="completed">{language === 'ar' ? 'مكتمل' : 'Completed'}</SelectItem>
                  <SelectItem value="voided">{language === 'ar' ? 'ملغي' : 'Voided'}</SelectItem>
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

              {/* Branch Filter */}
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'الفرع' : 'Branch'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'جميع الفروع' : 'All Branches'}</SelectItem>
                  {branches.map((br: { id: string; branch_name: string }) => (
                    <SelectItem key={br.id} value={br.id}>
                      {br.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Drift Only Toggle */}
              <Button
                variant={driftOnlyFilter ? 'default' : 'outline'}
                onClick={() => setDriftOnlyFilter(!driftOnlyFilter)}
                className="gap-2"
              >
                <AlertTriangle className="w-4 h-4" />
                {language === 'ar' ? 'انحراف فقط' : 'Drift Only'}
              </Button>

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
                <RotateCcw className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{language === 'ar' ? 'لا توجد مرتجعات' : 'No returns found'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{language === 'ar' ? 'رقم المرتجع' : 'Return No.'}</TableHead>
                      <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الفرع' : 'Branch'}</TableHead>
                      <TableHead>{language === 'ar' ? 'المورد' : 'Supplier'}</TableHead>
                      <TableHead className="text-end">{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                      <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الحالة' : 'Flags'}</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReturns.map((row) => (
                      <TableRow 
                        key={`${row.return_type}-${row.canonical_id}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleRowClick(row)}
                      >
                        <TableCell className="font-medium">{row.return_number}</TableCell>
                        <TableCell>{getReturnTypeBadge(row.return_type)}</TableCell>
                        <TableCell>{getStatusBadge(row.status)}</TableCell>
                        <TableCell>{row.branch_id ? (branchMap[row.branch_id] || '-') : '-'}</TableCell>
                        <TableCell>{row.supplier_id ? (supplierMap[row.supplier_id] || '-') : '-'}</TableCell>
                        <TableCell className="text-end" dir="ltr">{formatCurrency(Number(row.total_amount))}</TableCell>
                        <TableCell>{formatDate(row.return_date || row.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            {row.mirror_exists && (
                              <Badge variant="outline" className="gap-1 text-xs">
                                <Copy className="w-3 h-3" />
                                {language === 'ar' ? 'مرآة' : 'Mirror'}
                              </Badge>
                            )}
                            {row.has_je && (
                              <Badge variant="outline" className="gap-1 text-xs bg-green-50 text-green-700 border-green-200">
                                <BookOpen className="w-3 h-3" />
                                JE
                              </Badge>
                            )}
                            {getDriftBadge(row.has_drift, row.drift_type)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRowClick(row);
                            }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer info */}
        <div className="text-center text-sm text-muted-foreground">
          {language === 'ar' 
            ? `عرض ${filteredReturns.length} من ${returns.length} سجل`
            : `Showing ${filteredReturns.length} of ${returns.length} records`}
        </div>
      </div>
    </MainLayout>
  );
};

export default ReturnsHubPage;
