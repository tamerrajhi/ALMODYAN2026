import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { useNavigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { Plus, ChevronDown, ChevronLeft, FileText, ExternalLink, CalendarIcon, X, Download, Search, ArrowUpDown, ArrowUp, ArrowDown, Check, Ban, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ar } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { referenceTypeLabels, referenceTypeColors, getReferenceTypeLabel, getReferenceTypeColor } from '@/lib/journal-entry-types';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { checkAllAccountsLinkages, type AccountLinkageResult } from '@/lib/account-linkage-check';
import AccountPreviewDialog from '@/components/accounting/AccountPreviewDialog';
import { queryTable, rpc } from '@/lib/dataGateway';
import * as apiClient from '@/lib/apiClient';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_name_en: string | null;
  account_type: AccountType;
  parent_id: string | null;
  is_active: boolean;
  is_system: boolean;
  description: string | null;
  current_balance: number;
  entry_count?: number;
  children?: Account[];
}

const accountTypeLabels: Record<AccountType, string> = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};

const accountTypeColors: Record<AccountType, string> = {
  asset: 'bg-blue-500/20 text-blue-400',
  liability: 'bg-red-500/20 text-red-400',
  equity: 'bg-purple-500/20 text-purple-400',
  revenue: 'bg-green-500/20 text-green-400',
  expense: 'bg-orange-500/20 text-orange-400',
};

// Prefix for each account type
const accountTypePrefixes: Record<AccountType, string> = {
  asset: '1',
  liability: '2',
  equity: '3',
  revenue: '4',
  expense: '5',
};

interface JournalEntryWithDetails {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  reference_type: string | null;
  is_posted: boolean;
  debit_amount: number;
  credit_amount: number;
}


