import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { queryTable, rpc } from '@/lib/dataGateway';
import { useModules } from '@/core/contexts/ModuleContext';
import * as apiClient from '@/lib/apiClient';
import { logAudit } from '@/lib/audit';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AccountCombobox, type HierarchicalAccount } from '@/components/accounting/AccountCombobox';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Plus, Eye, Check, X, Trash2, Pencil, Filter, FileText, Printer, Building2, User, Calendar, Receipt, Undo2, RotateCcw, AlertTriangle, Wrench } from 'lucide-react';
import { rebuildJournalEntryLines, fixUnbalancedJournalEntry } from '@/lib/accounting';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import { useReactToPrint } from 'react-to-print';
import PrintableInvoice from '@/components/invoices/PrintableInvoice';
import PrintableJournalEntry from '@/components/accounting/PrintableJournalEntry';
import { referenceTypeLabels, referenceTypeColors, getReferenceTypeLabel, getReferenceTypeColor } from '@/lib/journal-entry-types';

interface InvoiceItem {
  id: string;
  sale_price?: number;
  return_price?: number;
  unique_items?: {
    serial_no: string;
    model: string | null;
    description: string | null;
    type: string | null;
    metal: string | null;
    g_weight: number | null;
    d_weight: number | null;
    b_weight: number | null;
    clarity: string | null;
    stone: string | null;
  };
}

interface InvoiceDetails {
  id: string;
  invoice_number: string;
  invoice_type: string;
  invoice_date: string;
  due_date: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  sale_id: string | null;
  return_id: string | null;
  branch_id: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  subtotal: number | null;
  tax_amount: number | null;
  discount_amount: number | null;
  status: string;
  notes: string | null;
  customer?: { full_name: string; customer_code: string; phone?: string; email?: string; vat_number?: string };
  supplier?: { supplier_name: string };
  branch?: { branch_name: string };
}

const invoiceTypeLabels: Record<string, string> = {
  sales: 'فاتورة مبيعات',
  purchase: 'فاتورة مشتريات',
  sales_return: 'مرتجع مبيعات',
  purchase_return: 'مرتجع مشتريات',
};

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: 'معلقة', color: 'bg-yellow-500/20 text-yellow-400' },
  partial: { label: 'مدفوعة جزئياً', color: 'bg-blue-500/20 text-blue-400' },
  paid: { label: 'مدفوعة', color: 'bg-green-500/20 text-green-400' },
  cancelled: { label: 'ملغاة', color: 'bg-red-500/20 text-red-400' },
};

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  parent_id: string | null;
}


interface JournalEntryLine {
  id?: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
  account?: {
    id: string;
    account_code: string;
    account_name: string;
  };
}

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  is_posted: boolean;
  total_debit: number;
  total_credit: number;
  created_at: string;
  journal_entry_lines?: JournalEntryLine[];
}


