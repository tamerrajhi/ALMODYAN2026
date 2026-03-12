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
  Store,
  ArrowRightLeft,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle,
  ShoppingCart,
  RotateCcw,
} from 'lucide-react';
import { logAudit } from '@/lib/audit';
import { createShowroomTransferJournalEntry } from '@/lib/accounting';

interface ShowroomItem {
  id: string;
  item_id: string | null;
  item_code: string;
  branch_id: string;
  received_from_factory_at: string;
  received_by: string | null;
  factory_record_id: string | null;
  status: string;
  sold_at: string | null;
  sale_id: string | null;
  notes: string | null;
  unique_items?: {
    description: string | null;
    g_weight: number | null;
    metal: string | null;
    tag_price: number | null;
  } | null;
  branches?: { branch_name: string } | null;
}

interface Branch {
  id: string;
  branch_name: string;
  branch_code: string;
}

export default function FinishedGoodsShowroomPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ShowroomItem | null>(null);

  const [transferForm, setTransferForm] = useState({
    to_branch_id: '',
    notes: '',
  });

  const { data: showroomItems = [], isLoading, refetch } = useQuery({
    queryKey: ['finished-goods-showroom'],
    queryFn: async () => {
      const res = await fetch('/api/finished-goods-showroom-with-details', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch showroom items');
      const data = await res.json();
      return (data || []).map((item: any) => ({
        ...item,
        unique_items: {
          description: item.description,
          g_weight: item.g_weight,
          metal: item.metal,
          tag_price: item.tag_price,
        },
        branches: item.branch_name ? { branch_name: item.branch_name } : null,
      })) as ShowroomItem[];
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch branches');
      return (await res.json()) as Branch[];
    },
  });

  // Transfer between showrooms mutation
  const transferMutation = useMutation({
    mutationFn: async (data: { item: ShowroomItem; to_branch_id: string; notes: string }) => {
      forbidDirectWrite('update', 'FinishedGoodsShowroomPage.tsx:126');
    },
    onSuccess: () => {
      toast.success('تم النقل بنجاح');
      setTransferDialogOpen(false);
      setSelectedItem(null);
      setTransferForm({ to_branch_id: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['finished-goods-showroom'] });
    },
    onError: (error) => {
      console.error('Error transferring:', error);
      toast.error('حدث خطأ أثناء النقل');
    },
  });

  const handleTransfer = (item: ShowroomItem) => {
    setSelectedItem(item);
    setTransferDialogOpen(true);
  };

  const filteredItems = useMemo(() => {
    return showroomItems.filter(item => {
      const matchesSearch = !searchTerm || 
        item.item_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.unique_items?.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesBranch = branchFilter === 'all' || item.branch_id === branchFilter;
      
      return matchesSearch && matchesStatus && matchesBranch;
    });
  }, [showroomItems, searchTerm, statusFilter, branchFilter]);

  const stats = useMemo(() => ({
    total: showroomItems.length,
    available: showroomItems.filter(g => g.status === 'available').length,
    sold: showroomItems.filter(g => g.status === 'sold').length,
    totalValue: showroomItems
      .filter(g => g.status === 'available')
      .reduce((sum, g) => sum + (g.unique_items?.tag_price || 0), 0),
  }), [showroomItems]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'available':
        return <Badge className="bg-green-100 text-green-800">متاح للبيع</Badge>;
      case 'sold':
        return <Badge className="bg-purple-100 text-purple-800">مباع</Badge>;
      case 'returned':
        return <Badge className="bg-orange-100 text-orange-800">مرتجع</Badge>;
      case 'transferred':
        return <Badge className="bg-blue-100 text-blue-800">منقول</Badge>;
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
            <h1 className="text-2xl font-bold text-foreground">خزنة الإنتاج التام - المعرض</h1>
            <p className="text-muted-foreground">إدارة المنتجات المتاحة للبيع في المعارض</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">إجمالي القطع</CardTitle>
              <Store className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">متاح للبيع</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.available}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">مباع</CardTitle>
              <ShoppingCart className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{stats.sold}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">قيمة المتاح</CardTitle>
              <Store className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">
                {stats.totalValue.toLocaleString()} ر.س
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle>مخزون المعارض</CardTitle>
                <CardDescription>جميع المنتجات المتاحة في المعارض</CardDescription>
              </div>
              <div className="flex gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث بالكود..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10 w-40"
                  />
                </div>
                <Select value={branchFilter} onValueChange={setBranchFilter}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="الفرع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الفروع</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="الحالة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="available">متاح</SelectItem>
                    <SelectItem value="sold">مباع</SelectItem>
                    <SelectItem value="returned">مرتجع</SelectItem>
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
            ) : filteredItems.length === 0 ? (
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
                    <TableHead>السعر</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>تاريخ الاستلام</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.item_code}</TableCell>
                      <TableCell>{item.unique_items?.description || '-'}</TableCell>
                      <TableCell>{item.unique_items?.g_weight?.toFixed(2) || '-'} جم</TableCell>
                      <TableCell>{item.unique_items?.tag_price?.toLocaleString() || '-'} ر.س</TableCell>
                      <TableCell>{item.branches?.branch_name || '-'}</TableCell>
                      <TableCell>
                        {format(new Date(item.received_from_factory_at), 'yyyy/MM/dd', { locale: ar })}
                      </TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell>
                        {item.status === 'available' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTransfer(item)}
                          >
                            <ArrowRightLeft className="w-4 h-4 ml-1" />
                            نقل
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

        {/* Transfer Dialog */}
        <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>نقل بين المعارض</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">القطعة:</p>
                <p className="font-medium">{selectedItem?.item_code}</p>
                <p className="text-sm text-muted-foreground mt-1">من:</p>
                <p className="font-medium">{selectedItem?.branches?.branch_name}</p>
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
                    {branches
                      .filter(b => b.id !== selectedItem?.branch_id)
                      .map((branch) => (
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