export default function ChartOfAccountsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [entriesDialogOpen, setEntriesDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [entriesDateFrom, setEntriesDateFrom] = useState<Date | undefined>(undefined);
  const [entriesDateTo, setEntriesDateTo] = useState<Date | undefined>(undefined);
  const [entriesSearchQuery, setEntriesSearchQuery] = useState('');
  const [entriesTypeFilter, setEntriesTypeFilter] = useState<string>('all');
  const [entriesSortBy, setEntriesSortBy] = useState<'date' | 'debit' | 'credit'>('date');
  const [entriesSortOrder, setEntriesSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showAggregateBalances, setShowAggregateBalances] = useState(true);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewAccount, setPreviewAccount] = useState<Account | null>(null);
  const [formData, setFormData] = useState({
    account_code: '',
    account_name: '',
    account_name_en: '',
    account_type: 'asset' as AccountType,
    parent_id: '',
    description: '',
  });

  // Fetch accounts
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['chart-of-accounts'],
    queryFn: async () => {
      const { data, error } = await queryTable<Account[]>('chart_of_accounts', {
        select: '*',
        order: { column: 'account_code', ascending: true },
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // Fetch actual balances and entry counts from posted journal entries
  const { data: accountStats = { balances: {}, entryCounts: {} } } = useQuery({
    queryKey: ['account-stats'],
    queryFn: async () => {
      const { data, error } = await apiClient.get<{ balances: Record<string, number>; entryCounts: Record<string, number> }>('/api/account-stats');
      if (error) throw new Error(error.message);
      return data || { balances: {}, entryCounts: {} };
    },
  });

  // Merge accounts with their actual balances and entry counts
  const accountsWithBalances = accounts.map(account => ({
    ...account,
    current_balance: accountStats.balances[account.id] || 0,
    entry_count: accountStats.entryCounts[account.id] || 0,
  }));

  // Fetch account linkages for all accounts
  const { data: accountLinkages = {} } = useQuery({
    queryKey: ['account-linkages', accounts.map(a => a.id).join(',')],
    enabled: accounts.length > 0,
    queryFn: async () => {
      const accountIds = accounts.map(a => a.id);
      const simpleAccounts = accounts.map(a => ({
        id: a.id,
        parent_id: a.parent_id,
        is_system: a.is_system,
      }));
      return checkAllAccountsLinkages(accountIds, accountStats, simpleAccounts);
    },
  });

  // Generate next account code based on type and parent
  const generateAccountCode = (accountType: AccountType, parentId: string): string => {
    const prefix = accountTypePrefixes[accountType];
    
    if (parentId) {
      // Find parent account
      const parentAccount = accounts.find(a => a.id === parentId);
      if (parentAccount) {
        // Get children of this parent
        const siblings = accounts.filter(a => a.parent_id === parentId);
        const nextNum = siblings.length + 1;
        // Parent code + next number (2 digits)
        return `${parentAccount.account_code}${nextNum.toString().padStart(2, '0')}`;
      }
    }
    
    // Get root accounts of this type (no parent)
    const rootAccounts = accounts.filter(a => 
      a.account_type === accountType && !a.parent_id
    );
    const nextNum = rootAccounts.length + 1;
    // Type prefix + next number (3 digits)
    return `${prefix}${nextNum.toString().padStart(3, '0')}`;
  };

  // Update account code when type or parent changes
  const updateAccountCode = (type: AccountType, parentId: string) => {
    if (!editingAccount) {
      const newCode = generateAccountCode(type, parentId);
      setFormData(prev => ({ ...prev, account_code: newCode, account_type: type, parent_id: parentId }));
    }
  };

  const buildTree = (accounts: Account[]): Account[] => {
    const map = new Map<string, Account>();
    const roots: Account[] = [];

    accounts.forEach(account => {
      map.set(account.id, { ...account, children: [] });
    });

    accounts.forEach(account => {
      const node = map.get(account.id)!;
      if (account.parent_id && map.has(account.parent_id)) {
        map.get(account.parent_id)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  };

  const createAccountMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        account_code: data.account_code,
        account_name: data.account_name,
        account_name_en: data.account_name_en || null,
        account_type: data.account_type,
        parent_id: data.parent_id || null,
      };
      const res = await rpc('create_chart_of_account_atomic', { p_payload: payload });
      if (res.error) throw new Error(res.error.message || 'حدث خطأ أثناء إضافة الحساب');
      const result = res.data as any;
      if (result?.error) throw new Error(result.error.message || 'حدث خطأ أثناء إضافة الحساب');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast.success('تم إضافة الحساب بنجاح');
      resetForm();
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء إضافة الحساب');
    },
  });

  const updateAccountMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      const payload = {
        account_id: data.id,
        account_name: data.account_name,
        account_name_en: data.account_name_en || null,
        parent_id: data.parent_id || null,
      };
      const res = await rpc('update_chart_of_account_atomic', { p_payload: payload });
      if (res.error) throw new Error(res.error.message || 'حدث خطأ أثناء تحديث الحساب');
      const result = res.data as any;
      if (result && !result.success) throw new Error(result.error || 'حدث خطأ أثناء تحديث الحساب');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account-linkages'] });
      toast.success('تم تحديث الحساب بنجاح');
      resetForm();
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء تحديث الحساب');
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await rpc('delete_chart_of_account_atomic', { p_payload: { account_id: id } });
      if (res.error) throw new Error(res.error.message || 'حدث خطأ أثناء حذف الحساب');
      const result = res.data as any;
      if (result && !result.success) throw new Error(result.error || 'حدث خطأ أثناء حذف الحساب');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account-linkages'] });
      toast.success('تم حذف الحساب بنجاح');
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء حذف الحساب');
    },
  });

  // Handle opening preview dialog
  const handleOpenPreview = (account: Account) => {
    setPreviewAccount(account);
    setPreviewDialogOpen(true);
  };

  // Handle delete with confirmation
  const handleDelete = (account: Account) => {
    if (confirm('هل أنت متأكد من حذف هذا الحساب؟ هذا الإجراء لا يمكن التراجع عنه.')) {
      deleteAccountMutation.mutate(account.id);
    }
  };

  const resetForm = () => {
    setFormData({
      account_code: '',
      account_name: '',
      account_name_en: '',
      account_type: 'asset',
      parent_id: '',
      description: '',
    });
    setEditingAccount(null);
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setFormData({
      account_code: account.account_code,
      account_name: account.account_name,
      account_name_en: account.account_name_en || '',
      account_type: account.account_type,
      parent_id: account.parent_id || '',
      description: account.description || '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingAccount) {
      updateAccountMutation.mutate({ ...formData, id: editingAccount.id });
    } else {
      createAccountMutation.mutate(formData);
    }
  };

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedAccounts);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedAccounts(newExpanded);
  };

  // Fetch journal entries for selected account
  const { data: accountEntries = [], isLoading: isLoadingEntries } = useQuery({
    queryKey: ['account-journal-entries', selectedAccount?.id, entriesDateFrom?.toISOString(), entriesDateTo?.toISOString()],
    enabled: !!selectedAccount?.id && entriesDialogOpen,
    queryFn: async () => {
      if (!selectedAccount?.id) return [];
      
      const params = new URLSearchParams({ account_id: selectedAccount.id });
      if (entriesDateFrom) params.set('date_from', format(entriesDateFrom, 'yyyy-MM-dd'));
      if (entriesDateTo) params.set('date_to', format(entriesDateTo, 'yyyy-MM-dd'));
      
      const { data, error } = await apiClient.get<any[]>(`/api/account-entries?${params.toString()}`);
      if (error) throw new Error(error.message);
      
      const entriesMap = new Map<string, JournalEntryWithDetails>();
      (data || []).forEach((line: any) => {
        if (!entriesMap.has(line.je_id)) {
          entriesMap.set(line.je_id, {
            id: line.je_id,
            entry_number: line.entry_number,
            entry_date: line.entry_date,
            description: line.description,
            reference_type: line.reference_type,
            is_posted: line.is_posted,
            debit_amount: 0,
            credit_amount: 0,
          });
        }
        const entry = entriesMap.get(line.je_id)!;
        entry.debit_amount += parseFloat(line.debit_amount) || 0;
        entry.credit_amount += parseFloat(line.credit_amount) || 0;
      });
      
      return Array.from(entriesMap.values()).sort((a, b) => 
        new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime()
      );
    },
  });

  const handleOpenEntries = (account: Account) => {
    setSelectedAccount(account);
    setEntriesDateFrom(undefined);
    setEntriesDateTo(undefined);
    setEntriesSearchQuery('');
    setEntriesTypeFilter('all');
    setEntriesDialogOpen(true);
  };

  const clearDateFilters = () => {
    setEntriesDateFrom(undefined);
    setEntriesDateTo(undefined);
  };

  const setCurrentMonth = () => {
    const now = new Date();
    setEntriesDateFrom(startOfMonth(now));
    setEntriesDateTo(endOfMonth(now));
  };

  // Filter and sort entries
  const filteredEntries = accountEntries
    .filter((entry) => {
      // Type filter
      if (entriesTypeFilter !== 'all') {
        const entryType = entry.reference_type || 'manual';
        if (entryType !== entriesTypeFilter) return false;
      }
      // Search filter
      if (!entriesSearchQuery.trim()) return true;
      const query = entriesSearchQuery.toLowerCase().trim();
      return (
        entry.entry_number.toLowerCase().includes(query) ||
        (entry.description?.toLowerCase().includes(query) ?? false)
      );
    })
    .sort((a, b) => {
      let comparison = 0;
      if (entriesSortBy === 'date') {
        comparison = new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime();
      } else if (entriesSortBy === 'debit') {
        comparison = (a.debit_amount || 0) - (b.debit_amount || 0);
      } else if (entriesSortBy === 'credit') {
        comparison = (a.credit_amount || 0) - (b.credit_amount || 0);
      }
      return entriesSortOrder === 'asc' ? comparison : -comparison;
    });

  const handleSort = (column: 'date' | 'debit' | 'credit') => {
    if (entriesSortBy === column) {
      setEntriesSortOrder(entriesSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setEntriesSortBy(column);
      setEntriesSortOrder('desc');
    }
  };

  const getSortIcon = (column: 'date' | 'debit' | 'credit') => {
    if (entriesSortBy !== column) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return entriesSortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const renderAccountRow = (account: Account, level: number = 0): React.ReactNode[] => {
    const hasChildren = account.children && account.children.length > 0;
    const isExpanded = expandedAccounts.has(account.id);
    const rows: React.ReactNode[] = [];

    rows.push(
      <TableRow key={account.id} className="hover:bg-muted/50">
        <TableCell>
          <div className="flex items-center gap-2" style={{ paddingRight: `${level * 24}px` }}>
            {hasChildren && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => toggleExpand(account.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </Button>
            )}
            {!hasChildren && <div className="w-6" />}
            <span className="font-mono text-sm">{account.account_code}</span>
          </div>
        </TableCell>
        <TableCell className="font-medium">{account.account_name}</TableCell>
        <TableCell className="text-muted-foreground">{account.account_name_en || '-'}</TableCell>
        <TableCell>
          <Badge variant="outline" className={accountTypeColors[account.account_type]}>
            {accountTypeLabels[account.account_type]}
          </Badge>
        </TableCell>
        <TableCell className="text-left font-mono">
          {account.current_balance?.toLocaleString() || '0'}
        </TableCell>
        <TableCell className="text-center">
          {(account.entry_count || 0) > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-1 font-mono hover:bg-primary/10"
              onClick={() => handleOpenEntries(account)}
            >
              <Badge variant="secondary" className="font-mono cursor-pointer hover:bg-primary/20">
                {account.entry_count}
              </Badge>
            </Button>
          ) : (
            <Badge variant="secondary" className="font-mono opacity-50">
              0
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-center">
          {(() => {
            const hasTransactions = (account.entry_count || 0) > 0;
            const hasBalance = (account.current_balance || 0) !== 0;
            const hasChildren = account.children && account.children.length > 0;
            const isSystem = account.is_system;
            
            if (isSystem) {
              return (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30 gap-1">
                  <Lock className="h-3 w-3" />
                  نظامي
                </Badge>
              );
            }
            
            if (hasTransactions || hasBalance || hasChildren) {
              const reasons: string[] = [];
              if (hasTransactions) reasons.push('عمليات');
              if (hasBalance) reasons.push('رصيد');
              if (hasChildren) reasons.push('فرعيات');
              
              return (
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 gap-1" title={`السبب: ${reasons.join('، ')}`}>
                  <Ban className="h-3 w-3" />
                  محمي
                </Badge>
              );
            }
            
            return (
              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 gap-1">
                <Check className="h-3 w-3" />
                قابل للحذف
              </Badge>
            );
          })()}
        </TableCell>
        <TableCell>
          {(() => {
            const linkage = accountLinkages[account.id];
            const canEdit = linkage?.canEdit ?? false;
            const canDelete = linkage?.canDelete ?? false;

            return (
              <RowActionsMenu
                onPreview={() => handleOpenPreview(account)}
                onEdit={canEdit ? () => handleEdit(account) : undefined}
                onDelete={canDelete ? () => handleDelete(account) : undefined}
                labels={{
                  preview: 'معاينة الحساب',
                  edit: 'تعديل الحساب',
                  delete: 'حذف الحساب',
                }}
              />
            );
          })()}
        </TableCell>
      </TableRow>
    );

    if (hasChildren && isExpanded) {
      account.children!.forEach(child => {
        rows.push(...renderAccountRow(child, level + 1));
      });
    }

    return rows;
  };

  const applyRollups = (nodes: Account[]): Account[] => {
    const visit = (node: Account): Account => {
      const children = (node.children || []).map(visit);
      const hasChildren = children.length > 0;

      const childrenBalance = children.reduce((sum, c) => sum + (c.current_balance || 0), 0);
      const childrenCount = children.reduce((sum, c) => sum + (c.entry_count || 0), 0);

      return {
        ...node,
        children,
        current_balance: hasChildren ? childrenBalance : (node.current_balance || 0),
        entry_count: hasChildren ? childrenCount : (node.entry_count || 0),
      };
    };

    return nodes.map(visit);
  };

  const rawTree = buildTree(accountsWithBalances);
  const tree = showAggregateBalances ? applyRollups(rawTree) : rawTree;

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold">دليل الحسابات</h1>
            <p className="text-muted-foreground">إدارة شجرة الحسابات المحاسبية</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 rounded-lg">
              <Label htmlFor="aggregate-toggle" className="text-sm cursor-pointer">
                {showAggregateBalances ? 'أرصدة تجميعية' : 'أرصدة مباشرة'}
              </Label>
              <Switch
                id="aggregate-toggle"
                checked={showAggregateBalances}
                onCheckedChange={setShowAggregateBalances}
              />
            </div>

          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              resetForm();
            } else if (!editingAccount) {
              // Generate initial code when opening for new account
              const initialCode = generateAccountCode('asset', '');
              setFormData(prev => ({ ...prev, account_code: initialCode }));
            }
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                إضافة حساب
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingAccount ? 'تعديل حساب' : 'إضافة حساب جديد'}
                </DialogTitle>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>نوع الحساب</Label>
                    <Select
                      value={formData.account_type}
                      onValueChange={(value: AccountType) => {
                        if (editingAccount) {
                          setFormData({ ...formData, account_type: value, parent_id: '' });
                        } else {
                          updateAccountCode(value, '');
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(accountTypeLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>رقم الحساب</Label>
                    <Input
                      value={formData.account_code}
                      onChange={(e) => setFormData({ ...formData, account_code: e.target.value })}
                      placeholder="سيتم توليده تلقائياً"
                      readOnly={!editingAccount}
                      className={!editingAccount ? 'bg-muted cursor-not-allowed' : ''}
                      required
                    />
                    {!editingAccount && (
                      <p className="text-xs text-muted-foreground">يتم توليد الرقم تلقائياً</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>اسم الحساب (عربي)</Label>
                  <Input
                    value={formData.account_name}
                    onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                    placeholder="اسم الحساب"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>اسم الحساب (إنجليزي)</Label>
                  <Input
                    value={formData.account_name_en}
                    onChange={(e) => setFormData({ ...formData, account_name_en: e.target.value })}
                    placeholder="Account Name"
                  />
                </div>

                <div className="space-y-2">
                  <Label>الحساب الأب</Label>
                  <Select
                    value={formData.parent_id || '_none'}
                    onValueChange={(value) => {
                      const parentId = value === '_none' ? '' : value;
                      if (editingAccount) {
                        setFormData({ ...formData, parent_id: parentId });
                      } else {
                        updateAccountCode(formData.account_type, parentId);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الحساب الأب (اختياري)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">بدون حساب أب</SelectItem>
                      {accounts
                        .filter(a => {
                          // Filter by type and exclude self
                          if (a.id === editingAccount?.id) return false;
                          if (a.account_type !== formData.account_type) return false;
                          
                          // For new accounts, exclude accounts that have transactions
                          if (!editingAccount) {
                            const entryCount = accountStats.entryCounts[a.id] || 0;
                            if (entryCount > 0) return false;
                          }
                          
                          return true;
                        })
                        .map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.account_code} - {account.account_name}
                            {(accountStats.entryCounts[account.id] || 0) > 0 && (
                              <span className="text-muted-foreground mr-2">(عليه عمليات)</span>
                            )}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {formData.account_type && (
                    <p className="text-xs text-muted-foreground">
                      {editingAccount 
                        ? `يظهر فقط حسابات ${accountTypeLabels[formData.account_type]}`
                        : `يظهر فقط حسابات ${accountTypeLabels[formData.account_type]} التي ليس عليها عمليات`
                      }
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>الوصف</Label>
                  <Input
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="وصف اختياري للحساب"
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    إلغاء
                  </Button>
                  <Button type="submit" disabled={createAccountMutation.isPending || updateAccountMutation.isPending}>
                    {editingAccount ? 'تحديث' : 'إضافة'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        <div className="responsive-table-wrapper">
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">رقم الحساب</TableHead>
                <TableHead>اسم الحساب</TableHead>
                <TableHead>الاسم بالإنجليزية</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead className="text-left">الرصيد</TableHead>
                <TableHead className="text-center">عدد القيود</TableHead>
                <TableHead className="text-center">الحالة</TableHead>
                <TableHead className="w-24">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    جاري التحميل...
                  </TableCell>
                </TableRow>
              ) : tree.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    لا توجد حسابات
                  </TableCell>
                </TableRow>
              ) : (
                tree.map(account => renderAccountRow(account))
              )}
            </TableBody>
          </Table>
        </div>
        </div>

        {/* Journal Entries Dialog */}
        <Dialog open={entriesDialogOpen} onOpenChange={setEntriesDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                القيود المحاسبية للحساب: {selectedAccount?.account_code} - {selectedAccount?.account_name}
              </DialogTitle>
            </DialogHeader>

            {/* Date Filters */}
            <div className="flex flex-wrap items-center gap-3 pb-4 border-b">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">من:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-[140px] justify-start text-left font-normal",
                        !entriesDateFrom && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {entriesDateFrom ? format(entriesDateFrom, 'dd/MM/yyyy') : "تاريخ البداية"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={entriesDateFrom}
                      onSelect={setEntriesDateFrom}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">إلى:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-[140px] justify-start text-left font-normal",
                        !entriesDateTo && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {entriesDateTo ? format(entriesDateTo, 'dd/MM/yyyy') : "تاريخ النهاية"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={entriesDateTo}
                      onSelect={setEntriesDateTo}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <Button variant="secondary" size="sm" onClick={setCurrentMonth}>
                الشهر الحالي
              </Button>

              {(entriesDateFrom || entriesDateTo) && (
                <Button variant="ghost" size="sm" onClick={clearDateFilters} className="gap-1">
                  <X className="h-4 w-4" />
                  مسح الفلتر
                </Button>
              )}
            </div>

            {/* Search and Type Filter */}
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="بحث برقم القيد أو الوصف..."
                  value={entriesSearchQuery}
                  onChange={(e) => setEntriesSearchQuery(e.target.value)}
                  className="pr-10"
                />
              </div>
              <Select value={entriesTypeFilter} onValueChange={setEntriesTypeFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="نوع القيد" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="manual">يدوي</SelectItem>
                  <SelectItem value="sale">مبيعات</SelectItem>
                  <SelectItem value="purchase">مشتريات</SelectItem>
                  <SelectItem value="sale_return">مرتجع مبيعات</SelectItem>
                  <SelectItem value="purchase_return">مرتجع مشتريات</SelectItem>
                  <SelectItem value="payment">صرف</SelectItem>
                  <SelectItem value="receipt">قبض</SelectItem>
                  <SelectItem value="inventory_shortage">عجز مخزون</SelectItem>
                  <SelectItem value="inventory_overage">زيادة مخزون</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="h-[50vh]">
              {isLoadingEntries ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-muted-foreground">جاري التحميل...</span>
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-muted-foreground">
                    {entriesSearchQuery ? 'لا توجد نتائج للبحث' : 'لا توجد قيود مرتبطة بهذا الحساب'}
                  </span>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم القيد</TableHead>
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 gap-1 font-medium hover:bg-transparent"
                          onClick={() => handleSort('date')}
                        >
                          التاريخ
                          {getSortIcon('date')}
                        </Button>
                      </TableHead>
                      <TableHead>الوصف</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead className="text-left">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 gap-1 font-medium hover:bg-transparent"
                          onClick={() => handleSort('debit')}
                        >
                          مدين
                          {getSortIcon('debit')}
                        </Button>
                      </TableHead>
                      <TableHead className="text-left">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 gap-1 font-medium hover:bg-transparent"
                          onClick={() => handleSort('credit')}
                        >
                          دائن
                          {getSortIcon('credit')}
                        </Button>
                      </TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEntries.map((entry) => (
                      <TableRow key={entry.id} className="hover:bg-muted/50">
                        <TableCell className="font-mono">{entry.entry_number}</TableCell>
                        <TableCell>
                          {format(new Date(entry.entry_date), 'dd/MM/yyyy', { locale: ar })}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate">
                          {entry.description || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${referenceTypeColors[entry.reference_type || 'manual'] || referenceTypeColors.manual}`}
                          >
                            {referenceTypeLabels[entry.reference_type || 'manual'] || 'يدوي'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-left text-green-600">
                          {entry.debit_amount > 0 ? entry.debit_amount.toLocaleString() : '-'}
                        </TableCell>
                        <TableCell className="font-mono text-left text-red-600">
                          {entry.credit_amount > 0 ? entry.credit_amount.toLocaleString() : '-'}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => navigate(`/accounting/journal-entries?entry=${entry.id}`)}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>

            {/* Totals Summary */}
            {filteredEntries.length > 0 && (() => {
              const totalDebit = filteredEntries.reduce((sum, e) => sum + (e.debit_amount || 0), 0);
              const totalCredit = filteredEntries.reduce((sum, e) => sum + (e.credit_amount || 0), 0);
              const netBalance = totalDebit - totalCredit;
              
              return (
                <div className="grid grid-cols-4 gap-4 py-3 px-4 bg-muted/50 rounded-lg">
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">عدد القيود</div>
                    <div className="font-bold text-lg">{filteredEntries.length}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">إجمالي المدين</div>
                    <div className="font-bold text-lg text-green-600">
                      {totalDebit.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">إجمالي الدائن</div>
                    <div className="font-bold text-lg text-red-600">
                      {totalCredit.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">الرصيد</div>
                    <div className={cn(
                      "font-bold text-lg",
                      netBalance > 0 ? "text-green-600" : netBalance < 0 ? "text-red-600" : "text-muted-foreground"
                    )}>
                      {netBalance.toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-between items-center pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                {entriesDateFrom || entriesDateTo ? (
                  <span>
                    الفترة: {entriesDateFrom ? format(entriesDateFrom, 'dd/MM/yyyy') : '...'} - {entriesDateTo ? format(entriesDateTo, 'dd/MM/yyyy') : '...'}
                  </span>
                ) : (
                  <span>جميع القيود</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    if (filteredEntries.length === 0) {
                      toast.error('لا توجد قيود للتصدير');
                      return;
                    }
                    
                    const exportData = filteredEntries.map((entry) => ({
                      'رقم القيد': entry.entry_number,
                      'التاريخ': format(new Date(entry.entry_date), 'dd/MM/yyyy'),
                      'الوصف': entry.description || '',
                      'النوع': referenceTypeLabels[entry.reference_type || 'manual'] || 'يدوي',
                      'مدين': entry.debit_amount || 0,
                      'دائن': entry.credit_amount || 0,
                    }));
                    
                    // Add totals row
                    const totalDebit = filteredEntries.reduce((sum, e) => sum + (e.debit_amount || 0), 0);
                    const totalCredit = filteredEntries.reduce((sum, e) => sum + (e.credit_amount || 0), 0);
                    exportData.push({
                      'رقم القيد': '',
                      'التاريخ': '',
                      'الوصف': 'الإجمالي',
                      'النوع': '',
                      'مدين': totalDebit,
                      'دائن': totalCredit,
                    });
                    
                    const ws = XLSX.utils.json_to_sheet(exportData);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'القيود');
                    
                    // Set column widths
                    ws['!cols'] = [
                      { wch: 20 }, // رقم القيد
                      { wch: 12 }, // التاريخ
                      { wch: 35 }, // الوصف
                      { wch: 15 }, // النوع
                      { wch: 15 }, // مدين
                      { wch: 15 }, // دائن
                    ];
                    
                    const dateRange = entriesDateFrom || entriesDateTo
                      ? `_${entriesDateFrom ? format(entriesDateFrom, 'yyyy-MM-dd') : ''}_${entriesDateTo ? format(entriesDateTo, 'yyyy-MM-dd') : ''}`
                      : '';
                    const fileName = `قيود_${selectedAccount?.account_code}${dateRange}.xlsx`;
                    
                    XLSX.writeFile(wb, fileName);
                    toast.success('تم تصدير القيود بنجاح');
                  }}
                  disabled={filteredEntries.length === 0}
                >
                  <Download className="h-4 w-4" />
                  تصدير Excel
                </Button>
                <Button variant="outline" onClick={() => setEntriesDialogOpen(false)}>
                  إغلاق
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        {/* Account Preview Dialog */}
        <AccountPreviewDialog
          account={previewAccount}
          open={previewDialogOpen}
          onOpenChange={setPreviewDialogOpen}
          linkages={previewAccount ? accountLinkages[previewAccount.id] || null : null}
        />
      </div>
    </MainLayout>
  );
}
