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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import {
  Plus,
  ArrowDownCircle,
  ArrowUpCircle,
  ArrowRightLeft,
  Scale,
  Loader2,
  Search,
  RefreshCw,
  Coins,
} from 'lucide-react';
import { logAudit } from '@/lib/audit';
import { createGoldReceiptJournalEntry, createGoldToProductionJournalEntry } from '@/lib/accounting';

interface GoldVault {
  id: string;
  branch_id: string | null;
  vault_name: string;
  vault_type: string;
  account_id: string | null;
  is_active: boolean;
  created_at: string;
  branches?: { branch_name: string } | null;
}

interface GoldVaultTransaction {
  id: string;
  vault_id: string;
  transaction_type: string;
  gold_type: string;
  karat_id: string | null;
  weight_grams: number;
  from_vault_id: string | null;
  to_vault_id: string | null;
  reference_type: string | null;
  supplier_id: string | null;
  notes: string | null;
  performed_by: string | null;
  journal_entry_id: string | null;
  transaction_date: string;
  gold_karats?: { karat_name: string; karat_value: number } | null;
  gold_vaults?: { vault_name: string } | null;
  suppliers?: { supplier_name: string } | null;
}

interface GoldKarat {
  id: string;
  karat_name: string;
  karat_value: number;
  purity_percentage: number;
}

interface Supplier {
  id: string;
  supplier_name: string;
}

