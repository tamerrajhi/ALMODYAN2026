import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Trash2, Plus, Scale, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface GoldKarat {
  id: string;
  karat_value: number;
  karat_name: string;
}

interface Branch {
  id: string;
  branch_name: string;
  branch_type: string;
}

interface GoldScrap {
  id: string;
  branch_id: string;
  scrap_date: string;
  karat_id: string;
  weight_grams: number;
  reason: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  gold_karats?: GoldKarat;
  branches?: Branch;
}

export default function GoldScrapPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [formData, setFormData] = useState({
    branch_id: '',
    scrap_date: format(new Date(), 'yyyy-MM-dd'),
    karat_id: '',
    weight_grams: '',
    reason: '',
    notes: '',
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['gold-branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      const data = await res.json();
      return (data as Branch[]).filter(b => b.branch_type === 'gold');
    },
  });

  const { data: karats = [] } = useQuery({
    queryKey: ['gold-karats-active'],
    queryFn: async () => {
      const res = await fetch('/api/gold-karats-active', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      return await res.json() as GoldKarat[];
    },
  });

  const { data: scrapRecords = [], isLoading } = useQuery({
    queryKey: ['gold-scrap', selectedBranch],
    queryFn: async () => {
      const url = selectedBranch !== 'all'
        ? `/api/gold-scrap-list?branch=${selectedBranch}`
        : '/api/gold-scrap-list';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      const data = await res.json();
      return (data as any[]).map(row => ({
        ...row,
        scrap_date: row.scrap_date || row.created_at,
        karat_id: row.karat_id || '',
        gold_karats: row.gold_karats || (row.karat ? { karat_name: row.karat, karat_value: 0, id: '' } : undefined),
        branches: row.branches || (row.branch_name ? { branch_name: row.branch_name, id: row.branch_id, branch_type: '' } : undefined),
      })) as GoldScrap[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      forbidDirectWrite('insert', 'GoldScrapPage.tsx:createMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gold-scrap'] });
      toast.success('تم تسجيل الفاقد بنجاح');
      resetForm();
    },
    onError: () => {
      toast.error('حدث خطأ أثناء تسجيل الفاقد');
    },
  });

  const resetForm = () => {
    setFormData({
      branch_id: '',
      scrap_date: format(new Date(), 'yyyy-MM-dd'),
      karat_id: '',
      weight_grams: '',
      reason: '',
      notes: '',
    });
    setIsDialogOpen(false);
  };

  const handleSubmit = () => {
    if (!formData.branch_id || !formData.karat_id || !formData.weight_grams) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    createMutation.mutate(formData);
  };

  const totalsByKarat = scrapRecords.reduce((acc, record) => {
    const karatName = record.gold_karats?.karat_name || 'غير معروف';
    if (!acc[karatName]) acc[karatName] = 0;
    acc[karatName] += record.weight_grams;
    return acc;
  }, {} as Record<string, number>);

  const totalWeight = scrapRecords.reduce((sum, r) => sum + r.weight_grams, 0);

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trash2 className="h-8 w-8 text-amber-500" />
            <div>
              <h1 className="text-3xl font-bold">فاقد الذهب</h1>
              <p className="text-muted-foreground">تتبع وتسجيل فاقد الذهب في عمليات التصنيع والبيع</p>
            </div>
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="ml-2 h-4 w-4" />
            تسجيل فاقد
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="col-span-2 md:col-span-1 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/20 dark:to-yellow-950/20">
            <CardContent className="p-4 text-center">
              <Scale className="h-8 w-8 mx-auto mb-2 text-amber-500" />
              <div className="text-2xl font-bold text-amber-600">
                {totalWeight.toFixed(2)} جم
              </div>
              <div className="text-sm text-muted-foreground">إجمالي الفاقد</div>
            </CardContent>
          </Card>
          {Object.entries(totalsByKarat).map(([karat, weight]) => (
            <Card key={karat}>
              <CardContent className="p-4 text-center">
                <div className="text-lg font-bold text-amber-600">{karat}</div>
                <div className="text-xl font-semibold">{weight.toFixed(2)} جم</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>سجل الفاقد</CardTitle>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الفروع</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">جاري التحميل...</div>
            ) : scrapRecords.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                لا توجد سجلات فاقد
              </div>
            ) : (
              <div className="responsive-table-wrapper">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>الفرع</TableHead>
                      <TableHead>العيار</TableHead>
                      <TableHead>الوزن (جم)</TableHead>
                      <TableHead>السبب</TableHead>
                      <TableHead>بواسطة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scrapRecords.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>
                          {format(new Date(record.scrap_date), 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {record.branches?.branch_name}
                        </TableCell>
                        <TableCell className="font-bold text-amber-600">
                          {record.gold_karats?.karat_name}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {record.weight_grams.toFixed(2)} جم
                        </TableCell>
                        <TableCell>{record.reason || '-'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {record.recorded_by || '-'}
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
              <DialogTitle>تسجيل فاقد ذهب</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>الفرع *</Label>
                  <Select
                    value={formData.branch_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, branch_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الفرع" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>التاريخ *</Label>
                  <Input
                    type="date"
                    value={formData.scrap_date}
                    onChange={(e) =>
                      setFormData({ ...formData, scrap_date: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>العيار *</Label>
                  <Select
                    value={formData.karat_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, karat_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر العيار" />
                    </SelectTrigger>
                    <SelectContent>
                      {karats.map((karat) => (
                        <SelectItem key={karat.id} value={karat.id}>
                          {karat.karat_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>الوزن (جرام) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.weight_grams}
                    onChange={(e) =>
                      setFormData({ ...formData, weight_grams: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>السبب</Label>
                <Input
                  placeholder="مثال: فاقد تصنيع، تنظيف..."
                  value={formData.reason}
                  onChange={(e) =>
                    setFormData({ ...formData, reason: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Textarea
                  placeholder="ملاحظات إضافية..."
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetForm}>
                إلغاء
              </Button>
              <Button onClick={handleSubmit}>تسجيل</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
