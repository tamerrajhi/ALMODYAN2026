import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as dataGateway from '@/lib/dataGateway';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  ArrowRight, 
  Building2, 
  Package, 
  Loader2, 
  Download, 
  Search, 
  History, 
  Eye,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

// ============= Constants =============
const PAGE_SIZE = 50;

// ============= Types =============
interface BranchSummary {
  branch_id: string;
  branch_name: string;
  branch_code: string;
  total_items: number;
  total_g_weight: number;
  total_d_weight: number;
  total_cost: number;
  total_tag_price: number;
}

interface JewelryItem {
  id: string;
  serial_no: string;
  stockcode: string | null;
  model: string | null;
  description: string | null;
  type: string | null;
  g_weight: number | null;
  d_weight: number | null;
  b_weight: number | null;
  cost: number | null;
  tag_price: number | null;
}

interface BranchItemsResult {
  items: JewelryItem[];
  total: number;
}

// ============= Hooks =============
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ============= Component =============
export default function BranchBalancesReport() {
  const navigate = useNavigate();
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [showDetails, setShowDetails] = useState(false);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  // Reset page when branch or search changes
  useEffect(() => {
    setPage(0);
  }, [selectedBranch, debouncedSearch]);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch branches');
      return await res.json();
    },
  });

  // Phase 1: Server-side aggregation via RPC
  const { data: summaries = [], isLoading: summariesLoading } = useQuery({
    queryKey: ['branch-balances-summary-rpc'],
    queryFn: async () => {
      const { data, error } = await dataGateway.rpc('get_inventory_summary_by_branch', {});
      
      if (error) throw error;
      
      // Transform the data to match our interface
      return (data || []).map((row: any) => ({
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        branch_code: row.branch_code,
        total_items: Number(row.total_items) || 0,
        total_g_weight: Number(row.total_g_weight) || 0,
        total_d_weight: Number(row.total_d_weight) || 0,
        total_cost: Number(row.total_cost) || 0,
        total_tag_price: Number(row.total_tag_price) || 0,
      })) as BranchSummary[];
    },
  });

  // Phase 2: Paginated branch items with server-side search
  const { data: branchItemsResult, isLoading: itemsLoading } = useQuery({
    queryKey: ['branch-items-paginated', selectedBranch, page, debouncedSearch],
    queryFn: async (): Promise<BranchItemsResult> => {
      const filters: dataGateway.FilterOp[] = [
        { type: 'is', column: 'sold_at', value: null },
      ];

      if (selectedBranch === 'unassigned') {
        filters.push({ type: 'is', column: 'branch_id', value: null });
      } else if (selectedBranch !== 'all') {
        filters.push({ type: 'eq', column: 'branch_id', value: selectedBranch });
      }

      if (debouncedSearch.trim()) {
        const searchTerm = `%${debouncedSearch.trim()}%`;
        filters.push({ type: 'or', value: `serial_no.ilike.${searchTerm},model.ilike.${searchTerm},stockcode.ilike.${searchTerm}` });
      }

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, count, error } = await dataGateway.queryTable('unique_items', {
        select: 'id, serial_no, stockcode, model, description, type, g_weight, d_weight, b_weight, cost, tag_price',
        filters,
        order: { column: 'serial_no', ascending: true },
        count: 'exact',
        range: { from, to },
      });
      if (error) throw error;
      
      return {
        items: (data || []) as JewelryItem[],
        total: count || 0,
      };
    },
    enabled: showDetails,
  });

  const branchItems = branchItemsResult?.items || [];
  const totalItems = branchItemsResult?.total || 0;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);

  // Export current page only (safe export)
  const handleExportCurrentPage = useCallback(() => {
    const exportData = branchItems.map((item) => ({
      'كود القطعة': item.serial_no,
      'كود المخزون': item.stockcode || '-',
      'الموديل': item.model || '-',
      'الوصف': item.description || '-',
      'النوع': item.type || '-',
      'وزن الذهب (G)': item.g_weight || 0,
      'وزن الألماس (D)': item.d_weight || 0,
      'الوزن الإجمالي (B)': item.b_weight || 0,
      'التكلفة': item.cost || 0,
      'سعر البيع': item.tag_price || 0,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'بلانس الفرع');
    
    const branchName = selectedBranch === 'all' 
      ? 'جميع الفروع' 
      : selectedBranch === 'unassigned'
        ? 'غير محدد'
        : branches.find(b => b.id === selectedBranch)?.branch_name || 'فرع';
    
    XLSX.writeFile(wb, `بلانس_${branchName}_صفحة${page + 1}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [branchItems, selectedBranch, branches, page]);

  // Phase 3: Navigation actions
  const handleViewItemMovements = useCallback((itemId: string, itemCode: string) => {
    navigate(`/inventory/item-movements?item_id=${itemId}&item_code=${encodeURIComponent(itemCode)}`);
  }, [navigate]);

  const handleBack = () => {
    setShowDetails(false);
    setSelectedBranch('all');
    setPage(0);
    setSearchQuery('');
  };

  // Calculate totals from server-side summaries
  const totalStats = useMemo(() => 
    summaries.reduce(
      (acc, s) => ({
        items: acc.items + s.total_items,
        g_weight: acc.g_weight + s.total_g_weight,
        d_weight: acc.d_weight + s.total_d_weight,
        cost: acc.cost + s.total_cost,
        tag_price: acc.tag_price + s.total_tag_price,
      }),
      { items: 0, g_weight: 0, d_weight: 0, cost: 0, tag_price: 0 }
    ),
    [summaries]
  );

  // ============= Details View =============
  if (showDetails) {
    const currentStart = page * PAGE_SIZE + 1;
    const currentEnd = Math.min((page + 1) * PAGE_SIZE, totalItems);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={handleBack}>
              <ArrowRight className="w-4 h-4 ml-2" />
              رجوع
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">تفاصيل بلانس الفرع</h1>
              <p className="text-muted-foreground mt-1">
                {selectedBranch === 'all' 
                  ? 'جميع الفروع' 
                  : selectedBranch === 'unassigned'
                    ? 'قطع غير محددة الفرع'
                    : branches.find(b => b.id === selectedBranch)?.branch_name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالكود أو الموديل..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 pr-10"
              />
            </div>
            
            {/* Branch Selector */}
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="اختر الفرع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الفروع</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.branch_name}
                  </SelectItem>
                ))}
                <SelectItem value="unassigned">غير محدد</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Export Button */}
            <Button onClick={handleExportCurrentPage} disabled={branchItems.length === 0} variant="outline">
              <Download className="w-4 h-4 ml-2" />
              تصدير الصفحة ({branchItems.length})
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="w-5 h-5" />
                القطع
                {totalItems > 0 && (
                  <Badge variant="secondary" className="mr-2">
                    {totalItems.toLocaleString()} قطعة
                  </Badge>
                )}
              </CardTitle>
              
              {/* Pagination Info */}
              {totalItems > 0 && (
                <div className="text-sm text-muted-foreground">
                  عرض {currentStart.toLocaleString()} - {currentEnd.toLocaleString()} من {totalItems.toLocaleString()}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {itemsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : branchItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {debouncedSearch ? 'لا توجد نتائج للبحث' : 'لا توجد قطع في هذا الفرع'}
              </div>
            ) : (
              <>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right w-[50px]">الإجراءات</TableHead>
                        <TableHead className="text-right">كود القطعة</TableHead>
                        <TableHead className="text-right">كود المخزون</TableHead>
                        <TableHead className="text-right">الموديل</TableHead>
                        <TableHead className="text-right">الوصف</TableHead>
                        <TableHead className="text-right">النوع</TableHead>
                        <TableHead className="text-right">G</TableHead>
                        <TableHead className="text-right">D</TableHead>
                        <TableHead className="text-right">B</TableHead>
                        <TableHead className="text-right">التكلفة</TableHead>
                        <TableHead className="text-right">سعر البيع</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {branchItems.map((item) => (
                        <TableRow key={item.id}>
                          {/* Phase 3: Action buttons */}
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleViewItemMovements(item.id, item.serial_no)}
                                title="فتح حركة القطعة"
                              >
                                <History className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{item.serial_no}</TableCell>
                          <TableCell>{item.stockcode || '-'}</TableCell>
                          <TableCell>{item.model || '-'}</TableCell>
                          <TableCell className="max-w-[200px] truncate" title={item.description || ''}>
                            {item.description || '-'}
                          </TableCell>
                          <TableCell>{item.type || '-'}</TableCell>
                          <TableCell>{item.g_weight?.toFixed(3) || '-'}</TableCell>
                          <TableCell>{item.d_weight?.toFixed(3) || '-'}</TableCell>
                          <TableCell>{item.b_weight?.toFixed(3) || '-'}</TableCell>
                          <TableCell>{item.cost?.toLocaleString() || '-'}</TableCell>
                          <TableCell>{item.tag_price?.toLocaleString() || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm text-muted-foreground">
                      صفحة {page + 1} من {totalPages}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                      >
                        <ChevronRight className="w-4 h-4 ml-1" />
                        السابق
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                      >
                        التالي
                        <ChevronLeft className="w-4 h-4 mr-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============= Summary View =============
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">بلانسات الفروع</h1>
          <p className="text-muted-foreground mt-1">عرض ملخص المخزون في كل فرع</p>
        </div>
        <Button onClick={() => setShowDetails(true)}>
          عرض التفاصيل
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي القطع</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.items.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي وزن الذهب</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.g_weight.toFixed(3)} g</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي وزن الألماس</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.d_weight.toFixed(3)} ct</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي التكلفة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.cost.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي سعر البيع</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.tag_price.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Branch Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            ملخص الفروع
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summariesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : summaries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد بيانات
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الفرع</TableHead>
                    <TableHead className="text-right">الكود</TableHead>
                    <TableHead className="text-right">عدد القطع</TableHead>
                    <TableHead className="text-right">وزن الذهب</TableHead>
                    <TableHead className="text-right">وزن الألماس</TableHead>
                    <TableHead className="text-right">إجمالي التكلفة</TableHead>
                    <TableHead className="text-right">إجمالي سعر البيع</TableHead>
                    <TableHead className="text-right">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.map((summary) => (
                    <TableRow key={summary.branch_id}>
                      <TableCell className="font-medium">{summary.branch_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{summary.branch_code}</Badge>
                      </TableCell>
                      <TableCell>{summary.total_items.toLocaleString()}</TableCell>
                      <TableCell>{summary.total_g_weight.toFixed(3)} g</TableCell>
                      <TableCell>{summary.total_d_weight.toFixed(3)} ct</TableCell>
                      <TableCell>{summary.total_cost.toLocaleString()}</TableCell>
                      <TableCell>{summary.total_tag_price.toLocaleString()}</TableCell>
                      <TableCell>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => {
                            setSelectedBranch(summary.branch_id);
                            setShowDetails(true);
                          }}
                        >
                          عرض القطع
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
    </div>
  );
}
