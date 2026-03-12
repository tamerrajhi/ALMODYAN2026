import { useState, useEffect, useRef } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Search, 
  RotateCcw, 
  Package,
  Building2,
  Loader2,
  ShoppingBag,
  Truck,
  Plus,
  Check,
  X
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
// OPS-P1B: Removed legacy accounting import - now using atomic RPC
import { formatCurrency } from '@/lib/utils';
import { useUserBranches } from '@/hooks/useUserBranches';
import { useLanguage } from '@/contexts/LanguageContext';

export default function ReturnsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { userBranches, primaryBranch, isAdmin, isLoading: branchesLoading } = useUserBranches();
  
  const [activeTab, setActiveTab] = useState('sales-returns');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [showPurchaseReturnDialog, setShowPurchaseReturnDialog] = useState(false);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [dialogSearchQuery, setDialogSearchQuery] = useState('');
  const [postReturnStatus, setPostReturnStatus] = useState<'inspection' | 'available'>('inspection');
  
  // OPS-P1B: Idempotency key via useRef - stable across retries
  const clientRequestIdRef = useRef<string | null>(null);

  // Auto-select branch if user has only one branch
  useEffect(() => {
    if (!branchesLoading && userBranches.length === 1) {
      setSelectedBranch(userBranches[0].branch_id);
    }
  }, [userBranches, branchesLoading]);

  // Use user branches instead of fetching all branches
  const branches = userBranches.map(ub => ({
    id: ub.branch_id,
    branch_name: ub.branch_name,
    branch_code: ub.branch_code,
  }));

  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['sales-for-return', searchQuery, selectedBranch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/sales-with-details?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch sales');
      const data = await res.json();
      return (data || []).map((s: any) => ({
        ...s,
        branches: s.branch_name ? { branch_name: s.branch_name } : null,
        customers: s.full_name ? { full_name: s.full_name, phone: s.phone } : null,
      }));
    },
  });

  // Fetch sale items for selected sale
  const { data: saleItems = [] } = useQuery({
    queryKey: ['sale-items', selectedSale?.id],
    queryFn: async () => {
      if (!selectedSale) return [];
      
      const response = await fetch(`/api/sale-items?sale_id=${selectedSale.id}`);
      if (!response.ok) throw new Error('Failed to fetch sale items');
      const data = await response.json();
      
      // Filter only items that are still sold (not already returned)
      return (data || []).filter((item: any) => item.jewelry_items?.sold_at !== null);
    },
    enabled: !!selectedSale,
  });

  const { data: returns = [], isLoading: returnsLoading } = useQuery({
    queryKey: ['returns', selectedBranch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      const res = await fetch(`/api/returns-with-details?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch returns');
      const data = await res.json();
      return (data || []).map((r: any) => ({
        ...r,
        branches: r.branch_name ? { branch_name: r.branch_name } : null,
        customers: r.full_name ? { full_name: r.full_name } : null,
        sales: r.sale_code ? { sale_code: r.sale_code, invoice_number: r.invoice_number } : null,
      }));
    },
  });

  // Fetch items for purchase returns (items that are in stock)
  const { data: stockItems = [], isLoading: stockLoading } = useQuery({
    queryKey: ['stock-items-for-return', searchQuery, selectedBranch],
    queryFn: async () => {
      const filters: any[] = [
        { column: 'sold_at', type: 'is', value: null },
      ];

      if (selectedBranch !== 'all') {
        filters.push({ column: 'branch_id', type: 'eq', value: selectedBranch });
      }

      if (searchQuery) {
        filters.push({ type: 'or', value: `serial_no.ilike.%${searchQuery}%,model.ilike.%${searchQuery}%,stockcode.ilike.%${searchQuery}%` });
      }

      const { data } = await dataGateway.queryTable('unique_items', {
        select: 'id, serial_no, model, description, type, metal, g_weight, cost, tag_price, branch_id',
        filters,
        order: [{ column: 'created_at', ascending: false }],
        limit: 50,
      });
      return (data || []).map((item: any) => ({
        ...item,
        item_code: item.serial_no,
      }));
    },
  });

  // OPS-P1B: Create sales return mutation - NOW USING ATOMIC RPC ONLY
  const createReturnMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSale || selectedItems.length === 0) {
        throw new Error(t.returns.selectItemsError);
      }

      // OPS-P1B: Generate idempotency key ONCE per attempt, reuse on retry
      if (!clientRequestIdRef.current) {
        clientRequestIdRef.current = crypto.randomUUID();
      }
      const requestId = clientRequestIdRef.current;

      // Get selected sale items with prices
      const itemsToReturn = saleItems.filter(item => selectedItems.includes(item.id));

      // Resolve branch_id from selected sale
      const saleBranchId = selectedSale.branch_id || 
        (selectedSale.branches ? branches.find(b => b.branch_name === selectedSale.branches.branch_name)?.id : null);

      // OPS-P1B: Build p_payload for atomic RPC
      const p_payload = {
        client_request_id: requestId,
        sale_id: selectedSale.id,
        branch_id: saleBranchId,
        customer_id: selectedSale.customer_id || null,
        refund_method: 'cash' as const,
        post_return_status: postReturnStatus,
        create_invoice: true, // This page creates invoices
        return_reason: returnReason || undefined,
        notes: returnNotes || undefined,
        items: itemsToReturn.map(item => ({
          jewelry_item_id: item.jewelry_items?.id,
          sale_item_id: item.id,
          line_amount: item.sale_price || 0,
          unit_price: item.sale_price || 0,
          item_code: item.jewelry_items?.item_code,
          item_name: item.jewelry_items?.model || item.jewelry_items?.description,
        })),
      };

      // OPS-P1B: Single atomic RPC call - replaces all direct writes
      const { data: rpcResult, error: rpcError } = await dataGateway.rpc(
        'complete_pos_piece_return_atomic',
        { p_payload }
      );

      if (rpcError) {
        // Network/timeout - idempotent, safe to retry
        if (rpcError.message?.includes('timeout') || rpcError.message?.includes('network')) {
          throw new Error('خطأ في الشبكة. يمكنك إعادة المحاولة بأمان.');
        }
        throw new Error(rpcError.message || t.returns.createFailed);
      }

      // Type assertion for RPC response
      const result = rpcResult as { success: boolean; return_id?: string; return_code?: string; error?: string; error_code?: string } | null;

      if (!result?.success) {
        throw new Error(result?.error || result?.error_code || t.returns.createFailed);
      }

      // OPS-P1B: Clear idempotency key on success
      clientRequestIdRef.current = null;

      return { 
        id: result.return_id, 
        return_code: result.return_code 
      };
    },
    onSuccess: (returnRecord) => {
      toast.success(`${t.returns.createdSuccessfully} - ${returnRecord.return_code}`);
      setShowReturnDialog(false);
      setSelectedSale(null);
      setSelectedItems([]);
      setReturnReason('');
      setReturnNotes('');
      setPostReturnStatus('inspection');
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['sales-for-return'] });
    },
    onError: (error: any) => {
      // OPS-P1B: Do NOT clear clientRequestIdRef on error - allow retry with same ID
      toast.error(error.message || t.returns.createFailed);
    },
  });

  // Toggle item selection
  const toggleItemSelection = (itemId: string) => {
    setSelectedItems(prev => 
      prev.includes(itemId) 
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RotateCcw className="w-6 h-6 text-gold" />
              {t.returns.title}
            </h1>
            <p className="text-muted-foreground text-sm">{t.returns.subtitle}</p>
          </div>
          {userBranches.length > 1 && (
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-48">
                <Building2 className="w-4 h-4 ml-2" />
                <SelectValue placeholder={t.dashboard.allBranches} />
              </SelectTrigger>
              <SelectContent>
                {isAdmin && <SelectItem value="all">{t.dashboard.allBranches}</SelectItem>}
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.branch_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="sales-returns" className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" />
              {t.returns.salesReturns}
            </TabsTrigger>
            <TabsTrigger value="purchase-returns" className="flex items-center gap-2">
              <Truck className="w-4 h-4" />
              {t.returns.purchaseReturns}
            </TabsTrigger>
          </TabsList>

          {/* Sales Returns Tab */}
          <TabsContent value="sales-returns" className="space-y-4">
            {/* Search and Filter */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t.returns.searchInvoice}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pr-10"
                    />
                  </div>
                  <Button onClick={() => setShowReturnDialog(true)} className="gap-2">
                    <Plus className="w-4 h-4" />
                    {t.returns.newSalesReturn}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Sales List */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t.returns.salesInvoices}</CardTitle>
                </CardHeader>
                <CardContent>
                  {salesLoading ? (
                    <div className="p-8 text-center">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  ) : sales.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>{t.returns.noInvoices}</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {sales.map((sale: any) => (
                        <div
                          key={sale.id}
                          className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => {
                            setSelectedSale(sale);
                            setSelectedItems([]);
                            setShowReturnDialog(true);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{sale.invoice_number || sale.sale_code}</p>
                              <p className="text-sm text-muted-foreground">
                                {sale.customers?.full_name || 'عميل غير محدد'}
                              </p>
                            </div>
                            <div className="text-left">
                              <p className="font-bold text-primary">{formatCurrency(sale.final_amount)}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(sale.sale_date), 'dd MMM yyyy', { locale: ar })}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Returns History */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t.returns.returnsHistory}</CardTitle>
                </CardHeader>
                <CardContent>
                  {returnsLoading ? (
                    <div className="p-8 text-center">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  ) : returns.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <RotateCcw className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>{t.returns.noReturns}</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {returns.map((ret: any) => (
                        <div key={ret.id} className="p-3 border rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{ret.return_code}</p>
                              <p className="text-sm text-muted-foreground">
                                {t.returns.fromInvoice}: {ret.sales?.invoice_number || ret.sales?.sale_code}
                              </p>
                              <p className="text-xs text-muted-foreground">{ret.reason}</p>
                            </div>
                            <div className="text-left">
                              <p className="font-bold text-destructive">{formatCurrency(ret.total_amount)}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(ret.return_date), 'dd MMM yyyy', { locale: ar })}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Purchase Returns Tab */}
          <TabsContent value="purchase-returns" className="space-y-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="البحث بكود القطعة..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pr-10"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">قطع المخزون (لإرجاعها للمورد)</CardTitle>
              </CardHeader>
              <CardContent>
                {stockLoading ? (
                  <div className="p-8 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                  </div>
                ) : stockItems.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>لا توجد قطع</p>
                  </div>
                ) : (
                  <div className="responsive-table-wrapper">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>كود القطعة</TableHead>
                        <TableHead>الموديل</TableHead>
                        <TableHead>النوع</TableHead>
                        <TableHead>المعدن</TableHead>
                        <TableHead>الوزن</TableHead>
                        <TableHead>المورد</TableHead>
                        <TableHead>الفرع</TableHead>
                        <TableHead>التكلفة</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockItems.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono">{item.item_code}</TableCell>
                          <TableCell>{item.model || '-'}</TableCell>
                          <TableCell>{item.type || '-'}</TableCell>
                          <TableCell>{item.metal || '-'}</TableCell>
                          <TableCell>{item.g_weight ? `${item.g_weight} g` : '-'}</TableCell>
                          <TableCell>{item.suppliers?.supplier_name || '-'}</TableCell>
                          <TableCell>{item.branches?.branch_name || '-'}</TableCell>
                          <TableCell>{item.cost?.toLocaleString() || '-'}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                              onClick={() => {
                                // TODO: Implement purchase return
                                toast.info('سيتم إضافة هذه الميزة قريباً');
                              }}
                            >
                              <RotateCcw className="w-4 h-4" />
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
          </TabsContent>
        </Tabs>
      </div>

      {/* Sales Return Dialog */}
      <Dialog open={showReturnDialog} onOpenChange={(open) => {
        setShowReturnDialog(open);
        if (!open) {
          setSelectedSale(null);
          setSelectedItems([]);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedSale ? `إرجاع قطع من فاتورة ${selectedSale.invoice_number || selectedSale.sale_code}` : 'مرتجع مبيعات جديد'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!selectedSale ? (
              // Sale selection step
              <div className="space-y-3">
                <Label className="block">اختر فاتورة البيع</Label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="البحث برقم الفاتورة أو اسم العميل..."
                    value={dialogSearchQuery}
                    onChange={(e) => setDialogSearchQuery(e.target.value)}
                    className="pr-10"
                  />
                </div>
                <div className="border rounded-lg max-h-60 overflow-y-auto">
                  {sales.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      لا توجد فواتير متاحة
                    </div>
                  ) : (
                    <div className="divide-y">
                      {sales
                        .filter((sale: any) => {
                          if (!dialogSearchQuery) return true;
                          const query = dialogSearchQuery.toLowerCase();
                          return (
                            sale.sale_code?.toLowerCase().includes(query) ||
                            sale.invoice_number?.toLowerCase().includes(query) ||
                            sale.customers?.full_name?.toLowerCase().includes(query)
                          );
                        })
                        .map((sale: any) => (
                          <div
                            key={sale.id}
                            className="p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                            onClick={() => {
                              setSelectedSale(sale);
                              setSelectedItems([]);
                              setDialogSearchQuery('');
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium">{sale.invoice_number || sale.sale_code}</p>
                                <p className="text-sm text-muted-foreground">
                                  {sale.customers?.full_name || 'عميل غير محدد'}
                                </p>
                              </div>
                              <div className="text-left">
                                <p className="font-bold text-primary">{formatCurrency(sale.final_amount)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(sale.sale_date), 'dd MMM yyyy', { locale: ar })}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // Items selection step
              <>
                <div className="bg-muted/50 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="grid grid-cols-2 gap-4 text-sm flex-1">
                      <div>
                        <span className="text-muted-foreground">الفاتورة:</span>
                        <span className="font-medium mr-2">{selectedSale.invoice_number || selectedSale.sale_code}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">العميل:</span>
                        <span className="font-medium mr-2">{selectedSale.customers?.full_name || 'غير محدد'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">تاريخ البيع:</span>
                        <span className="font-medium mr-2">
                          {selectedSale.sale_date && format(new Date(selectedSale.sale_date), 'dd/MM/yyyy')}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedSale(null)}
                    >
                      تغيير الفاتورة
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block">اختر القطع للإرجاع</Label>
                  <div className="border rounded-lg max-h-60 overflow-y-auto">
                    {saleItems.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        لا توجد قطع يمكن إرجاعها (قد تكون جميع القطع مرتجعة بالفعل)
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12"></TableHead>
                            <TableHead>كود القطعة</TableHead>
                            <TableHead>الموديل</TableHead>
                            <TableHead>سعر البيع</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {saleItems.map((item: any) => (
                            <TableRow 
                              key={item.id}
                              className="cursor-pointer"
                              onClick={() => toggleItemSelection(item.id)}
                            >
                              <TableCell>
                                <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                                  selectedItems.includes(item.id) 
                                    ? 'bg-primary border-primary text-primary-foreground' 
                                    : 'border-input'
                                }`}>
                                  {selectedItems.includes(item.id) && <Check className="w-3 h-3" />}
                                </div>
                              </TableCell>
                              <TableCell className="font-mono">{item.jewelry_items?.item_code}</TableCell>
                              <TableCell>{item.jewelry_items?.model || '-'}</TableCell>
                              <TableCell>{formatCurrency(item.sale_price)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                  {selectedItems.length > 0 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      تم اختيار {selectedItems.length} قطعة
                    </p>
                  )}
                </div>
              </>
            )}

            {selectedSale && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>سبب الإرجاع</Label>
                    <Select value={returnReason} onValueChange={setReturnReason}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر السبب" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="عيب صناعة">عيب صناعة</SelectItem>
                        <SelectItem value="عدم مطابقة المواصفات">عدم مطابقة المواصفات</SelectItem>
                        <SelectItem value="تغيير رأي العميل">تغيير رأي العميل</SelectItem>
                        <SelectItem value="خطأ في الفاتورة">خطأ في الفاتورة</SelectItem>
                        <SelectItem value="أخرى">أخرى</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>إجمالي المبلغ المرتجع</Label>
                    <div className="h-10 px-3 py-2 bg-muted rounded-md flex items-center font-bold text-primary">
                      {formatCurrency(saleItems
                        .filter(item => selectedItems.includes(item.id))
                        .reduce((sum, item) => sum + (item.sale_price || 0), 0))}
                    </div>
                  </div>
                </div>

                <div>
                  <Label>ملاحظات</Label>
                  <Textarea
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    placeholder="ملاحظات إضافية..."
                    rows={2}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowReturnDialog(false);
              setSelectedSale(null);
              setSelectedItems([]);
              setReturnReason('');
              setReturnNotes('');
            }}>
              إلغاء
            </Button>
            <Button
              onClick={() => createReturnMutation.mutate()}
              disabled={!selectedSale || selectedItems.length === 0 || !returnReason || createReturnMutation.isPending}
            >
              {createReturnMutation.isPending ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4 ml-2" />
              )}
              تأكيد الإرجاع
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
