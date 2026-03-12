import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { queryTable } from '@/lib/dataGateway';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Pencil, Trash2, Settings, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

interface Threshold {
  id: string;
  threshold_name: string;
  min_amount: number;
  max_amount: number | null;
  approver_role: string;
  approval_order: number;
  is_active: boolean;
}

const roleLabels: Record<string, string> = {
  department_manager: 'مدير القسم',
  procurement: 'المشتريات',
  top_management: 'الإدارة العليا',
};

export default function PRApprovalThresholdsPage() {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingThreshold, setEditingThreshold] = useState<Threshold | null>(null);
  const [formData, setFormData] = useState({
    threshold_name: '',
    min_amount: 0,
    max_amount: '',
    approver_role: 'department_manager',
    approval_order: 1,
    is_active: true,
  });

  const { data: thresholds = [], isLoading } = useQuery({
    queryKey: ['pr-approval-thresholds'],
    queryFn: async () => {
      const { data, error } = await queryTable('pr_approval_thresholds', {
        select: '*',
        order: { column: 'min_amount', ascending: true },
      });
      if (error) throw error;
      return (data || []) as Threshold[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        threshold_name: formData.threshold_name,
        min_amount: formData.min_amount,
        max_amount: formData.max_amount ? Number(formData.max_amount) : null,
        approver_role: formData.approver_role,
        approval_order: formData.approval_order,
        is_active: formData.is_active,
      };

      if (editingThreshold) {
        forbidDirectWrite('update', 'PRApprovalThresholdsPage.tsx:saveMutation');
      } else {
        forbidDirectWrite('insert', 'PRApprovalThresholdsPage.tsx:saveMutation');
      }
    },
    onSuccess: () => {
      toast.success(editingThreshold ? 'تم تحديث الحد' : 'تم إضافة الحد');
      setShowDialog(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['pr-approval-thresholds'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في الحفظ');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      forbidDirectWrite('delete', 'PRApprovalThresholdsPage.tsx:deleteMutation');
    },
    onSuccess: () => {
      toast.success('تم حذف الحد');
      queryClient.invalidateQueries({ queryKey: ['pr-approval-thresholds'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في الحذف');
    },
  });

  const resetForm = () => {
    setFormData({
      threshold_name: '',
      min_amount: 0,
      max_amount: '',
      approver_role: 'department_manager',
      approval_order: 1,
      is_active: true,
    });
    setEditingThreshold(null);
  };

  const openCreate = () => {
    resetForm();
    setShowDialog(true);
  };

  const openEdit = (threshold: Threshold) => {
    setEditingThreshold(threshold);
    setFormData({
      threshold_name: threshold.threshold_name,
      min_amount: threshold.min_amount,
      max_amount: threshold.max_amount?.toString() || '',
      approver_role: threshold.approver_role,
      approval_order: threshold.approval_order,
      is_active: threshold.is_active,
    });
    setShowDialog(true);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Settings className="w-7 h-7 text-primary" />
              إعدادات حدود الموافقات
            </h1>
            <p className="text-muted-foreground">
              تحديد مستويات الموافقة حسب قيمة طلب الشراء
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            إضافة حد جديد
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              حدود الموافقات الحالية
            </CardTitle>
            <CardDescription>
              تحدد هذه الحدود من يجب أن يوافق على طلبات الشراء حسب قيمتها
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : thresholds.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                لا توجد حدود موافقات محددة
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الحد الأدنى</TableHead>
                    <TableHead>الحد الأقصى</TableHead>
                    <TableHead>المسؤول</TableHead>
                    <TableHead>الترتيب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {thresholds.map((threshold) => (
                    <TableRow key={threshold.id}>
                      <TableCell className="font-medium">{threshold.threshold_name}</TableCell>
                      <TableCell>{threshold.min_amount.toLocaleString()} ر.س</TableCell>
                      <TableCell>
                        {threshold.max_amount ? `${threshold.max_amount.toLocaleString()} ر.س` : 'بدون حد'}
                      </TableCell>
                      <TableCell>{roleLabels[threshold.approver_role] || threshold.approver_role}</TableCell>
                      <TableCell>{threshold.approval_order}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs ${threshold.is_active ? 'bg-green-500/20 text-green-600' : 'bg-muted'}`}>
                          {threshold.is_active ? 'مفعل' : 'معطل'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(threshold)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => {
                              if (confirm('هل أنت متأكد من حذف هذا الحد؟')) {
                                deleteMutation.mutate(threshold.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingThreshold ? 'تعديل حد الموافقة' : 'إضافة حد موافقة جديد'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>اسم الحد</Label>
                <Input
                  value={formData.threshold_name}
                  onChange={(e) => setFormData({ ...formData, threshold_name: e.target.value })}
                  placeholder="مثال: الطلبات الصغيرة"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>الحد الأدنى (ر.س)</Label>
                  <Input
                    type="number"
                    value={formData.min_amount}
                    onChange={(e) => setFormData({ ...formData, min_amount: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>الحد الأقصى (ر.س)</Label>
                  <Input
                    type="number"
                    value={formData.max_amount}
                    onChange={(e) => setFormData({ ...formData, max_amount: e.target.value })}
                    placeholder="اتركه فارغاً لبدون حد"
                  />
                </div>
              </div>
              <div>
                <Label>المسؤول عن الموافقة</Label>
                <Select
                  value={formData.approver_role}
                  onValueChange={(v) => setFormData({ ...formData, approver_role: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="department_manager">مدير القسم</SelectItem>
                    <SelectItem value="procurement">المشتريات</SelectItem>
                    <SelectItem value="top_management">الإدارة العليا</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>ترتيب الموافقة</Label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={formData.approval_order}
                  onChange={(e) => setFormData({ ...formData, approval_order: Number(e.target.value) })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
                />
                <Label>مفعل</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !formData.threshold_name}
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
