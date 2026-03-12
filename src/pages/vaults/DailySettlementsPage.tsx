import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { 
  Plus, 
  Search, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Send, 
  Eye,
  Calculator,
  Wallet,
  Coins,
  TrendingUp,
  TrendingDown,
  AlertTriangle
} from 'lucide-react';

interface DailySettlement {
  id: string;
  settlement_number: string;
  settlement_date: string;
  branch_id: string;
  cashier_id: string;
  cashier_name: string | null;
  cash_vault_id: string | null;
  system_cash_balance: number;
  actual_cash_balance: number;
  cash_difference: number;
  gold_vault_id: string | null;
  system_gold_weight: number;
  actual_gold_weight: number;
  gold_difference: number;
  total_sales_count: number;
  total_sales_amount: number;
  total_returns_count: number;
  total_returns_amount: number;
  cash_received: number;
  card_received: number;
  bank_transfer_received: number;
  status: 'pending' | 'submitted' | 'approved' | 'rejected';
  notes: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_at: string;
  branches?: { branch_name: string };
  cash_vaults?: { vault_name: string };
  gold_vaults?: { vault_name: string };
}

interface SystemUser {
  id: string;
  email: string;
  full_name?: string;
}

interface Branch {
  id: string;
  branch_name: string;
}

interface CashVault {
  id: string;
  vault_name: string;
  branch_id: string;
}

interface GoldVault {
  id: string;
  vault_name: string;
  branch_id: string;
}