export default function JournalEntriesPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [formData, setFormData] = useState({
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
  });
  const [editFormData, setEditFormData] = useState({
    entry_date: '',
    description: '',
  });
  const [lines, setLines] = useState<JournalEntryLine[]>([
    { account_id: '', debit_amount: 0, credit_amount: 0, description: '' },
    { account_id: '', debit_amount: 0, credit_amount: 0, description: '' },
  ]);
  const [editLines, setEditLines] = useState<JournalEntryLine[]>([]);
  const [relatedInvoice, setRelatedInvoice] = useState<{ id: string; invoice_number: string } | null>(null);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetails | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const printRef = useRef<HTMLDivElement>(null);
  const journalPrintRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: selectedInvoice ? `فاتورة-${selectedInvoice.invoice_number}` : 'فاتورة',
  });

  const handlePrintJournalEntry = useReactToPrint({
    contentRef: journalPrintRef,
    documentTitle: selectedEntry ? `قيد-${selectedEntry.entry_number}` : 'قيد يومية',
  });

  const { isAdmin = false } = useModules();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['journal-entries'],
    queryFn: async () => {
      const { data, error } = await queryTable<JournalEntry[]>('journal_entries', { order: { column: 'created_at', ascending: false } });
      if (error) throw new Error(error.message);
      return (data || []) as JournalEntry[];
    },
  });

  // Fetch lines count for all entries
  const { data: entriesLinesCount = {} } = useQuery({
    queryKey: ['journal-entries-lines-count', entries.map(e => e.id)],
    queryFn: async () => {
      if (entries.length === 0) return {};
      
      const { data, error } = await queryTable<any[]>('journal_entry_lines', { select: 'journal_entry_id', filters: [{ type: 'in', column: 'journal_entry_id', value: entries.map(e => e.id) }] });
      if (error) throw new Error(error.message);
      
      // Count lines per entry
      const counts: Record<string, number> = {};
      entries.forEach(e => { counts[e.id] = 0; });
      data?.forEach(line => {
        counts[line.journal_entry_id] = (counts[line.journal_entry_id] || 0) + 1;
      });
      
      return counts;
    },
    enabled: entries.length > 0,
  });

  // Fetch all accounts and build hierarchical structure
  const { data: hierarchicalAccounts = [] } = useQuery({
    queryKey: ['hierarchical-accounts-for-entries'],
    queryFn: async () => {
      const { data: allAccounts, error: accError } = await queryTable<any[]>('chart_of_accounts', { select: 'id, account_code, account_name, parent_id', filters: [{ type: 'eq', column: 'is_active', value: true }], order: { column: 'account_code', ascending: true } });
      if (accError) throw new Error(accError.message);
      if (!allAccounts) return [];
      
      // Get all parent_ids (accounts that have children)
      const parentIds = new Set(
        allAccounts
          .filter(acc => acc.parent_id)
          .map(acc => acc.parent_id)
      );
      
      // Build a map for quick lookup
      const accountMap = new Map(allAccounts.map(acc => [acc.id, acc]));
      
      // Calculate level and build full path for each account
      const getLevel = (acc: Account): number => {
        if (!acc.parent_id) return 0;
        const parent = accountMap.get(acc.parent_id);
        return parent ? getLevel(parent) + 1 : 0;
      };
      
      const getFullPath = (acc: Account): string => {
        if (!acc.parent_id) return acc.account_name;
        const parent = accountMap.get(acc.parent_id);
        return parent ? `${getFullPath(parent)} > ${acc.account_name}` : acc.account_name;
      };
      
      // Build hierarchical list with levels
      const hierarchical: HierarchicalAccount[] = allAccounts.map(acc => ({
        ...acc,
        level: getLevel(acc),
        isLeaf: !parentIds.has(acc.id),
        fullPath: getFullPath(acc),
      }));
      
      return hierarchical;
    },
  });
  
  // Filter to only leaf accounts for selection
  const selectableAccounts = hierarchicalAccounts.filter(acc => acc.isLeaf);

  const fetchEntryDetails = async (entryId: string) => {
    const { data, error } = await apiClient.get<any>('/api/journal-entry-detail/' + entryId);
    if (error) throw new Error(error.message);
    return data?.lines || [];
  };

  const createEntryMutation = useMutation({
    mutationFn: async () => {
      const totalDebit = lines.reduce((sum, line) => sum + (line.debit_amount || 0), 0);
      const totalCredit = lines.reduce((sum, line) => sum + (line.credit_amount || 0), 0);

      if (totalDebit !== totalCredit) {
        throw new Error('مجموع المدين يجب أن يساوي مجموع الدائن');
      }

      const payload = {
        entry_date: formData.entry_date,
        description: formData.description,
        branch_id: (user as any)?.branch_id || null,
        lines: lines.filter(l => l.account_id).map(l => ({
          account_id: l.account_id,
          debit_amount: l.debit_amount || 0,
          credit_amount: l.credit_amount || 0,
          description: l.description || '',
        })),
      };

      const res = await rpc('create_journal_entry_atomic', { p_payload: payload });
      if (res.error) throw new Error(res.error.message || 'حدث خطأ أثناء إنشاء القيد');
      const result = res.data as any;
      if (result && !result.success) throw new Error(result.error || 'حدث خطأ أثناء إنشاء القيد');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      toast.success('تم إنشاء القيد بنجاح');
      resetForm();
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء إنشاء القيد');
    },
  });

  const postEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const res = await rpc('post_journal_entry_atomic', { p_payload: { entry_id: entryId } });
      if (res.error) throw new Error(res.error.message || 'حدث خطأ أثناء ترحيل القيد');
      const result = res.data as any;
      if (result && !result.success) throw new Error(result.error || 'حدث خطأ أثناء ترحيل القيد');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      toast.success('تم ترحيل القيد بنجاح');
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء ترحيل القيد');
    },
  });

  const unpostEntryMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const res = await rpc('unpost_journal_entry_atomic', { p_payload: { entry_id: entryId } });
      if (res.error) throw new Error(res.error.message || 'حدث خطأ أثناء إلغاء ترحيل القيد');
      const result = res.data as any;
      if (result && !result.success) throw new Error(result.error || 'حدث خطأ أثناء إلغاء ترحيل القيد');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      toast.success('تم إلغاء ترحيل القيد بنجاح');
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء إلغاء ترحيل القيد');
    },
  });

  const createReversingEntryMutation = useMutation({
    mutationFn: async (originalEntryId: string) => {
      const res = await rpc('reverse_journal_entry_atomic', { p_payload: { entry_id: originalEntryId } });
      if (res.error) throw new Error(res.error.message || 'حدث خطأ أثناء إنشاء القيد العكسي');
      const result = res.data as any;
      if (result && !result.success) throw new Error(result.error || 'حدث خطأ أثناء إنشاء القيد العكسي');
      return result;
    },
    onSuccess: (newEntry: any) => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      toast.success(`تم إنشاء القيد العكسي بنجاح - رقم ${newEntry?.reversal_entry_number || ''}`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء إنشاء القيد العكسي');
    },
  });

  // Rebuild orphan entry lines mutation
  const rebuildLinesMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const result = await rebuildJournalEntryLines(entryId);
      if (!result.success) {
        throw new Error(result.message);
      }
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries-lines-count'] });
      toast.success(result.message);
      // Refresh selected entry if viewing
      if (selectedEntry) {
        handleViewEntry(selectedEntry);
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء إصلاح القيد');
    },
  });

  // Fix unbalanced entry mutation (for entries with NULL credit amounts)
  const fixUnbalancedMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const result = await fixUnbalancedJournalEntry(entryId);
      if (!result.success) {
        throw new Error(result.message);
      }
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries-lines-count'] });
      toast.success(result.message);
      // Refresh selected entry if viewing
      if (selectedEntry) {
        handleViewEntry(selectedEntry);
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء إصلاح القيد');
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: async () => {
      if (!editingEntry) throw new Error('لا يوجد قيد للتعديل');

      const totalDebit = editLines.reduce((sum, line) => sum + (line.debit_amount || 0), 0);
      const totalCredit = editLines.reduce((sum, line) => sum + (line.credit_amount || 0), 0);

      if (totalDebit !== totalCredit) {
        throw new Error('مجموع المدين يجب أن يساوي مجموع الدائن');
      }

      const payload = {
        entry_id: editingEntry.id,
        description: editFormData.description,
        entry_date: editFormData.entry_date,
        lines: editLines.filter(l => l.account_id).map(l => ({
          account_id: l.account_id,
          debit_amount: l.debit_amount || 0,
          credit_amount: l.credit_amount || 0,
          description: l.description || '',
        })),
      };

      const res = await rpc('update_journal_entry_atomic', { p_payload: payload });
      if (res.error) throw new Error(res.error.message || 'حدث خطأ أثناء تعديل القيد');
      const result = res.data as any;
      if (result && !result.success) throw new Error(result.error || 'حدث خطأ أثناء تعديل القيد');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      toast.success('تم تعديل القيد بنجاح');
      setEditDialogOpen(false);
      setEditingEntry(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء تعديل القيد');
    },
  });

  const resetForm = () => {
    setFormData({
      entry_date: format(new Date(), 'yyyy-MM-dd'),
      description: '',
    });
    setLines([
      { account_id: '', debit_amount: 0, credit_amount: 0, description: '' },
      { account_id: '', debit_amount: 0, credit_amount: 0, description: '' },
    ]);
  };

  const addLine = () => {
    setLines([...lines, { account_id: '', debit_amount: 0, credit_amount: 0, description: '' }]);
  };

  const removeLine = (index: number) => {
    if (lines.length > 2) {
      setLines(lines.filter((_, i) => i !== index));
    }
  };

  const updateLine = (index: number, field: keyof JournalEntryLine, value: any) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setLines(newLines);
  };

  const addEditLine = () => {
    setEditLines([...editLines, { account_id: '', debit_amount: 0, credit_amount: 0, description: '' }]);
  };

  const removeEditLine = (index: number) => {
    if (editLines.length > 2) {
      setEditLines(editLines.filter((_, i) => i !== index));
    }
  };

  const updateEditLine = (index: number, field: keyof JournalEntryLine, value: any) => {
    const newLines = [...editLines];
    newLines[index] = { ...newLines[index], [field]: value };
    setEditLines(newLines);
  };

  const handleViewEntry = async (entry: JournalEntry) => {
    setSelectedEntry(entry);
    setRelatedInvoice(null);
    const details = await fetchEntryDetails(entry.id);
    setSelectedEntry({ ...entry, journal_entry_lines: details });
    
    // Fetch related invoice if entry has a reference
    if (entry.reference_id && entry.reference_type && ['sale', 'sale_return', 'purchase'].includes(entry.reference_type)) {
      let filterCol = 'sale_id';
      let filterVal: string = entry.reference_id;
      if (entry.reference_type === 'sale_return') {
        filterCol = 'return_id';
      } else if (entry.reference_type === 'purchase') {
        filterCol = 'journal_entry_id';
        filterVal = entry.id;
      }

      const { data: invoice } = await dataGateway.queryTable('invoices', {
        select: 'id, invoice_number',
        filters: [{ type: 'eq', column: filterCol, value: filterVal }],
        single: true,
      });
      if (invoice) {
        setRelatedInvoice(invoice as any);
      }
    }
    
    setViewDialogOpen(true);
  };

  const handleEditEntry = async (entry: JournalEntry) => {
    const details = await fetchEntryDetails(entry.id);
    setEditingEntry({ ...entry, journal_entry_lines: details });
    setEditFormData({
      entry_date: entry.entry_date,
      description: entry.description || '',
    });
    setEditLines(details.map((line: any) => ({
      id: line.id,
      account_id: line.account_id,
      debit_amount: line.debit_amount || 0,
      credit_amount: line.credit_amount || 0,
      description: line.description || '',
    })));
    setEditDialogOpen(true);
  };

  const canEditEntry = (entry: JournalEntry) => {
    return isAdmin && !entry.is_posted && entry.reference_type === 'manual';
  };

  const totalDebit = lines.reduce((sum, line) => sum + (line.debit_amount || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (line.credit_amount || 0), 0);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  const editTotalDebit = editLines.reduce((sum, line) => sum + (line.debit_amount || 0), 0);
  const editTotalCredit = editLines.reduce((sum, line) => sum + (line.credit_amount || 0), 0);
  const isEditBalanced = editTotalDebit === editTotalCredit && editTotalDebit > 0;

  const filteredEntries = entries.filter(entry => {
    const matchesSearch = entry.entry_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || entry.reference_type === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t.accounting.journalEntries}</h1>
            <p className="text-muted-foreground">{t.accounting.manageEntries}</p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                {t.accounting.newEntry}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t.accounting.createEntry}</DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t.accounting.entryDate}</Label>
                    <Input
                      type="date"
                      value={formData.entry_date}
                      onChange={(e) => setFormData({ ...formData, entry_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t.accounting.statement}</Label>
                    <Input
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder={t.accounting.entryDescription}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>{t.accounting.entryLines}</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addLine}>
                      <Plus className="h-4 w-4 ml-1" />
                      {t.accounting.addLine}
                    </Button>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-64">{t.accounting.account}</TableHead>
                        <TableHead>{t.accounting.statement}</TableHead>
                        <TableHead className="w-32">{t.accounting.debit}</TableHead>
                        <TableHead className="w-32">{t.accounting.credit}</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <AccountCombobox
                              accounts={hierarchicalAccounts}
                              value={line.account_id}
                              onValueChange={(value) => updateLine(index, 'account_id', value)}
                              showOnlyLeaf={true}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={line.description}
                              onChange={(e) => updateLine(index, 'description', e.target.value)}
                              placeholder="البيان"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              value={line.debit_amount || ''}
                              onChange={(e) => updateLine(index, 'debit_amount', parseFloat(e.target.value) || 0)}
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              value={line.credit_amount || ''}
                              onChange={(e) => updateLine(index, 'credit_amount', parseFloat(e.target.value) || 0)}
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => removeLine(index)}
                              disabled={lines.length <= 2}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50">
                        <TableCell colSpan={2} className="font-bold">
                          الإجمالي
                        </TableCell>
                        <TableCell className="font-bold">{totalDebit.toLocaleString()}</TableCell>
                        <TableCell className="font-bold">{totalCredit.toLocaleString()}</TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>

                  {!isBalanced && totalDebit > 0 && (
                    <p className="text-destructive text-sm">
                      القيد غير متوازن: الفرق = {Math.abs(totalDebit - totalCredit).toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    إلغاء
                  </Button>
                  <Button
                    onClick={() => createEntryMutation.mutate()}
                    disabled={!isBalanced || createEntryMutation.isPending}
                  >
                    حفظ القيد
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex gap-4 flex-wrap">
          <Input
            placeholder="بحث بالرقم أو البيان..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
          />
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-48">
              <Filter className="h-4 w-4 ml-2" />
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
            </SelectContent>
          </Select>
        </div>

        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم القيد</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>البيان</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead className="text-left">المدين</TableHead>
                <TableHead className="text-left">الدائن</TableHead>
                <TableHead>الحالة</TableHead>
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
              ) : filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    لا توجد قيود
                  </TableCell>
                </TableRow>
              ) : (
                filteredEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono">{entry.entry_number}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{entry.created_at ? format(new Date(entry.created_at), 'yyyy-MM-dd') : '-'}</span>
                        <span className="text-xs text-muted-foreground">
                          {entry.created_at ? format(new Date(entry.created_at), 'HH:mm:ss') : ''}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{entry.description || '-'}</TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline"
                        className={referenceTypeColors[entry.reference_type || 'manual'] || referenceTypeColors.manual}
                      >
                        {referenceTypeLabels[entry.reference_type || 'manual'] || 'يدوي'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-left font-mono">
                      {(entry.total_debit ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-left font-mono">
                      {(entry.total_credit ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {entry.is_posted ? (
                          <Badge className="bg-green-500/20 text-green-400">مرحل</Badge>
                        ) : (
                          <Badge variant="outline">غير مرحل</Badge>
                        )}
                        {(entriesLinesCount[entry.id] || 0) === 0 && (
                          <span className="text-amber-500" title="لا توجد سطور تفصيلية">
                            <AlertTriangle className="h-4 w-4" />
                          </span>
                        )}
                        {/* Warning for unbalanced entries */}
                        {Math.abs((entry.total_debit ?? 0) - (entry.total_credit ?? 0)) > 0.01 && (
                          <span className="text-red-500" title={`القيد غير متوازن - مدين: ${entry.total_debit ?? 0} ≠ دائن: ${entry.total_credit ?? 0}`}>
                            <AlertTriangle className="h-4 w-4" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleViewEntry(entry)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canEditEntry(entry) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-blue-500"
                            onClick={() => handleEditEntry(entry)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {(entriesLinesCount[entry.id] || 0) === 0 && entry.reference_type !== 'manual' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-amber-500"
                            onClick={() => {
                              if (confirm('هل تريد إعادة بناء سطور هذا القيد؟')) {
                                rebuildLinesMutation.mutate(entry.id);
                              }
                            }}
                            title="إصلاح القيد (إعادة بناء السطور)"
                            disabled={rebuildLinesMutation.isPending}
                          >
                            <Wrench className="h-4 w-4" />
                          </Button>
                        )}
                        {/* Fix unbalanced entry button */}
                        {Math.abs((entry.total_debit ?? 0) - (entry.total_credit ?? 0)) > 0.01 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500"
                            onClick={() => {
                              if (confirm('هل تريد إصلاح توازن هذا القيد؟')) {
                                fixUnbalancedMutation.mutate(entry.id);
                              }
                            }}
                            title="إصلاح القيد غير المتوازن"
                            disabled={fixUnbalancedMutation.isPending}
                          >
                            <Wrench className="h-4 w-4" />
                          </Button>
                        )}
                        {!entry.is_posted && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-500"
                            onClick={() => postEntryMutation.mutate(entry.id)}
                            title="ترحيل القيد"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        {entry.is_posted && isAdmin && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-amber-500"
                              onClick={() => {
                                if (confirm('هل أنت متأكد من إلغاء ترحيل هذا القيد؟ سيؤثر هذا على أرصدة الحسابات.')) {
                                  unpostEntryMutation.mutate(entry.id);
                                }
                              }}
                              title="إلغاء الترحيل"
                            >
                              <Undo2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-500"
                              onClick={() => {
                                if (confirm('هل تريد إنشاء قيد عكسي لإلغاء أثر هذا القيد؟')) {
                                  createReversingEntryMutation.mutate(entry.id);
                                }
                              }}
                              title="إنشاء قيد عكسي"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* View Entry Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تفاصيل القيد - {selectedEntry?.entry_number}</DialogTitle>
          </DialogHeader>

          {selectedEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">التاريخ</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedEntry.entry_date ? format(new Date(selectedEntry.entry_date), 'yyyy/MM/dd') : '-'}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">النوع</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge 
                      variant="outline"
                      className={referenceTypeColors[selectedEntry.reference_type || 'manual'] || referenceTypeColors.manual}
                    >
                      {referenceTypeLabels[selectedEntry.reference_type || 'manual'] || 'يدوي'}
                    </Badge>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">الحالة</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedEntry.is_posted ? 'مرحل' : 'غير مرحل'}
                  </CardContent>
                </Card>
              </div>

              {selectedEntry.description && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">البيان</CardTitle>
                  </CardHeader>
                  <CardContent>{selectedEntry.description}</CardContent>
                </Card>
              )}

              {/* Warning if no lines */}
              {(!selectedEntry.journal_entry_lines || selectedEntry.journal_entry_lines.length === 0) && (
                <Card className="border-amber-500/50 bg-amber-500/10">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-amber-500">
                        <AlertTriangle className="h-5 w-5" />
                        <span>هذا القيد لا يحتوي على سطور تفصيلية</span>
                      </div>
                      {selectedEntry.reference_type !== 'manual' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2 border-amber-500 text-amber-500 hover:bg-amber-500/20"
                          onClick={() => rebuildLinesMutation.mutate(selectedEntry.id)}
                          disabled={rebuildLinesMutation.isPending}
                        >
                          <Wrench className="h-4 w-4" />
                          إصلاح القيد
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Warning if entry is unbalanced (has lines but totals don't match) */}
              {selectedEntry.journal_entry_lines && 
               selectedEntry.journal_entry_lines.length > 0 && 
               Math.abs((selectedEntry.total_debit ?? 0) - (selectedEntry.total_credit ?? 0)) > 0.01 && (
                <Card className="border-red-500/50 bg-red-500/10">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-red-500">
                        <AlertTriangle className="h-5 w-5" />
                        <span>
                          القيد غير متوازن! المدين: {(selectedEntry.total_debit ?? 0).toLocaleString()} ≠ الدائن: {(selectedEntry.total_credit ?? 0).toLocaleString()}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 border-red-500 text-red-500 hover:bg-red-500/20"
                        onClick={() => {
                          if (confirm('هل تريد إصلاح هذا القيد؟ سيتم تصحيح المبلغ الدائن الناقص.')) {
                            fixUnbalancedMutation.mutate(selectedEntry.id);
                          }
                        }}
                        disabled={fixUnbalancedMutation.isPending}
                      >
                        <Wrench className="h-4 w-4" />
                        إصلاح التوازن
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="border rounded-lg overflow-x-auto w-full">
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">رقم الحساب</TableHead>
                      <TableHead>اسم الحساب</TableHead>
                      <TableHead>البيان</TableHead>
                      <TableHead className="text-left whitespace-nowrap">مدين</TableHead>
                      <TableHead className="text-left whitespace-nowrap">دائن</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedEntry.journal_entry_lines?.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-sm whitespace-nowrap">
                          {line.account?.account_code || '-'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {line.account?.account_name || '-'}
                        </TableCell>
                        <TableCell className="text-sm">{line.description || '-'}</TableCell>
                        <TableCell className="text-left font-mono whitespace-nowrap">
                          {(line.debit_amount ?? 0) > 0 ? (line.debit_amount ?? 0).toLocaleString() : '-'}
                        </TableCell>
                        <TableCell className="text-left font-mono whitespace-nowrap">
                          {(line.credit_amount ?? 0) > 0 ? (line.credit_amount ?? 0).toLocaleString() : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={3}>الإجمالي</TableCell>
                      <TableCell className="text-left whitespace-nowrap">
                        {(selectedEntry.total_debit ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-left whitespace-nowrap">
                        {(selectedEntry.total_credit ?? 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* Print and Preview Buttons */}
              <div className="flex justify-between items-center pt-4 border-t">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => handlePrintJournalEntry()}
                  >
                    <Printer className="h-4 w-4" />
                    طباعة القيد
                  </Button>
                </div>

                {relatedInvoice && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={async () => {
                      const { data: invoiceData, error: invError } = await apiClient.get<any>('/api/invoice-with-items/' + relatedInvoice.id);
                      if (invError || !invoiceData?.invoice) return;
                      setSelectedInvoice(invoiceData.invoice as InvoiceDetails);
                      setInvoiceItems((invoiceData.items || []) as InvoiceItem[]);
                        
                      setInvoiceDialogOpen(true);
                    }}
                  >
                    <FileText className="h-4 w-4" />
                    فتح الفاتورة ({relatedInvoice.invoice_number})
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Entry Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تعديل القيد - {editingEntry?.entry_number}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>تاريخ القيد</Label>
                <Input
                  type="date"
                  value={editFormData.entry_date}
                  onChange={(e) => setEditFormData({ ...editFormData, entry_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>البيان</Label>
                <Input
                  value={editFormData.description}
                  onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                  placeholder="وصف القيد"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>بنود القيد</Label>
                <Button type="button" variant="outline" size="sm" onClick={addEditLine}>
                  <Plus className="h-4 w-4 ml-1" />
                  إضافة بند
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-64">الحساب</TableHead>
                    <TableHead>البيان</TableHead>
                    <TableHead className="w-32">مدين</TableHead>
                    <TableHead className="w-32">دائن</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editLines.map((line, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <AccountCombobox
                          accounts={hierarchicalAccounts}
                          value={line.account_id}
                          onValueChange={(value) => updateEditLine(index, 'account_id', value)}
                          showOnlyLeaf={true}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={line.description}
                          onChange={(e) => updateEditLine(index, 'description', e.target.value)}
                          placeholder="البيان"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={line.debit_amount || ''}
                          onChange={(e) => updateEditLine(index, 'debit_amount', parseFloat(e.target.value) || 0)}
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={line.credit_amount || ''}
                          onChange={(e) => updateEditLine(index, 'credit_amount', parseFloat(e.target.value) || 0)}
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeEditLine(index)}
                          disabled={editLines.length <= 2}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={2} className="font-bold">
                      الإجمالي
                    </TableCell>
                    <TableCell className="font-bold">{editTotalDebit.toLocaleString()}</TableCell>
                    <TableCell className="font-bold">{editTotalCredit.toLocaleString()}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {!isEditBalanced && editTotalDebit > 0 && (
                <p className="text-destructive text-sm">
                  القيد غير متوازن: الفرق = {Math.abs(editTotalDebit - editTotalCredit).toLocaleString()}
                </p>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => updateEntryMutation.mutate()}
                disabled={!isEditBalanced || updateEntryMutation.isPending}
              >
                حفظ التعديلات
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice View Dialog */}
      <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {selectedInvoice?.invoice_number}
            </DialogTitle>
          </DialogHeader>
          
          {selectedInvoice && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      نوع الفاتورة
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="outline">
                      {invoiceTypeLabels[selectedInvoice.invoice_type] || selectedInvoice.invoice_type}
                    </Badge>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      تاريخ الفاتورة
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {format(new Date(selectedInvoice.invoice_date), 'yyyy/MM/dd')}
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      الحالة
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge className={statusLabels[selectedInvoice.status]?.color || ''}>
                      {statusLabels[selectedInvoice.status]?.label || selectedInvoice.status}
                    </Badge>
                  </CardContent>
                </Card>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedInvoice.customer && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <User className="h-4 w-4" />
                        العميل
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="font-medium">{selectedInvoice.customer.full_name}</p>
                      <p className="text-sm text-muted-foreground">{selectedInvoice.customer.customer_code}</p>
                    </CardContent>
                  </Card>
                )}
                
                {selectedInvoice.supplier && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        المورد
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="font-medium">{selectedInvoice.supplier.supplier_name}</p>
                    </CardContent>
                  </Card>
                )}
                
                {selectedInvoice.branch && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        الفرع
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="font-medium">{selectedInvoice.branch.branch_name}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
              
              {/* Items Table */}
              {invoiceItems.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h4 className="font-semibold">الأصناف ({invoiceItems.length})</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>كود الصنف</TableHead>
                          <TableHead>الموديل</TableHead>
                          <TableHead>النوع</TableHead>
                          <TableHead>المعدن</TableHead>
                          <TableHead>الوزن (جم)</TableHead>
                          <TableHead className="text-left">السعر</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoiceItems.map((item, index) => (
                          <TableRow key={item.id}>
                            <TableCell>{index + 1}</TableCell>
                            <TableCell className="font-mono">{item.unique_items?.serial_no || '-'}</TableCell>
                            <TableCell>{item.unique_items?.model || '-'}</TableCell>
                            <TableCell>{item.unique_items?.type || '-'}</TableCell>
                            <TableCell>{item.unique_items?.metal || '-'}</TableCell>
                            <TableCell>{item.unique_items?.g_weight?.toFixed(2) || '-'}</TableCell>
                            <TableCell className="text-left font-mono">{formatCurrency(item.sale_price)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
              
              <Separator />
              
              <div className="space-y-4">
                <h4 className="font-semibold">ملخص المبالغ</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">الإجمالي الفرعي</CardTitle>
                    </CardHeader>
                    <CardContent className="font-mono text-lg">
                      {formatCurrency(selectedInvoice.subtotal || 0)}
                    </CardContent>
                  </Card>
                  {(selectedInvoice.discount_amount || 0) > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs text-muted-foreground">الخصم</CardTitle>
                      </CardHeader>
                      <CardContent className="font-mono text-lg text-red-500">
                        -{formatCurrency(selectedInvoice.discount_amount || 0)}
                      </CardContent>
                    </Card>
                  )}
                  {(selectedInvoice.tax_amount || 0) > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs text-muted-foreground">الضريبة</CardTitle>
                      </CardHeader>
                      <CardContent className="font-mono text-lg">
                        {formatCurrency(selectedInvoice.tax_amount || 0)}
                      </CardContent>
                    </Card>
                  )}
                  <Card className="bg-primary/10">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">الإجمالي</CardTitle>
                    </CardHeader>
                    <CardContent className="font-mono text-lg font-bold">
                      {formatCurrency(selectedInvoice.total_amount)}
                    </CardContent>
                  </Card>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-green-500/10">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">المدفوع</CardTitle>
                    </CardHeader>
                    <CardContent className="font-mono text-lg text-green-500">
                      {formatCurrency(selectedInvoice.paid_amount)}
                    </CardContent>
                  </Card>
                  <Card className={selectedInvoice.remaining_amount > 0 ? 'bg-yellow-500/10' : ''}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">المتبقي</CardTitle>
                    </CardHeader>
                    <CardContent className={`font-mono text-lg ${selectedInvoice.remaining_amount > 0 ? 'text-yellow-500' : ''}`}>
                      {formatCurrency(selectedInvoice.remaining_amount)}
                    </CardContent>
                  </Card>
                </div>
              </div>
              
              {selectedInvoice.notes && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-semibold mb-2">ملاحظات</h4>
                    <p className="text-muted-foreground">{selectedInvoice.notes}</p>
                  </div>
                </>
              )}
              
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setInvoiceDialogOpen(false)}>
                  إغلاق
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => handlePrint()}>
                  <Printer className="h-4 w-4" />
                  طباعة
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hidden Print Component for Invoice */}
      <div style={{ display: 'none' }}>
        <div ref={printRef}>
          {selectedInvoice && (
            <PrintableInvoice
              invoice={selectedInvoice}
              items={invoiceItems}
            />
          )}
        </div>
      </div>

      {/* Hidden Print Component for Journal Entry */}
      <div style={{ display: 'none' }}>
        <div ref={journalPrintRef}>
          {selectedEntry && (
            <PrintableJournalEntry entry={selectedEntry} />
          )}
        </div>
      </div>
    </MainLayout>
  );
}
