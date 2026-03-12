import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import {
  ArrowRight,
  Loader2,
  Plus,
  Package,
  Gem,
  Wrench,
  DollarSign,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  FileText,
  Split,
} from 'lucide-react';
import { logAudit } from '@/lib/audit';
import DirectCostsTab from '@/components/production/DirectCostsTab';
import PartialCompletionDialog from '@/components/production/PartialCompletionDialog';

export default function WorkOrderDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [laborDialogOpen, setLaborDialogOpen] = useState(false);
  const [partialCompletionOpen, setPartialCompletionOpen] = useState(false);
  const [materialType, setMaterialType] = useState<'gold' | 'gemstone' | 'raw_material' | 'other'>('gold');
  const [materialForm, setMaterialForm] = useState({
    gold_weight_grams: 0,
    gold_karat_id: '',
    gold_cost: 0,
    gemstone_id: '',
    gemstone_cost: 0,
    raw_material_id: '',
    quantity: 0,
    unit: 'جرام',
    unit_cost: 0,
    description: '',
    total_cost: 0,
    is_estimated: false,
  });
  const [laborForm, setLaborForm] = useState({
    stage_id: '',
    worker_name: '',
    labor_type: '',
    hours_worked: 0,
    hourly_rate: 0,
    work_date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
  });

  const [schemaNotReady, setSchemaNotReady] = useState(false);

  // Fetch work order
  const { data: workOrder, isLoading } = useQuery({
    queryKey: ['work-order', id],
    queryFn: async () => {
      const res = await fetch(`/api/work-order/${id}`, { credentials: 'include' });
      if (res.status === 501) { setSchemaNotReady(true); return null; }
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    enabled: !!id,
  });

  // Fetch partial completions
  const { data: partialCompletions = [] } = useQuery({
    queryKey: ['work-order-partial-completions', id],
    queryFn: async () => {
      const res = await fetch(`/api/work-order-partial-completions/${id}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    enabled: !!id && !schemaNotReady,
  });

  // Fetch journal entries
  const { data: journalEntries = [] } = useQuery({
    queryKey: ['work-order-journal-entries', id],
    queryFn: async () => {
      const res = await fetch(`/api/work-order-journal-entries/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    enabled: !!id,
  });

  // Fetch materials
  const { data: materials = [] } = useQuery({
    queryKey: ['work-order-materials', id],
    queryFn: async () => {
      const res = await fetch(`/api/work-order-materials/${id}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    enabled: !!id && !schemaNotReady,
  });

  // Fetch labor
  const { data: laborRecords = [] } = useQuery({
    queryKey: ['work-order-labor', id],
    queryFn: async () => {
      const res = await fetch(`/api/work-order-labor/${id}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    enabled: !!id && !schemaNotReady,
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

  // Fetch stages
  const { data: stages = [] } = useQuery({
    queryKey: ['production-stages'],
    queryFn: async () => {
      const res = await fetch('/api/production-stages', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Fetch gemstones
  const { data: gemstones = [] } = useQuery({
    queryKey: ['available-gemstones'],
    queryFn: async () => {
      const res = await fetch('/api/available-gemstones', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Fetch raw materials
  const { data: rawMaterials = [] } = useQuery({
    queryKey: ['raw-materials'],
    queryFn: async () => {
      const res = await fetch('/api/raw-materials-active', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Add material mutation
  const addMaterialMutation = useMutation({
    mutationFn: async () => {
      forbidDirectWrite('insert', 'WorkOrderDetailsPage.tsx:223');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-order-materials'] });
      queryClient.invalidateQueries({ queryKey: ['work-order', id] });
      setMaterialDialogOpen(false);
      resetMaterialForm();
      toast.success('تم إضافة المادة بنجاح');
    },
    onError: (error) => {
      toast.error('فشل في إضافة المادة');
      console.error(error);
    },
  });

  // Add labor mutation
  const addLaborMutation = useMutation({
    mutationFn: async () => {
      forbidDirectWrite('insert', 'WorkOrderDetailsPage.tsx:264');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-order-labor'] });
      queryClient.invalidateQueries({ queryKey: ['work-order', id] });
      setLaborDialogOpen(false);
      resetLaborForm();
      toast.success('تم إضافة العمالة بنجاح');
    },
    onError: (error) => {
      toast.error('فشل في إضافة العمالة');
      console.error(error);
    },
  });

  const updateWorkOrderCosts = async () => {
    forbidDirectWrite('update', 'WorkOrderDetailsPage.tsx:321');
  };

  const resetMaterialForm = () => {
    setMaterialForm({
      gold_weight_grams: 0,
      gold_karat_id: '',
      gold_cost: 0,
      gemstone_id: '',
      gemstone_cost: 0,
      raw_material_id: '',
      quantity: 0,
      unit: 'جرام',
      unit_cost: 0,
      description: '',
      total_cost: 0,
      is_estimated: false,
    });
    setMaterialType('gold');
  };

  const resetLaborForm = () => {
    setLaborForm({
      stage_id: '',
      worker_name: '',
      labor_type: '',
      hours_worked: 0,
      hourly_rate: 0,
      work_date: format(new Date(), 'yyyy-MM-dd'),
      notes: '',
    });
  };

  // Calculate totals
  const totalEstimatedCost = (workOrder?.estimated_gold_cost || 0) + 
    (workOrder?.estimated_labor_cost || 0) + 
    (workOrder?.estimated_gemstone_cost || 0) + 
    (workOrder?.estimated_other_cost || 0);

  const totalActualCost = (workOrder?.actual_gold_cost || 0) + 
    (workOrder?.actual_labor_cost || 0) + 
    (workOrder?.actual_gemstone_cost || 0) + 
    (workOrder?.actual_other_cost || 0);

  const costVariance = totalActualCost - totalEstimatedCost;
  const variancePercentage = totalEstimatedCost > 0 ? (costVariance / totalEstimatedCost) * 100 : 0;

  if (isLoading) {
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
          <Button variant="outline" onClick={() => navigate('/production/wip')} className="mt-4">
            العودة
          </Button>
        </div>
      </MainLayout>
    );
  }

  if (!workOrder) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-96">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">أمر العمل غير موجود</p>
          <Button variant="outline" onClick={() => navigate('/production/wip')} className="mt-4">
            العودة
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Button variant="ghost" size="sm" onClick={() => navigate('/production/wip')}>
                <ArrowRight className="w-4 h-4" />
              </Button>
              <h1 className="text-2xl font-bold text-foreground">
                أمر عمل: {workOrder.order_number}
              </h1>
            </div>
            <p className="text-muted-foreground">{workOrder.product_description}</p>
          </div>
          <Badge variant={workOrder.status === 'completed' ? 'default' : 'secondary'} className="text-sm px-4 py-2">
            {workOrder.status === 'pending' ? 'قيد الانتظار' :
             workOrder.status === 'in_progress' ? 'قيد التنفيذ' :
             workOrder.status === 'completed' ? 'مكتمل' : workOrder.status}
          </Badge>
        </div>

        {/* Cost Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">التكلفة التقديرية</p>
                  <p className="text-2xl font-bold">{totalEstimatedCost.toLocaleString()}</p>
                </div>
                <DollarSign className="w-8 h-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">التكلفة الفعلية</p>
                  <p className="text-2xl font-bold">{totalActualCost.toLocaleString()}</p>
                </div>
                <DollarSign className="w-8 h-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">الفرق</p>
                  <p className={`text-2xl font-bold ${costVariance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {costVariance > 0 ? '+' : ''}{costVariance.toLocaleString()}
                  </p>
                </div>
                {costVariance > 0 ? (
                  <TrendingUp className="w-8 h-8 text-destructive" />
                ) : (
                  <TrendingDown className="w-8 h-8 text-green-600" />
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">نسبة الانحراف</p>
                  <p className={`text-2xl font-bold ${variancePercentage > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {variancePercentage > 0 ? '+' : ''}{variancePercentage.toFixed(1)}%
                  </p>
                </div>
                <AlertTriangle className={`w-8 h-8 ${Math.abs(variancePercentage) > 10 ? 'text-destructive' : 'text-muted-foreground'}`} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Order Details */}
        <Card>
          <CardHeader>
            <CardTitle>تفاصيل أمر العمل</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">الفرع</p>
                <p className="font-medium">{workOrder.branches?.branch_name || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">الكمية</p>
                <p className="font-medium">{workOrder.quantity} قطعة</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">وزن الذهب المطلوب</p>
                <p className="font-medium">{workOrder.gold_weight_required} جم</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">العيار</p>
                <p className="font-medium">{workOrder.gold_karats?.karat_name || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">المرحلة الحالية</p>
                <p className="font-medium">{workOrder.production_stages?.stage_name || 'لم يبدأ'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">تاريخ الإنشاء</p>
                <p className="font-medium">
                  {format(new Date(workOrder.created_at), 'dd/MM/yyyy', { locale: ar })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">الأولوية</p>
                <Badge variant={workOrder.priority === 'urgent' ? 'destructive' : 'secondary'}>
                  {workOrder.priority === 'low' ? 'منخفضة' :
                   workOrder.priority === 'normal' ? 'عادية' :
                   workOrder.priority === 'high' ? 'عالية' : 'عاجلة'}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">بواسطة</p>
                <p className="font-medium">{workOrder.created_by || '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs for Materials, Labor, Costs, etc */}
        <Tabs defaultValue="materials" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="materials" className="gap-2">
              <Package className="w-4 h-4" />
              المواد
            </TabsTrigger>
            <TabsTrigger value="labor" className="gap-2">
              <Wrench className="w-4 h-4" />
              العمالة
            </TabsTrigger>
            <TabsTrigger value="direct-costs" className="gap-2">
              <DollarSign className="w-4 h-4" />
              تكاليف إضافية
            </TabsTrigger>
            <TabsTrigger value="partial-completions" className="gap-2">
              <Split className="w-4 h-4" />
              الإنتاج الجزئي
            </TabsTrigger>
            <TabsTrigger value="journal-entries" className="gap-2">
              <FileText className="w-4 h-4" />
              القيود المحاسبية
            </TabsTrigger>
            <TabsTrigger value="breakdown" className="gap-2">
              <TrendingUp className="w-4 h-4" />
              تحليل التكلفة
            </TabsTrigger>
          </TabsList>

          {/* Materials Tab */}
          <TabsContent value="materials">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>المواد المستخدمة</CardTitle>
                <Button size="sm" onClick={() => setMaterialDialogOpen(true)}>
                  <Plus className="w-4 h-4 ml-2" />
                  إضافة مادة
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>النوع</TableHead>
                      <TableHead>الوصف</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>تقديري/فعلي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {materials.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          لم يتم إضافة مواد بعد
                        </TableCell>
                      </TableRow>
                    ) : (
                      materials.map((m: any) => (
                        <TableRow key={m.id}>
                          <TableCell>
                            <Badge variant="outline">
                              {m.material_type === 'gold' ? 'ذهب' :
                               m.material_type === 'gemstone' ? 'حجر كريم' :
                               m.material_type === 'raw_material' ? 'خامة' : 'أخرى'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {m.material_type === 'gold' 
                              ? `${m.gold_weight_grams} جم - ${m.gold_karats?.karat_name || ''}`
                              : m.material_type === 'gemstone'
                              ? m.gemstone_inventory?.stone_code
                              : m.description}
                          </TableCell>
                          <TableCell>{m.quantity} {m.unit}</TableCell>
                          <TableCell>{m.total_cost?.toLocaleString()} ر.س</TableCell>
                          <TableCell>
                            <Badge variant={m.is_estimated ? 'secondary' : 'default'}>
                              {m.is_estimated ? 'تقديري' : 'فعلي'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Labor Tab */}
          <TabsContent value="labor">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>سجل العمالة</CardTitle>
                <Button size="sm" onClick={() => setLaborDialogOpen(true)}>
                  <Plus className="w-4 h-4 ml-2" />
                  إضافة عمالة
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>المرحلة</TableHead>
                      <TableHead>العامل</TableHead>
                      <TableHead>الساعات</TableHead>
                      <TableHead>سعر الساعة</TableHead>
                      <TableHead>الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {laborRecords.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          لم يتم تسجيل عمالة بعد
                        </TableCell>
                      </TableRow>
                    ) : (
                      laborRecords.map((l: any) => (
                        <TableRow key={l.id}>
                          <TableCell>
                            {format(new Date(l.work_date), 'dd/MM/yyyy', { locale: ar })}
                          </TableCell>
                          <TableCell>{l.production_stages?.stage_name || '-'}</TableCell>
                          <TableCell>{l.worker_name}</TableCell>
                          <TableCell>{l.hours_worked} ساعة</TableCell>
                          <TableCell>{l.hourly_rate} ر.س</TableCell>
                          <TableCell className="font-medium">{l.total_cost?.toLocaleString()} ر.س</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Direct Costs Tab */}
          <TabsContent value="direct-costs">
            <DirectCostsTab workOrderId={id!} workOrderStatus={workOrder.status} />
          </TabsContent>

          {/* Partial Completions Tab */}
          <TabsContent value="partial-completions">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>سجل الإنتاج الجزئي</CardTitle>
                  <CardDescription>
                    المكتمل: {workOrder.completed_quantity || 0} / {workOrder.quantity} قطعة | 
                    الوزن: {workOrder.completed_weight?.toFixed(2) || 0} / {workOrder.gold_weight_required} جم
                  </CardDescription>
                </div>
                {workOrder.status === 'in_progress' && (workOrder.completed_quantity || 0) < workOrder.quantity && (
                  <Button onClick={() => setPartialCompletionOpen(true)}>
                    <Plus className="w-4 h-4 ml-2" />
                    تسجيل إنتاج جزئي
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {partialCompletions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    لا توجد دفعات إنتاج جزئي
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>رقم الدفعة</TableHead>
                        <TableHead>الكمية</TableHead>
                        <TableHead>الوزن</TableHead>
                        <TableHead>التكلفة المخصصة</TableHead>
                        <TableHead>التاريخ</TableHead>
                        <TableHead>بواسطة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {partialCompletions.map((pc: any) => (
                        <TableRow key={pc.id}>
                          <TableCell className="font-medium">{pc.completion_number}</TableCell>
                          <TableCell>{pc.quantity_completed} قطعة</TableCell>
                          <TableCell>{pc.weight_completed?.toFixed(2)} جم</TableCell>
                          <TableCell>{pc.cost_allocated?.toLocaleString()} ر.س</TableCell>
                          <TableCell>{format(new Date(pc.created_at), 'yyyy/MM/dd', { locale: ar })}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{pc.completed_by}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Journal Entries Tab */}
          <TabsContent value="journal-entries">
            <Card>
              <CardHeader>
                <CardTitle>القيود المحاسبية</CardTitle>
                <CardDescription>جميع القيود المرتبطة بأمر الإنتاج هذا</CardDescription>
              </CardHeader>
              <CardContent>
                {journalEntries.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    لا توجد قيود محاسبية مرتبطة
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>رقم القيد</TableHead>
                        <TableHead>الوصف</TableHead>
                        <TableHead>القيمة</TableHead>
                        <TableHead>التاريخ</TableHead>
                        <TableHead>الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {journalEntries.map((je: any) => (
                        <TableRow key={je.id}>
                          <TableCell className="font-medium">{je.entry_number}</TableCell>
                          <TableCell>{je.description}</TableCell>
                          <TableCell>{je.total_debit?.toLocaleString()} ر.س</TableCell>
                          <TableCell>{format(new Date(je.entry_date), 'yyyy/MM/dd', { locale: ar })}</TableCell>
                          <TableCell>
                            <Badge variant={je.is_posted ? 'default' : 'secondary'}>
                              {je.is_posted ? 'مرحّل' : 'مسودة'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Cost Breakdown Tab */}
          <TabsContent value="breakdown">
            <Card>
              <CardHeader>
                <CardTitle>تحليل التكلفة التفصيلي</CardTitle>
                <CardDescription>مقارنة بين التكلفة التقديرية والفعلية</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>البند</TableHead>
                      <TableHead className="text-center">تقديري</TableHead>
                      <TableHead className="text-center">فعلي</TableHead>
                      <TableHead className="text-center">الفرق</TableHead>
                      <TableHead className="text-center">النسبة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">الذهب</TableCell>
                      <TableCell className="text-center">{(workOrder.estimated_gold_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-center">{(workOrder.actual_gold_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className={`text-center ${(workOrder.actual_gold_cost || 0) - (workOrder.estimated_gold_cost || 0) > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {((workOrder.actual_gold_cost || 0) - (workOrder.estimated_gold_cost || 0)).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {workOrder.estimated_gold_cost ? 
                          (((workOrder.actual_gold_cost || 0) - (workOrder.estimated_gold_cost || 0)) / workOrder.estimated_gold_cost * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">الأحجار الكريمة</TableCell>
                      <TableCell className="text-center">{(workOrder.estimated_gemstone_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-center">{(workOrder.actual_gemstone_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className={`text-center ${(workOrder.actual_gemstone_cost || 0) - (workOrder.estimated_gemstone_cost || 0) > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {((workOrder.actual_gemstone_cost || 0) - (workOrder.estimated_gemstone_cost || 0)).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {workOrder.estimated_gemstone_cost ? 
                          (((workOrder.actual_gemstone_cost || 0) - (workOrder.estimated_gemstone_cost || 0)) / workOrder.estimated_gemstone_cost * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">العمالة</TableCell>
                      <TableCell className="text-center">{(workOrder.estimated_labor_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-center">{(workOrder.actual_labor_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className={`text-center ${(workOrder.actual_labor_cost || 0) - (workOrder.estimated_labor_cost || 0) > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {((workOrder.actual_labor_cost || 0) - (workOrder.estimated_labor_cost || 0)).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {workOrder.estimated_labor_cost ? 
                          (((workOrder.actual_labor_cost || 0) - (workOrder.estimated_labor_cost || 0)) / workOrder.estimated_labor_cost * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">أخرى</TableCell>
                      <TableCell className="text-center">{(workOrder.estimated_other_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-center">{(workOrder.actual_other_cost || 0).toLocaleString()}</TableCell>
                      <TableCell className={`text-center ${(workOrder.actual_other_cost || 0) - (workOrder.estimated_other_cost || 0) > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {((workOrder.actual_other_cost || 0) - (workOrder.estimated_other_cost || 0)).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {workOrder.estimated_other_cost ? 
                          (((workOrder.actual_other_cost || 0) - (workOrder.estimated_other_cost || 0)) / workOrder.estimated_other_cost * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                    <TableRow className="font-bold bg-muted/50">
                      <TableCell>الإجمالي</TableCell>
                      <TableCell className="text-center">{totalEstimatedCost.toLocaleString()}</TableCell>
                      <TableCell className="text-center">{totalActualCost.toLocaleString()}</TableCell>
                      <TableCell className={`text-center ${costVariance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {costVariance.toLocaleString()}
                      </TableCell>
                      <TableCell className={`text-center ${variancePercentage > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {variancePercentage.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Add Material Dialog */}
        <Dialog open={materialDialogOpen} onOpenChange={setMaterialDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إضافة مادة</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>نوع المادة</Label>
                <Select value={materialType} onValueChange={(v: any) => setMaterialType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gold">ذهب</SelectItem>
                    <SelectItem value="gemstone">حجر كريم</SelectItem>
                    <SelectItem value="raw_material">خامة</SelectItem>
                    <SelectItem value="other">أخرى</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {materialType === 'gold' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>الوزن (جم)</Label>
                      <Input
                        type="number"
                        value={materialForm.gold_weight_grams}
                        onChange={(e) => setMaterialForm({ ...materialForm, gold_weight_grams: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>العيار</Label>
                      <Select
                        value={materialForm.gold_karat_id}
                        onValueChange={(v) => setMaterialForm({ ...materialForm, gold_karat_id: v })}
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
                  </div>
                  <div className="space-y-2">
                    <Label>التكلفة</Label>
                    <Input
                      type="number"
                      value={materialForm.gold_cost}
                      onChange={(e) => setMaterialForm({ 
                        ...materialForm, 
                        gold_cost: parseFloat(e.target.value) || 0,
                        total_cost: parseFloat(e.target.value) || 0 
                      })}
                    />
                  </div>
                </>
              )}

              {materialType === 'gemstone' && (
                <div className="space-y-2">
                  <Label>الحجر الكريم</Label>
                  <Select
                    value={materialForm.gemstone_id}
                    onValueChange={(v) => {
                      const gem = gemstones.find((g: any) => g.id === v);
                      setMaterialForm({ 
                        ...materialForm, 
                        gemstone_id: v,
                        gemstone_cost: gem?.purchase_price || 0,
                        total_cost: gem?.purchase_price || 0
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الحجر" />
                    </SelectTrigger>
                    <SelectContent>
                      {gemstones.map((g: any) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.stone_code} - {g.gemstone_types?.type_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(materialType === 'raw_material' || materialType === 'other') && (
                <>
                  <div className="space-y-2">
                    <Label>الوصف</Label>
                    <Input
                      value={materialForm.description}
                      onChange={(e) => setMaterialForm({ ...materialForm, description: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>الكمية</Label>
                      <Input
                        type="number"
                        value={materialForm.quantity}
                        onChange={(e) => {
                          const qty = parseFloat(e.target.value) || 0;
                          setMaterialForm({ 
                            ...materialForm, 
                            quantity: qty,
                            total_cost: qty * materialForm.unit_cost
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>الوحدة</Label>
                      <Input
                        value={materialForm.unit}
                        onChange={(e) => setMaterialForm({ ...materialForm, unit: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>سعر الوحدة</Label>
                      <Input
                        type="number"
                        value={materialForm.unit_cost}
                        onChange={(e) => {
                          const cost = parseFloat(e.target.value) || 0;
                          setMaterialForm({ 
                            ...materialForm, 
                            unit_cost: cost,
                            total_cost: materialForm.quantity * cost
                          });
                        }}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_estimated"
                  checked={materialForm.is_estimated}
                  onChange={(e) => setMaterialForm({ ...materialForm, is_estimated: e.target.checked })}
                />
                <Label htmlFor="is_estimated">تكلفة تقديرية</Label>
              </div>

              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">إجمالي التكلفة</p>
                <p className="text-xl font-bold">{materialForm.total_cost.toLocaleString()} ر.س</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMaterialDialogOpen(false)}>إلغاء</Button>
              <Button onClick={() => addMaterialMutation.mutate()} disabled={addMaterialMutation.isPending}>
                {addMaterialMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                إضافة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Labor Dialog */}
        <Dialog open={laborDialogOpen} onOpenChange={setLaborDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إضافة عمالة</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>اسم العامل</Label>
                  <Input
                    value={laborForm.worker_name}
                    onChange={(e) => setLaborForm({ ...laborForm, worker_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>المرحلة</Label>
                  <Select
                    value={laborForm.stage_id}
                    onValueChange={(v) => setLaborForm({ ...laborForm, stage_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر المرحلة" />
                    </SelectTrigger>
                    <SelectContent>
                      {stages.map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.stage_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>نوع العمل</Label>
                <Input
                  value={laborForm.labor_type}
                  onChange={(e) => setLaborForm({ ...laborForm, labor_type: e.target.value })}
                  placeholder="مثال: تجميع، تلميع، ترصيع..."
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>الساعات</Label>
                  <Input
                    type="number"
                    value={laborForm.hours_worked}
                    onChange={(e) => setLaborForm({ ...laborForm, hours_worked: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>سعر الساعة</Label>
                  <Input
                    type="number"
                    value={laborForm.hourly_rate}
                    onChange={(e) => setLaborForm({ ...laborForm, hourly_rate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>التاريخ</Label>
                  <Input
                    type="date"
                    value={laborForm.work_date}
                    onChange={(e) => setLaborForm({ ...laborForm, work_date: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Textarea
                  value={laborForm.notes}
                  onChange={(e) => setLaborForm({ ...laborForm, notes: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">إجمالي التكلفة</p>
                <p className="text-xl font-bold">
                  {(laborForm.hours_worked * laborForm.hourly_rate).toLocaleString()} ر.س
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLaborDialogOpen(false)}>إلغاء</Button>
              <Button onClick={() => addLaborMutation.mutate()} disabled={addLaborMutation.isPending}>
                {addLaborMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                إضافة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Partial Completion Dialog */}
        <PartialCompletionDialog
          open={partialCompletionOpen}
          onOpenChange={setPartialCompletionOpen}
          workOrder={{
            id: workOrder.id,
            order_number: workOrder.order_number,
            quantity: workOrder.quantity,
            gold_weight_required: workOrder.gold_weight_required,
            completed_quantity: workOrder.completed_quantity,
            completed_weight: workOrder.completed_weight,
            cost_center_id: workOrder.cost_center_id,
            branch_id: workOrder.branch_id,
          }}
        />
      </div>
    </MainLayout>
  );
}
