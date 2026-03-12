import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import {
  Plus,
  Factory,
  ArrowRight,
  Loader2,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  AlertTriangle,
  ChevronLeft,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { logAudit } from '@/lib/audit';
import {
  createProductionStartJournalEntry,
  createReversalJournalEntry,
  checkRawMaterialAvailability,
} from '@/lib/production-accounting';

interface ProductionStage {
  id: string;
  stage_code: string;
  stage_name: string;
  stage_name_en: string | null;
  stage_order: number;
  is_active: boolean;
}

interface CostCenter {
  id: string;
  center_code: string;
  center_name: string;
  is_active: boolean;
}

interface WorkOrder {
  id: string;
  order_number: string;
  order_date?: string;
  branch_id: string | null;
  product_description: string | null;
  quantity: number;
  gold_weight_required: number;
  karat_id: string | null;
  priority: string;
  status: string;
  current_stage_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_by: string | null;
  cost_center_id?: string | null;
  start_journal_entry_id?: string | null;
  branches?: { branch_name: string } | null;
  gold_karats?: { karat_name: string } | null;
  production_stages?: { stage_name: string; stage_order: number } | null;
  cost_centers?: { center_name: string } | null;
}

interface WIPInventory {
  id: string;
  work_order_id: string;
  stage_id: string;
  gold_weight_in: number;
  gold_weight_out: number;
  gold_weight_loss: number;
  entered_at: string;
  exited_at: string | null;
  processed_by: string | null;
  status: string;
  production_stages?: ProductionStage | null;
  work_orders?: WorkOrder | null;
}

const priorityLabels: Record<string, string> = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'عالية',
  urgent: 'عاجلة',
};

