import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import { useUserBranches } from '@/hooks/useUserBranches';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Plus, Search, ClipboardCheck, Eye, Play, CheckCircle, FileText, Calendar, Building2, User, Package } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@/lib/utils';

interface InventoryCount {
  id: string;
  count_number: string;
  branch_id: string;
  count_type: string;
  status: string;
  start_date: string;
  end_date: string | null;
  created_by: string;
  notes: string | null;
  total_system_items: number;
  total_counted_items: number;
  total_matched: number;
  total_shortage: number;
  total_overage: number;
  shortage_value: number;
  overage_value: number;
  branch?: { branch_name: string };
  branch_name?: string;
  creator?: { full_name: string };
}

const statusLabels: Record<string, string> = {
  open: 'مفتوح',
  counting: 'قيد العد',
  reviewing: 'قيد المراجعة',
  approved: 'معتمد'
};

const statusColors: Record<string, string> = {
  open: 'bg-blue-500',
  counting: 'bg-yellow-500',
  reviewing: 'bg-orange-500',
  approved: 'bg-green-500'
};

const countTypeLabels: Record<string, string> = {
  full: 'جرد كامل',
  partial: 'جرد جزئي',
  specific: 'أصناف محددة'
};

export default function InventoryCountsPage() {
  const { user } = useAuth();
  const { userBranches, primaryBranch, isAdmin } = useUserBranches();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  
  const [newCount, setNewCount] = useState({
    branch_id: primaryBranch?.id || '',
    count_type: 'full',
    notes: ''
  });

  const { data: counts, isLoading } = useQuery({
    queryKey: ['inventory-counts', filterStatus, filterBranch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (filterBranch !== 'all') params.set('branch', filterBranch);
      const res = await fetch(`/api/inventory-counts-with-branch?${params}`, { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      const data = await res.json();
      return (data || []).map((ic: any) => ({
        ...ic,
        branch: ic.branch || { branch_name: ic.branch_name },
      })) as InventoryCount[];
    }
  });

  const createCountMutation = useMutation({
    mutationFn: async () => {
      forbidDirectWrite('insert', 'InventoryCountsPage.tsx:createCountMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-counts'] });
      toast.success('تم إنشاء الجرد بنجاح');
      setShowCreateDialog(false);
      setNewCount({ branch_id: primaryBranch?.id || '', count_type: 'full', notes: '' });
    },
    onError: (error: any) => {
      toast.error('حدث خطأ أثناء إنشاء الجرد: ' + error.message);
    }
  });

  const filteredCounts = counts?.filter(count => 
    count.count_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (count.branch?.branch_name || count.branch_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardCheck className="w-7 h-7 text-primary" />
              جرد المخزون
            </h1>
            <p className="text-muted-foreground mt-1">إدارة عمليات جرد مخزون الذهب والمجوهرات</p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            إنشاء جرد جديد
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث برقم الجرد أو الفرع..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الحالات</SelectItem>
                  <SelectItem value="open">مفتوح</SelectItem>
                  <SelectItem value="counting">قيد العد</SelectItem>
                  <SelectItem value="reviewing">قيد المراجعة</SelectItem>
                  <SelectItem value="approved">معتمد</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterBranch} onValueChange={setFilterBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="الفرع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الفروع</SelectItem>
                  {userBranches.map(branch => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-primary">
                {counts?.filter(c => c.status === 'open').length || 0}
              </div>
              <div className="text-sm text-muted-foreground">جرد مفتوح</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-yellow-500">
                {counts?.filter(c => c.status === 'counting').length || 0}
              </div>
              <div className="text-sm text-muted-foreground">قيد العد</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-500">
                {counts?.filter(c => c.status === 'reviewing').length || 0}
              </div>
              <div className="text-sm text-muted-foreground">قيد المراجعة</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-500">
                {counts?.filter(c => c.status === 'approved').length || 0}
              </div>
              <div className="text-sm text-muted-foreground">معتمد</div>
            </CardContent>
          </Card>
        </div>

        {/* Counts Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الجرد</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ البدء</TableHead>
                  <TableHead>القطع بالنظام</TableHead>
                  <TableHead>القطع المعدودة</TableHead>
                  <TableHead>العجز</TableHead>
                  <TableHead>الزيادة</TableHead>
                  <TableHead>الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      جاري التحميل...
                    </TableCell>
                  </TableRow>
                ) : filteredCounts?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      لا توجد عمليات جرد
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCounts?.map((count) => (
                    <TableRow key={count.id}>
                      <TableCell className="font-mono font-medium">{count.count_number}</TableCell>
                      <TableCell>{count.branch?.branch_name || count.branch_name}</TableCell>
                      <TableCell>{countTypeLabels[count.count_type]}</TableCell>
                      <TableCell>
                        <Badge className={statusColors[count.status]}>
                          {statusLabels[count.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(count.start_date).toLocaleDateString('ar-EG')}
                      </TableCell>
                      <TableCell>{count.total_system_items}</TableCell>
                      <TableCell>{count.total_counted_items}</TableCell>
                      <TableCell className="text-red-500">
                        {count.total_shortage > 0 && (
                          <span>{count.total_shortage} ({formatCurrency(count.shortage_value)})</span>
                        )}
                      </TableCell>
                      <TableCell className="text-green-500">
                        {count.total_overage > 0 && (
                          <span>{count.total_overage} ({formatCurrency(count.overage_value)})</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/inventory-counts/${count.id}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {count.status === 'approved' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => navigate(`/inventory-counts/${count.id}/report`)}
                            >
                              <FileText className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Create Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5" />
                إنشاء جرد جديد
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>الفرع</Label>
                <Select
                  value={newCount.branch_id}
                  onValueChange={(value) => setNewCount(prev => ({ ...prev, branch_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الفرع" />
                  </SelectTrigger>
                  <SelectContent>
                    {userBranches.map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>نوع الجرد</Label>
                <Select
                  value={newCount.count_type}
                  onValueChange={(value) => setNewCount(prev => ({ ...prev, count_type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">جرد كامل</SelectItem>
                    <SelectItem value="partial">جرد جزئي</SelectItem>
                    <SelectItem value="specific">أصناف محددة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Textarea
                  value={newCount.notes}
                  onChange={(e) => setNewCount(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="أي ملاحظات إضافية..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => createCountMutation.mutate()}
                disabled={!newCount.branch_id || createCountMutation.isPending}
              >
                {createCountMutation.isPending ? 'جاري الإنشاء...' : 'بدء الجرد'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
