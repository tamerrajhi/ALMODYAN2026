import { useState, useRef } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { 
  Search, 
  Plus, 
  Users,
  User,
  Building2,
  Phone,
  Mail,
  MapPin,
  Star,
  ShoppingBag,
  Loader2,
  RotateCcw,
  FileText,
  ArrowLeft,
  Edit,
  Receipt
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import * as apiClient from '@/lib/apiClient';
import { queryTable } from '@/lib/dataGateway';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { format } from 'date-fns';
import { ar as arLocale } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';

interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  vat_number: string | null;
  customer_type: 'individual' | 'company';
  company_name: string | null;
  loyalty_points: number;
  total_purchases: number;
  created_at: string;
}

// RPC response type for return atomic
interface ReturnRpcResponse {
  success: boolean;
  is_existing?: boolean;
  race_resolved?: boolean;
  return_id?: string;
  return_code?: string;
  journal_entry_id?: string;
  journal_entry_number?: string;
  invoice_id?: string;
  invoice_number?: string;
  affected_items_count?: number;
  credit_id?: string;
  error_message?: string;
  error_code?: string;
}

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [selectedItemsForReturn, setSelectedItemsForReturn] = useState<string[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'store_credit'>('cash');
  const [postReturnStatus, setPostReturnStatus] = useState<'available' | 'inspection'>('inspection');
  
  // Idempotency: client_request_id generated once per submit attempt
  const returnRequestIdRef = useRef<string | null>(null);
  
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
    vat_number: '',
    customer_type: 'individual' as 'individual' | 'company',
    company_name: '',
  });

  // Fetch customers
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', searchQuery],
    queryFn: async () => {
      const params = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : '';
      const { data, error } = await apiClient.get<Customer[]>(`/api/customers-list${params}`);
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // Fetch customer sales history
  const { data: customerSales = [] } = useQuery({
    queryKey: ['customer-sales', selectedCustomer?.id],
    queryFn: async () => {
      if (!selectedCustomer) return [];
      const { data, error } = await apiClient.get<any[]>(`/api/customer-sales?customer_id=${selectedCustomer.id}`);
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!selectedCustomer && (showDetailsDialog || showInvoiceDialog),
  });

  // Fetch customer returns history
  const { data: customerReturns = [] } = useQuery({
    queryKey: ['customer-returns', selectedCustomer?.id],
    queryFn: async () => {
      if (!selectedCustomer) return [];
      const { data, error } = await apiClient.get<any[]>(`/api/customer-returns?customer_id=${selectedCustomer.id}`);
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!selectedCustomer && showDetailsDialog,
  });

  // Fetch sale items for selected sale (invoice view)
  const { data: saleItems = [], isLoading: saleItemsLoading } = useQuery({
    queryKey: ['sale-items-for-customer', selectedSale?.id],
    queryFn: async () => {
      if (!selectedSale) return [];
      const { data, error } = await apiClient.get<any[]>(`/api/sale-items?sale_id=${selectedSale.id}`);
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!selectedSale && showInvoiceDialog,
  });

  // Get items available for return (still sold, not returned)
  const availableForReturn = saleItems.filter(item => item.jewelry_items?.sold_at !== null);

  // Fetch branches for return
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-for-return'],
    queryFn: async () => {
      const { data, error } = await apiClient.get<any[]>('/api/branches-list');
      if (error) throw new Error(error.message);
      return (data || []).filter((b: any) => b.is_active);
    },
    enabled: showReturnDialog,
  });

  // Create return mutation using atomic RPC (S-Clean-2: RPC-only, no direct writes)
  const createReturnMutation = useMutation({
    mutationFn: async (): Promise<ReturnRpcResponse> => {
      if (!selectedSale || selectedItemsForReturn.length === 0) {
        throw new Error('يرجى اختيار قطع للإرجاع');
      }

      // Idempotency: Generate client_request_id ONCE per submit attempt
      // Reuse the same ID for retries within the same submit action
      if (!returnRequestIdRef.current) {
        returnRequestIdRef.current = crypto.randomUUID();
      }
      const clientRequestId = returnRequestIdRef.current;

      // Get selected sale items with prices
      const itemsToReturn = saleItems.filter(item => selectedItemsForReturn.includes(item.id));
      
      const branchId = selectedSale.branches?.id || selectedSale.branch_id;

      // Build items array for RPC payload
      const itemsPayload = itemsToReturn.map(item => ({
        jewelry_item_id: item.jewelry_items?.id || null,
        sale_item_id: item.id || null,
        unit_price: item.sale_price || null,
        line_amount: item.sale_price || null,
        item_code: item.jewelry_items?.item_code || null,
        item_name: item.jewelry_items?.description || item.jewelry_items?.model || null,
      }));

      // RPC payload matching complete_pos_piece_return_atomic contract
      const payload = {
        client_request_id: clientRequestId,
        sale_id: selectedSale.id || null,
        branch_id: branchId || null,
        customer_id: selectedCustomer?.id || null,
        return_reason: returnReason || null,
        notes: returnNotes || null,
        processed_by: user?.email || 'system',
        post_return_status: postReturnStatus,
        refund_method: refundMethod,
        create_invoice: true, // Legacy behavior: always create invoice
        items: itemsPayload,
      };

      // Call the atomic RPC - this is the ONLY mutation for return flow
      const { data, error } = await dataGateway.rpc('complete_pos_piece_return_atomic', {
        p_payload: payload
      });

      if (error) {
        throw new Error(error.message || 'فشل في الاتصال بقاعدة البيانات');
      }

      // Type-safe cast through unknown for RPC response
      const result = data as unknown as ReturnRpcResponse;
      
      if (!result || !result.success) {
        throw new Error(result?.error_message || 'فشل في إنشاء المرتجع');
      }

      return result;
    },
    onSuccess: (result) => {
      // Clear the request ID after successful submission
      returnRequestIdRef.current = null;

      // Handle idempotency hit
      if (result.is_existing || result.race_resolved) {
        toast.success(`تمت العملية بالفعل - ${result.return_code}`);
      } else {
        // Build success message with details
        let successMsg = `تم إنشاء مرتجع بنجاح - ${result.return_code}`;
        if (result.journal_entry_number) {
          successMsg += ` | قيد: ${result.journal_entry_number}`;
        }
        if (result.invoice_number) {
          successMsg += ` | فاتورة: ${result.invoice_number}`;
        }
        toast.success(successMsg);
      }
      
      setShowReturnDialog(false);
      setShowInvoiceDialog(false);
      setSelectedSale(null);
      setSelectedItemsForReturn([]);
      setReturnReason('');
      setReturnNotes('');
      setRefundMethod('cash');
      setPostReturnStatus('inspection');
      queryClient.invalidateQueries({ queryKey: ['customer-sales'] });
      queryClient.invalidateQueries({ queryKey: ['sale-items-for-customer'] });
    },
    onError: (error: any) => {
      // Don't clear request ID on error - allow retry with same ID
      toast.error(error.message || 'فشل في إنشاء المرتجع');
    },
  });

  // Toggle item selection for return
  const toggleItemForReturn = (itemId: string) => {
    setSelectedItemsForReturn(prev => 
      prev.includes(itemId) 
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  const openInvoiceDialog = (sale: any) => {
    setSelectedSale(sale);
    setSelectedItemsForReturn([]);
    setShowInvoiceDialog(true);
  };

  const openReturnDialog = () => {
    setReturnReason('');
    setReturnNotes('');
    setRefundMethod('cash');
    setPostReturnStatus('inspection');
    // Generate new client_request_id for new return attempt
    returnRequestIdRef.current = crypto.randomUUID();
    setShowReturnDialog(true);
  };

  // Create customer mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { data: codeData } = await dataGateway.rpc('generate_customer_code', {});
      
      forbidDirectWrite('insert', 'CustomersPage.tsx:306');
    },
    onSuccess: () => {
      toast.success('تم إضافة العميل بنجاح');
      setShowAddDialog(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: () => {
      toast.error('فشل في إضافة العميل');
    },
  });

  // Update customer mutation
  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!selectedCustomer) return;
      
      forbidDirectWrite('update', 'CustomersPage.tsx:331');
    },
    onSuccess: () => {
      toast.success('تم تحديث بيانات العميل');
      setShowEditDialog(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: () => {
      toast.error('فشل في تحديث بيانات العميل');
    },
  });

  const resetForm = () => {
    setFormData({
      full_name: '',
      phone: '',
      email: '',
      address: '',
      notes: '',
      vat_number: '',
      customer_type: 'individual',
      company_name: '',
    });
    setSelectedCustomer(null);
  };

  const openEditDialog = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormData({
      full_name: customer.full_name,
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      notes: customer.notes || '',
      vat_number: customer.vat_number || '',
      customer_type: customer.customer_type || 'individual',
      company_name: customer.company_name || '',
    });
    setShowEditDialog(true);
  };

  const openDetailsDialog = (customer: Customer) => {
    setSelectedCustomer(customer);
    setShowDetailsDialog(true);
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div>
            <h1 className="text-2xl font-bold text-foreground">العملاء</h1>
            <p className="text-muted-foreground mt-1">إدارة بيانات العملاء ونقاط الولاء</p>
          </div>
          <Button onClick={() => setShowAddDialog(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            إضافة عميل
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{customers.length}</p>
                <p className="text-sm text-muted-foreground">إجمالي العملاء</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Star className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {customers.reduce((sum, c) => sum + (c.loyalty_points || 0), 0).toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground">إجمالي النقاط</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <ShoppingBag className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {customers.reduce((sum, c) => sum + (Number(c.total_purchases) || 0), 0).toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground">إجمالي المشتريات</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {customers.filter(c => (c.loyalty_points || 0) >= 100).length}
                </p>
                <p className="text-sm text-muted-foreground">عملاء VIP</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="p-4">
            <div className="relative max-w-md">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="البحث بالاسم أو رقم الهاتف أو الكود..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Customers Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : customers.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>لا يوجد عملاء</p>
              </div>
            ) : (
              <div className="responsive-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الكود</TableHead>
                    <TableHead className="text-right">النوع</TableHead>
                    <TableHead className="text-right">الاسم</TableHead>
                    <TableHead className="text-right">الهاتف / الرقم الضريبي</TableHead>
                    <TableHead className="text-right">النقاط</TableHead>
                    <TableHead className="text-right">إجمالي المشتريات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => (
                    <TableRow 
                      key={customer.id} 
                      className="cursor-pointer hover-elevate"
                      onClick={() => openDetailsDialog(customer)}
                      data-testid={`row-customer-${customer.id}`}
                    >
                      <TableCell className="font-mono text-sm">{customer.customer_code}</TableCell>
                      <TableCell>
                        <Badge variant={customer.customer_type === 'company' ? 'default' : 'outline'}>
                          {customer.customer_type === 'company' ? (
                            <>
                              <Building2 className="w-3 h-3 ml-1" />
                              شركة
                            </>
                          ) : (
                            <>
                              <User className="w-3 h-3 ml-1" />
                              فرد
                            </>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {customer.customer_type === 'company' ? (
                          <div>
                            <div>{customer.company_name}</div>
                            <div className="text-xs text-muted-foreground">{customer.full_name}</div>
                          </div>
                        ) : (
                          customer.full_name
                        )}
                      </TableCell>
                      <TableCell>
                        {customer.customer_type === 'company' ? (
                          <span className="font-mono text-sm">{customer.vat_number || '-'}</span>
                        ) : (
                          customer.phone || '-'
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={(customer.loyalty_points || 0) >= 100 ? 'default' : 'secondary'}>
                          <Star className="w-3 h-3 ml-1" />
                          {customer.loyalty_points || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>{Number(customer.total_purchases || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إضافة عميل جديد</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Customer Type Toggle */}
              <div>
                <Label className="mb-2 block">نوع العميل *</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={formData.customer_type === 'individual' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setFormData({ ...formData, customer_type: 'individual', company_name: '', vat_number: '' })}
                  >
                    <User className="w-4 h-4 ml-2" />
                    فرد
                  </Button>
                  <Button
                    type="button"
                    variant={formData.customer_type === 'company' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setFormData({ ...formData, customer_type: 'company' })}
                  >
                    <Building2 className="w-4 h-4 ml-2" />
                    شركة
                  </Button>
                </div>
              </div>

              {/* Company-specific fields */}
              {formData.customer_type === 'company' && (
                <>
                  <div>
                    <Label>اسم الشركة *</Label>
                    <Input
                      value={formData.company_name}
                      onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                      placeholder="اسم الشركة أو المؤسسة"
                    />
                  </div>
                  <div>
                    <Label>الرقم الضريبي *</Label>
                    <Input
                      value={formData.vat_number}
                      onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })}
                      placeholder="300000000000003"
                      className="font-mono"
                      dir="ltr"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      مطلوب للفواتير الضريبية الكاملة B2B وفقاً لمتطلبات ZATCA
                    </p>
                  </div>
                </>
              )}

              <div>
                <Label>{formData.customer_type === 'company' ? 'اسم المسؤول' : 'الاسم الكامل'} *</Label>
                <Input
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>رقم الهاتف {formData.customer_type === 'individual' ? '*' : ''}</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label>البريد الإلكتروني</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>العنوان</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              <div>
                <Label>ملاحظات</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowAddDialog(false); resetForm(); }}>
                إلغاء
              </Button>
              <Button
                onClick={() => createMutation.mutate(formData)}
                disabled={
                  !formData.full_name || 
                  createMutation.isPending ||
                  (formData.customer_type === 'company' && (!formData.company_name || !formData.vat_number)) ||
                  (formData.customer_type === 'individual' && !formData.phone)
                }
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'حفظ'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>تعديل بيانات العميل</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Customer Type Toggle */}
              <div>
                <Label className="mb-2 block">نوع العميل *</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={formData.customer_type === 'individual' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setFormData({ ...formData, customer_type: 'individual', company_name: '', vat_number: '' })}
                  >
                    <User className="w-4 h-4 ml-2" />
                    فرد
                  </Button>
                  <Button
                    type="button"
                    variant={formData.customer_type === 'company' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setFormData({ ...formData, customer_type: 'company' })}
                  >
                    <Building2 className="w-4 h-4 ml-2" />
                    شركة
                  </Button>
                </div>
              </div>

              {/* Company-specific fields */}
              {formData.customer_type === 'company' && (
                <>
                  <div>
                    <Label>اسم الشركة *</Label>
                    <Input
                      value={formData.company_name}
                      onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                      placeholder="اسم الشركة أو المؤسسة"
                    />
                  </div>
                  <div>
                    <Label>الرقم الضريبي *</Label>
                    <Input
                      value={formData.vat_number}
                      onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })}
                      placeholder="300000000000003"
                      className="font-mono"
                      dir="ltr"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      مطلوب للفواتير الضريبية الكاملة B2B وفقاً لمتطلبات ZATCA
                    </p>
                  </div>
                </>
              )}

              <div>
                <Label>{formData.customer_type === 'company' ? 'اسم المسؤول' : 'الاسم الكامل'} *</Label>
                <Input
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>رقم الهاتف {formData.customer_type === 'individual' ? '*' : ''}</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label>البريد الإلكتروني</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>العنوان</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              <div>
                <Label>ملاحظات</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowEditDialog(false); resetForm(); }}>
                إلغاء
              </Button>
              <Button
                onClick={() => updateMutation.mutate(formData)}
                disabled={
                  !formData.full_name || 
                  updateMutation.isPending ||
                  (formData.customer_type === 'company' && (!formData.company_name || !formData.vat_number)) ||
                  (formData.customer_type === 'individual' && !formData.phone)
                }
              >
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'تحديث'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Details Dialog */}
        <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between gap-4">
                <DialogTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  تفاصيل العميل
                </DialogTitle>
                {selectedCustomer && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDetailsDialog(false);
                      openEditDialog(selectedCustomer);
                    }}
                    data-testid="button-edit-customer"
                  >
                    <Edit className="w-4 h-4" />
                    تعديل
                  </Button>
                )}
              </div>
            </DialogHeader>
            {selectedCustomer && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">الاسم</p>
                    <p className="font-medium">{selectedCustomer.full_name}</p>
                    {selectedCustomer.customer_type === 'company' && selectedCustomer.company_name && (
                      <p className="text-xs text-muted-foreground mt-1">{selectedCustomer.company_name}</p>
                    )}
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">الكود</p>
                    <p className="font-mono">{selectedCustomer.customer_code}</p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> الهاتف
                    </p>
                    <p>{selectedCustomer.phone || '-'}</p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <Mail className="w-3 h-3" /> البريد
                    </p>
                    <p>{selectedCustomer.email || '-'}</p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <Star className="w-3 h-3" /> نقاط الولاء
                    </p>
                    <p className="text-xl font-bold text-primary">{selectedCustomer.loyalty_points || 0}</p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <ShoppingBag className="w-3 h-3" /> إجمالي المشتريات
                    </p>
                    <p className="text-xl font-bold">{Number(selectedCustomer.total_purchases || 0).toLocaleString()}</p>
                  </div>
                </div>

                {(selectedCustomer.address || selectedCustomer.vat_number) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedCustomer.address && (
                      <div className="p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> العنوان
                        </p>
                        <p>{selectedCustomer.address}</p>
                      </div>
                    )}
                    {selectedCustomer.vat_number && (
                      <div className="p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground mb-1">الرقم الضريبي</p>
                        <p className="font-mono">{selectedCustomer.vat_number}</p>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    فواتير المبيعات
                    {customerSales.length > 0 && (
                      <Badge variant="secondary">{customerSales.length}</Badge>
                    )}
                  </h4>
                  {customerSales.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">لا توجد فواتير مبيعات</p>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">رقم الفاتورة</TableHead>
                            <TableHead className="text-right">الفرع</TableHead>
                            <TableHead className="text-right">القطع</TableHead>
                            <TableHead className="text-right">المبلغ</TableHead>
                            <TableHead className="text-right">التاريخ</TableHead>
                            <TableHead className="text-right"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {customerSales.map((sale: any) => (
                            <TableRow key={sale.id}>
                              <TableCell className="font-mono text-sm">{sale.invoice_number || sale.sale_code}</TableCell>
                              <TableCell>{sale.branches?.branch_name || '-'}</TableCell>
                              <TableCell>{sale.total_items}</TableCell>
                              <TableCell className="font-medium">{Number(sale.final_amount).toLocaleString()}</TableCell>
                              <TableCell>{new Date(sale.sale_date).toLocaleDateString('ar-EG')}</TableCell>
                              <TableCell>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="gap-1"
                                  onClick={() => openInvoiceDialog(sale)}
                                  data-testid={`button-view-sale-${sale.id}`}
                                >
                                  <FileText className="w-4 h-4" />
                                  عرض
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <RotateCcw className="w-4 h-4" />
                    المرتجعات
                    {customerReturns.length > 0 && (
                      <Badge variant="destructive">{customerReturns.length}</Badge>
                    )}
                  </h4>
                  {customerReturns.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">لا توجد مرتجعات</p>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">رقم المرتجع</TableHead>
                            <TableHead className="text-right">الفاتورة الأصلية</TableHead>
                            <TableHead className="text-right">الفرع</TableHead>
                            <TableHead className="text-right">المبلغ</TableHead>
                            <TableHead className="text-right">الحالة</TableHead>
                            <TableHead className="text-right">التاريخ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {customerReturns.map((ret: any) => (
                            <TableRow key={ret.id}>
                              <TableCell className="font-mono text-sm">{ret.return_number}</TableCell>
                              <TableCell className="font-mono text-sm">{ret.original_invoice_number || '-'}</TableCell>
                              <TableCell>{ret.branches?.branch_name || '-'}</TableCell>
                              <TableCell className="font-medium text-destructive">{Number(ret.total_amount).toLocaleString()}</TableCell>
                              <TableCell>
                                {ret.status === 'completed' ? (
                                  <Badge variant="default">مكتمل</Badge>
                                ) : ret.status === 'pending' ? (
                                  <Badge variant="outline">قيد المعالجة</Badge>
                                ) : ret.status === 'voided' || ret.status === 'cancelled' ? (
                                  <Badge variant="destructive">ملغي</Badge>
                                ) : ret.status === 'draft' ? (
                                  <Badge variant="outline">مسودة</Badge>
                                ) : ret.status === 'approved' ? (
                                  <Badge variant="default">معتمد</Badge>
                                ) : (
                                  <Badge variant="secondary">{ret.status}</Badge>
                                )}
                              </TableCell>
                              <TableCell>{new Date(ret.return_date).toLocaleDateString('ar-EG')}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Invoice Details Dialog */}
        <Dialog open={showInvoiceDialog} onOpenChange={(open) => {
          setShowInvoiceDialog(open);
          if (!open) {
            setSelectedSale(null);
            setSelectedItemsForReturn([]);
          }
        }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                تفاصيل الفاتورة: {selectedSale?.invoice_number || selectedSale?.sale_code}
              </DialogTitle>
            </DialogHeader>
            {selectedSale && (
              <div className="space-y-4">
                {/* Invoice Info */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">العميل</p>
                    <p className="font-medium">{selectedCustomer?.full_name}</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">الفرع</p>
                    <p className="font-medium">{selectedSale.branches?.branch_name || '-'}</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">التاريخ</p>
                    <p className="font-medium">
                      {format(new Date(selectedSale.sale_date), 'dd/MM/yyyy', { locale: arLocale })}
                    </p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">الإجمالي</p>
                    <p className="font-bold text-primary">{formatCurrency(selectedSale.final_amount)}</p>
                  </div>
                </div>

                {/* Items List */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold">القطع المباعة</h4>
                    {availableForReturn.length > 0 && selectedItemsForReturn.length > 0 && (
                      <Button 
                        size="sm" 
                        variant="destructive" 
                        className="gap-1"
                        onClick={openReturnDialog}
                      >
                        <RotateCcw className="w-4 h-4" />
                        إرجاع المحدد ({selectedItemsForReturn.length})
                      </Button>
                    )}
                  </div>
                  
                  {saleItemsLoading ? (
                    <div className="p-8 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                    </div>
                  ) : saleItems.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">لا توجد قطع</p>
                  ) : (
                    <div className="responsive-table-wrapper">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead className="text-right">كود القطعة</TableHead>
                          <TableHead className="text-right">الموديل</TableHead>
                          <TableHead className="text-right">النوع</TableHead>
                          <TableHead className="text-right">المعدن</TableHead>
                          <TableHead className="text-right">الوزن</TableHead>
                          <TableHead className="text-right">السعر</TableHead>
                          <TableHead className="text-right">الحالة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {saleItems.map((item: any) => {
                          const isReturned = item.jewelry_items?.sold_at === null;
                          const canReturn = !isReturned;
                          
                          return (
                            <TableRow key={item.id} className={isReturned ? 'opacity-50' : ''}>
                              <TableCell>
                                {canReturn && (
                                  <Checkbox
                                    checked={selectedItemsForReturn.includes(item.id)}
                                    onCheckedChange={() => toggleItemForReturn(item.id)}
                                  />
                                )}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {item.jewelry_items?.item_code}
                              </TableCell>
                              <TableCell>{item.jewelry_items?.model || '-'}</TableCell>
                              <TableCell>{item.jewelry_items?.type || '-'}</TableCell>
                              <TableCell>{item.jewelry_items?.metal || '-'}</TableCell>
                              <TableCell>{item.jewelry_items?.g_weight?.toFixed(2) || '-'} جم</TableCell>
                              <TableCell className="font-medium">{formatCurrency(item.sale_price)}</TableCell>
                              <TableCell>
                                {isReturned ? (
                                  <Badge variant="secondary">تم الإرجاع</Badge>
                                ) : (
                                  <Badge variant="default">مباعة</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    </div>
                  )}
                </div>

                {/* Total for selected items */}
                {selectedItemsForReturn.length > 0 && (
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">مجموع القطع المحددة للإرجاع:</span>
                      <span className="font-bold text-destructive">
                        {formatCurrency(
                          saleItems
                            .filter(item => selectedItemsForReturn.includes(item.id))
                            .reduce((sum, item) => sum + (item.sale_price || 0), 0)
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowInvoiceDialog(false)}>
                إغلاق
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Return Confirmation Dialog */}
        <Dialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <RotateCcw className="w-5 h-5" />
                تأكيد إرجاع القطع
              </DialogTitle>
              <DialogDescription>
                سيتم إرجاع {selectedItemsForReturn.length} قطعة من الفاتورة {selectedSale?.invoice_number || selectedSale?.sale_code}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">إجمالي مبلغ الإرجاع</p>
                <p className="text-2xl font-bold text-destructive">
                  {formatCurrency(
                    saleItems
                      .filter(item => selectedItemsForReturn.includes(item.id))
                      .reduce((sum, item) => sum + (item.sale_price || 0), 0)
                  )}
                </p>
              </div>
              
              {/* Refund Method */}
              <div>
                <Label className="mb-2 block">طريقة الاسترداد *</Label>
                <Select value={refundMethod} onValueChange={(v) => setRefundMethod(v as 'cash' | 'card' | 'store_credit')}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر طريقة الاسترداد" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="card">بطاقة</SelectItem>
                    {selectedCustomer && <SelectItem value="store_credit">رصيد متجر</SelectItem>}
                  </SelectContent>
                </Select>
              </div>

              {/* Post Return Status */}
              <div>
                <Label className="mb-2 block">حالة القطعة بعد الإرجاع *</Label>
                <RadioGroup 
                  value={postReturnStatus} 
                  onValueChange={(v) => setPostReturnStatus(v as 'available' | 'inspection')}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2 space-x-reverse">
                    <RadioGroupItem value="inspection" id="status-inspection" />
                    <Label htmlFor="status-inspection" className="cursor-pointer">فحص</Label>
                  </div>
                  <div className="flex items-center space-x-2 space-x-reverse">
                    <RadioGroupItem value="available" id="status-available" />
                    <Label htmlFor="status-available" className="cursor-pointer">متاح للبيع</Label>
                  </div>
                </RadioGroup>
              </div>
              
              <div>
                <Label>سبب الإرجاع *</Label>
                <Input
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="مثال: عيب في القطعة، رغبة العميل..."
                />
              </div>
              
              <div>
                <Label>ملاحظات</Label>
                <Textarea
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="أي ملاحظات إضافية..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReturnDialog(false)}>
                إلغاء
              </Button>
              <Button 
                variant="destructive"
                onClick={() => createReturnMutation.mutate()}
                disabled={!returnReason.trim() || createReturnMutation.isPending}
              >
                {createReturnMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                ) : (
                  <RotateCcw className="w-4 h-4 ml-2" />
                )}
                تأكيد الإرجاع
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
