import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { BookOpen, Download, Printer, Search, Calendar, FileText, Settings2, FileDown } from 'lucide-react';
import PrintableInvoice from '@/components/invoices/PrintableInvoice';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { arSA } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { AccountCombobox, HierarchicalAccount } from '@/components/accounting/AccountCombobox';
import { addCairoFont, processTextForPDF } from '@/lib/fonts/cairo-font';
import { queryTable } from '@/lib/dataGateway';
import * as apiClient from '@/lib/apiClient';

interface ColumnVisibility {
  date: boolean;
  entryNumber: boolean;
  accountCode: boolean;
  accountName: boolean;
  description: boolean;
  debit: boolean;
  credit: boolean;
  balance: boolean;
}

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  parent_id: string | null;
}

interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  description: string | null;
  journal_entry: {
    id: string;
    entry_number: string;
    entry_date: string;
    description: string | null;
    is_posted: boolean;
  };
}

interface LedgerEntry {
  date: string;
  entryNumber: string;
  entryId: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

interface JournalEntryDetail {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  is_posted: boolean;
  reference_type: string | null;
  reference_id: string | null;
  total_debit: number | null;
  total_credit: number | null;
  lines: {
    id: string;
    account_id: string;
    debit_amount: number | null;
    credit_amount: number | null;
    description: string | null;
    account: {
      account_code: string;
      account_name: string;
    };
  }[];
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  invoice_date: string;
  total_amount: number | null;
  customer?: { full_name: string } | null;
  supplier?: { supplier_name: string } | null;
}

export default function AccountLedgerPage() {
  const today = new Date();
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(today), 'yyyy-MM-dd'));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [showEntryDialog, setShowEntryDialog] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  
  // Column visibility state
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>({
    date: true,
    entryNumber: true,
    accountCode: true,
    accountName: true,
    description: true,
    debit: true,
    credit: true,
    balance: true,
  });

  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumnVisibility(prev => ({ ...prev, [column]: !prev[column] }));
  };

  const visibleColumnsCount = Object.values(columnVisibility).filter(Boolean).length;

  // Fetch all accounts
  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ['chart-of-accounts-ledger'],
    queryFn: async () => {
      const { data, error } = await queryTable<Account[]>('chart_of_accounts', {
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'account_code', ascending: true },
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // Get selected account details
  const selectedAccount = useMemo(() => {
    return accounts?.find(acc => acc.id === selectedAccountId);
  }, [accounts, selectedAccountId]);

  // Fetch journal entry lines for selected account
  const { data: journalLines, isLoading: linesLoading } = useQuery({
    queryKey: ['account-ledger', selectedAccountId, startDate, endDate],
    queryFn: async () => {
      if (!selectedAccountId) return [];

      const { data, error } = await apiClient.get<JournalEntryLine[]>('/api/ledger-lines', {
        account_id: selectedAccountId,
        start_date: startDate,
        end_date: endDate,
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!selectedAccountId,
  });

  // Fetch opening balance (entries before start date)
  const { data: openingBalanceData } = useQuery({
    queryKey: ['account-opening-balance', selectedAccountId, startDate],
    queryFn: async () => {
      if (!selectedAccountId) return { debit: 0, credit: 0 };

      const { data, error } = await apiClient.get<{ debit: number; credit: number }>('/api/ledger-opening-balance', {
        account_id: selectedAccountId,
        before_date: startDate,
      });
      if (error) throw new Error(error.message);
      return data || { debit: 0, credit: 0 };
    },
    enabled: !!selectedAccountId,
  });

  // Fetch journal entry details when selected
  const { data: entryDetails, isLoading: entryLoading } = useQuery({
    queryKey: ['journal-entry-detail', selectedEntryId],
    queryFn: async () => {
      if (!selectedEntryId) return null;

      const { data, error } = await apiClient.get<JournalEntryDetail>('/api/journal-entry-detail/' + selectedEntryId);
      if (error) throw new Error(error.message);
      return data || null;
    },
    enabled: !!selectedEntryId,
  });

  const handleViewEntry = (entryId: string) => {
    setSelectedEntryId(entryId);
    setShowEntryDialog(true);
  };

  // Fetch linked invoice for current entry
  const { data: linkedInvoice } = useQuery({
    queryKey: ['linked-invoice', entryDetails?.reference_id, entryDetails?.reference_type],
    queryFn: async () => {
      if (!entryDetails?.reference_id) return null;
      
      const refType = entryDetails.reference_type;
      // Only fetch if reference type is related to invoices
      if (!refType || !['sale', 'purchase', 'sales_return', 'purchase_return'].includes(refType)) {
        return null;
      }

      const { data, error } = await apiClient.get<Invoice>('/api/linked-invoice', {
        reference_id: entryDetails.reference_id,
      });
      if (error) throw new Error(error.message);
      return data || null;
    },
    enabled: !!entryDetails?.reference_id,
  });

  const handleOpenInvoice = () => {
    if (linkedInvoice) {
      setSelectedInvoiceId(linkedInvoice.id);
      setShowInvoiceDialog(true);
    }
  };

  // Fetch full invoice details for the dialog
  const { data: invoiceDetails } = useQuery({
    queryKey: ['invoice-details-ledger', selectedInvoiceId],
    queryFn: async () => {
      if (!selectedInvoiceId) return null;

      const { data, error } = await apiClient.get<any>('/api/invoice-with-items/' + selectedInvoiceId);
      if (error) throw new Error(error.message);
      if (!data?.invoice) return null;
      return { invoice: data.invoice, items: data.items || [] };
    },
    enabled: !!selectedInvoiceId && showInvoiceDialog,
  });

  const ledgerEntries = useMemo(() => {
    if (!journalLines || !selectedAccount) return [];

    const openingBalance = (openingBalanceData?.debit || 0) - (openingBalanceData?.credit || 0);
    let runningBalance = openingBalance;

    // Determine if account is debit-nature or credit-nature
    const isDebitNature = ['asset', 'expense'].includes(selectedAccount.account_type);

    const entries: LedgerEntry[] = journalLines
      .filter(line => line.journal_entry)
      .map(line => {
        const debit = line.debit_amount || 0;
        const credit = line.credit_amount || 0;
        
        // For debit-nature accounts: debit increases, credit decreases
        // For credit-nature accounts: credit increases, debit decreases
        if (isDebitNature) {
          runningBalance = runningBalance + debit - credit;
        } else {
          runningBalance = runningBalance - debit + credit;
        }

        return {
          date: line.journal_entry.entry_date,
          entryNumber: line.journal_entry.entry_number,
          entryId: line.journal_entry.id,
          description: line.description || line.journal_entry.description || '',
          debit,
          credit,
          balance: runningBalance,
        };
      });

    return entries;
  }, [journalLines, openingBalanceData, selectedAccount]);

  // Filter entries by search query
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return ledgerEntries;
    
    const query = searchQuery.toLowerCase();
    return ledgerEntries.filter(entry =>
      entry.description.toLowerCase().includes(query) ||
      entry.entryNumber.toLowerCase().includes(query)
    );
  }, [ledgerEntries, searchQuery]);

  // Calculate totals
  const totals = useMemo(() => {
    return filteredEntries.reduce(
      (acc, entry) => ({
        debit: acc.debit + entry.debit,
        credit: acc.credit + entry.credit,
      }),
      { debit: 0, credit: 0 }
    );
  }, [filteredEntries]);

  const openingBalance = (openingBalanceData?.debit || 0) - (openingBalanceData?.credit || 0);
  const closingBalance = filteredEntries.length > 0 
    ? filteredEntries[filteredEntries.length - 1].balance 
    : openingBalance;

  // Export to Excel
  const handleExportExcel = () => {
    if (!selectedAccount || filteredEntries.length === 0) return;

    const exportData = [
      { 'رقم الحساب': selectedAccount.account_code, 'اسم الحساب': selectedAccount.account_name },
      { 'من تاريخ': startDate, 'إلى تاريخ': endDate },
      {},
      { 
        'التاريخ': '', 
        'رقم القيد': '', 
        'رقم الحساب': selectedAccount.account_code,
        'اسم الحساب': selectedAccount.account_name,
        'البيان': 'رصيد افتتاحي', 
        'مدين': '', 
        'دائن': '', 
        'الرصيد': openingBalance.toFixed(2)
      },
      ...filteredEntries.map(entry => ({
        'التاريخ': format(new Date(entry.date), 'yyyy-MM-dd'),
        'رقم القيد': entry.entryNumber,
        'رقم الحساب': selectedAccount.account_code,
        'اسم الحساب': selectedAccount.account_name,
        'البيان': entry.description,
        'مدين': entry.debit > 0 ? entry.debit.toFixed(2) : '',
        'دائن': entry.credit > 0 ? entry.credit.toFixed(2) : '',
        'الرصيد': entry.balance.toFixed(2),
      })),
      {},
      {
        'التاريخ': '',
        'رقم القيد': '',
        'رقم الحساب': '',
        'اسم الحساب': '',
        'البيان': 'الإجمالي',
        'مدين': totals.debit.toFixed(2),
        'دائن': totals.credit.toFixed(2),
        'الرصيد': closingBalance.toFixed(2),
      },
    ];

    const ws = XLSX.utils.json_to_sheet(exportData, { skipHeader: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كشف الحساب');
    XLSX.writeFile(wb, `كشف_حساب_${selectedAccount.account_code}_${startDate}_${endDate}.xlsx`);
  };

  // Print handler
  const handlePrint = () => {
    window.print();
  };

  // Export to PDF with Arabic font support
  const handleExportPDF = async () => {
    if (!selectedAccount || filteredEntries.length === 0) return;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    // Load Cairo Arabic font
    const fontLoaded = await addCairoFont(doc);
    const fontName = fontLoaded ? 'Cairo' : 'helvetica';

    const pageWidth = doc.internal.pageSize.getWidth();
    let yPos = 15;

    // Title - Arabic with fallback
    doc.setFont(fontName);
    doc.setFontSize(18);
    const title = fontLoaded ? 'كشف الحساب' : 'Account Ledger';
    doc.text(title, pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;

    // Account info
    doc.setFontSize(12);
    const accountLabel = fontLoaded ? 'الحساب:' : 'Account:';
    doc.text(`${accountLabel} ${selectedAccount.account_code} - ${selectedAccount.account_name}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 7;
    
    const periodLabel = fontLoaded ? 'الفترة:' : 'Period:';
    doc.text(`${periodLabel} ${startDate} - ${endDate}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 12;

    // Prepare table headers - Arabic with fallback
    const tableHeaders = fontLoaded 
      ? [['التاريخ', 'رقم القيد', 'رقم الحساب', 'اسم الحساب', 'البيان', 'مدين (ر.س)', 'دائن (ر.س)', 'الرصيد (ر.س)']]
      : [['Date', 'Entry No.', 'Acc. Code', 'Acc. Name', 'Description', 'Debit (SAR)', 'Credit (SAR)', 'Balance (SAR)']];
    
    const tableData: (string | number)[][] = [];
    
    // Opening balance row
    const openingLabel = fontLoaded ? 'رصيد افتتاحي' : 'Opening Balance';
    tableData.push([
      format(new Date(startDate), 'yyyy/MM/dd'),
      '-',
      selectedAccount.account_code,
      processTextForPDF(selectedAccount.account_name, 25),
      openingLabel,
      '-',
      '-',
      openingBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    ]);

    // Data rows
    filteredEntries.forEach((entry) => {
      tableData.push([
        format(new Date(entry.date), 'yyyy/MM/dd'),
        entry.entryNumber,
        selectedAccount.account_code,
        processTextForPDF(selectedAccount.account_name, 25),
        processTextForPDF(entry.description || '-', 35),
        entry.debit > 0 ? entry.debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-',
        entry.credit > 0 ? entry.credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-',
        entry.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      ]);
    });

    // Totals row
    const totalLabel = fontLoaded ? 'الإجمالي' : 'TOTAL';
    tableData.push([
      '',
      '',
      '',
      '',
      totalLabel,
      totals.debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      totals.credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      closingBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    ]);

    // Use autoTable for better formatting with Arabic font
    (doc as any).autoTable({
      head: tableHeaders,
      body: tableData,
      startY: yPos,
      theme: 'grid',
      styles: {
        font: fontName,
        fontSize: 9,
        halign: 'center',
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: 255,
        fontStyle: 'bold',
        halign: 'center',
        fontSize: 9,
      },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 28 },
        2: { cellWidth: 22 },
        3: { cellWidth: 38 },
        4: { cellWidth: 52 },
        5: { cellWidth: 28, halign: 'right' },
        6: { cellWidth: 28, halign: 'right' },
        7: { cellWidth: 30, halign: 'right' },
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      didParseCell: function(data: any) {
        // Style the last row (totals)
        if (data.row.index === tableData.length - 1) {
          data.cell.styles.fillColor = [226, 232, 240];
          data.cell.styles.fontStyle = 'bold';
        }
        // Style opening balance row
        if (data.row.index === 0) {
          data.cell.styles.fillColor = [241, 245, 249];
          data.cell.styles.fontStyle = 'italic';
        }
      },
      margin: { left: 10, right: 10 },
    });

    // Save PDF
    doc.save(`كشف_حساب_${selectedAccount.account_code}_${startDate}_${endDate}.pdf`);
  };

  // Build hierarchical accounts for combobox
  const hierarchicalAccounts = useMemo((): HierarchicalAccount[] => {
    if (!accounts) return [];
    
    // Build parent-child map
    const childrenMap = new Map<string | null, Account[]>();
    accounts.forEach(acc => {
      const parentId = acc.parent_id;
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(acc);
    });

    // Check if account has children
    const hasChildren = (accountId: string): boolean => {
      return (childrenMap.get(accountId)?.length || 0) > 0;
    };

    // Build path for account
    const buildPath = (account: Account): string => {
      const path: string[] = [account.account_name];
      let current = account;
      while (current.parent_id) {
        const parent = accounts.find(a => a.id === current.parent_id);
        if (parent) {
          path.unshift(parent.account_name);
          current = parent;
        } else {
          break;
        }
      }
      return path.join(' > ');
    };

    // Build hierarchy level
    const getHierarchy = (account: Account): number => {
      let level = 0;
      let current = account;
      while (current.parent_id) {
        const parent = accounts.find(a => a.id === current.parent_id);
        if (parent) {
          level++;
          current = parent;
        } else {
          break;
        }
      }
      return level;
    };

    return accounts.map(acc => ({
      id: acc.id,
      account_code: acc.account_code,
      account_name: acc.account_name,
      parent_id: acc.parent_id,
      level: getHierarchy(acc),
      isLeaf: !hasChildren(acc.id),
      fullPath: buildPath(acc),
    }));
  }, [accounts]);

  return (
    <MainLayout>
      <div className="space-y-6 print:space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-primary" />
              كشف الحساب / دفتر الأستاذ
            </h1>
            <p className="text-muted-foreground mt-1">
              عرض تفاصيل حركات أي حساب مع الرصيد التراكمي
            </p>
          </div>
          
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Settings2 className="w-4 h-4 ml-2" />
                  الأعمدة
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-popover z-50">
                <DropdownMenuLabel>إظهار/إخفاء الأعمدة</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.date}
                  onCheckedChange={() => toggleColumn('date')}
                >
                  التاريخ
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.entryNumber}
                  onCheckedChange={() => toggleColumn('entryNumber')}
                >
                  رقم القيد
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.accountCode}
                  onCheckedChange={() => toggleColumn('accountCode')}
                >
                  رقم الحساب
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.accountName}
                  onCheckedChange={() => toggleColumn('accountName')}
                >
                  اسم الحساب
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.description}
                  onCheckedChange={() => toggleColumn('description')}
                >
                  البيان
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.debit}
                  onCheckedChange={() => toggleColumn('debit')}
                >
                  مدين
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.credit}
                  onCheckedChange={() => toggleColumn('credit')}
                >
                  دائن
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={columnVisibility.balance}
                  onCheckedChange={() => toggleColumn('balance')}
                >
                  الرصيد
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              onClick={handleExportExcel}
              disabled={!selectedAccountId || filteredEntries.length === 0}
            >
              <Download className="w-4 h-4 ml-2" />
              تصدير Excel
            </Button>
            <Button
              variant="outline"
              onClick={handleExportPDF}
              disabled={!selectedAccountId || filteredEntries.length === 0}
            >
              <FileDown className="w-4 h-4 ml-2" />
              تصدير PDF
            </Button>
            <Button
              variant="outline"
              onClick={handlePrint}
              disabled={!selectedAccountId || filteredEntries.length === 0}
            >
              <Printer className="w-4 h-4 ml-2" />
              طباعة
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-lg">خيارات البحث</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <Label htmlFor="account">اختر الحساب</Label>
                <div className="mt-1">
                  <AccountCombobox
                    accounts={hierarchicalAccounts}
                    value={selectedAccountId}
                    onValueChange={setSelectedAccountId}
                    showOnlyLeaf={true}
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="startDate">من تاريخ</Label>
                <div className="relative mt-1">
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="pr-10"
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="endDate">إلى تاريخ</Label>
                <div className="relative mt-1">
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="pr-10"
                  />
                </div>
              </div>
            </div>

            {selectedAccountId && (
              <div className="mt-4">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث في البيانات أو أرقام القيود..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pr-10"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Print Header - Only visible when printing */}
        <div className="hidden print:block text-center mb-6">
          <h1 className="text-2xl font-bold">كشف الحساب</h1>
          {selectedAccount && (
            <>
              <p className="text-lg mt-2">
                {selectedAccount.account_code} - {selectedAccount.account_name}
              </p>
              <p className="text-sm text-muted-foreground">
                من {format(new Date(startDate), 'yyyy/MM/dd')} إلى {format(new Date(endDate), 'yyyy/MM/dd')}
              </p>
            </>
          )}
        </div>

        {/* Account Info */}
        {selectedAccount && (
          <Card className="print:shadow-none print:border-0">
            <CardHeader className="print:py-2">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <span className="text-muted-foreground text-sm">رقم الحساب:</span>
                  <span className="font-bold text-lg mr-2">{selectedAccount.account_code}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-sm">اسم الحساب:</span>
                  <span className="font-bold text-lg mr-2">{selectedAccount.account_name}</span>
                </div>
                <Badge variant="outline" className="print:hidden">
                  {selectedAccount.account_type === 'asset' && 'أصول'}
                  {selectedAccount.account_type === 'liability' && 'التزامات'}
                  {selectedAccount.account_type === 'equity' && 'حقوق ملكية'}
                  {selectedAccount.account_type === 'revenue' && 'إيرادات'}
                  {selectedAccount.account_type === 'expense' && 'مصروفات'}
                </Badge>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Ledger Table */}
        {selectedAccountId && (
          <Card className="print:shadow-none print:border-0">
            <CardContent className="p-0">
              {linesLoading ? (
                <div className="p-6 space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>لا توجد حركات لهذا الحساب في الفترة المحددة</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        {columnVisibility.date && <TableHead className="text-right w-[100px]">التاريخ</TableHead>}
                        {columnVisibility.entryNumber && <TableHead className="text-right w-[120px]">رقم القيد</TableHead>}
                        {columnVisibility.accountCode && <TableHead className="text-right w-[100px]">رقم الحساب</TableHead>}
                        {columnVisibility.accountName && <TableHead className="text-right w-[150px]">اسم الحساب</TableHead>}
                        {columnVisibility.description && <TableHead className="text-right">البيان</TableHead>}
                        {columnVisibility.debit && <TableHead className="text-left w-[120px]">مدين</TableHead>}
                        {columnVisibility.credit && <TableHead className="text-left w-[120px]">دائن</TableHead>}
                        {columnVisibility.balance && <TableHead className="text-left w-[140px]">الرصيد</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Opening Balance Row */}
                      <TableRow className="bg-muted/30 font-medium">
                        {columnVisibility.date && <TableCell>{format(new Date(startDate), 'yyyy/MM/dd')}</TableCell>}
                        {columnVisibility.entryNumber && <TableCell>-</TableCell>}
                        {columnVisibility.accountCode && <TableCell className="font-mono text-sm">{selectedAccount?.account_code}</TableCell>}
                        {columnVisibility.accountName && <TableCell>{selectedAccount?.account_name}</TableCell>}
                        {columnVisibility.description && <TableCell>رصيد افتتاحي</TableCell>}
                        {columnVisibility.debit && <TableCell className="text-left">-</TableCell>}
                        {columnVisibility.credit && <TableCell className="text-left">-</TableCell>}
                        {columnVisibility.balance && (
                          <TableCell className={`text-left font-bold ${openingBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {openingBalance.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                          </TableCell>
                        )}
                      </TableRow>

                      {/* Entry Rows */}
                      {filteredEntries.map((entry, index) => (
                        <TableRow key={index} className="hover:bg-muted/30">
                          {columnVisibility.date && (
                            <TableCell>
                              {format(new Date(entry.date), 'yyyy/MM/dd')}
                            </TableCell>
                          )}
                          {columnVisibility.entryNumber && (
                            <TableCell>
                              <button
                                onClick={() => handleViewEntry(entry.entryId)}
                                className="font-mono text-sm text-primary hover:underline hover:text-primary/80 transition-colors cursor-pointer print:hidden"
                              >
                                {entry.entryNumber}
                              </button>
                              <span className="hidden print:inline font-mono text-sm">
                                {entry.entryNumber}
                              </span>
                            </TableCell>
                          )}
                          {columnVisibility.accountCode && <TableCell className="font-mono text-sm">{selectedAccount?.account_code}</TableCell>}
                          {columnVisibility.accountName && <TableCell>{selectedAccount?.account_name}</TableCell>}
                          {columnVisibility.description && (
                            <TableCell className="max-w-[300px] truncate">
                              {entry.description || '-'}
                            </TableCell>
                          )}
                          {columnVisibility.debit && (
                            <TableCell className="text-left tabular-nums">
                              {entry.debit > 0 
                                ? entry.debit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })
                                : '-'}
                            </TableCell>
                          )}
                          {columnVisibility.credit && (
                            <TableCell className="text-left tabular-nums">
                              {entry.credit > 0 
                                ? entry.credit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })
                                : '-'}
                            </TableCell>
                          )}
                          {columnVisibility.balance && (
                            <TableCell className={`text-left font-semibold tabular-nums ${entry.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {entry.balance.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}

                      {/* Totals Row */}
                      <TableRow className="bg-muted font-bold border-t-2">
                        <TableCell 
                          colSpan={
                            (columnVisibility.date ? 1 : 0) + 
                            (columnVisibility.entryNumber ? 1 : 0) + 
                            (columnVisibility.accountCode ? 1 : 0) + 
                            (columnVisibility.accountName ? 1 : 0) + 
                            (columnVisibility.description ? 1 : 0)
                          } 
                          className="text-right"
                        >
                          الإجمالي
                        </TableCell>
                        {columnVisibility.debit && (
                          <TableCell className="text-left tabular-nums">
                            {totals.debit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                          </TableCell>
                        )}
                        {columnVisibility.credit && (
                          <TableCell className="text-left tabular-nums">
                            {totals.credit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                          </TableCell>
                        )}
                        {columnVisibility.balance && (
                          <TableCell className={`text-left tabular-nums ${closingBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {closingBalance.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                          </TableCell>
                        )}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        {selectedAccountId && filteredEntries.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print:hidden">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">الرصيد الافتتاحي</p>
                  <p className={`text-2xl font-bold ${openingBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {openingBalance.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">إجمالي المدين</p>
                  <p className="text-2xl font-bold text-primary">
                    {totals.debit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">إجمالي الدائن</p>
                  <p className="text-2xl font-bold text-primary">
                    {totals.credit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">الرصيد الختامي</p>
                  <p className={`text-2xl font-bold ${closingBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {closingBalance.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Empty State */}
        {!selectedAccountId && (
          <Card className="print:hidden">
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">اختر حساباً لعرض كشف الحساب</h3>
                <p className="text-sm">
                  حدد الحساب والفترة الزمنية من الخيارات أعلاه
                </p>
      </div>

      {/* Journal Entry Detail Dialog */}
      <Dialog open={showEntryDialog} onOpenChange={setShowEntryDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              تفاصيل القيد {entryDetails?.entry_number}
            </DialogTitle>
          </DialogHeader>
          
          {entryLoading ? (
            <div className="space-y-4 p-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : entryDetails ? (
            <div className="space-y-4">
              {/* Entry Header */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">رقم القيد</p>
                  <p className="font-medium">{entryDetails.entry_number}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">التاريخ</p>
                  <p className="font-medium">{format(new Date(entryDetails.entry_date), 'yyyy/MM/dd')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">الحالة</p>
                  <Badge variant={entryDetails.is_posted ? 'default' : 'secondary'}>
                    {entryDetails.is_posted ? 'مرحّل' : 'غير مرحّل'}
                  </Badge>
                </div>
                {entryDetails.reference_type && (
                  <div>
                    <p className="text-sm text-muted-foreground">النوع</p>
                    <Badge variant="outline">{entryDetails.reference_type}</Badge>
                  </div>
                )}
              </div>

              {/* Invoice Link Button */}
              {linkedInvoice && (
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={handleOpenInvoice}>
                    <FileText className="w-4 h-4 ml-2" />
                    فتح الفاتورة ({linkedInvoice.invoice_number})
                  </Button>
                </div>
              )}
              {entryDetails.description && (
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">البيان</p>
                  <p>{entryDetails.description}</p>
                </div>
              )}

              {/* Entry Lines */}
              <div>
                <h4 className="font-medium mb-2">بنود القيد</h4>
                <div className="border rounded-lg overflow-x-auto">
                  <Table className="min-w-[600px]">
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-right whitespace-nowrap">رقم الحساب</TableHead>
                        <TableHead className="text-right">اسم الحساب</TableHead>
                        <TableHead className="text-right">البيان</TableHead>
                        <TableHead className="text-left whitespace-nowrap">مدين</TableHead>
                        <TableHead className="text-left whitespace-nowrap">دائن</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entryDetails.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-mono text-sm whitespace-nowrap">
                            {line.account?.account_code}
                          </TableCell>
                          <TableCell className="text-sm">{line.account?.account_name}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {line.description || '-'}
                          </TableCell>
                          <TableCell className="text-left tabular-nums whitespace-nowrap">
                            {(line.debit_amount || 0) > 0
                              ? (line.debit_amount || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
                              : '-'}
                          </TableCell>
                          <TableCell className="text-left tabular-nums whitespace-nowrap">
                            {(line.credit_amount || 0) > 0
                              ? (line.credit_amount || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
                              : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totals Row */}
                      <TableRow className="bg-muted font-bold">
                        <TableCell colSpan={3} className="text-left">الإجمالي</TableCell>
                        <TableCell className="text-left tabular-nums">
                          {(entryDetails.total_debit || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-left tabular-nums">
                          {(entryDetails.total_credit || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              لم يتم العثور على القيد
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Invoice Dialog */}
      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              الفاتورة {linkedInvoice?.invoice_number}
            </DialogTitle>
          </DialogHeader>
          {invoiceDetails?.invoice && (
            <PrintableInvoice 
              invoice={invoiceDetails.invoice} 
              items={invoiceDetails.items || []} 
            />
          )}
          {!invoiceDetails?.invoice && selectedInvoiceId && (
            <div className="flex items-center justify-center py-8">
              <Skeleton className="h-64 w-full" />
            </div>
          )}
        </DialogContent>
      </Dialog>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:block, .print\\:block * {
            visibility: visible;
          }
          main {
            visibility: visible !important;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          main * {
            visibility: visible;
          }
          .print\\:hidden {
            display: none !important;
          }
          table {
            font-size: 12px;
          }
        }
      `}</style>
    </MainLayout>
  );
}