const statusLabels: Record<string, string> = {
  pending: 'قيد الانتظار',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

const movementTypeLabels: Record<string, string> = {
  forward: 'تقدم',
  backward: 'رجوع',
  reject: 'رفض',
  complete: 'إكمال',
};

export default function WIPPage() {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);

  // Fetch production stages
  const [schemaNotReady, setSchemaNotReady] = useState(false);

  const { data: stages = [], isLoading: loadingStages } = useQuery({
    queryKey: ['production-stages'],
    queryFn: async () => {
      const res = await fetch('/api/production-stages?all=true', { credentials: 'include' });
      if (res.status === 501) { setSchemaNotReady(true); return [] as ProductionStage[]; }
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as ProductionStage[];
    },
  });

  // Fetch cost centers
  const { data: costCenters = [] } = useQuery({
    queryKey: ['cost-centers-active'],
    queryFn: async () => {
      const res = await fetch('/api/cost-centers-active', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as CostCenter[];
    },
  });

  // Fetch work orders
  const { data: workOrders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['work-orders'],
    queryFn: async () => {
      const res = await fetch('/api/work-orders-list', { credentials: 'include' });
      if (res.status === 501) { setSchemaNotReady(true); return [] as WorkOrder[]; }
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as WorkOrder[];
    },
  });

  // Fetch WIP inventory
  const { data: wipInventory = [], isLoading: loadingWIP } = useQuery({
    queryKey: ['wip-inventory'],
    queryFn: async () => {
      const res = await fetch('/api/wip-inventory', { credentials: 'include' });
      if (res.status === 501) return [] as WIPInventory[];
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as WIPInventory[];
    },
  });

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Fetch karats
  const { data: karats = [] } = useQuery({
    queryKey: ['gold-karats'],
    queryFn: async () => {
      const res = await fetch('/api/gold-karats-active', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Create work order mutation
  const orderMutation = useMutation({
    mutationFn: async (data: {
      product_description: string;
      quantity: number;
      gold_weight_required: number;
      karat_id: string;
      branch_id: string;
      cost_center_id: string;
      priority: string;
      notes?: string;
    }) => {
      // Generate order number
      const today = format(new Date(), 'yyyyMMdd');
      const countRes = await fetch(`/api/work-order-count?prefix=WO-${today}`, { credentials: 'include' });
      const countData = await countRes.json();
      const count = countData.count;
      
      const orderNumber = `WO-${today}-${String((count || 0) + 1).padStart(4, '0')}`;

      forbidDirectWrite('insert', 'WIPPage.tsx:259');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      setOrderDialogOpen(false);
      toast.success('تم إنشاء أمر العمل بنجاح');
    },
    onError: (error) => {
      toast.error('فشل في إنشاء أمر العمل');
      console.error(error);
    },
  });

  // Start production mutation (creates first journal entry)
  const startProductionMutation = useMutation({
    mutationFn: async (order: WorkOrder) => {
      // Check raw material availability first
      const availability = await checkRawMaterialAvailability(
        order.branch_id || '',
        order.gold_weight_required
      );

      if (!availability.available) {
        throw new Error(`المخزون غير كافٍ. المتاح: ${availability.currentStock} جم، المطلوب: ${order.gold_weight_required} جم، العجز: ${availability.shortage} جم`);
      }

      // Get gold price for cost calculation
      const gpRes = await fetch(`/api/gold-price-latest?karat_id=${order.karat_id}`, { credentials: 'include' });
      const goldPrice = await gpRes.json();

      const rawMaterialCost = order.gold_weight_required * (goldPrice?.buy_price_per_gram || 0);

      // Create production start journal entry
      const journalEntryId = await createProductionStartJournalEntry({
        workOrderId: order.id,
        workOrderCode: order.order_number,
        branchId: order.branch_id || undefined,
        costCenterId: order.cost_center_id || undefined,
        rawMaterialCost,
      });

      forbidDirectWrite('update', 'WIPPage.tsx:334');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['wip-inventory'] });
      toast.success('تم بدء تنفيذ أمر العمل وإنشاء القيد المحاسبي');
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في بدء تنفيذ أمر العمل');
      console.error(error);
    },
  });

  // Cancel work order mutation (reverses journal entry)
  const cancelMutation = useMutation({
    mutationFn: async (order: WorkOrder) => {
      // If there's a start journal entry, reverse it
      if (order.start_journal_entry_id) {
        await createReversalJournalEntry({
          originalEntryId: order.start_journal_entry_id,
          reversalReason: `إلغاء أمر الإنتاج ${order.order_number}`,
          reversedBy: 'system',
        });
      }

      forbidDirectWrite('update', 'WIPPage.tsx:390');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['wip-inventory'] });
      setCancelDialogOpen(false);
      setSelectedOrder(null);
      toast.success('تم إلغاء أمر العمل وعكس القيود');
    },
    onError: (error) => {
      toast.error('فشل في إلغاء أمر العمل');
      console.error(error);
    },
  });

  // Move to next stage mutation (internal transfer - no journal entry)
  const movementMutation = useMutation({
    mutationFn: async (data: {
      work_order_id: string;
      from_stage_id: string | null;
      to_stage_id: string;
      gold_weight: number;
      movement_type: string;
      notes?: string;
      order_number?: string;
    }) => {
      forbidDirectWrite('insert', 'WIPPage.tsx:442');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['wip-inventory'] });
      setMovementDialogOpen(false);
      setSelectedOrder(null);
      toast.success('تم تحويل المرحلة بنجاح');
    },
    onError: (error) => {
      toast.error('فشل في تحويل المرحلة');
      console.error(error);
    },
  });

  // Filter orders
  const filteredOrders = useMemo(() => {
    return workOrders.filter(o =>
      o.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.product_description?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [workOrders, searchTerm]);

  // Statistics
  const stats = useMemo(() => ({
    totalOrders: workOrders.length,
    pendingOrders: workOrders.filter(o => o.status === 'pending').length,
    inProgressOrders: workOrders.filter(o => o.status === 'in_progress').length,
    completedOrders: workOrders.filter(o => o.status === 'completed').length,
  }), [workOrders]);

  // Get stage counts
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    wipInventory.forEach(wip => {
      if (wip.status === 'in_stage') {
        counts[wip.stage_id] = (counts[wip.stage_id] || 0) + 1;
      }
    });
    return counts;
  }, [wipInventory]);

  if (loadingStages || loadingOrders) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  if (schemaNotReady) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-96">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-lg font-semibold text-muted-foreground">هذه الميزة غير مهيأة بعد</p>
          <p className="text-muted-foreground mt-2">جداول الإنتاج غير موجودة في قاعدة البيانات</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">الإنتاج تحت التشغيل (WIP)</h1>
            <p className="text-muted-foreground">متابعة مراحل الإنتاج الـ 14</p>
          </div>
          <Button onClick={() => setOrderDialogOpen(true)}>
            <Plus className="w-4 h-4 ml-2" />
            أمر عمل جديد
          </Button>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Factory className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalOrders}</p>
                  <p className="text-xs text-muted-foreground">إجمالي الأوامر</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-yellow-500/10">
                  <Clock className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.pendingOrders}</p>
                  <p className="text-xs text-muted-foreground">قيد الانتظار</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <AlertCircle className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.inProgressOrders}</p>
                  <p className="text-xs text-muted-foreground">قيد التنفيذ</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.completedOrders}</p>
                  <p className="text-xs text-muted-foreground">مكتملة</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Production Stages Pipeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">خط الإنتاج - 14 مرحلة</CardTitle>
            <CardDescription>تتبع تقدم العمل عبر جميع المراحل</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex overflow-x-auto gap-2 pb-4">
              {stages.map((stage, index) => (
                <div key={stage.id} className="flex items-center">
                  <div className={`flex flex-col items-center min-w-[100px] p-3 rounded-lg border ${
                    stageCounts[stage.id] ? 'bg-primary/10 border-primary' : 'bg-muted/50 border-border'
                  }`}>
                    <span className="text-xs font-mono text-muted-foreground">{stage.stage_code}</span>
                    <span className="text-sm font-medium text-center mt-1">{stage.stage_name}</span>
                    <Badge variant={stageCounts[stage.id] ? 'default' : 'secondary'} className="mt-2">
                      {stageCounts[stage.id] || 0}
                    </Badge>
                  </div>
                  {index < stages.length - 1 && (
                    <ChevronLeft className="w-5 h-5 text-muted-foreground mx-1 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="orders" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="orders">أوامر العمل</TabsTrigger>
            <TabsTrigger value="wip">المخزون تحت التشغيل</TabsTrigger>
          </TabsList>

          {/* Work Orders Tab */}
          <TabsContent value="orders" className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-9"
                />
              </div>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الأمر</TableHead>
                    <TableHead>الوصف</TableHead>
                    <TableHead>مركز التكلفة</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>وزن الذهب</TableHead>
                    <TableHead>المرحلة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono">{order.order_number}</TableCell>
                      <TableCell className="font-medium">{order.product_description || '-'}</TableCell>
                      <TableCell>{order.cost_centers?.center_name || '-'}</TableCell>
                      <TableCell>{order.quantity}</TableCell>
                      <TableCell>{order.gold_weight_required} جم</TableCell>
                      <TableCell>
                        {order.production_stages?.stage_name || 'لم يبدأ'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          order.status === 'completed' ? 'default' :
                          order.status === 'in_progress' ? 'secondary' :
                          order.status === 'cancelled' ? 'destructive' : 'outline'
                        }>
                          {statusLabels[order.status] || order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/production/work-orders/${order.id}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          
                          {order.status === 'pending' && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => startProductionMutation.mutate(order)}
                              disabled={startProductionMutation.isPending}
                            >
                              {startProductionMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                'بدء الإنتاج'
                              )}
                            </Button>
                          )}
                          
                          {order.status === 'in_progress' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedOrder(order);
                                  setMovementDialogOpen(true);
                                }}
                              >
                                <ArrowRight className="w-4 h-4 ml-1" />
                                تحويل
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedOrder(order);
                                  setCancelDialogOpen(true);
                                }}
                              >
                                <RotateCcw className="w-4 h-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredOrders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        لا توجد أوامر عمل
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* WIP Inventory Tab */}
          <TabsContent value="wip" className="space-y-4">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الأمر</TableHead>
                    <TableHead>المرحلة</TableHead>
                    <TableHead>وزن الدخول</TableHead>
                    <TableHead>وزن الخروج</TableHead>
                    <TableHead>الفاقد</TableHead>
                    <TableHead>تاريخ الدخول</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>المنفذ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wipInventory.map((wip) => (
                    <TableRow key={wip.id}>
                      <TableCell className="font-mono">
                        {wip.work_orders?.order_number}
                      </TableCell>
                      <TableCell>{wip.production_stages?.stage_name}</TableCell>
                      <TableCell>{wip.gold_weight_in} جم</TableCell>
                      <TableCell>{wip.gold_weight_out || '-'} جم</TableCell>
                      <TableCell className={wip.gold_weight_loss > 0 ? 'text-destructive' : ''}>
                        {wip.gold_weight_loss || 0} جم
                      </TableCell>
                      <TableCell>
                        {format(new Date(wip.entered_at), 'yyyy/MM/dd HH:mm', { locale: ar })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={wip.status === 'in_stage' ? 'secondary' : 'default'}>
                          {wip.status === 'in_stage' ? 'في المرحلة' : 'مكتمل'}
                        </Badge>
                      </TableCell>
                      <TableCell>{wip.processed_by || '-'}</TableCell>
                    </TableRow>
                  ))}
                  {wipInventory.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        لا يوجد مخزون تحت التشغيل
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Work Order Dialog */}
        <WorkOrderDialog
          open={orderDialogOpen}
          onOpenChange={setOrderDialogOpen}
          branches={branches}
          karats={karats}
          costCenters={costCenters}
          onSave={(data) => orderMutation.mutate(data)}
          isLoading={orderMutation.isPending}
        />

        {/* Movement Dialog */}
        {selectedOrder && movementDialogOpen && (
          <MovementDialog
            open={movementDialogOpen}
            onOpenChange={(open) => {
              setMovementDialogOpen(open);
              if (!open) setSelectedOrder(null);
            }}
            order={selectedOrder}
            stages={stages}
            onSave={(data) => movementMutation.mutate(data)}
            isLoading={movementMutation.isPending}
          />
        )}

        {/* Cancel Confirmation Dialog */}
        <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد إلغاء أمر العمل</AlertDialogTitle>
              <AlertDialogDescription>
                هل أنت متأكد من إلغاء أمر العمل {selectedOrder?.order_number}؟
                سيتم عكس جميع القيود المحاسبية المرتبطة بهذا الأمر.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => selectedOrder && cancelMutation.mutate(selectedOrder)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                ) : null}
                تأكيد الإلغاء
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}

