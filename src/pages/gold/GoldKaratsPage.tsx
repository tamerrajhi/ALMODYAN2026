import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { toast } from 'sonner';
import { Plus, Edit, Sparkles } from 'lucide-react';

interface GoldKarat {
  id: string;
  karat_value: number;
  karat_name: string;
  purity_percentage: number;
  is_active: boolean;
  created_at: string;
}

export default function GoldKaratsPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingKarat, setEditingKarat] = useState<GoldKarat | null>(null);
  const [formData, setFormData] = useState({
    karat_value: '',
    karat_name: '',
    purity_percentage: '',
    is_active: true,
  });

  const { data: karats = [], isLoading } = useQuery({
    queryKey: ['gold-karats'],
    queryFn: async () => {
      const res = await fetch('/api/gold-karats-all', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch gold karats');
      return (await res.json()) as GoldKarat[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      forbidDirectWrite('insert', 'GoldKaratsPage.tsx:createMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gold-karats'] });
      toast.success('تم إضافة العيار بنجاح');
      resetForm();
    },
    onError: () => {
      toast.error('حدث خطأ أثناء إضافة العيار');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      forbidDirectWrite('update', 'GoldKaratsPage.tsx:updateMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gold-karats'] });
      toast.success('تم تحديث العيار بنجاح');
      resetForm();
    },
    onError: () => {
      toast.error('حدث خطأ أثناء تحديث العيار');
    },
  });

  const resetForm = () => {
    setFormData({
      karat_value: '',
      karat_name: '',
      purity_percentage: '',
      is_active: true,
    });
    setEditingKarat(null);
    setIsDialogOpen(false);
  };

  const handleEdit = (karat: GoldKarat) => {
    setEditingKarat(karat);
    setFormData({
      karat_value: karat.karat_value.toString(),
      karat_name: karat.karat_name,
      purity_percentage: karat.purity_percentage.toString(),
      is_active: karat.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.karat_value || !formData.karat_name || !formData.purity_percentage) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    if (editingKarat) {
      updateMutation.mutate({ id: editingKarat.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="h-8 w-8 text-amber-500" />
            <div>
              <h1 className="text-3xl font-bold">إدارة العيارات</h1>
              <p className="text-muted-foreground">تعريف عيارات الذهب ونسبة النقاء</p>
            </div>
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="ml-2 h-4 w-4" />
            إضافة عيار
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>العيارات المتاحة</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">جاري التحميل...</div>
            ) : (
              <div className="responsive-table-wrapper">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>العيار</TableHead>
                      <TableHead>الاسم</TableHead>
                      <TableHead>نسبة النقاء %</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {karats.map((karat) => (
                      <TableRow key={karat.id}>
                        <TableCell className="font-bold text-amber-600">
                          {karat.karat_value}K
                        </TableCell>
                        <TableCell>{karat.karat_name}</TableCell>
                        <TableCell>{karat.purity_percentage}%</TableCell>
                        <TableCell>
                          <span
                            className={`px-2 py-1 rounded-full text-xs ${
                              karat.is_active
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {karat.is_active ? 'نشط' : 'معطل'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(karat)}
                          >
                            <Edit className="h-4 w-4" />
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

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingKarat ? 'تعديل العيار' : 'إضافة عيار جديد'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>قيمة العيار</Label>
                  <Input
                    type="number"
                    placeholder="مثال: 21"
                    value={formData.karat_value}
                    onChange={(e) =>
                      setFormData({ ...formData, karat_value: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>نسبة النقاء %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="مثال: 87.5"
                    value={formData.purity_percentage}
                    onChange={(e) =>
                      setFormData({ ...formData, purity_percentage: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>اسم العيار</Label>
                <Input
                  placeholder="مثال: عيار 21"
                  value={formData.karat_name}
                  onChange={(e) =>
                    setFormData({ ...formData, karat_name: e.target.value })
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
                <Label>نشط</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetForm}>
                إلغاء
              </Button>
              <Button onClick={handleSubmit}>
                {editingKarat ? 'تحديث' : 'إضافة'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