export default function GoldVaultPage() {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedVault, setSelectedVault] = useState<string>('all');
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [transactionType, setTransactionType] = useState<'receive' | 'deliver' | 'transfer'>('receive');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Form state
  const [formData, setFormData] = useState({
    vault_id: '',
    gold_type: 'pure',
    karat_id: '',
    weight_grams: '',
    supplier_id: '',
    to_vault_id: '',
    notes: '',
  });

  // Fetch vaults
  const { data: vaults = [], isLoading: vaultsLoading } = useQuery({
    queryKey: ['gold-vaults'],
    queryFn: async () => {
      const res = await fetch('/api/gold-vaults-with-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch gold vaults');
      return await res.json();
    },
  });

  // Fetch transactions
  const { data: transactions = [], isLoading: transactionsLoading, refetch: refetchTransactions } = useQuery({
    queryKey: ['gold-vault-transactions', selectedVault],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedVault !== 'all') params.set('vault_id', selectedVault);
      const res = await fetch(`/api/gold-vault-transactions?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch transactions');
      return await res.json();
    },
  });

  // Fetch karats
  const { data: karats = [] } = useQuery({
    queryKey: ['gold-karats'],
    queryFn: async () => {
      const res = await fetch('/api/gold-karats-active', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch gold karats');
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

  // Calculate balances per vault and karat
  const vaultBalances = useMemo(() => {
    const balances: Record<string, Record<string, { pure: number; scrap: number }>> = {};
    
    transactions.forEach((tx) => {
      if (!balances[tx.vault_id]) balances[tx.vault_id] = {};
      const karatKey = tx.karat_id || 'unknown';
      if (!balances[tx.vault_id][karatKey]) {
        balances[tx.vault_id][karatKey] = { pure: 0, scrap: 0 };
      }
      
      const weight = Number(tx.weight_grams) || 0;
      const goldType = tx.gold_type === 'scrap' ? 'scrap' : 'pure';
      
      if (tx.transaction_type === 'receive' || tx.transaction_type === 'transfer_in') {
        balances[tx.vault_id][karatKey][goldType] += weight;
      } else if (tx.transaction_type === 'deliver' || tx.transaction_type === 'transfer_out') {
        balances[tx.vault_id][karatKey][goldType] -= weight;
      }
    });
    
    return balances;
  }, [transactions]);

  // Total balance across all vaults
  const totalBalance = useMemo(() => {
    let total = 0;
    Object.values(vaultBalances).forEach((karatBalances) => {
      Object.values(karatBalances).forEach((balance) => {
        total += balance.pure + balance.scrap;
      });
    });
    return total;
  }, [vaultBalances]);

  // Create transaction mutation
  const createTransactionMutation = useMutation({
    mutationFn: async (data: typeof formData & { transaction_type: string }) => {
      forbidDirectWrite('insert', 'GoldVaultPage.tsx:createTransactionMutation');
    },
    onSuccess: () => {
      toast.success('تم تسجيل الحركة بنجاح');
      setTransactionDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['gold-vault-transactions'] });
    },
    onError: (error) => {
      console.error('Error creating transaction:', error);
      toast.error('حدث خطأ أثناء تسجيل الحركة');
    },
  });

  const resetForm = () => {
    setFormData({
      vault_id: '',
      gold_type: 'pure',
      karat_id: '',
      weight_grams: '',
      supplier_id: '',
      to_vault_id: '',
      notes: '',
    });
  };

  const handleOpenTransaction = (type: 'receive' | 'deliver' | 'transfer') => {
    setTransactionType(type);
    resetForm();
    setTransactionDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.vault_id || !formData.weight_grams || !formData.karat_id) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    
    if (transactionType === 'transfer' && !formData.to_vault_id) {
      toast.error('يرجى اختيار الخزنة الوجهة');
      return;
    }

    createTransactionMutation.mutate({
      ...formData,
      transaction_type: transactionType,
    });
  };

  const getTransactionTypeBadge = (type: string) => {
    switch (type) {
      case 'receive':
        return <Badge className="bg-green-100 text-green-800">استلام</Badge>;
      case 'deliver':
        return <Badge className="bg-red-100 text-red-800">تسليم</Badge>;
      case 'transfer_in':
        return <Badge className="bg-blue-100 text-blue-800">تحويل وارد</Badge>;
      case 'transfer_out':
        return <Badge className="bg-orange-100 text-orange-800">تحويل صادر</Badge>;
      default:
        return <Badge>{type}</Badge>;
    }
  };

  const getGoldTypeBadge = (type: string) => {
    switch (type) {
      case 'pure':
        return <Badge variant="outline" className="border-amber-500 text-amber-700">صافي</Badge>;
      case 'scrap':
        return <Badge variant="outline" className="border-gray-500 text-gray-700">كسر</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const filteredTransactions = transactions.filter((tx) => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      tx.gold_vaults?.vault_name?.toLowerCase().includes(searchLower) ||
      tx.suppliers?.supplier_name?.toLowerCase().includes(searchLower) ||
      tx.notes?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">خزنة الذهب الرئيسية</h1>
            <p className="text-muted-foreground">إدارة حركات استلام وتسليم الذهب</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => handleOpenTransaction('receive')} className="bg-green-600 hover:bg-green-700">
              <ArrowDownCircle className="w-4 h-4 ml-2" />
              استلام ذهب
            </Button>
            <Button onClick={() => handleOpenTransaction('deliver')} variant="destructive">
              <ArrowUpCircle className="w-4 h-4 ml-2" />
              تسليم ذهب
            </Button>
            <Button onClick={() => handleOpenTransaction('transfer')} variant="outline">
              <ArrowRightLeft className="w-4 h-4 ml-2" />
              تحويل
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">إجمالي الرصيد</CardTitle>
              <Scale className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{totalBalance.toFixed(2)} جرام</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">عدد الخزائن</CardTitle>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{vaults.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">حركات اليوم</CardTitle>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {transactions.filter((tx) => 
                  new Date(tx.transaction_date).toDateString() === new Date().toDateString()
                ).length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">آخر عيار</CardTitle>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {transactions[0]?.gold_karats?.karat_name || '-'}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Vault Balances by Karat */}
        <Card>
          <CardHeader>
            <CardTitle>أرصدة الخزائن حسب العيار</CardTitle>
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
                    <div className="space-y-2">
                      {vaultBalances[vault.id] ? (
                        Object.entries(vaultBalances[vault.id]).map(([karatId, balance]) => {
                          const karat = karats.find((k) => k.id === karatId);
                          const total = balance.pure + balance.scrap;
                          if (total === 0) return null;
                          return (
                            <div key={karatId} className="flex justify-between items-center text-sm">
                              <span>{karat?.karat_name || 'غير محدد'}</span>
                              <span className="font-medium">{total.toFixed(2)} جم</span>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-muted-foreground text-sm">لا يوجد رصيد</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Transactions Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle>سجل الحركات</CardTitle>
                <CardDescription>جميع حركات الذهب الواردة والصادرة</CardDescription>
              </div>
              <div className="flex gap-2">
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
                    <SelectValue placeholder="جميع الخزائن" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الخزائن</SelectItem>
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
                      <TableHead>الخزنة</TableHead>
                      <TableHead>نوع الحركة</TableHead>
                      <TableHead>نوع الذهب</TableHead>
                      <TableHead>العيار</TableHead>
                      <TableHead>الوزن (جم)</TableHead>
                      <TableHead>المورد</TableHead>
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
                        <TableCell>{tx.gold_vaults?.vault_name}</TableCell>
                        <TableCell>{getTransactionTypeBadge(tx.transaction_type)}</TableCell>
                        <TableCell>{getGoldTypeBadge(tx.gold_type)}</TableCell>
                        <TableCell>{tx.gold_karats?.karat_name || '-'}</TableCell>
                        <TableCell className="font-medium">{Number(tx.weight_grams).toFixed(2)}</TableCell>
                        <TableCell>{tx.suppliers?.supplier_name || '-'}</TableCell>
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
              {transactionType === 'receive' && 'استلام ذهب'}
              {transactionType === 'deliver' && 'تسليم ذهب'}
              {transactionType === 'transfer' && 'تحويل بين الخزائن'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>الخزنة {transactionType === 'transfer' ? 'المصدر' : ''} *</Label>
              <Select value={formData.vault_id} onValueChange={(v) => setFormData({ ...formData, vault_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الخزنة" />
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

            {transactionType === 'transfer' && (
              <div>
                <Label>الخزنة الوجهة *</Label>
                <Select value={formData.to_vault_id} onValueChange={(v) => setFormData({ ...formData, to_vault_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الخزنة الوجهة" />
                  </SelectTrigger>
                  <SelectContent>
                    {vaults.filter((v) => v.id !== formData.vault_id).map((vault) => (
                      <SelectItem key={vault.id} value={vault.id}>
                        {vault.vault_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>نوع الذهب *</Label>
              <Select value={formData.gold_type} onValueChange={(v) => setFormData({ ...formData, gold_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pure">ذهب صافي</SelectItem>
                  <SelectItem value="scrap">ذهب كسر</SelectItem>
                  <SelectItem value="alloy">سبيكة</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>العيار *</Label>
              <Select value={formData.karat_id} onValueChange={(v) => setFormData({ ...formData, karat_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر العيار" />
                </SelectTrigger>
                <SelectContent>
                  {karats.map((karat) => (
                    <SelectItem key={karat.id} value={karat.id}>
                      {karat.karat_name} ({karat.purity_percentage}%)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>الوزن (جرام) *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.weight_grams}
                onChange={(e) => setFormData({ ...formData, weight_grams: e.target.value })}
                placeholder="0.00"
              />
            </div>

            {transactionType === 'receive' && (
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
              className={transactionType === 'deliver' ? 'bg-red-600 hover:bg-red-700' : ''}
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
