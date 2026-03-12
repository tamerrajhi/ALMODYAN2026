import { useState, useMemo } from 'react';
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
  Plus,
  Loader2,
  Search,
  AlertTriangle,
  TrendingDown,
  BarChart3,
  CheckCircle,
  XCircle,
  Filter,
} from 'lucide-react';
import { logAudit } from '@/lib/audit';

interface ProductionLoss {
  id: string;
  loss_code: string;
  work_order_id: string | null;
  branch_id: string;
  loss_type: string;
  loss_date: string;
  gold_weight_grams: number;
  gold_value: number;
  gemstone_carat: number;
  gemstone_value: number;
  material_description: string | null;
  material_value: number;
  labor_hours: number;
  labor_value: number;
  total_loss_value: number;
  reason: string;
  preventive_action: string | null;
  recorded_by: string | null;
  status: string;
  created_at: string;
  work_orders?: { order_number: string } | null;
  branches?: { branch_name: string } | null;
  gold_karats?: { karat_name: string } | null;
}

interface EfficiencyLog {
  id: string;
  work_order_id: string | null;
  branch_id: string;
  log_date: string;
  planned_hours: number;
  actual_hours: number;
  efficiency_percentage: number;
  units_planned: number;
  units_completed: number;
  units_defective: number;
  quality_rate: number;
  recorded_by: string | null;
  work_orders?: { order_number: string } | null;
  branches?: { branch_name: string } | null;
  production_stages?: { stage_name: string } | null;
}

const lossTypeLabels: Record<string, string> = {
  gold: 'ذهب',
  gemstone: 'حجر كريم',
  material: 'خامة',
  labor: 'عمالة',
  defect: 'عيب تصنيع',
};

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  pending: { label: 'قيد المراجعة', variant: 'secondary' },
  approved: { label: 'معتمد', variant: 'default' },
  rejected: { label: 'مرفوض', variant: 'destructive' },
};

