import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
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
  Plus,
  ArrowDownCircle,
  ArrowUpCircle,
  Wallet,
  Loader2,
  Search,
  RefreshCw,
  Banknote,
  CreditCard,
  Building2,
} from 'lucide-react';
import { logAudit } from '@/lib/audit';
import { createCashVaultJournalEntry } from '@/lib/accounting';

interface CashVault {
  id: string;
  branch_id: string | null;
  vault_name: string;
  account_id: string | null;
  is_active: boolean;
  created_at: string;
  branches?: { branch_name: string } | null;
}

interface CashVaultTransaction {
  id: string;
  vault_id: string;
  transaction_type: string;
  amount: number;
  currency: string;
  payment_method: string | null;
  reference_type: string | null;
  reference_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  notes: string | null;
  performed_by: string | null;
  journal_entry_id: string | null;
  transaction_date: string;
  cash_vaults?: { vault_name: string } | null;
  customers?: { full_name: string } | null;
  suppliers?: { supplier_name: string } | null;
}

interface Customer {
  id: string;
  full_name: string;
  customer_code: string;
}

interface Supplier {
  id: string;
  supplier_name: string;
}

export default function CashVaultPage() {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedVault, setSelectedVault] = useState<string>('all');
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [transactionType, setTransactionType] = useState<'receipt' | 'payment'>('receipt');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Form state
  const [formData, setFormData] = useState({
    vault_id: '',
    amount: '',
    payment_method: 'cash',
    reference_type: '',
    customer_id: '',
    supplier_id: '',
    notes: '',
  });

  // Fetch vaults
  const { data: vaults = [], isLoading: vaultsLoading } = useQuery({
    queryKey: ['cash-vaults'],
    queryFn: async () => {
      const res = await fetch('/api/cash-vaults-with-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch cash vaults');
      return await res.json();
    },
  });

  // Fetch transactions
  const { data: transactions = [], isLoading: transactionsLoading, refetch: refetchTransactions } = useQuery({
    queryKey: ['cash-vault-transactions', selectedVault],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedVault !== 'all') params.set('vault_id', selectedVault);
      const res = await fetch(`/api/cash-vault-transactions?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch transactions');
      return await res.json();
    },
  });

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const res = await fetch('/api/customers', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch customers');
      return await res.json();
    },
  });

  // Fetch suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const res = await fetch('/api/suppliers', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch suppliers');
      return await res.json();
    },
  });

  // Calculate balances per vault
  const vaultBalances = useMemo(() => {
    const balances: Record<string, number> = {};
    
    transactions.forEach((tx) => {
      if (!balances[tx.vault_id]) balances[tx.vault_id] = 0;
      
      const amount = Number(tx.amount) || 0;
      
      if (tx.transaction_type === 'receipt') {
        balances[tx.vault_id] += amount;
      } else if (tx.transaction_type === 'payment') {
        balances[tx.vault_id] -= amount;
      }
    });
    
    return balances;
  }, [transactions]);

  // Total balance across all vaults
  const totalBalance = useMemo(() => {
    return Object.values(vaultBalances).reduce((sum, balance) => sum + balance, 0);
  }, [vaultBalances]);

  // Today's receipts and payments
  const todayStats = useMemo(() => {
    const today = new Date().toDateString();
    let receipts = 0;
    let payments = 0;
    
    transactions.forEach((tx) => {
      if (new Date(tx.transaction_date).toDateString() === today) {
        if (tx.transaction_type === 'receipt') {
          receipts += Number(tx.amount) || 0;
        } else {
          payments += Number(tx.amount) || 0;
        }
      }
    });
    
    return { receipts, payments };
  }, [transactions]);

  // Create transaction mutation
  const createTransactionMutation = useMutation({
    mutationFn: async (data: typeof formData & { transaction_type: string }) => {
      const transactionData = {
        vault_id: data.vault_id,
        transaction_type: data.transaction_type,
        amount: parseFloat(data.amount),
        currency: 'SAR',
        payment_method: data.payment_method,
        reference_type: data.reference_type || null,
        customer_id: data.customer_id || null,
        supplier_id: data.supplier_id || null,
        notes: data.notes || null,
        performed_by: user?.user_metadata?.full_name || user?.email,
      };

      forbidDirectWrite('insert', 'CashVaultPage.tsx:238');
    },
    onSuccess: () => {
      toast.success('تم تسجيل الحركة بنجاح');
      setTransactionDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['cash-vault-transactions'] });
    },
    onError: (error) => {
      console.error('Error creating transaction:', error);
      toast.error('حدث خطأ أثناء تسجيل الحركة');
    },
  });

  const resetForm = () => {
    setFormData({
      vault_id: '',
      amount: '',
      payment_method: 'cash',
      reference_type: '',
      customer_id: '',
      supplier_id: '',
      notes: '',
    });
  };

  const handleOpenTransaction = (type: 'receipt' | 'payment') => {
    setTransactionType(type);
    resetForm();
    setTransactionDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.vault_id || !formData.amount) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    createTransactionMutation.mutate({
      ...formData,
      transaction_type: transactionType,
    });
  };

  const getTransactionTypeBadge = (type: string) => {
    if (type === 'receipt') {
      return <Badge className="bg-green-100 text-green-800">قبض</Badge>;
    }
    return <Badge className="bg-red-100 text-red-800">صرف</Badge>;
  };

  const getPaymentMethodIcon = (method: string | null) => {
    switch (method) {
      case 'cash':
        return <Banknote className="w-4 h-4 text-green-600" />;
      case 'card':
        return <CreditCard className="w-4 h-4 text-blue-600" />;
      case 'transfer':
        return <Building2 className="w-4 h-4 text-purple-600" />;
      default:
        return <Wallet className="w-4 h-4 text-gray-600" />;
    }
  };

  const getReferenceTypeLabel = (type: string | null) => {
    switch (type) {
      case 'sale': return 'مبيعات';
      case 'purchase': return 'مشتريات';
      case 'expense': return 'مصاريف';
      case 'salary': return 'رواتب';
      case 'customer': return 'عميل';
      case 'supplier': return 'مورد';
      default: return 'أخرى';
    }
  };

  const filteredTransactions = transactions.filter((tx) => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      tx.cash_vaults?.vault_name?.toLowerCase().includes(searchLower) ||
      tx.customers?.full_name?.toLowerCase().includes(searchLower) ||
      tx.suppliers?.supplier_name?.toLowerCase().includes(searchLower) ||
      tx.notes?.toLowerCase().includes(searchLower)
    );
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
    }).format(amount);
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">الصندوق العام</h1>
            <p className="text-muted-foreground">إدارة حركات القبض والصرف النقدي</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleOpenTransaction('receipt')} className="bg-green-600 hover:bg-green-700">
              <ArrowDownCircle className="w-4 h-4 ml-2" />
              قبض نقدي
            </Button>
            <Button onClick={() => handleOpenTransaction('payment')} variant="destructive">
              <ArrowUpCircle className="w-4 h-4 ml-2" />
              صرف نقدي
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">إجمالي الرصيد</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(totalBalance)}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">قبض اليوم</CardTitle>
              <ArrowDownCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{formatCurrency(todayStats.receipts)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">صرف اليوم</CardTitle>
              <ArrowUpCircle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(todayStats.payments)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">عدد الصناديق</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{vaults.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Vault Balances */}
        <Card>
          <CardHeader>
            <CardTitle>أرصدة الصناديق</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {vaults.map((vault) => (
                <Card key={vault.id} className="bg-muted/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{vault.vault_name}</CardTitle>
                    <CardDescription>{vault.branches?.branch_name || 'المقر الرئيسي'}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-xl font-bold ${(vaultBalances[vault.id] || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(vaultBalances[vault.id] || 0)}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {vaults.length === 0 && (
                <div className="col-span-full text-center py-8 text-muted-foreground">
                  لا توجد صناديق مسجلة
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Transactions Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle>سجل الحركات</CardTitle>
                <CardDescription>جميع حركات القبض والصرف</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10 w-64"
                  />
                </div>
                <Select value={selectedVault} onValueChange={setSelectedVault}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="جميع الصناديق" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الصناديق</SelectItem>
                    {vaults.map((vault) => (
                      <SelectItem key={vault.id} value={vault.id}>
                        {vault.vault_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => refetchTransactions()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {transactionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                لا توجد حركات مسجلة
              </div>
            ) : (
              <div className="responsive-table-wrapper rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>الصندوق</TableHead>
                      <TableHead>نوع الحركة</TableHead>
                      <TableHead>المبلغ</TableHead>
                      <TableHead>طريقة الدفع</TableHead>
                      <TableHead>المرجع</TableHead>
                      <TableHead>العميل/المورد</TableHead>
                      <TableHead>المنفذ</TableHead>
                      <TableHead>ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(tx.transaction_date), 'yyyy/MM/dd HH:mm', { locale: ar })}
                        </TableCell>
                        <TableCell>{tx.cash_vaults?.vault_name}</TableCell>
                        <TableCell>{getTransactionTypeBadge(tx.transaction_type)}</TableCell>
                        <TableCell className={`font-medium ${tx.transaction_type === 'receipt' ? 'text-green-600' : 'text-red-600'}`}>
                          {tx.transaction_type === 'receipt' ? '+' : '-'}{formatCurrency(Number(tx.amount))}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getPaymentMethodIcon(tx.payment_method)}
                            <span className="text-sm">
                              {tx.payment_method === 'cash' && 'نقدي'}
                              {tx.payment_method === 'card' && 'بطاقة'}
                              {tx.payment_method === 'transfer' && 'تحويل'}
                              {tx.payment_method === 'check' && 'شيك'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{getReferenceTypeLabel(tx.reference_type)}</TableCell>
                        <TableCell>
                          {tx.customers?.full_name || tx.suppliers?.supplier_name || '-'}
                        </TableCell>
                        <TableCell>{tx.performed_by || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{tx.notes || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Transaction Dialog */}
      <Dialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {transactionType === 'receipt' ? 'قبض نقدي' : 'صرف نقدي'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>الصندوق *</Label>
              <Select value={formData.vault_id} onValueChange={(v) => setFormData({ ...formData, vault_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الصندوق" />
                </SelectTrigger>
                <SelectContent>
                  {vaults.map((vault) => (
                    <SelectItem key={vault.id} value={vault.id}>
                      {vault.vault_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>المبلغ (ر.س) *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>

            <div>
              <Label>طريقة الدفع</Label>
              <Select value={formData.payment_method} onValueChange={(v) => setFormData({ ...formData, payment_method: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="card">بطاقة</SelectItem>
                  <SelectItem value="transfer">تحويل بنكي</SelectItem>
                  <SelectItem value="check">شيك</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>نوع المرجع</Label>
              <Select value={formData.reference_type} onValueChange={(v) => setFormData({ ...formData, reference_type: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر نوع المرجع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sale">مبيعات</SelectItem>
                  <SelectItem value="purchase">مشتريات</SelectItem>
                  <SelectItem value="expense">مصاريف</SelectItem>
                  <SelectItem value="salary">رواتب</SelectItem>
                  <SelectItem value="customer">عميل</SelectItem>
                  <SelectItem value="supplier">مورد</SelectItem>
                  <SelectItem value="other">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {transactionType === 'receipt' && (
              <div>
                <Label>العميل</Label>
                <Select value={formData.customer_id} onValueChange={(v) => setFormData({ ...formData, customer_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر العميل (اختياري)" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.full_name} ({customer.customer_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {transactionType === 'payment' && (
              <div>
                <Label>المورد</Label>
                <Select value={formData.supplier_id} onValueChange={(v) => setFormData({ ...formData, supplier_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر المورد (اختياري)" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.supplier_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>ملاحظات</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="ملاحظات إضافية..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTransactionDialogOpen(false)}>
              إلغاء
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={createTransactionMutation.isPending}
              className={transactionType === 'payment' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}
            >
              {createTransactionMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