export default function DailySettlementsPage() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false);
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [selectedSettlement, setSelectedSettlement] = useState<DailySettlement | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [selectedApprover, setSelectedApprover] = useState('');
  
  // Form state
  const [formData, setFormData] = useState({
    branch_id: '',
    cash_vault_id: '',
    gold_vault_id: '',
    actual_cash_balance: 0,
    actual_gold_weight: 0,
    notes: ''
  });

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['daily-settlements'],
    queryFn: async () => {
      const res = await fetch('/api/daily-settlements');
      if (!res.ok) throw new Error('Failed to fetch settlements');
      return res.json() as Promise<DailySettlement[]>;
    }
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/branches');
      if (!res.ok) throw new Error('Failed to fetch branches');
      const data = await res.json();
      return data.filter((b: any) => b.is_active).map((b: any) => ({ id: b.id, branch_name: b.name })) as Branch[];
    }
  });

  const { data: cashVaults = [] } = useQuery({
    queryKey: ['cash-vaults'],
    queryFn: async () => {
      const res = await fetch('/api/cash-vaults');
      if (!res.ok) throw new Error('Failed to fetch cash vaults');
      const data = await res.json();
      return data.filter((v: any) => v.is_active) as CashVault[];
    }
  });

  const { data: goldVaults = [] } = useQuery({
    queryKey: ['gold-vaults'],
    queryFn: async () => {
      const res = await fetch('/api/gold-vaults');
      if (!res.ok) throw new Error('Failed to fetch gold vaults');
      const data = await res.json();
      return data.filter((v: any) => v.is_active) as GoldVault[];
    }
  });

  const { data: approvers = [] } = useQuery({
    queryKey: ['approvers'],
    queryFn: async () => {
      const res = await fetch('/api/approvers');
      if (!res.ok) throw new Error('Failed to fetch approvers');
      return res.json() as Promise<SystemUser[]>;
    }
  });

  const getSystemBalances = async (_cashVaultId: string, _goldVaultId: string) => {
    return { cashBalance: 0, goldWeight: 0 };
  };

  // Create settlement mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Generate settlement number
      const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const settlementNumber = `SET${dateStr}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

      // Get system balances
      const { cashBalance, goldWeight } = await getSystemBalances(data.cash_vault_id, data.gold_vault_id);

      const today = new Date().toISOString().split('T')[0];
      const summaryRes = await fetch(`/api/daily-sales-summary?branch_id=${data.branch_id}&date=${today}`);
      const summary = summaryRes.ok ? await summaryRes.json() : { totalSalesCount: 0, totalSalesAmount: 0, totalReturnsCount: 0, totalReturnsAmount: 0 };

      const totalSalesCount = summary.totalSalesCount;
      const totalSalesAmount = summary.totalSalesAmount;
      const totalReturnsCount = summary.totalReturnsCount;
      const totalReturnsAmount = summary.totalReturnsAmount;
      const cashReceived = 0;
      const cardReceived = 0;
      const bankTransferReceived = 0;

      // BLOCKED: Use atomic RPC
      forbidDirectWrite('insert', 'DailySettlementsPage.tsx:290');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-settlements'] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast.success('تم إنشاء مطابقة نهاية اليوم بنجاح');
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء إنشاء المطابقة');
    }
  });

  // Submit for approval with assignment
  const submitMutation = useMutation({
    mutationFn: async ({ id, approverId, approverName }: { id: string; approverId: string; approverName: string }) => {
      // BLOCKED: Use atomic RPC for update
      forbidDirectWrite('update', 'DailySettlementsPage.tsx:336');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-settlements'] });
      setIsSubmitDialogOpen(false);
      setSelectedApprover('');
      toast.success('تم إرسال المطابقة للموافقة');
    }
  });

  // Approve settlement
  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      // BLOCKED: Use atomic RPC for update
      forbidDirectWrite('update', 'DailySettlementsPage.tsx:372');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-settlements'] });
      setIsApprovalDialogOpen(false);
      toast.success('تم اعتماد المطابقة بنجاح');
    }
  });

  // Reject settlement
  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      // BLOCKED: Use atomic RPC for update
      forbidDirectWrite('update', 'DailySettlementsPage.tsx:408');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-settlements'] });
      setIsApprovalDialogOpen(false);
      setRejectionReason('');
      toast.success('تم رفض المطابقة');
    }
  });

  const resetForm = () => {
    setFormData({
      branch_id: '',
      cash_vault_id: '',
      gold_vault_id: '',
      actual_cash_balance: 0,
      actual_gold_weight: 0,
      notes: ''
    });
  };

  // Filtered vaults based on selected branch
  const filteredCashVaults = useMemo(() => {
    return cashVaults.filter(v => v.branch_id === formData.branch_id);
  }, [cashVaults, formData.branch_id]);

  const filteredGoldVaults = useMemo(() => {
    return goldVaults.filter(v => v.branch_id === formData.branch_id);
  }, [goldVaults, formData.branch_id]);

  // Filtered settlements
  const filteredSettlements = useMemo(() => {
    return settlements.filter(s => 
      s.settlement_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.cashier_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.branches?.branch_name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [settlements, searchTerm]);

  // Summary stats
  const stats = useMemo(() => {
    const pending = settlements.filter(s => s.status === 'pending').length;
    const submitted = settlements.filter(s => s.status === 'submitted').length;
    const approved = settlements.filter(s => s.status === 'approved').length;
    const withDifference = settlements.filter(s => s.cash_difference !== 0 || s.gold_difference !== 0).length;
    return { pending, submitted, approved, withDifference };
  }, [settlements]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300"><Clock className="w-3 h-3 ml-1" />قيد الإعداد</Badge>;
      case 'submitted':
        return <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300"><Send className="w-3 h-3 ml-1" />مُرسل للموافقة</Badge>;
      case 'approved':
        return <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300"><CheckCircle className="w-3 h-3 ml-1" />معتمد</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300"><XCircle className="w-3 h-3 ml-1" />مرفوض</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR'
    }).format(amount);
  };

  const handleViewSettlement = (settlement: DailySettlement) => {
    setSelectedSettlement(settlement);
    setIsViewDialogOpen(true);
  };

  const handleApprovalDialog = (settlement: DailySettlement) => {
    setSelectedSettlement(settlement);
    setIsApprovalDialogOpen(true);
  };

  const handleSubmitDialog = (settlement: DailySettlement) => {
    setSelectedSettlement(settlement);
    setIsSubmitDialogOpen(true);
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">مطابقة نهاية اليوم</h1>
            <p className="text-muted-foreground">إدارة ومراجعة مطابقات الخزينة اليومية</p>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 ml-2" />
            إنشاء مطابقة جديدة
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-yellow-100">
                  <Clock className="w-5 h-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">قيد الإعداد</p>
                  <p className="text-2xl font-bold">{stats.pending}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-blue-100">
                  <Send className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">بانتظار الموافقة</p>
                  <p className="text-2xl font-bold">{stats.submitted}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-green-100">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">معتمدة</p>
                  <p className="text-2xl font-bold">{stats.approved}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-orange-100">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">بها فروقات</p>
                  <p className="text-2xl font-bold">{stats.withDifference}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم المطابقة أو اسم الكاشير..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10"
          />
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="responsive-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم المطابقة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead>الكاشير</TableHead>
                  <TableHead>فرق النقد</TableHead>
                  <TableHead>فرق الذهب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      جاري التحميل...
                    </TableCell>
                  </TableRow>
                ) : filteredSettlements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      لا توجد مطابقات
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSettlements.map((settlement) => (
                    <TableRow key={settlement.id}>
                      <TableCell className="font-medium">{settlement.settlement_number}</TableCell>
                      <TableCell>
                        {format(new Date(settlement.settlement_date), 'dd/MM/yyyy', { locale: language === 'ar' ? ar : undefined })}
                      </TableCell>
                      <TableCell>{settlement.branches?.branch_name}</TableCell>
                      <TableCell>{settlement.cashier_name}</TableCell>
                      <TableCell>
                        <span className={settlement.cash_difference < 0 ? 'text-red-600' : settlement.cash_difference > 0 ? 'text-green-600' : ''}>
                          {settlement.cash_difference !== 0 && (
                            settlement.cash_difference > 0 ? <TrendingUp className="w-3 h-3 inline ml-1" /> : <TrendingDown className="w-3 h-3 inline ml-1" />
                          )}
                          {formatCurrency(settlement.cash_difference)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={settlement.gold_difference < 0 ? 'text-red-600' : settlement.gold_difference > 0 ? 'text-green-600' : ''}>
                          {settlement.gold_difference.toFixed(2)} جرام
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(settlement.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" onClick={() => handleViewSettlement(settlement)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {settlement.status === 'pending' && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleSubmitDialog(settlement)}
                              title="إرسال للموافقة"
                            >
                              <Send className="w-4 h-4" />
                            </Button>
                          )}
                          {settlement.status === 'submitted' && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleApprovalDialog(settlement)}
                            >
                              <CheckCircle className="w-4 h-4" />
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

        {/* Create Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>إنشاء مطابقة نهاية اليوم</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>الفرع *</Label>
                <Select
                  value={formData.branch_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, branch_id: value, cash_vault_id: '', gold_vault_id: '' }))}
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

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>خزينة النقد</Label>
                  <Select
                    value={formData.cash_vault_id}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, cash_vault_id: value }))}
                    disabled={!formData.branch_id}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الخزينة" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredCashVaults.map((vault) => (
                        <SelectItem key={vault.id} value={vault.id}>
                          {vault.vault_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>خزينة الذهب</Label>
                  <Select
                    value={formData.gold_vault_id}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, gold_vault_id: value }))}
                    disabled={!formData.branch_id}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الخزينة" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredGoldVaults.map((vault) => (
                        <SelectItem key={vault.id} value={vault.id}>
                          {vault.vault_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>الرصيد النقدي الفعلي (ر.س)</Label>
                  <Input
                    type="number"
                    value={formData.actual_cash_balance}
                    onChange={(e) => setFormData(prev => ({ ...prev, actual_cash_balance: parseFloat(e.target.value) || 0 }))}
                    placeholder="0.00"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>وزن الذهب الفعلي (جرام)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.actual_gold_weight}
                    onChange={(e) => setFormData(prev => ({ ...prev, actual_gold_weight: parseFloat(e.target.value) || 0 }))}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>ملاحظات</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="أي ملاحظات إضافية..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                إلغاء
              </Button>
              <Button 
                onClick={() => createMutation.mutate(formData)}
                disabled={!formData.branch_id || createMutation.isPending}
              >
                <Calculator className="w-4 h-4 ml-2" />
                إنشاء المطابقة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>تفاصيل المطابقة: {selectedSettlement?.settlement_number}</DialogTitle>
            </DialogHeader>
            {selectedSettlement && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">التاريخ</p>
                    <p className="font-medium">{format(new Date(selectedSettlement.settlement_date), 'dd/MM/yyyy')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">الفرع</p>
                    <p className="font-medium">{selectedSettlement.branches?.branch_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">الكاشير</p>
                    <p className="font-medium">{selectedSettlement.cashier_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">الحالة</p>
                    {getStatusBadge(selectedSettlement.status)}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Cash Section */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Wallet className="w-5 h-5" />
                        مطابقة النقد
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">رصيد النظام:</span>
                        <span>{formatCurrency(selectedSettlement.system_cash_balance)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">الرصيد الفعلي:</span>
                        <span>{formatCurrency(selectedSettlement.actual_cash_balance)}</span>
                      </div>
                      <div className="flex justify-between font-bold border-t pt-2">
                        <span>الفرق:</span>
                        <span className={selectedSettlement.cash_difference < 0 ? 'text-red-600' : selectedSettlement.cash_difference > 0 ? 'text-green-600' : ''}>
                          {formatCurrency(selectedSettlement.cash_difference)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Gold Section */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Coins className="w-5 h-5" />
                        مطابقة الذهب
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">وزن النظام:</span>
                        <span>{selectedSettlement.system_gold_weight.toFixed(2)} جرام</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">الوزن الفعلي:</span>
                        <span>{selectedSettlement.actual_gold_weight.toFixed(2)} جرام</span>
                      </div>
                      <div className="flex justify-between font-bold border-t pt-2">
                        <span>الفرق:</span>
                        <span className={selectedSettlement.gold_difference < 0 ? 'text-red-600' : selectedSettlement.gold_difference > 0 ? 'text-green-600' : ''}>
                          {selectedSettlement.gold_difference.toFixed(2)} جرام
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Sales Summary */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">ملخص المبيعات</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">عدد المبيعات</p>
                        <p className="text-xl font-bold">{selectedSettlement.total_sales_count}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">إجمالي المبيعات</p>
                        <p className="text-xl font-bold">{formatCurrency(selectedSettlement.total_sales_amount)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">عدد المرتجعات</p>
                        <p className="text-xl font-bold">{selectedSettlement.total_returns_count}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">إجمالي المرتجعات</p>
                        <p className="text-xl font-bold">{formatCurrency(selectedSettlement.total_returns_amount)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
                      <div>
                        <p className="text-sm text-muted-foreground">نقداً</p>
                        <p className="font-medium">{formatCurrency(selectedSettlement.cash_received)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">بطاقة</p>
                        <p className="font-medium">{formatCurrency(selectedSettlement.card_received)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">تحويل بنكي</p>
                        <p className="font-medium">{formatCurrency(selectedSettlement.bank_transfer_received)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {selectedSettlement.notes && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">ملاحظات</p>
                    <p className="bg-muted p-3 rounded-lg">{selectedSettlement.notes}</p>
                  </div>
                )}

                {selectedSettlement.rejection_reason && (
                  <div className="bg-red-50 border border-red-200 p-3 rounded-lg">
                    <p className="text-sm text-red-600 font-medium">سبب الرفض:</p>
                    <p className="text-red-800">{selectedSettlement.rejection_reason}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Approval Dialog */}
        <Dialog open={isApprovalDialogOpen} onOpenChange={setIsApprovalDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>اعتماد / رفض المطابقة</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-muted-foreground mb-4">
                هل تريد اعتماد أو رفض المطابقة رقم: <strong>{selectedSettlement?.settlement_number}</strong>؟
              </p>
              <div className="grid gap-2">
                <Label>سبب الرفض (في حالة الرفض)</Label>
                <Textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="اكتب سبب الرفض هنا..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setIsApprovalDialogOpen(false)}>
                إلغاء
              </Button>
              <Button 
                variant="destructive"
                onClick={() => selectedSettlement && rejectMutation.mutate({ id: selectedSettlement.id, reason: rejectionReason })}
                disabled={!rejectionReason || rejectMutation.isPending}
              >
                <XCircle className="w-4 h-4 ml-2" />
                رفض
              </Button>
              <Button 
                onClick={() => selectedSettlement && approveMutation.mutate(selectedSettlement.id)}
                disabled={approveMutation.isPending}
              >
                <CheckCircle className="w-4 h-4 ml-2" />
                اعتماد
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Submit for Approval Dialog */}
        <Dialog open={isSubmitDialogOpen} onOpenChange={setIsSubmitDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إرسال للموافقة</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <p className="text-muted-foreground">
                اختر المسؤول الذي سيراجع المطابقة رقم: <strong>{selectedSettlement?.settlement_number}</strong>
              </p>
              <div className="grid gap-2">
                <Label>المسؤول *</Label>
                <Select
                  value={selectedApprover}
                  onValueChange={setSelectedApprover}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر المسؤول للموافقة" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvers.map((approver) => (
                      <SelectItem key={approver.id} value={approver.id}>
                        {approver.full_name || approver.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSubmitDialogOpen(false)}>
                إلغاء
              </Button>
              <Button 
                onClick={() => {
                  if (selectedSettlement && selectedApprover) {
                    const approver = approvers.find(a => a.id === selectedApprover);
                    submitMutation.mutate({
                      id: selectedSettlement.id,
                      approverId: selectedApprover,
                      approverName: approver?.full_name || approver?.email || ''
                    });
                  }
                }}
                disabled={!selectedApprover || submitMutation.isPending}
              >
                <Send className="w-4 h-4 ml-2" />
                إرسال للموافقة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}