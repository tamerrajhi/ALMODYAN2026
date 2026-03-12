import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
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
import { Plus, Trash2, Loader2, DollarSign } from 'lucide-react';

interface DirectCost {
  id: string;
  work_order_id: string;
  cost_type: string;
  cost_type_name: string;
  description: string;
  amount: number;
  cost_date: string;
  added_by: string | null;
  notes: string | null;
  created_at: string;
}

const costTypes = [
  { value: 'labor', label: 'أجور مباشرة', labelEn: 'Direct Labor' },
  { value: 'services', label: 'خدمات إنتاجية', labelEn: 'Production Services' },
  { value: 'overhead', label: 'مصاريف تشغيل', labelEn: 'Overhead' },
  { value: 'other', label: 'أخرى', labelEn: 'Other' },
];

interface DirectCostsTabProps {
  workOrderId: string;
  workOrderStatus: string;
}

export default function DirectCostsTab({ workOrderId, workOrderStatus }: DirectCostsTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    cost_type: 'labor',
    description: '',
    amount: 0,
    cost_date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
  });

  // Fetch direct costs
  const { data: directCosts = [], isLoading } = useQuery({
    queryKey: ['work-order-direct-costs', workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/work-order-direct-costs-list/${workOrderId}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch direct costs');
      return (await res.json()) as DirectCost[];
    },
    enabled: !!workOrderId,
  });

  // Add cost mutation
  const addMutation = useMutation({
    mutationFn: async () => {
      const costTypeLabel = costTypes.find(c => c.value === form.cost_type)?.label || form.cost_type;
      
      forbidDirectWrite('insert', 'DirectCostsTab.tsx:addMutation');
    },
    onSuccess: () => {
      toast.success('تم إضافة التكلفة بنجاح');
      setDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['work-order-direct-costs', workOrderId] });
      queryClient.invalidateQueries({ queryKey: ['work-order', workOrderId] });
    },
    onError: (error) => {
      console.error('Error adding cost:', error);
      toast.error('حدث خطأ أثناء إضافة التكلفة');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      forbidDirectWrite('delete', 'DirectCostsTab.tsx:deleteMutation');
    },
    onSuccess: () => {
      toast.success('تم حذف التكلفة');
      queryClient.invalidateQueries({ queryKey: ['work-order-direct-costs', workOrderId] });
      queryClient.invalidateQueries({ queryKey: ['work-order', workOrderId] });
    },
    onError: (error) => {
      console.error('Error deleting:', error);
      toast.error('حدث خطأ أثناء الحذف');
    },
  });

  const resetForm = () => {
    setForm({
      cost_type: 'labor',
      description: '',
      amount: 0,
      cost_date: format(new Date(), 'yyyy-MM-dd'),
      notes: '',
    });
  };

  const totalCosts = directCosts.reduce((sum, c) => sum + c.amount, 0);
  const canEdit = workOrderStatus !== 'completed' && workOrderStatus !== 'cancelled';

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">إجمالي التكاليف الإضافية</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalCosts.toLocaleString()} ر.س</div>
          <p className="text-xs text-muted-foreground">{directCosts.length} عنصر</p>
        </CardContent>
      </Card>

      {/* Actions */}
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 ml-2" />
            إضافة تكلفة
          </Button>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : directCosts.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          لا توجد تكاليف إضافية مسجلة
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>النوع</TableHead>
              <TableHead>الوصف</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead>بواسطة</TableHead>
              {canEdit && <TableHead>إجراءات</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {directCosts.map((cost) => (
              <TableRow key={cost.id}>
                <TableCell>{cost.cost_type_name}</TableCell>
                <TableCell>{cost.description}</TableCell>
                <TableCell className="font-medium">{cost.amount.toLocaleString()} ر.س</TableCell>
                <TableCell>{format(new Date(cost.cost_date), 'yyyy/MM/dd', { locale: ar })}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{cost.added_by || '-'}</TableCell>
                {canEdit && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => {
                        if (confirm('هل أنت متأكد من حذف هذه التكلفة؟')) {
                          deleteMutation.mutate(cost.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة تكلفة إضافية</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>نوع التكلفة *</Label>
              <Select
                value={form.cost_type}
                onValueChange={(v) => setForm(prev => ({ ...prev, cost_type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {costTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>الوصف *</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="وصف التكلفة..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>المبلغ (ر.س) *</Label>
                <Input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                  min={0}
                  step={0.01}
                />
              </div>
              <div className="space-y-2">
                <Label>التاريخ *</Label>
                <Input
                  type="date"
                  value={form.cost_date}
                  onChange={(e) => setForm(prev => ({ ...prev, cost_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="ملاحظات إضافية..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
              إلغاء
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={!form.description || form.amount <= 0 || addMutation.isPending}
            >
              {addMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              إضافة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
