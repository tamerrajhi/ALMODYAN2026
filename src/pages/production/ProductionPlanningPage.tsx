import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
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
  Plus,
  Calendar,
  Loader2,
  Search,
  Play,
  CheckCircle2,
  XCircle,
  FileText,
  Target,
  LayoutList,
  Eye,
} from 'lucide-react';
import { logAudit } from '@/lib/audit';
import * as apiClient from '@/lib/apiClient';

interface ProductionPlan {
  id: string;
  plan_number: string;
  plan_name: string;
  branch_id: string;
  start_date: string;
  end_date: string;
  status: string;
  total_orders: number;
  completed_orders: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  branches?: { branch_name: string } | null;
}

interface WorkOrder {
  id: string;
  order_number: string;
  product_description: string | null;
  quantity: number;
  status: string;
  priority: string;
  gold_weight_required: number;
  gold_karats?: { karat_name: string } | null;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'مسودة', variant: 'secondary' },
  active: { label: 'نشطة', variant: 'default' },
  completed: { label: 'مكتملة', variant: 'outline' },
  cancelled: { label: 'ملغية', variant: 'destructive' },
};

export default function ProductionPlanningPage() {
  const { user } = useAuth();
  const { isRTL } = useLanguage();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<ProductionPlan | null>(null);
  const [formData, setFormData] = useState({
    plan_name: '',
    branch_id: '',
    start_date: format(new Date(), 'yyyy-MM-dd'),
    end_date: format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
    notes: '',
  });

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['production-plans'],
    queryFn: async () => {
      const res = await fetch('/api/production-plans-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch production plans');
      return (await res.json()) as ProductionPlan[];
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await apiClient.get<any[]>('/api/active-branches');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: availableOrders = [] } = useQuery({
    queryKey: ['available-work-orders'],
    queryFn: async () => {
      const res = await fetch('/api/work-orders-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch work orders');
      return (await res.json()) as WorkOrder[];
    },
  });

  const { data: planItems = [] } = useQuery({
    queryKey: ['plan-items', selectedPlan?.id],
    queryFn: async () => {
      if (!selectedPlan) return [];
      const res = await fetch(`/api/production-plan-items/${selectedPlan.id}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch plan items');
      return await res.json();
    },
    enabled: !!selectedPlan,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      forbidDirectWrite('insert', 'ProductionPlanningPage.tsx:164');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-plans'] });
      setDialogOpen(false);
      resetForm();
      toast.success('تم إنشاء خطة الإنتاج بنجاح');
    },
    onError: (error) => {
      toast.error('فشل في إنشاء خطة الإنتاج');
      console.error(error);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ planId, status }: { planId: string; status: string }) => {
      forbidDirectWrite('update', 'ProductionPlanningPage.tsx:201');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-plans'] });
      toast.success('تم تحديث حالة الخطة');
    },
  });

  const addOrderMutation = useMutation({
    mutationFn: async ({ planId, orderId }: { planId: string; orderId: string }) => {
      forbidDirectWrite('insert', 'ProductionPlanningPage.tsx:216');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-items'] });
      queryClient.invalidateQueries({ queryKey: ['production-plans'] });
      queryClient.invalidateQueries({ queryKey: ['available-work-orders'] });
      toast.success('تم إضافة أمر العمل للخطة');
    },
  });

  const resetForm = () => {
    setFormData({
      plan_name: '',
      branch_id: '',
      start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
      notes: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.plan_name || !formData.branch_id) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    createMutation.mutate(formData);
  };

  const filteredPlans = plans.filter(p =>
    p.plan_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.plan_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: plans.length,
    draft: plans.filter(p => p.status === 'draft').length,
    active: plans.filter(p => p.status === 'active').length,
    completed: plans.filter(p => p.status === 'completed').length,
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">تخطيط الإنتاج</h1>
            <p className="text-muted-foreground">إدارة خطط الإنتاج وجدولة أوامر العمل</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 ml-2" />
            خطة إنتاج جديدة
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <LayoutList className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">إجمالي الخطط</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-yellow-500/10">
                  <FileText className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.draft}</p>
                  <p className="text-xs text-muted-foreground">مسودات</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Play className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.active}</p>
                  <p className="text-xs text-muted-foreground">نشطة</p>
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
                  <p className="text-2xl font-bold">{stats.completed}</p>
                  <p className="text-xs text-muted-foreground">مكتملة</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="البحث في الخطط..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-10"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>خطط الإنتاج</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="responsive-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الخطة</TableHead>
                  <TableHead>اسم الخطة</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead>تاريخ البدء</TableHead>
                  <TableHead>تاريخ الانتهاء</TableHead>
                  <TableHead>الأوامر</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPlans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      لا توجد خطط إنتاج
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPlans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-mono">{plan.plan_number}</TableCell>
                      <TableCell className="font-medium">{plan.plan_name}</TableCell>
                      <TableCell>{plan.branches?.branch_name}</TableCell>
                      <TableCell>
                        {format(new Date(plan.start_date), 'dd/MM/yyyy', { locale: ar })}
                      </TableCell>
                      <TableCell>
                        {format(new Date(plan.end_date), 'dd/MM/yyyy', { locale: ar })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {plan.completed_orders}/{plan.total_orders}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusConfig[plan.status]?.variant || 'secondary'}>
                          {statusConfig[plan.status]?.label || plan.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedPlan(plan);
                              setDetailsDialogOpen(true);
                            }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {plan.status === 'draft' && (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => updateStatusMutation.mutate({ planId: plan.id, status: 'active' })}
                            >
                              <Play className="w-4 h-4" />
                            </Button>
                          )}
                          {plan.status === 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateStatusMutation.mutate({ planId: plan.id, status: 'completed' })}
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>خطة إنتاج جديدة</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>اسم الخطة *</Label>
                <Input
                  value={formData.plan_name}
                  onChange={(e) => setFormData({ ...formData, plan_name: e.target.value })}
                  placeholder="مثال: خطة إنتاج يناير 2025"
                />
              </div>

              <div className="space-y-2">
                <Label>الفرع *</Label>
                <Select
                  value={formData.branch_id}
                  onValueChange={(v) => setFormData({ ...formData, branch_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الفرع" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch: any) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>تاريخ البدء</Label>
                  <Input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>تاريخ الانتهاء</Label>
                  <Input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="ملاحظات إضافية..."
                  rows={3}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  إلغاء
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                  إنشاء الخطة
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>تفاصيل الخطة: {selectedPlan?.plan_name}</DialogTitle>
            </DialogHeader>
            
            {selectedPlan && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-xs text-muted-foreground">رقم الخطة</p>
                    <p className="font-mono">{selectedPlan.plan_number}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الفرع</p>
                    <p>{selectedPlan.branches?.branch_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الفترة</p>
                    <p>
                      {format(new Date(selectedPlan.start_date), 'dd/MM')} - {format(new Date(selectedPlan.end_date), 'dd/MM/yyyy')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">التقدم</p>
                    <p>{selectedPlan.completed_orders}/{selectedPlan.total_orders} أوامر</p>
                  </div>
                </div>

                {selectedPlan.status === 'draft' && (
                  <div className="space-y-2">
                    <Label>إضافة أمر عمل</Label>
                    <div className="flex gap-2">
                      <Select
                        onValueChange={(orderId) => {
                          if (selectedPlan) {
                            addOrderMutation.mutate({ planId: selectedPlan.id, orderId });
                          }
                        }}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="اختر أمر عمل لإضافته" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableOrders.map((order) => (
                            <SelectItem key={order.id} value={order.id}>
                              {order.order_number} - {order.product_description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="font-medium mb-3">أوامر العمل في الخطة</h4>
                  <div className="responsive-table-wrapper">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>رقم الأمر</TableHead>
                        <TableHead>الوصف</TableHead>
                        <TableHead>الكمية</TableHead>
                        <TableHead>وزن الذهب</TableHead>
                        <TableHead>الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">
                            لا توجد أوامر في هذه الخطة
                          </TableCell>
                        </TableRow>
                      ) : (
                        planItems.map((item: any, index: number) => (
                          <TableRow key={item.id}>
                            <TableCell>{index + 1}</TableCell>
                            <TableCell className="font-mono">{item.work_orders?.order_number}</TableCell>
                            <TableCell>{item.work_orders?.product_description}</TableCell>
                            <TableCell>{item.work_orders?.quantity}</TableCell>
                            <TableCell>{item.work_orders?.gold_weight_required} جم</TableCell>
                            <TableCell>
                              <Badge variant={item.work_orders?.status === 'completed' ? 'default' : 'secondary'}>
                                {item.work_orders?.status === 'completed' ? 'مكتمل' : 'قيد التنفيذ'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
