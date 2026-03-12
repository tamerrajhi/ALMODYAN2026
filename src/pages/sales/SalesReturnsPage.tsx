import { useState, useEffect, useMemo, useRef } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { 
  Search, 
  RotateCcw, 
  Package,
  Building2,
  Loader2,
  Plus,
  Check,
  X,
  ShoppingBag,
  Users,
  ClipboardCheck,
  ShoppingCart,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
// OPS-P1: Removed legacy pos-return-workflow import - now using atomic RPC
import { formatCurrency } from '@/lib/utils';
import { useUserBranches } from '@/hooks/useUserBranches';
import { useLanguage } from '@/contexts/LanguageContext';

const RETURN_REASONS = [
  { value: 'defective', label: { ar: 'عيب في المنتج', en: 'Defective Product' } },
  { value: 'wrong_item', label: { ar: 'منتج خاطئ', en: 'Wrong Item' } },
  { value: 'customer_change', label: { ar: 'تغيير رأي العميل', en: 'Customer Changed Mind' } },
  { value: 'size_issue', label: { ar: 'مشكلة في المقاس', en: 'Size Issue' } },
  { value: 'other', label: { ar: 'أخرى', en: 'Other' } },
];

export default function SalesReturnsPage() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const { userBranches, primaryBranch, isAdmin, isLoading: branchesLoading } = useUserBranches();
  const dateLocale = language === 'ar' ? ar : enUS;
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [dialogSearchQuery, setDialogSearchQuery] = useState('');
  const [postReturnStatus, setPostReturnStatus] = useState<'inspection' | 'available'>('inspection');
  // OPS-P1: Idempotency key via useRef - stable across retries
  const clientRequestIdRef = useRef<string | null>(null);
  // Auto-select branch if user has only one branch
  useEffect(() => {
    if (!branchesLoading && userBranches.length === 1) {
      setSelectedBranch(userBranches[0].branch_id);
    }
  }, [userBranches, branchesLoading]);

  const branches = userBranches.map(ub => ({
    id: ub.branch_id,
    branch_name: ub.branch_name,
    branch_code: ub.branch_code,
  }));

  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['sales-for-return', dialogSearchQuery, selectedBranch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      if (dialogSearchQuery) params.set('search', dialogSearchQuery);
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
    queryKey: ['sales-returns', selectedBranch, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/returns-with-details?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch returns');
      const data = await res.json();
      return (data || []).map((r: any) => ({
        ...r,
        branches: r.branch_name ? { branch_name: r.branch_name } : null,
        customers: r.full_name ? { full_name: r.full_name } : null,
        sales: r.sale_code ? { sale_code: r.sale_code, invoice_number: r.sale_invoice_number } : null,
      }));
    },
  });

  // OPS-P1: Create sales return mutation - NOW USING ATOMIC RPC ONLY
  const createReturnMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSale || selectedItems.length === 0) {
        throw new Error(language === 'ar' ? 'يرجى اختيار قطع للإرجاع' : 'Please select items to return');
      }

      // OPS-P1: Validate store_credit requires customer_id
      if (!selectedSale.customer_id) {
        // Default to cash if no customer
      }

      // OPS-P1: Generate idempotency key ONCE per attempt, reuse on retry
      if (!clientRequestIdRef.current) {
        clientRequestIdRef.current = crypto.randomUUID();
      }
      const requestId = clientRequestIdRef.current;

      // Get selected sale items with prices
      const itemsToReturn = saleItems.filter(item => selectedItems.includes(item.id));
      const totalAmount = itemsToReturn.reduce((sum, item) => sum + (item.sale_price || 0), 0);

      // OPS-P1: Build p_payload for atomic RPC
      const p_payload = {
        client_request_id: requestId,
        sale_id: selectedSale.id,
        branch_id: selectedSale.branch_id,
        customer_id: selectedSale.customer_id || null,
        refund_method: 'cash' as const, // Default for ERP returns
        post_return_status: postReturnStatus,
        create_invoice: false,
        items: itemsToReturn.map(item => ({
          jewelry_item_id: item.jewelry_items?.id || item.item_id || item.id,
          line_amount: item.sale_price || 0,
          sale_item_id: item.id || null,
        })),
      };

      // OPS-P1: Single atomic RPC call - replaces all direct writes
      const { data: rpcResult, error: rpcError } = await dataGateway.rpc(
        'complete_pos_piece_return_atomic',
        { p_payload }
      );

      if (rpcError) {
        // Network/timeout - idempotent, safe to retry
        if (rpcError.message?.includes('timeout') || rpcError.message?.includes('network')) {
          throw new Error(language === 'ar' ? 'خطأ في الشبكة. يمكنك إعادة المحاولة بأمان.' : 'Network error. Safe to retry.');
        }
        throw new Error(rpcError.message || 'فشل في إنشاء المرتجع');
      }

      // Type assertion for RPC response
      const result = rpcResult as { success: boolean; return_id?: string; return_code?: string; error?: string; error_code?: string } | null;

      if (!result?.success) {
        throw new Error(result?.error || result?.error_code || 'فشل في إنشاء المرتجع');
      }

      // OPS-P1: Clear idempotency key on success
      clientRequestIdRef.current = null;

      return { 
        id: result.return_id, 
        return_code: result.return_code 
      };
    },
    onSuccess: (returnRecord) => {
      toast.success(`${language === 'ar' ? 'تم إنشاء مرتجع المبيعات بنجاح' : 'Sales return created successfully'} - ${returnRecord.return_code}`);
      setShowReturnDialog(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['sales-returns'] });
      queryClient.invalidateQueries({ queryKey: ['sales-for-return'] });
    },
    onError: (error: any) => {
      // OPS-P1: Do NOT clear clientRequestIdRef on error - allow retry with same ID
      toast.error(error.message || (language === 'ar' ? 'فشل في إنشاء المرتجع' : 'Failed to create return'));
    },
  });

  const resetForm = () => {
    setSelectedSale(null);
    setSelectedItems([]);
    setReturnReason('');
    setReturnNotes('');
    setDialogSearchQuery('');
    setPostReturnStatus('inspection');
    clientRequestIdRef.current = null; // OPS-P1: Clear idempotency key
  };

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
        <div className="page-header-rtl">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RotateCcw className="w-6 h-6 text-green-600" />
              {language === 'ar' ? 'مرتجعات المبيعات' : 'Sales Returns'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {language === 'ar' ? 'إدارة مرتجعات المبيعات من العملاء' : 'Manage sales returns from customers'}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
            <Button onClick={() => setShowReturnDialog(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              {language === 'ar' ? 'مرتجع جديد' : 'New Return'}
            </Button>
          </div>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={language === 'ar' ? 'البحث برقم المرتجع...' : 'Search by return number...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Returns List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{language === 'ar' ? 'سجل المرتجعات' : 'Returns History'}</CardTitle>
          </CardHeader>
          <CardContent>
            {returnsLoading ? (
              <div className="p-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : returns.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <RotateCcw className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{language === 'ar' ? 'لا توجد مرتجعات' : 'No returns found'}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{language === 'ar' ? 'رقم المرتجع' : 'Return No.'}</TableHead>
                    <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                    <TableHead>{language === 'ar' ? 'رقم الفاتورة' : 'Invoice No.'}</TableHead>
                    <TableHead>{language === 'ar' ? 'العميل' : 'Customer'}</TableHead>
                    <TableHead>{language === 'ar' ? 'السبب' : 'Reason'}</TableHead>
                    <TableHead>{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                    <TableHead>{language === 'ar' ? 'الفرع' : 'Branch'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returns.map((ret: any) => (
                    <TableRow key={ret.id}>
                      <TableCell className="font-medium">{ret.return_code}</TableCell>
                      <TableCell>{format(new Date(ret.return_date), 'dd MMM yyyy', { locale: dateLocale })}</TableCell>
                      <TableCell>{ret.sales?.invoice_number || ret.sales?.sale_code || '-'}</TableCell>
                      <TableCell>{ret.customers?.full_name || (language === 'ar' ? 'عميل بدون حساب' : 'Walk-in')}</TableCell>
                      <TableCell>
                        {RETURN_REASONS.find(r => r.value === ret.reason)?.label[language] || ret.reason || '-'}
                      </TableCell>
                      <TableCell className="font-bold text-destructive">{formatCurrency(ret.total_amount)}</TableCell>
                      <TableCell>{ret.branches?.branch_name || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* New Return Dialog */}
        <Dialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5" />
                {language === 'ar' ? 'مرتجع مبيعات جديد' : 'New Sales Return'}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {!selectedSale ? (
                <>
                  {/* Search for Sale */}
                  <div className="space-y-4">
                    <div className="relative">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder={language === 'ar' ? 'البحث برقم الفاتورة...' : 'Search by invoice number...'}
                        value={dialogSearchQuery}
                        onChange={(e) => setDialogSearchQuery(e.target.value)}
                        className="pr-10"
                      />
                    </div>

                    <div className="border rounded-lg max-h-80 overflow-y-auto">
                      {salesLoading ? (
                        <div className="p-8 text-center">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                        </div>
                      ) : sales.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                          <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-50" />
                          <p>{language === 'ar' ? 'لا توجد فواتير' : 'No invoices found'}</p>
                        </div>
                      ) : (
                        <div className="divide-y">
                          {sales.map((sale: any) => (
                            <div
                              key={sale.id}
                              className="p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                              onClick={() => {
                                setSelectedSale(sale);
                                setSelectedItems([]);
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="font-medium">{sale.invoice_number || sale.sale_code}</p>
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Users className="w-3 h-3" />
                                    {sale.customers?.full_name || (language === 'ar' ? 'عميل بدون حساب' : 'Walk-in')}
                                  </div>
                                </div>
                                <div className="text-left">
                                  <p className="font-bold text-primary">{formatCurrency(sale.final_amount)}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {format(new Date(sale.sale_date), 'dd MMM yyyy', { locale: dateLocale })}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Selected Sale Info */}
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{language === 'ar' ? 'الفاتورة:' : 'Invoice:'} {selectedSale.invoice_number || selectedSale.sale_code}</p>
                        <p className="text-sm text-muted-foreground">
                          {selectedSale.customers?.full_name || (language === 'ar' ? 'عميل بدون حساب' : 'Walk-in')}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setSelectedSale(null)}>
                        {language === 'ar' ? 'تغيير' : 'Change'}
                      </Button>
                    </div>
                  </div>

                  {/* Return Reason */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{language === 'ar' ? 'سبب الإرجاع' : 'Return Reason'}</Label>
                      <Select value={returnReason} onValueChange={setReturnReason}>
                        <SelectTrigger>
                          <SelectValue placeholder={language === 'ar' ? 'اختر السبب...' : 'Select reason...'} />
                        </SelectTrigger>
                        <SelectContent>
                          {RETURN_REASONS.map((reason) => (
                            <SelectItem key={reason.value} value={reason.value}>
                              {reason.label[language]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
                      <Textarea
                        value={returnNotes}
                        onChange={(e) => setReturnNotes(e.target.value)}
                        placeholder={language === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
                        rows={1}
                      />
                    </div>
                  </div>

                  {/* P4-4: Post-Return Status Selection */}
                  <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
                    <Label className="flex items-center gap-2 text-base font-medium">
                      {postReturnStatus === 'inspection' ? (
                        <ClipboardCheck className="w-4 h-4 text-amber-600" />
                      ) : (
                        <ShoppingCart className="w-4 h-4 text-green-600" />
                      )}
                      {language === 'ar' ? 'حالة القطع بعد الإرجاع' : 'Post-Return Status'}
                    </Label>
                    <RadioGroup
                      value={postReturnStatus}
                      onValueChange={(value: 'inspection' | 'available') => setPostReturnStatus(value)}
                      className="flex gap-6"
                    >
                      <div className="flex items-center space-x-2 space-x-reverse">
                        <RadioGroupItem value="inspection" id="status-inspection" />
                        <Label htmlFor="status-inspection" className="flex items-center gap-2 cursor-pointer">
                          <ClipboardCheck className="w-4 h-4 text-amber-600" />
                          <span>{language === 'ar' ? 'فحص (افتراضي)' : 'Inspection (Default)'}</span>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2 space-x-reverse">
                        <RadioGroupItem value="available" id="status-available" />
                        <Label htmlFor="status-available" className="flex items-center gap-2 cursor-pointer">
                          <ShoppingCart className="w-4 h-4 text-green-600" />
                          <span>{language === 'ar' ? 'متاح للبيع' : 'Available for Sale'}</span>
                        </Label>
                      </div>
                    </RadioGroup>
                    <p className="text-xs text-muted-foreground">
                      {postReturnStatus === 'inspection' 
                        ? (language === 'ar' ? 'القطع ستحتاج لفحص قبل إعادتها للبيع' : 'Items will need inspection before resale')
                        : (language === 'ar' ? 'القطع ستكون متاحة للبيع مباشرة' : 'Items will be available for sale immediately')
                      }
                    </p>
                  </div>

                  {/* Sale Items */}
                  <div className="space-y-2">
                    <Label>{language === 'ar' ? 'اختر القطع للإرجاع' : 'Select Items to Return'}</Label>
                    {saleItems.length === 0 ? (
                      <div className="border rounded-lg p-8 text-center text-muted-foreground">
                        <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>{language === 'ar' ? 'لا توجد قطع متاحة للإرجاع' : 'No items available for return'}</p>
                      </div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12"></TableHead>
                              <TableHead>{language === 'ar' ? 'الكود' : 'Code'}</TableHead>
                              <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                              <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                              <TableHead>{language === 'ar' ? 'الوزن' : 'Weight'}</TableHead>
                              <TableHead>{language === 'ar' ? 'السعر' : 'Price'}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {saleItems.map((item: any) => (
                              <TableRow
                                key={item.id}
                                className={`cursor-pointer ${selectedItems.includes(item.id) ? 'bg-primary/10' : ''}`}
                                onClick={() => toggleItemSelection(item.id)}
                              >
                                <TableCell>
                                  <Checkbox
                                    checked={selectedItems.includes(item.id)}
                                    onCheckedChange={() => toggleItemSelection(item.id)}
                                  />
                                </TableCell>
                                <TableCell className="font-medium">{item.jewelry_items?.item_code}</TableCell>
                                <TableCell>{item.jewelry_items?.description || item.jewelry_items?.model}</TableCell>
                                <TableCell>{item.jewelry_items?.type}</TableCell>
                                <TableCell>{item.jewelry_items?.g_weight}g</TableCell>
                                <TableCell className="font-bold">{formatCurrency(item.sale_price)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  {/* Selected Items Summary */}
                  {selectedItems.length > 0 && (
                    <div className="bg-muted/50 rounded-lg p-4">
                      <div className="flex justify-between items-center">
                        <span>
                          {language === 'ar' ? 'القطع المحددة:' : 'Selected Items:'} {selectedItems.length}
                        </span>
                        <span className="font-bold text-lg text-primary">
                          {formatCurrency(
                            saleItems
                              .filter((item: any) => selectedItems.includes(item.id))
                              .reduce((sum: number, item: any) => sum + (item.sale_price || 0), 0)
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowReturnDialog(false);
                resetForm();
              }}>
                {t.common.cancel}
              </Button>
              {selectedSale && (
                <Button
                  onClick={() => createReturnMutation.mutate()}
                  disabled={createReturnMutation.isPending || selectedItems.length === 0}
                >
                  {createReturnMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                  {language === 'ar' ? 'تأكيد المرتجع' : 'Confirm Return'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