export default function ProductionLossReportPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [efficiencyDialogOpen, setEfficiencyDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    work_order_id: '',
    branch_id: '',
    loss_type: 'gold' as const,
    loss_date: format(new Date(), 'yyyy-MM-dd'),
    gold_weight_grams: 0,
    gold_karat_id: '',
    gold_value: 0,
    gemstone_carat: 0,
    gemstone_value: 0,
    material_description: '',
    material_value: 0,
    labor_hours: 0,
    labor_value: 0,
    reason: '',
    preventive_action: '',
  });
  const [efficiencyForm, setEfficiencyForm] = useState({
    work_order_id: '',
    branch_id: '',
    stage_id: '',
    log_date: format(new Date(), 'yyyy-MM-dd'),
    planned_hours: 0,
    actual_hours: 0,
    units_planned: 0,
    units_completed: 0,
    units_defective: 0,
    notes: '',
  });

  // Fetch production losses
  const { data: losses = [], isLoading } = useQuery({
    queryKey: ['production-losses'],
    queryFn: async () => {
      const res = await fetch('/api/production-losses-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json() as ProductionLoss[];
    },
  });

  // Fetch efficiency logs
  const { data: efficiencyLogs = [] } = useQuery({
    queryKey: ['efficiency-logs'],
    queryFn: async () => {
      const res = await fetch('/api/efficiency-logs-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json() as EfficiencyLog[];
    },
  });

  // Fetch work orders
  const { data: workOrders = [] } = useQuery({
    queryKey: ['work-orders'],
    queryFn: async () => {
      const res = await fetch('/api/work-orders-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  // Fetch karats
  const { data: karats = [] } = useQuery({
    queryKey: ['gold-karats'],
    queryFn: async () => {
      const res = await fetch('/api/gold-karats-active', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  // Fetch stages
  const { data: stages = [] } = useQuery({
    queryKey: ['production-stages'],
    queryFn: async () => {
      const res = await fetch('/api/production-stages', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  // Create loss mutation
  const createLossMutation = useMutation({
    mutationFn: async () => {
      forbidDirectWrite('insert', 'ProductionLossReportPage.tsx:239');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-losses'] });
      setDialogOpen(false);
      resetForm();
      toast.success('تم تسجيل الفاقد بنجاح');
    },
    onError: (error) => {
      toast.error('فشل في تسجيل الفاقد');
      console.error(error);
    },
  });

  // Create efficiency log mutation
  const createEfficiencyMutation = useMutation({
    mutationFn: async () => {
      forbidDirectWrite('insert', 'ProductionLossReportPage.tsx:294');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['efficiency-logs'] });
      setEfficiencyDialogOpen(false);
      resetEfficiencyForm();
      toast.success('تم تسجيل بيانات الكفاءة');
    },
    onError: (error) => {
      toast.error('فشل في تسجيل البيانات');
      console.error(error);
    },
  });

  // Update loss status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      forbidDirectWrite('update', 'ProductionLossReportPage.tsx:328');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-losses'] });
      toast.success('تم تحديث الحالة');
    },
  });

  const resetForm = () => {
    setFormData({
      work_order_id: '',
      branch_id: '',
      loss_type: 'gold',
      loss_date: format(new Date(), 'yyyy-MM-dd'),
      gold_weight_grams: 0,
      gold_karat_id: '',
      gold_value: 0,
      gemstone_carat: 0,
      gemstone_value: 0,
      material_description: '',
      material_value: 0,
      labor_hours: 0,
      labor_value: 0,
      reason: '',
      preventive_action: '',
    });
  };

  const resetEfficiencyForm = () => {
    setEfficiencyForm({
      work_order_id: '',
      branch_id: '',
      stage_id: '',
      log_date: format(new Date(), 'yyyy-MM-dd'),
      planned_hours: 0,
      actual_hours: 0,
      units_planned: 0,
      units_completed: 0,
      units_defective: 0,
      notes: '',
    });
  };

  // Filter losses
  const filteredLosses = useMemo(() => {
    return losses.filter(loss => {
      const matchesSearch = loss.loss_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        loss.reason.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = filterType === 'all' || loss.loss_type === filterType;
      const matchesStatus = filterStatus === 'all' || loss.status === filterStatus;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [losses, searchTerm, filterType, filterStatus]);

  // Statistics
  const stats = useMemo(() => {
    const totalLoss = losses.reduce((sum, l) => sum + (l.total_loss_value || 0), 0);
    const goldLoss = losses.filter(l => l.loss_type === 'gold').reduce((sum, l) => sum + (l.gold_value || 0), 0);
    const avgEfficiency = efficiencyLogs.length > 0 
      ? efficiencyLogs.reduce((sum, e) => sum + (e.efficiency_percentage || 0), 0) / efficiencyLogs.length 
      : 0;
    const avgQuality = efficiencyLogs.length > 0
      ? efficiencyLogs.reduce((sum, e) => sum + (e.quality_rate || 0), 0) / efficiencyLogs.length
      : 0;

    return {
      totalLoss,
      goldLoss,
      pendingCount: losses.filter(l => l.status === 'pending').length,
      avgEfficiency,
      avgQuality,
    };
  }, [losses, efficiencyLogs]);

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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">تقارير الفاقد والكفاءة</h1>
            <p className="text-muted-foreground">تتبع الفواقد وقياس كفاءة الإنتاج</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEfficiencyDialogOpen(true)}>
              <BarChart3 className="w-4 h-4 ml-2" />
              تسجيل كفاءة
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 ml-2" />
              تسجيل فاقد
            </Button>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <TrendingDown className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalLoss.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">إجمالي الفاقد (ر.س)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-yellow-500/10">
                  <AlertTriangle className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.goldLoss.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">فاقد الذهب (ر.س)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <AlertTriangle className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.pendingCount}</p>
                  <p className="text-xs text-muted-foreground">قيد المراجعة</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <BarChart3 className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.avgEfficiency.toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground">متوسط الكفاءة</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <CheckCircle className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.avgQuality.toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground">معدل الجودة</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="losses" className="space-y-4">
          <TabsList>
            <TabsTrigger value="losses">سجل الفواقد</TabsTrigger>
            <TabsTrigger value="efficiency">سجل الكفاءة</TabsTrigger>
          </TabsList>

          {/* Losses Tab */}
          <TabsContent value="losses">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between gap-4">
                  <CardTitle>سجل الفواقد</CardTitle>
                  <div className="flex gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        placeholder="بحث..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pr-10"
                      />
                    </div>
                    <Select value={filterType} onValueChange={setFilterType}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="النوع" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">جميع الأنواع</SelectItem>
                        <SelectItem value="gold">ذهب</SelectItem>
                        <SelectItem value="gemstone">حجر كريم</SelectItem>
                        <SelectItem value="material">خامة</SelectItem>
                        <SelectItem value="labor">عمالة</SelectItem>
                        <SelectItem value="defect">عيب تصنيع</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="الحالة" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">جميع الحالات</SelectItem>
                        <SelectItem value="pending">قيد المراجعة</SelectItem>
                        <SelectItem value="approved">معتمد</SelectItem>
                        <SelectItem value="rejected">مرفوض</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الكود</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>أمر العمل</TableHead>
                      <TableHead>الفرع</TableHead>
                      <TableHead>القيمة</TableHead>
                      <TableHead>السبب</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLosses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          لا توجد سجلات فاقد
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredLosses.map((loss) => (
                        <TableRow key={loss.id}>
                          <TableCell className="font-mono">{loss.loss_code}</TableCell>
                          <TableCell>
                            {format(new Date(loss.loss_date), 'dd/MM/yyyy', { locale: ar })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{lossTypeLabels[loss.loss_type]}</Badge>
                          </TableCell>
                          <TableCell>{loss.work_orders?.order_number || '-'}</TableCell>
                          <TableCell>{loss.branches?.branch_name}</TableCell>
                          <TableCell className="font-medium text-destructive">
                            {loss.total_loss_value.toLocaleString()} ر.س
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">{loss.reason}</TableCell>
                          <TableCell>
                            <Badge variant={statusLabels[loss.status]?.variant || 'secondary'}>
                              {statusLabels[loss.status]?.label || loss.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {loss.status === 'pending' && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-green-600"
                                  onClick={() => updateStatusMutation.mutate({ id: loss.id, status: 'approved' })}
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive"
                                  onClick={() => updateStatusMutation.mutate({ id: loss.id, status: 'rejected' })}
                                >
                                  <XCircle className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Efficiency Tab */}
          <TabsContent value="efficiency">
            <Card>
              <CardHeader>
                <CardTitle>سجل الكفاءة</CardTitle>
                <CardDescription>متابعة كفاءة الإنتاج ومعدلات الجودة</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>أمر العمل</TableHead>
                      <TableHead>المرحلة</TableHead>
                      <TableHead>الساعات المخططة</TableHead>
                      <TableHead>الساعات الفعلية</TableHead>
                      <TableHead>الكفاءة</TableHead>
                      <TableHead>الوحدات</TableHead>
                      <TableHead>العيوب</TableHead>
                      <TableHead>الجودة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {efficiencyLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          لا توجد سجلات كفاءة
                        </TableCell>
                      </TableRow>
                    ) : (
                      efficiencyLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            {format(new Date(log.log_date), 'dd/MM/yyyy', { locale: ar })}
                          </TableCell>
                          <TableCell>{log.work_orders?.order_number || '-'}</TableCell>
                          <TableCell>{log.production_stages?.stage_name || '-'}</TableCell>
                          <TableCell>{log.planned_hours}</TableCell>
                          <TableCell>{log.actual_hours}</TableCell>
                          <TableCell>
                            <Badge variant={log.efficiency_percentage >= 90 ? 'default' : log.efficiency_percentage >= 70 ? 'secondary' : 'destructive'}>
                              {log.efficiency_percentage.toFixed(1)}%
                            </Badge>
                          </TableCell>
                          <TableCell>{log.units_completed}/{log.units_planned}</TableCell>
                          <TableCell className="text-destructive">{log.units_defective}</TableCell>
                          <TableCell>
                            <Badge variant={log.quality_rate >= 95 ? 'default' : log.quality_rate >= 85 ? 'secondary' : 'destructive'}>
                              {log.quality_rate.toFixed(1)}%
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
        </Tabs>

        {/* Add Loss Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>تسجيل فاقد إنتاج</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
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
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>أمر العمل</Label>
                  <Select
                    value={formData.work_order_id}
                    onValueChange={(v) => setFormData({ ...formData, work_order_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختياري" />
                    </SelectTrigger>
                    <SelectContent>
                      {workOrders.map((wo) => (
                        <SelectItem key={wo.id} value={wo.id}>{wo.order_number}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>نوع الفاقد *</Label>
                  <Select
                    value={formData.loss_type}
                    onValueChange={(v: any) => setFormData({ ...formData, loss_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gold">ذهب</SelectItem>
                      <SelectItem value="gemstone">حجر كريم</SelectItem>
                      <SelectItem value="material">خامة</SelectItem>
                      <SelectItem value="labor">عمالة</SelectItem>
                      <SelectItem value="defect">عيب تصنيع</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>التاريخ</Label>
                  <Input
                    type="date"
                    value={formData.loss_date}
                    onChange={(e) => setFormData({ ...formData, loss_date: e.target.value })}
                  />
                </div>
              </div>

              {formData.loss_type === 'gold' && (
                <div className="space-y-4 p-3 bg-muted/50 rounded-lg">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>الوزن (جم)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.gold_weight_grams}
                        onChange={(e) => setFormData({ ...formData, gold_weight_grams: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>العيار</Label>
                      <Select
                        value={formData.gold_karat_id}
                        onValueChange={(v) => setFormData({ ...formData, gold_karat_id: v })}
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
                    <Label>القيمة (ر.س)</Label>
                    <Input
                      type="number"
                      value={formData.gold_value}
                      onChange={(e) => setFormData({ ...formData, gold_value: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              )}

              {(formData.loss_type as string) === 'gemstone' && (
                <div className="space-y-4 p-3 bg-muted/50 rounded-lg">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>القيراط</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.gemstone_carat}
                        onChange={(e) => setFormData({ ...formData, gemstone_carat: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>القيمة (ر.س)</Label>
                      <Input
                        type="number"
                        value={formData.gemstone_value}
                        onChange={(e) => setFormData({ ...formData, gemstone_value: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {(formData.loss_type as string) === 'material' && (
                <div className="space-y-4 p-3 bg-muted/50 rounded-lg">
                  <div className="space-y-2">
                    <Label>وصف المادة</Label>
                    <Input
                      value={formData.material_description}
                      onChange={(e) => setFormData({ ...formData, material_description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>القيمة (ر.س)</Label>
                    <Input
                      type="number"
                      value={formData.material_value}
                      onChange={(e) => setFormData({ ...formData, material_value: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              )}

              {(formData.loss_type as string) === 'labor' && (
                <div className="space-y-4 p-3 bg-muted/50 rounded-lg">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>الساعات الضائعة</Label>
                      <Input
                        type="number"
                        value={formData.labor_hours}
                        onChange={(e) => setFormData({ ...formData, labor_hours: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>قيمة الساعات (ر.س)</Label>
                      <Input
                        type="number"
                        value={formData.labor_value}
                        onChange={(e) => setFormData({ ...formData, labor_value: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>السبب *</Label>
                <Textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="اشرح سبب الفاقد..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>الإجراء الوقائي</Label>
                <Textarea
                  value={formData.preventive_action}
                  onChange={(e) => setFormData({ ...formData, preventive_action: e.target.value })}
                  placeholder="ما الإجراءات لمنع تكرار هذا الفاقد؟"
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
              <Button 
                onClick={() => createLossMutation.mutate()} 
                disabled={createLossMutation.isPending || !formData.branch_id || !formData.reason}
              >
                {createLossMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                تسجيل
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Efficiency Dialog */}
        <Dialog open={efficiencyDialogOpen} onOpenChange={setEfficiencyDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>تسجيل بيانات الكفاءة</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>الفرع *</Label>
                  <Select
                    value={efficiencyForm.branch_id}
                    onValueChange={(v) => setEfficiencyForm({ ...efficiencyForm, branch_id: v })}
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
                <div className="space-y-2">
                  <Label>التاريخ</Label>
                  <Input
                    type="date"
                    value={efficiencyForm.log_date}
                    onChange={(e) => setEfficiencyForm({ ...efficiencyForm, log_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>أمر العمل</Label>
                  <Select
                    value={efficiencyForm.work_order_id}
                    onValueChange={(v) => setEfficiencyForm({ ...efficiencyForm, work_order_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختياري" />
                    </SelectTrigger>
                    <SelectContent>
                      {workOrders.map((wo) => (
                        <SelectItem key={wo.id} value={wo.id}>{wo.order_number}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>المرحلة</Label>
                  <Select
                    value={efficiencyForm.stage_id}
                    onValueChange={(v) => setEfficiencyForm({ ...efficiencyForm, stage_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختياري" />
                    </SelectTrigger>
                    <SelectContent>
                      {stages.map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.stage_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>الساعات المخططة</Label>
                  <Input
                    type="number"
                    value={efficiencyForm.planned_hours}
                    onChange={(e) => setEfficiencyForm({ ...efficiencyForm, planned_hours: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>الساعات الفعلية</Label>
                  <Input
                    type="number"
                    value={efficiencyForm.actual_hours}
                    onChange={(e) => setEfficiencyForm({ ...efficiencyForm, actual_hours: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>الوحدات المخططة</Label>
                  <Input
                    type="number"
                    value={efficiencyForm.units_planned}
                    onChange={(e) => setEfficiencyForm({ ...efficiencyForm, units_planned: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>الوحدات المنجزة</Label>
                  <Input
                    type="number"
                    value={efficiencyForm.units_completed}
                    onChange={(e) => setEfficiencyForm({ ...efficiencyForm, units_completed: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>الوحدات المعيبة</Label>
                  <Input
                    type="number"
                    value={efficiencyForm.units_defective}
                    onChange={(e) => setEfficiencyForm({ ...efficiencyForm, units_defective: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 p-3 bg-muted rounded-lg">
                <div>
                  <p className="text-xs text-muted-foreground">نسبة الكفاءة</p>
                  <p className="text-xl font-bold">
                    {efficiencyForm.actual_hours > 0 
                      ? ((efficiencyForm.planned_hours / efficiencyForm.actual_hours) * 100).toFixed(1) 
                      : 0}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">معدل الجودة</p>
                  <p className="text-xl font-bold">
                    {efficiencyForm.units_completed > 0
                      ? (((efficiencyForm.units_completed - efficiencyForm.units_defective) / efficiencyForm.units_completed) * 100).toFixed(1)
                      : 0}%
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Textarea
                  value={efficiencyForm.notes}
                  onChange={(e) => setEfficiencyForm({ ...efficiencyForm, notes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEfficiencyDialogOpen(false)}>إلغاء</Button>
              <Button 
                onClick={() => createEfficiencyMutation.mutate()} 
                disabled={createEfficiencyMutation.isPending || !efficiencyForm.branch_id}
              >
                {createEfficiencyMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                تسجيل
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
