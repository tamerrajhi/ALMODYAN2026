import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
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
  Package,
  ArrowDownCircle,
  ArrowRightCircle,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle,
  Clock,
} from 'lucide-react';
import { logAudit } from '@/lib/audit';
import { createProductionCompleteJournalEntry, calculateWorkOrderTotalCost } from '@/lib/production-accounting';

interface FinishedGood {
  id: string;
  item_id: string | null;
  item_code: string;
  branch_id: string;
  received_from_wip_at: string;
  received_by: string | null;
  work_order_id: string | null;
  status: string;
  transferred_to_showroom_at: string | null;
  transferred_to_branch_id: string | null;
  notes: string | null;
  unique_items?: {
    description: string | null;
    g_weight: number | null;
    metal: string | null;
    cost: number | null;
  } | null;
  branches?: { branch_name: string } | null;
  work_orders?: { order_code: string } | null;
}

interface Branch {
  id: string;
  branch_name: string;
  branch_code: string;
  branch_type: string;
}

interface WorkOrder {
  id: string;
  order_code: string;
  status: string;
}

export default function FinishedGoodsFactoryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<FinishedGood | null>(null);

  const [receiveForm, setReceiveForm] = useState({
    item_code: '',
    work_order_id: '',
    notes: '',
  });

  const [transferForm, setTransferForm] = useState({
    to_branch_id: '',
    notes: '',
  });

  // Fetch finished goods in factory
  const { data: finishedGoods = [], isLoading, refetch } = useQuery({
    queryKey: ['finished-goods-factory'],
    queryFn: async () => {
      const res = await fetch('/api/finished-goods-factory-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json() as FinishedGood[];
    },
  });

  // Fetch branches (showrooms only for transfer)
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-showroom'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  // Fetch work orders (completed)
  const { data: workOrders = [] } = useQuery({
    queryKey: ['work-orders-completed'],
    queryFn: async () => {
      const res = await fetch('/api/work-orders-completed', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json() as WorkOrder[];
    },
  });

  // Receive from WIP mutation
  const receiveMutation = useMutation({
    mutationFn: async (data: typeof receiveForm) => {
      // Generate item code
      const { data: itemCode } = await dataGateway.rpc('generate_finished_goods_code', {});
      
      const factoryBranch = branches.find(b => b.branch_type === 'factory') || branches[0];
      
      // Get work order details for journal entry
      let totalCost = 0;
      let workOrderData: any = null;
      if (data.work_order_id) {
        try {
          const woRes = await fetch(`/api/work-order/${data.work_order_id}`, { credentials: 'include' });
          if (woRes.ok) workOrderData = await woRes.json();
        } catch {}
        const costResult = await calculateWorkOrderTotalCost(data.work_order_id);
        totalCost = costResult.totalCost;
      }

      forbidDirectWrite('insert', 'FinishedGoodsFactoryPage.tsx:176');
    },
    onSuccess: () => {
      toast.success('تم استلام الإنتاج التام بنجاح');
      setReceiveDialogOpen(false);
      setReceiveForm({ item_code: '', work_order_id: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['finished-goods-factory'] });
    },
    onError: (error) => {
      console.error('Error receiving:', error);
      toast.error('حدث خطأ أثناء استلام الإنتاج');
    },
  });

  // Transfer to showroom mutation
  const transferMutation = useMutation({
    mutationFn: async (data: { item: FinishedGood; to_branch_id: string; notes: string }) => {
      forbidDirectWrite('update', 'FinishedGoodsFactoryPage.tsx:254');
    },
    onSuccess: () => {
      toast.success('تم النقل للمعرض بنجاح');
      setTransferDialogOpen(false);
      setSelectedItem(null);
      setTransferForm({ to_branch_id: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['finished-goods-factory'] });
    },
    onError: (error) => {
      console.error('Error transferring:', error);
      toast.error('حدث خطأ أثناء النقل');
    },
  });

  const handleTransfer = (item: FinishedGood) => {
    setSelectedItem(item);
    setTransferDialogOpen(true);
  };

  const filteredGoods = useMemo(() => {
    return finishedGoods.filter(item => {
      const matchesSearch = !searchTerm || 
        item.item_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.unique_items?.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [finishedGoods, searchTerm, statusFilter]);

  const stats = useMemo(() => ({
    total: finishedGoods.length,
    available: finishedGoods.filter(g => g.status === 'available').length,
    transferred: finishedGoods.filter(g => g.status === 'transferred').length,
  }), [finishedGoods]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'available':
        return <Badge className="bg-green-100 text-green-800">متاح</Badge>;
      case 'transferred':
        return <Badge className="bg-blue-100 text-blue-800">تم النقل</Badge>;
      case 'sold':
        return <Badge className="bg-purple-100 text-purple-800">مباع</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">خزنة الإنتاج التام - المصنع</h1>
            <p className="text-muted-foreground">إدارة المنتجات الجاهزة في المصنع</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setReceiveDialogOpen(true)} className="bg-green-600 hover:bg-green-700">
              <ArrowDownCircle className="w-4 h-4 ml-2" />
              استلام من الإنتاج
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">إجمالي القطع</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">متاح للنقل</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.available}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">تم النقل</CardTitle>
              <ArrowRightCircle className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.transferred}</div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle>قائمة المنتجات</CardTitle>
                <CardDescription>جميع المنتجات التامة في المصنع</CardDescription>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث بالكود..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10 w-48"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="الحالة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="available">متاح</SelectItem>
                    <SelectItem value="transferred">منقول</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredGoods.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                لا توجد منتجات
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>كود القطعة</TableHead>
                    <TableHead>الوصف</TableHead>
                    <TableHead>الوزن</TableHead>
                    <TableHead>أمر الإنتاج</TableHead>
                    <TableHead>تاريخ الاستلام</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGoods.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.item_code}</TableCell>
                      <TableCell>{item.unique_items?.description || '-'}</TableCell>
                      <TableCell>{item.unique_items?.g_weight?.toFixed(2) || '-'} جم</TableCell>
                      <TableCell>{item.work_orders?.order_code || '-'}</TableCell>
                      <TableCell>
                        {format(new Date(item.received_from_wip_at), 'yyyy/MM/dd', { locale: ar })}
                      </TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell>
                        {item.status === 'available' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTransfer(item)}
                          >
                            <ArrowRightCircle className="w-4 h-4 ml-1" />
                            نقل للمعرض
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Receive Dialog */}
        <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>استلام إنتاج تام من WIP</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>أمر الإنتاج (اختياري)</Label>
                <Select
                  value={receiveForm.work_order_id}
                  onValueChange={(v) => setReceiveForm(prev => ({ ...prev, work_order_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر أمر الإنتاج" />
                  </SelectTrigger>
                  <SelectContent>
                    {workOrders.map((order) => (
                      <SelectItem key={order.id} value={order.id}>
                        {order.order_code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Textarea
                  value={receiveForm.notes}
                  onChange={(e) => setReceiveForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="ملاحظات إضافية..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReceiveDialogOpen(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => receiveMutation.mutate(receiveForm)}
                disabled={receiveMutation.isPending}
              >
                {receiveMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                استلام
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Transfer Dialog */}
        <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>نقل للمعرض</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">القطعة:</p>
                <p className="font-medium">{selectedItem?.item_code}</p>
              </div>
              <div className="space-y-2">
                <Label>المعرض الوجهة *</Label>
                <Select
                  value={transferForm.to_branch_id}
                  onValueChange={(v) => setTransferForm(prev => ({ ...prev, to_branch_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر المعرض" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.filter(b => b.branch_type === 'showroom' || b.branch_type === 'jewelry').map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Textarea
                  value={transferForm.notes}
                  onChange={(e) => setTransferForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="ملاحظات إضافية..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => selectedItem && transferMutation.mutate({
                  item: selectedItem,
                  to_branch_id: transferForm.to_branch_id,
                  notes: transferForm.notes,
                })}
                disabled={!transferForm.to_branch_id || transferMutation.isPending}
              >
                {transferMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                نقل
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
