import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
import { Loader2, Plus, Building2, Factory, Store, Briefcase } from 'lucide-react';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { logAudit } from '@/lib/audit';

interface CostCenter {
  id: string;
  center_code: string;
  center_name: string;
  center_name_en: string | null;
  center_type: string;
  parent_id: string | null;
  branch_id: string | null;
  is_active: boolean;
  description: string | null;
  branches?: { branch_name: string } | null;
  parent?: { center_name: string } | null;
}

const centerTypeLabels: Record<string, string> = {
  production: 'إنتاج',
  sales: 'مبيعات',
  admin: 'إداري',
};

const centerTypeIcons: Record<string, React.ReactNode> = {
  production: <Factory className="w-4 h-4" />,
  sales: <Store className="w-4 h-4" />,
  admin: <Briefcase className="w-4 h-4" />,
};

export default function CostCentersPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCenter, setEditingCenter] = useState<CostCenter | null>(null);
  const [form, setForm] = useState({
    center_code: '',
    center_name: '',
    center_name_en: '',
    center_type: 'production',
    parent_id: '',
    branch_id: '',
    description: '',
    is_active: true,
  });

  const { data: costCenters = [], isLoading } = useQuery({
    queryKey: ['cost-centers'],
    queryFn: async () => {
      const res = await fetch('/api/cost-centers-with-branches', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      const data = await res.json();
      return (data as any[]).map(row => ({
        ...row,
        branches: row.branches || (row.branch_name ? { branch_name: row.branch_name } : null),
        parent: row.parent || (row.parent_name ? { center_name: row.parent_name } : null),
      })) as CostCenter[];
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        center_code: form.center_code,
        center_name: form.center_name,
        center_name_en: form.center_name_en || null,
        center_type: form.center_type,
        parent_id: form.parent_id || null,
        branch_id: form.branch_id || null,
        description: form.description || null,
        is_active: form.is_active,
      };

      if (editingCenter) {
        forbidDirectWrite('update', 'CostCentersPage.tsx:140');
      } else {
        forbidDirectWrite('insert', 'CostCentersPage.tsx:154');
      }
    },
    onSuccess: () => {
      toast.success(editingCenter ? 'تم تعديل مركز التكلفة بنجاح' : 'تم إنشاء مركز التكلفة بنجاح');
      setDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
    },
    onError: (error: any) => {
      console.error('Error saving:', error);
      if (error.code === '23505') {
        toast.error('كود مركز التكلفة موجود مسبقاً');
      } else {
        toast.error('حدث خطأ أثناء الحفظ');
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      forbidDirectWrite('delete', 'CostCentersPage.tsx:186');
    },
    onSuccess: () => {
      toast.success('تم حذف مركز التكلفة');
      queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
    },
    onError: (error) => {
      console.error('Error deleting:', error);
      toast.error('لا يمكن حذف مركز التكلفة - قد يكون مرتبطاً بأوامر إنتاج');
    },
  });

  const resetForm = () => {
    setForm({
      center_code: '',
      center_name: '',
      center_name_en: '',
      center_type: 'production',
      parent_id: '',
      branch_id: '',
      description: '',
      is_active: true,
    });
    setEditingCenter(null);
  };

  const handleEdit = (center: CostCenter) => {
    setEditingCenter(center);
    setForm({
      center_code: center.center_code,
      center_name: center.center_name,
      center_name_en: center.center_name_en || '',
      center_type: center.center_type,
      parent_id: center.parent_id || '',
      branch_id: center.branch_id || '',
      description: center.description || '',
      is_active: center.is_active,
    });
    setDialogOpen(true);
  };

  const handleDelete = (center: CostCenter) => {
    if (confirm(`هل أنت متأكد من حذف مركز التكلفة "${center.center_name}"؟`)) {
      deleteMutation.mutate(center.id);
    }
  };

  const generateCode = () => {
    const prefix = form.center_type === 'production' ? 'CC-P' : 
                   form.center_type === 'sales' ? 'CC-S' : 'CC-A';
    const existing = costCenters.filter(c => c.center_code.startsWith(prefix));
    const nextNum = existing.length + 1;
    setForm(prev => ({ ...prev, center_code: `${prefix}${String(nextNum).padStart(3, '0')}` }));
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
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-foreground">مراكز التكلفة</h1>
            <p className="text-muted-foreground">إدارة مراكز التكلفة لتتبع تكاليف الإنتاج</p>
          </div>
          <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 ml-2" />
            مركز تكلفة جديد
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">مراكز الإنتاج</CardTitle>
              <Factory className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {costCenters.filter(c => c.center_type === 'production').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">مراكز المبيعات</CardTitle>
              <Store className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {costCenters.filter(c => c.center_type === 'sales').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">مراكز إدارية</CardTitle>
              <Briefcase className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {costCenters.filter(c => c.center_type === 'admin').length}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>قائمة مراكز التكلفة</CardTitle>
            <CardDescription>جميع مراكز التكلفة المسجلة في النظام</CardDescription>
          </CardHeader>
          <CardContent>
            {costCenters.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                لا توجد مراكز تكلفة. أضف مركز تكلفة جديد للبدء.
              </div>
            ) : (
              <div className="responsive-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الكود</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>المركز الأب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costCenters.map((center) => (
                    <TableRow key={center.id}>
                      <TableCell className="font-mono">{center.center_code}</TableCell>
                      <TableCell className="font-medium">{center.center_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          {centerTypeIcons[center.center_type]}
                          {centerTypeLabels[center.center_type]}
                        </Badge>
                      </TableCell>
                      <TableCell>{center.branches?.branch_name || '-'}</TableCell>
                      <TableCell>{center.parent?.center_name || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={center.is_active ? 'default' : 'secondary'}>
                          {center.is_active ? 'نشط' : 'غير نشط'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <RowActionsMenu
                          onEdit={() => handleEdit(center)}
                          onDelete={() => handleDelete(center)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingCenter ? 'تعديل مركز التكلفة' : 'إضافة مركز تكلفة جديد'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>كود المركز *</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.center_code}
                      onChange={(e) => setForm(prev => ({ ...prev, center_code: e.target.value }))}
                      placeholder="CC-P001"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={generateCode}>
                      #
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>النوع *</Label>
                  <Select
                    value={form.center_type}
                    onValueChange={(v) => setForm(prev => ({ ...prev, center_type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="production">إنتاج</SelectItem>
                      <SelectItem value="sales">مبيعات</SelectItem>
                      <SelectItem value="admin">إداري</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>اسم المركز (عربي) *</Label>
                <Input
                  value={form.center_name}
                  onChange={(e) => setForm(prev => ({ ...prev, center_name: e.target.value }))}
                  placeholder="خط الإنتاج 1"
                />
              </div>

              <div className="space-y-2">
                <Label>اسم المركز (إنجليزي)</Label>
                <Input
                  value={form.center_name_en}
                  onChange={(e) => setForm(prev => ({ ...prev, center_name_en: e.target.value }))}
                  placeholder="Production Line 1"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>الفرع</Label>
                  <Select
                    value={form.branch_id}
                    onValueChange={(v) => setForm(prev => ({ ...prev, branch_id: v }))}
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
                <div className="space-y-2">
                  <Label>المركز الأب</Label>
                  <Select
                    value={form.parent_id}
                    onValueChange={(v) => setForm(prev => ({ ...prev, parent_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="بدون" />
                    </SelectTrigger>
                    <SelectContent>
                      {costCenters
                        .filter(c => c.id !== editingCenter?.id)
                        .map((center) => (
                          <SelectItem key={center.id} value={center.id}>
                            {center.center_name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>الوصف</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="وصف مركز التكلفة..."
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(checked) => setForm(prev => ({ ...prev, is_active: checked }))}
                />
                <Label>نشط</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                إلغاء
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!form.center_code || !form.center_name || saveMutation.isPending}
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                {editingCenter ? 'تحديث' : 'إضافة'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