// Work Order Dialog
function WorkOrderDialog({
  open,
  onOpenChange,
  branches,
  karats,
  costCenters,
  onSave,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: { id: string; branch_name: string }[];
  karats: { id: string; karat_name: string; karat_value: number }[];
  costCenters: CostCenter[];
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    product_description: '',
    quantity: 1,
    gold_weight_required: 0,
    karat_id: '',
    branch_id: '',
    cost_center_id: '',
    priority: 'normal',
    notes: '',
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>أمر عمل جديد</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>وصف المنتج</Label>
            <Input
              value={formData.product_description}
              onChange={(e) => setFormData({ ...formData, product_description: e.target.value })}
              placeholder="مثال: خاتم ذهب 18 قيراط"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الكمية</Label>
              <Input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>وزن الذهب المطلوب (جم)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.gold_weight_required}
                onChange={(e) => setFormData({ ...formData, gold_weight_required: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>العيار</Label>
              <Select
                value={formData.karat_id}
                onValueChange={(value) => setFormData({ ...formData, karat_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر العيار" />
                </SelectTrigger>
                <SelectContent>
                  {karats.map((k) => (
                    <SelectItem key={k.id} value={k.id}>{k.karat_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الفرع</Label>
              <Select
                value={formData.branch_id}
                onValueChange={(value) => setFormData({ ...formData, branch_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>مركز التكلفة <span className="text-destructive">*</span></Label>
            <Select
              value={formData.cost_center_id}
              onValueChange={(value) => setFormData({ ...formData, cost_center_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر مركز التكلفة" />
              </SelectTrigger>
              <SelectContent>
                {costCenters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.center_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>الأولوية</Label>
            <Select
              value={formData.priority}
              onValueChange={(value) => setFormData({ ...formData, priority: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(priorityLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            onClick={() => onSave(formData)}
            disabled={isLoading || !formData.product_description || !formData.karat_id || !formData.branch_id || !formData.cost_center_id}
          >
            {isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            إنشاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Movement Dialog
function MovementDialog({
  open,
  onOpenChange,
  order,
  stages,
  onSave,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: WorkOrder;
  stages: ProductionStage[];
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const currentStageIndex = stages.findIndex(s => s.id === order.current_stage_id);
  const nextStage = stages[currentStageIndex + 1];
  const isLastStage = currentStageIndex === stages.length - 1;

  const [formData, setFormData] = useState({
    to_stage_id: nextStage?.id || '',
    gold_weight: order.gold_weight_required,
    movement_type: isLastStage ? 'complete' : 'forward',
    notes: '',
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تحويل مرحلة الإنتاج</DialogTitle>
          <DialogDescription>
            تحويل داخلي - لا ينشئ قيود محاسبية
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-muted">
            <p className="text-sm font-medium">أمر العمل: {order.order_number}</p>
            <p className="text-sm text-muted-foreground">
              المرحلة الحالية: {order.production_stages?.stage_name || 'لم يبدأ'}
            </p>
          </div>

          <div className="space-y-2">
            <Label>المرحلة التالية</Label>
            <Select
              value={formData.to_stage_id}
              onValueChange={(value) => setFormData({ ...formData, to_stage_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر المرحلة" />
              </SelectTrigger>
              <SelectContent>
                {stages.filter(s => s.stage_order > (order.production_stages?.stage_order || 0)).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.stage_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>وزن الذهب (جم)</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.gold_weight}
              onChange={(e) => setFormData({ ...formData, gold_weight: Number(e.target.value) })}
            />
          </div>

          <div className="space-y-2">
            <Label>نوع التحويل</Label>
            <Select
              value={formData.movement_type}
              onValueChange={(value) => setFormData({ ...formData, movement_type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(movementTypeLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            onClick={() => onSave({
              work_order_id: order.id,
              from_stage_id: order.current_stage_id,
              order_number: order.order_number,
              ...formData,
            })}
            disabled={isLoading || !formData.to_stage_id || formData.gold_weight <= 0}
          >
            {isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            تحويل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
