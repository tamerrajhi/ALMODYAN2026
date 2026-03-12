import { useState, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ArrowRight, CalendarIcon, Download, FileText, Printer, CheckCircle2, XCircle, Settings2, Filter } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useReactToPrint } from 'react-to-print';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { addCairoFont } from '@/lib/fonts/cairo-font';
import { useBranches } from '@/hooks/useBranches';

interface AdvancedTrialBalanceReportProps {
  onBack: () => void;
}

interface TrialBalanceRow {
  id: string;
  account_code: string;
  account_name: string;
  account_name_en: string | null;
  account_type: string;
  level: number;
  opening_debit: number;
  opening_credit: number;
  period_debit: number;
  period_credit: number;
  closing_debit: number;
  closing_credit: number;
}

interface JournalEntryLine {
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  journal_entries: {
    entry_date: string;
    is_posted: boolean;
    reference_type: string | null;
    branch_id: string | null;
  };
}

const getAccountLevel = (accountCode: string): number => {
  const length = accountCode.length;
  if (length === 1) return 1;
  if (length === 2) return 2;
  if (length <= 4) return 3;
  if (length <= 6) return 4;
  return 5;
};

// Parent account codes for Accounts Receivable (Customers) and Accounts Payable (Suppliers)
const CUSTOMER_PARENT_CODE = '1102';
const SUPPLIER_PARENT_CODE = '2101';

// Check if account is a customer sub-account (starts with 1102 and has more digits)
// Includes both old format (110201, 110202) and new format (11020001, 11020002, etc.)
const isCustomerSubAccount = (code: string) => 
  code.startsWith(CUSTOMER_PARENT_CODE) && code.length > CUSTOMER_PARENT_CODE.length;

// Check if account is a supplier sub-account (starts with 2101 and has more digits)
// Includes both old format (210101, 210102) and new format (21010001, 21010002, etc.)
const isSupplierSubAccount = (code: string) => 
  code.startsWith(SUPPLIER_PARENT_CODE) && code.length > SUPPLIER_PARENT_CODE.length;

export default function AdvancedTrialBalanceReport({ onBack }: AdvancedTrialBalanceReportProps) {
  const { t, language } = useLanguage();
  const printRef = useRef<HTMLDivElement>(null);
  
  // Date Filters
  const [startDate, setStartDate] = useState<Date>(() => {
    const date = new Date();
    date.setMonth(0, 1);
    return date;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [selectedLevel, setSelectedLevel] = useState<number>(5);

  // Options Section (خيارات)
  const [showSerial, setShowSerial] = useState(true);
  const [includePostedEntries, setIncludePostedEntries] = useState(true);
  const [includeUnpostedEntries, setIncludeUnpostedEntries] = useState(false);
  const [excludeOpeningEntries, setExcludeOpeningEntries] = useState(false);
  const [showOpeningWithPreviousBalance, setShowOpeningWithPreviousBalance] = useState(true);
  const [hideEmptyAccounts, setHideEmptyAccounts] = useState(true);
  const [hideBalancedAccounts, setHideBalancedAccounts] = useState(false);
  const [showSubAccounts, setShowSubAccounts] = useState(true);
  const [showMainAccounts, setShowMainAccounts] = useState(true);
  const [showLowestParentOnly, setShowLowestParentOnly] = useState(false);
  const [detailByBranch, setDetailByBranch] = useState(false);
  const [mergeCodeWithName, setMergeCodeWithName] = useState(false);

  // Conditions Section (شروط)
  const [accountFilter, setAccountFilter] = useState('');
  const [showCustomers, setShowCustomers] = useState(true);
  const [showSuppliers, setShowSuppliers] = useState(true);
  const [sortType, setSortType] = useState<'auto' | 'code' | 'name'>('auto');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);

  // Fetch branches
  const { data: branches } = useBranches(true);

  // Fetch all trial balance data from API
  const { data: trialBalanceResponse } = useQuery({
    queryKey: ['trial-balance-data', startDate.toISOString(), endDate.toISOString(), includePostedEntries, includeUnpostedEntries, excludeOpeningEntries, selectedBranches],
    queryFn: async () => {
      const params = new URLSearchParams({
        start_date: format(startDate, 'yyyy-MM-dd'),
        end_date: format(endDate, 'yyyy-MM-dd'),
      });
      if (includePostedEntries && !includeUnpostedEntries) params.append('posted_only', 'true');
      if (!includePostedEntries && includeUnpostedEntries) params.append('unposted_only', 'true');
      if (excludeOpeningEntries) params.append('exclude_opening', 'true');
      if (selectedBranches.length > 0) params.append('branches', selectedBranches.join(','));

      const res = await fetch(`/api/reports/advanced-trial-balance?${params.toString()}`, { credentials: 'include' });
      if (res.status === 501) return { accounts: [], balances: [] };
      if (!res.ok) throw new Error('Failed to fetch trial balance data');
      return await res.json() as {
        accounts: Array<{
          id: string;
          account_code: string;
          account_name: string;
          account_name_en: string | null;
          account_type: string;
          is_active: boolean;
        }>;
        balances: Array<{
          account_id: string;
          total_debit: number;
          total_credit: number;
          opening_debit?: number;
          opening_credit?: number;
          period_debit?: number;
          period_credit?: number;
        }>;
      };
    }
  });

  const accounts = trialBalanceResponse?.accounts;
  const balancesRaw = trialBalanceResponse?.balances;

  const openingEntries = useMemo(() => {
    if (!balancesRaw) return [];
    return balancesRaw.map(b => ({
      account_id: b.account_id,
      debit_amount: b.opening_debit ?? 0,
      credit_amount: b.opening_credit ?? 0,
      journal_entries: { entry_date: '', is_posted: true, reference_type: null, branch_id: null },
    }));
  }, [balancesRaw]);

  const periodEntries = useMemo(() => {
    if (!balancesRaw) return [];
    return balancesRaw.map(b => ({
      account_id: b.account_id,
      debit_amount: b.period_debit ?? b.total_debit ?? 0,
      credit_amount: b.period_credit ?? b.total_credit ?? 0,
      journal_entries: { entry_date: '', is_posted: true, reference_type: null, branch_id: null },
    }));
  }, [balancesRaw]);

  // Calculate balances
  const trialBalanceData = useMemo(() => {
    if (!accounts) return [];

    // Group opening entries by account
    const openingByAccount: Record<string, { debit: number; credit: number }> = {};
    openingEntries?.forEach(entry => {
      if (!openingByAccount[entry.account_id]) {
        openingByAccount[entry.account_id] = { debit: 0, credit: 0 };
      }
      openingByAccount[entry.account_id].debit += Number(entry.debit_amount) || 0;
      openingByAccount[entry.account_id].credit += Number(entry.credit_amount) || 0;
    });

    // Group period entries by account
    const periodByAccount: Record<string, { debit: number; credit: number }> = {};
    periodEntries?.forEach(entry => {
      if (!periodByAccount[entry.account_id]) {
        periodByAccount[entry.account_id] = { debit: 0, credit: 0 };
      }
      periodByAccount[entry.account_id].debit += Number(entry.debit_amount) || 0;
      periodByAccount[entry.account_id].credit += Number(entry.credit_amount) || 0;
    });

    const rows: TrialBalanceRow[] = accounts.map(account => {
      const opening = openingByAccount[account.id] || { debit: 0, credit: 0 };
      const period = periodByAccount[account.id] || { debit: 0, credit: 0 };
      
      // Calculate opening balance
      const openingNet = opening.debit - opening.credit;
      const opening_debit = openingNet > 0 ? openingNet : 0;
      const opening_credit = openingNet < 0 ? Math.abs(openingNet) : 0;

      // Period movement (raw debits and credits)
      const period_debit = period.debit;
      const period_credit = period.credit;

      // Calculate closing balance
      const closingNet = openingNet + (period.debit - period.credit);
      const closing_debit = closingNet > 0 ? closingNet : 0;
      const closing_credit = closingNet < 0 ? Math.abs(closingNet) : 0;

      return {
        id: account.id,
        account_code: account.account_code,
        account_name: account.account_name,
        account_name_en: account.account_name_en,
        account_type: account.account_type,
        level: getAccountLevel(account.account_code),
        opening_debit,
        opening_credit,
        period_debit,
        period_credit,
        closing_debit,
        closing_credit,
      };
    });

    return rows;
  }, [accounts, openingEntries, periodEntries]);

  // Process data with customer/supplier aggregation logic
  // Handles BOTH scenarios:
  // 1. Entries on parent account directly (legacy/transitional state)
  // 2. Entries on sub-accounts (correct state after migration)
  // 
  // When HIDDEN: Show parent account with TOTAL balance (parent's own + aggregated sub-accounts)
  // When SHOWN: Show parent account + all sub-accounts individually
  const processedData = useMemo(() => {
    const result: TrialBalanceRow[] = [];
    
    // Get parent account rows
    const customerParentRow = trialBalanceData.find(r => r.account_code === CUSTOMER_PARENT_CODE);
    const supplierParentRow = trialBalanceData.find(r => r.account_code === SUPPLIER_PARENT_CODE);
    
    // Calculate aggregated balances for customers (sum of all sub-accounts)
    const customerSubAccounts = trialBalanceData.filter(r => isCustomerSubAccount(r.account_code));
    const customerSubAggregated = customerSubAccounts.reduce((acc, r) => ({
      opening_debit: acc.opening_debit + r.opening_debit,
      opening_credit: acc.opening_credit + r.opening_credit,
      period_debit: acc.period_debit + r.period_debit,
      period_credit: acc.period_credit + r.period_credit,
      closing_debit: acc.closing_debit + r.closing_debit,
      closing_credit: acc.closing_credit + r.closing_credit,
    }), { opening_debit: 0, opening_credit: 0, period_debit: 0, period_credit: 0, closing_debit: 0, closing_credit: 0 });
    
    // Calculate aggregated balances for suppliers (sum of all sub-accounts)
    const supplierSubAccounts = trialBalanceData.filter(r => isSupplierSubAccount(r.account_code));
    const supplierSubAggregated = supplierSubAccounts.reduce((acc, r) => ({
      opening_debit: acc.opening_debit + r.opening_debit,
      opening_credit: acc.opening_credit + r.opening_credit,
      period_debit: acc.period_debit + r.period_debit,
      period_credit: acc.period_credit + r.period_credit,
      closing_debit: acc.closing_debit + r.closing_debit,
      closing_credit: acc.closing_credit + r.closing_credit,
    }), { opening_debit: 0, opening_credit: 0, period_debit: 0, period_credit: 0, closing_debit: 0, closing_credit: 0 });
    
    // Calculate TOTAL balance for parent accounts (parent's direct balance + sub-accounts aggregated)
    // This handles the transitional state where entries may exist on both parent and sub-accounts
    const customerTotalBalance = {
      opening_debit: (customerParentRow?.opening_debit || 0) + customerSubAggregated.opening_debit,
      opening_credit: (customerParentRow?.opening_credit || 0) + customerSubAggregated.opening_credit,
      period_debit: (customerParentRow?.period_debit || 0) + customerSubAggregated.period_debit,
      period_credit: (customerParentRow?.period_credit || 0) + customerSubAggregated.period_credit,
      closing_debit: (customerParentRow?.closing_debit || 0) + customerSubAggregated.closing_debit,
      closing_credit: (customerParentRow?.closing_credit || 0) + customerSubAggregated.closing_credit,
    };
    
    const supplierTotalBalance = {
      opening_debit: (supplierParentRow?.opening_debit || 0) + supplierSubAggregated.opening_debit,
      opening_credit: (supplierParentRow?.opening_credit || 0) + supplierSubAggregated.opening_credit,
      period_debit: (supplierParentRow?.period_debit || 0) + supplierSubAggregated.period_debit,
      period_credit: (supplierParentRow?.period_credit || 0) + supplierSubAggregated.period_credit,
      closing_debit: (supplierParentRow?.closing_debit || 0) + supplierSubAggregated.closing_debit,
      closing_credit: (supplierParentRow?.closing_credit || 0) + supplierSubAggregated.closing_credit,
    };
    
    trialBalanceData.forEach(row => {
      // Handle customer sub-accounts
      if (isCustomerSubAccount(row.account_code)) {
        // Only include sub-accounts when showCustomers is true
        if (showCustomers) {
          result.push(row);
        }
        return;
      }
      
      // Handle supplier sub-accounts
      if (isSupplierSubAccount(row.account_code)) {
        // Only include sub-accounts when showSuppliers is true
        if (showSuppliers) {
          result.push(row);
        }
        return;
      }
      
      // Handle customer parent account (1102)
      if (row.account_code === CUSTOMER_PARENT_CODE) {
        if (showCustomers) {
          // When showing customers: parent shows only its DIRECT balance
          // Sub-accounts are displayed separately, so no aggregation here
          result.push(row);
        } else {
          // When hiding customers: parent shows TOTAL balance (direct + sub-accounts)
          result.push({
            ...row,
            opening_debit: customerTotalBalance.opening_debit,
            opening_credit: customerTotalBalance.opening_credit,
            period_debit: customerTotalBalance.period_debit,
            period_credit: customerTotalBalance.period_credit,
            closing_debit: customerTotalBalance.closing_debit,
            closing_credit: customerTotalBalance.closing_credit,
          });
        }
        return;
      }
      
      // Handle supplier parent account (2101)
      if (row.account_code === SUPPLIER_PARENT_CODE) {
        if (showSuppliers) {
          // When showing suppliers: parent shows only its DIRECT balance
          // Sub-accounts are displayed separately, so no aggregation here
          result.push(row);
        } else {
          // When hiding suppliers: parent shows TOTAL balance (direct + sub-accounts)
          result.push({
            ...row,
            opening_debit: supplierTotalBalance.opening_debit,
            opening_credit: supplierTotalBalance.opening_credit,
            period_debit: supplierTotalBalance.period_debit,
            period_credit: supplierTotalBalance.period_credit,
            closing_debit: supplierTotalBalance.closing_debit,
            closing_credit: supplierTotalBalance.closing_credit,
          });
        }
        return;
      }
      
      // All other accounts pass through unchanged
      result.push(row);
    });
    
    return result;
  }, [trialBalanceData, showCustomers, showSuppliers]);

  // Filter data
  const filteredData = useMemo(() => {
    let data = processedData.filter(row => {
      // Level filter
      if (row.level > selectedLevel) return false;
      
      // Account search filter
      if (accountFilter) {
        const search = accountFilter.toLowerCase();
        if (!row.account_code.toLowerCase().includes(search) && 
            !row.account_name.toLowerCase().includes(search)) {
          return false;
        }
      }
      
      // Hide empty accounts
      if (hideEmptyAccounts) {
        const hasActivity = row.opening_debit > 0 || row.opening_credit > 0 || 
                           row.period_debit > 0 || row.period_credit > 0 ||
                           row.closing_debit > 0 || row.closing_credit > 0;
        if (!hasActivity) return false;
      }
      
      // Hide balanced accounts (zero closing balance)
      if (hideBalancedAccounts) {
        if (Math.abs(row.closing_debit - row.closing_credit) < 0.01 && 
            row.closing_debit === 0 && row.closing_credit === 0) return false;
      }
      
      // Sub/Main account filters
      if (!showSubAccounts && row.level === selectedLevel) return false;
      if (!showMainAccounts && row.level < selectedLevel) return false;
      
      // Lowest parent only - show only accounts at selected level
      if (showLowestParentOnly && row.level !== selectedLevel) return false;
      
      return true;
    });
    
    // Sort data
    if (sortType === 'code') {
      data = [...data].sort((a, b) => a.account_code.localeCompare(b.account_code));
    } else if (sortType === 'name') {
      data = [...data].sort((a, b) => a.account_name.localeCompare(b.account_name));
    }
    
    return data;
  }, [processedData, selectedLevel, hideEmptyAccounts, 
      hideBalancedAccounts, showSubAccounts, showMainAccounts, showLowestParentOnly, 
      accountFilter, sortType]);

  // Calculate totals
  const totals = useMemo(() => {
    return filteredData.reduce((acc, row) => ({
      opening_debit: acc.opening_debit + row.opening_debit,
      opening_credit: acc.opening_credit + row.opening_credit,
      period_debit: acc.period_debit + row.period_debit,
      period_credit: acc.period_credit + row.period_credit,
      closing_debit: acc.closing_debit + row.closing_debit,
      closing_credit: acc.closing_credit + row.closing_credit,
    }), {
      opening_debit: 0,
      opening_credit: 0,
      period_debit: 0,
      period_credit: 0,
      closing_debit: 0,
      closing_credit: 0,
    });
  }, [filteredData]);

  // Check balance
  const isBalanced = {
    opening: Math.abs(totals.opening_debit - totals.opening_credit) < 0.01,
    period: Math.abs(totals.period_debit - totals.period_credit) < 0.01,
    closing: Math.abs(totals.closing_debit - totals.closing_credit) < 0.01,
  };

  // Print handler
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: language === 'ar' ? 'ميزان المراجعة' : 'Trial Balance',
  });

  // Export to Excel
  const exportToExcel = () => {
    const data = filteredData.map((row, index) => ({
      '#': index + 1,
      [language === 'ar' ? 'رمز الحساب' : 'Account Code']: row.account_code,
      [language === 'ar' ? 'اسم الحساب' : 'Account Name']: language === 'ar' ? row.account_name : (row.account_name_en || row.account_name),
      [language === 'ar' ? 'رصيد أول مدين' : 'Opening Debit']: row.opening_debit,
      [language === 'ar' ? 'رصيد أول دائن' : 'Opening Credit']: row.opening_credit,
      [language === 'ar' ? 'حركة مدين' : 'Period Debit']: row.period_debit,
      [language === 'ar' ? 'حركة دائن' : 'Period Credit']: row.period_credit,
      [language === 'ar' ? 'رصيد آخر مدين' : 'Closing Debit']: row.closing_debit,
      [language === 'ar' ? 'رصيد آخر دائن' : 'Closing Credit']: row.closing_credit,
    }));

    // Add totals row
    data.push({
      '#': '',
      [language === 'ar' ? 'رمز الحساب' : 'Account Code']: '',
      [language === 'ar' ? 'اسم الحساب' : 'Account Name']: language === 'ar' ? 'الإجمالي' : 'Total',
      [language === 'ar' ? 'رصيد أول مدين' : 'Opening Debit']: totals.opening_debit,
      [language === 'ar' ? 'رصيد أول دائن' : 'Opening Credit']: totals.opening_credit,
      [language === 'ar' ? 'حركة مدين' : 'Period Debit']: totals.period_debit,
      [language === 'ar' ? 'حركة دائن' : 'Period Credit']: totals.period_credit,
      [language === 'ar' ? 'رصيد آخر مدين' : 'Closing Debit']: totals.closing_debit,
      [language === 'ar' ? 'رصيد آخر دائن' : 'Closing Credit']: totals.closing_credit,
    } as any);

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'ميزان المراجعة' : 'Trial Balance');
    XLSX.writeFile(wb, `trial-balance-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  // Export to PDF
  const exportToPDF = async () => {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const fontLoaded = await addCairoFont(doc);
    
    if (fontLoaded) {
      doc.setFont('Cairo');
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Title
    doc.setFontSize(18);
    doc.text(language === 'ar' ? 'ميزان المراجعة' : 'Trial Balance', pageWidth / 2, 15, { align: 'center' });
    
    // Date range
    doc.setFontSize(12);
    const dateRange = language === 'ar' 
      ? `من: ${format(startDate, 'yyyy/MM/dd')} إلى: ${format(endDate, 'yyyy/MM/dd')}`
      : `From: ${format(startDate, 'yyyy/MM/dd')} To: ${format(endDate, 'yyyy/MM/dd')}`;
    doc.text(dateRange, pageWidth / 2, 22, { align: 'center' });

    // Table
    const tableData = filteredData.map((row, index) => [
      (index + 1).toString(),
      row.account_code,
      language === 'ar' ? row.account_name : (row.account_name_en || row.account_name),
      row.opening_debit.toLocaleString(),
      row.opening_credit.toLocaleString(),
      row.period_debit.toLocaleString(),
      row.period_credit.toLocaleString(),
      row.closing_debit.toLocaleString(),
      row.closing_credit.toLocaleString(),
    ]);

    // Add totals row
    tableData.push([
      '',
      '',
      language === 'ar' ? 'الإجمالي' : 'Total',
      totals.opening_debit.toLocaleString(),
      totals.opening_credit.toLocaleString(),
      totals.period_debit.toLocaleString(),
      totals.period_credit.toLocaleString(),
      totals.closing_debit.toLocaleString(),
      totals.closing_credit.toLocaleString(),
    ]);

    autoTable(doc, {
      head: [[
        '#',
        language === 'ar' ? 'الرمز' : 'Code',
        language === 'ar' ? 'الحساب' : 'Account',
        language === 'ar' ? 'رصيد أول مدين' : 'Op. Debit',
        language === 'ar' ? 'رصيد أول دائن' : 'Op. Credit',
        language === 'ar' ? 'حركة مدين' : 'Per. Debit',
        language === 'ar' ? 'حركة دائن' : 'Per. Credit',
        language === 'ar' ? 'رصيد آخر مدين' : 'Cl. Debit',
        language === 'ar' ? 'رصيد آخر دائن' : 'Cl. Credit',
      ]],
      body: tableData,
      startY: 28,
      styles: {
        font: fontLoaded ? 'Cairo' : 'helvetica',
        fontSize: 8,
        halign: language === 'ar' ? 'right' : 'left',
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: 255,
        halign: 'center',
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { halign: 'center', cellWidth: 20 },
        2: { cellWidth: 50 },
        3: { halign: 'right', cellWidth: 25 },
        4: { halign: 'right', cellWidth: 25 },
        5: { halign: 'right', cellWidth: 25 },
        6: { halign: 'right', cellWidth: 25 },
        7: { halign: 'right', cellWidth: 25 },
        8: { halign: 'right', cellWidth: 25 },
      },
    });

    doc.save(`trial-balance-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'ميزان المراجعة المتقدم' : 'Advanced Trial Balance'}</h2>
            <p className="text-muted-foreground text-sm">
              {language === 'ar' ? 'ميزان مراجعة شامل مع أرصدة أول وآخر المدة والحركة' : 'Comprehensive trial balance with opening, closing and movement'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportToExcel}>
            <Download className="w-4 h-4 me-2" />
            Excel
          </Button>
          <Button variant="outline" size="sm" onClick={exportToPDF}>
            <FileText className="w-4 h-4 me-2" />
            PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => handlePrint()}>
            <Printer className="w-4 h-4 me-2" />
            {language === 'ar' ? 'طباعة' : 'Print'}
          </Button>
        </div>
      </div>

      {/* Filters - Two Panel Layout */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Options Panel (خيارات) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              {language === 'ar' ? 'خيارات' : 'Options'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="show-serial" checked={showSerial} onCheckedChange={(c) => setShowSerial(!!c)} />
                <Label htmlFor="show-serial" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'إظهار المسلسل (#)' : 'Show Serial (#)'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="posted-entries" checked={includePostedEntries} onCheckedChange={(c) => setIncludePostedEntries(!!c)} />
                <Label htmlFor="posted-entries" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'القيود المرحلة' : 'Posted Entries'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="unposted-entries" checked={includeUnpostedEntries} onCheckedChange={(c) => setIncludeUnpostedEntries(!!c)} />
                <Label htmlFor="unposted-entries" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'القيود غير المرحلة' : 'Unposted Entries'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="exclude-opening" checked={excludeOpeningEntries} onCheckedChange={(c) => setExcludeOpeningEntries(!!c)} />
                <Label htmlFor="exclude-opening" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'عدم اعتبار القيود الإفتتاحية' : 'Exclude Opening Entries'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="show-opening-prev" checked={showOpeningWithPreviousBalance} onCheckedChange={(c) => setShowOpeningWithPreviousBalance(!!c)} />
                <Label htmlFor="show-opening-prev" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'إظهار الإفتتاحية مع الرصيد السابق' : 'Show Opening with Previous'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="hide-empty" checked={hideEmptyAccounts} onCheckedChange={(c) => setHideEmptyAccounts(!!c)} />
                <Label htmlFor="hide-empty" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'إخفاء الحسابات الفارغة' : 'Hide Empty Accounts'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="hide-balanced" checked={hideBalancedAccounts} onCheckedChange={(c) => setHideBalancedAccounts(!!c)} />
                <Label htmlFor="hide-balanced" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'إخفاء الحسابات المرصدة' : 'Hide Balanced Accounts'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="show-sub" checked={showSubAccounts} onCheckedChange={(c) => setShowSubAccounts(!!c)} />
                <Label htmlFor="show-sub" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'إظهار الحسابات الفرعية' : 'Show Sub Accounts'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="show-main" checked={showMainAccounts} onCheckedChange={(c) => setShowMainAccounts(!!c)} />
                <Label htmlFor="show-main" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'إظهار الحسابات الرئيسية' : 'Show Main Accounts'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="lowest-parent" checked={showLowestParentOnly} onCheckedChange={(c) => setShowLowestParentOnly(!!c)} />
                <Label htmlFor="lowest-parent" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'إظهار الرئيسي الأدنى فقط' : 'Show Lowest Parent Only'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="detail-branch" checked={detailByBranch} onCheckedChange={(c) => setDetailByBranch(!!c)} />
                <Label htmlFor="detail-branch" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'بالتفصيل لكل فرع' : 'Detail by Branch'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="merge-code" checked={mergeCodeWithName} onCheckedChange={(c) => setMergeCodeWithName(!!c)} />
                <Label htmlFor="merge-code" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'دمج رمز الحساب مع الاسم' : 'Merge Code with Name'}
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Conditions Panel (شروط) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="w-4 h-4" />
              {language === 'ar' ? 'شروط' : 'Conditions'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Account Search */}
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الحساب' : 'Account'}</Label>
              <Input
                placeholder={language === 'ar' ? 'بحث بالرمز أو الاسم...' : 'Search by code or name...'}
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
              />
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'من تاريخ' : 'From Date'}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-start font-normal">
                      <CalendarIcon className="me-2 h-4 w-4" />
                      {format(startDate, 'yyyy/MM/dd')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={(date) => date && setStartDate(date)}
                      locale={language === 'ar' ? ar : undefined}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'إلى تاريخ' : 'To Date'}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-start font-normal">
                      <CalendarIcon className="me-2 h-4 w-4" />
                      {format(endDate, 'yyyy/MM/dd')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={(date) => date && setEndDate(date)}
                      locale={language === 'ar' ? ar : undefined}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Level and Sort */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                <Select value={selectedLevel.toString()} onValueChange={(v) => setSelectedLevel(parseInt(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map(level => (
                      <SelectItem key={level} value={level.toString()}>
                        {language === 'ar' ? `المستوى ${level}` : `Level ${level}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'نوع الترتيب' : 'Sort Type'}</Label>
                <Select value={sortType} onValueChange={(v) => setSortType(v as 'auto' | 'code' | 'name')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{language === 'ar' ? 'تلقائي' : 'Auto'}</SelectItem>
                    <SelectItem value="code">{language === 'ar' ? 'حسب الرمز' : 'By Code'}</SelectItem>
                    <SelectItem value="name">{language === 'ar' ? 'حسب الاسم' : 'By Name'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Branches Filter */}
            {branches && branches.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{language === 'ar' ? 'الفروع' : 'Branches'}</Label>
                  {selectedBranches.length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-xs"
                      onClick={() => setSelectedBranches([])}
                    >
                      {language === 'ar' ? 'مسح الكل' : 'Clear All'}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedBranches.length === 0
                    ? (language === 'ar' ? 'جميع الفروع (بدون فلترة)' : 'All branches (no filter)')
                    : (language === 'ar' ? `${selectedBranches.length} فرع مختار` : `${selectedBranches.length} branch(es) selected`)}
                </p>
                <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-24 overflow-y-auto">
                  {branches.map((branch) => (
                    <div key={branch.id} className="flex items-center gap-1">
                      <Checkbox 
                        id={`branch-${branch.id}`} 
                        checked={selectedBranches.includes(branch.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedBranches([...selectedBranches, branch.id]);
                          } else {
                            setSelectedBranches(selectedBranches.filter(id => id !== branch.id));
                          }
                        }}
                      />
                      <Label htmlFor={`branch-${branch.id}`} className="text-xs cursor-pointer">
                        {branch.branch_name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Customer/Supplier toggles */}
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <Checkbox id="show-customers" checked={showCustomers} onCheckedChange={(c) => setShowCustomers(!!c)} />
                <Label htmlFor="show-customers" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'إظهار العملاء' : 'Show Customers'}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="show-suppliers" checked={showSuppliers} onCheckedChange={(c) => setShowSuppliers(!!c)} />
                <Label htmlFor="show-suppliers" className="text-sm cursor-pointer">
                  {language === 'ar' ? 'إظهار الموردين' : 'Show Suppliers'}
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              {language === 'ar' ? 'رصيد أول المدة' : 'Opening Balance'}
              {isBalanced.opening ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{language === 'ar' ? 'مدين' : 'Debit'}:</span>
                <span className="font-medium">{formatNumber(totals.opening_debit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{language === 'ar' ? 'دائن' : 'Credit'}:</span>
                <span className="font-medium">{formatNumber(totals.opening_credit)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              {language === 'ar' ? 'الحركة' : 'Movement'}
              {isBalanced.period ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{language === 'ar' ? 'مدين' : 'Debit'}:</span>
                <span className="font-medium">{formatNumber(totals.period_debit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{language === 'ar' ? 'دائن' : 'Credit'}:</span>
                <span className="font-medium">{formatNumber(totals.period_credit)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              {language === 'ar' ? 'رصيد آخر المدة' : 'Closing Balance'}
              {isBalanced.closing ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{language === 'ar' ? 'مدين' : 'Debit'}:</span>
                <span className="font-medium">{formatNumber(totals.closing_debit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{language === 'ar' ? 'دائن' : 'Credit'}:</span>
                <span className="font-medium">{formatNumber(totals.closing_credit)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <div ref={printRef} className="print:p-4">
        {/* Print Header - Hidden on screen */}
        <div className="hidden print:block mb-4">
          <h1 className="text-2xl font-bold text-center">{language === 'ar' ? 'ميزان المراجعة' : 'Trial Balance'}</h1>
          <p className="text-center text-sm text-muted-foreground">
            {language === 'ar' 
              ? `من: ${format(startDate, 'yyyy/MM/dd')} إلى: ${format(endDate, 'yyyy/MM/dd')}`
              : `From: ${format(startDate, 'yyyy/MM/dd')} To: ${format(endDate, 'yyyy/MM/dd')}`
            }
          </p>
        </div>

        <Card className="print:shadow-none print:border-0">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {showSerial && <TableHead className="w-12 text-center">#</TableHead>}
                    {mergeCodeWithName ? (
                      <TableHead>{language === 'ar' ? 'الحساب' : 'Account'}</TableHead>
                    ) : (
                      <>
                        <TableHead className="w-24">{language === 'ar' ? 'الرمز' : 'Code'}</TableHead>
                        <TableHead>{language === 'ar' ? 'الحساب' : 'Account'}</TableHead>
                      </>
                    )}
                    <TableHead colSpan={2} className="text-center border-s bg-blue-50/50 dark:bg-blue-900/20">
                      {language === 'ar' ? 'رصيد أول المدة' : 'Opening'}
                    </TableHead>
                    <TableHead colSpan={2} className="text-center border-s bg-amber-50/50 dark:bg-amber-900/20">
                      {language === 'ar' ? 'الحركة' : 'Movement'}
                    </TableHead>
                    <TableHead colSpan={2} className="text-center border-s bg-green-50/50 dark:bg-green-900/20">
                      {language === 'ar' ? 'رصيد آخر المدة' : 'Closing'}
                    </TableHead>
                  </TableRow>
                  <TableRow>
                    {showSerial && <TableHead></TableHead>}
                    {mergeCodeWithName ? (
                      <TableHead></TableHead>
                    ) : (
                      <>
                        <TableHead></TableHead>
                        <TableHead></TableHead>
                      </>
                    )}
                    <TableHead className="text-end border-s bg-blue-50/50 dark:bg-blue-900/20">{language === 'ar' ? 'مدين' : 'Debit'}</TableHead>
                    <TableHead className="text-end bg-blue-50/50 dark:bg-blue-900/20">{language === 'ar' ? 'دائن' : 'Credit'}</TableHead>
                    <TableHead className="text-end border-s bg-amber-50/50 dark:bg-amber-900/20">{language === 'ar' ? 'مدين' : 'Debit'}</TableHead>
                    <TableHead className="text-end bg-amber-50/50 dark:bg-amber-900/20">{language === 'ar' ? 'دائن' : 'Credit'}</TableHead>
                    <TableHead className="text-end border-s bg-green-50/50 dark:bg-green-900/20">{language === 'ar' ? 'مدين' : 'Debit'}</TableHead>
                    <TableHead className="text-end bg-green-50/50 dark:bg-green-900/20">{language === 'ar' ? 'دائن' : 'Credit'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={showSerial ? (mergeCodeWithName ? 8 : 9) : (mergeCodeWithName ? 7 : 8)} className="text-center py-8 text-muted-foreground">
                        {language === 'ar' ? 'لا توجد بيانات' : 'No data'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {filteredData.map((row, index) => (
                        <TableRow key={row.id} className={row.level === 1 ? 'bg-muted/30 font-semibold' : ''}>
                          {showSerial && <TableCell className="text-center text-muted-foreground">{index + 1}</TableCell>}
                          {mergeCodeWithName ? (
                            <TableCell style={{ paddingInlineStart: `${(row.level - 1) * 16}px` }}>
                              <span className="font-mono text-sm">{row.account_code}</span>
                              <span className="mx-2">-</span>
                              {language === 'ar' ? row.account_name : (row.account_name_en || row.account_name)}
                            </TableCell>
                          ) : (
                            <>
                              <TableCell className="font-mono text-sm">{row.account_code}</TableCell>
                              <TableCell style={{ paddingInlineStart: `${(row.level - 1) * 16}px` }}>
                                {language === 'ar' ? row.account_name : (row.account_name_en || row.account_name)}
                              </TableCell>
                            </>
                          )}
                          <TableCell className="text-end border-s bg-blue-50/30 dark:bg-blue-900/10">
                            {row.opening_debit > 0 ? formatNumber(row.opening_debit) : '-'}
                          </TableCell>
                          <TableCell className="text-end bg-blue-50/30 dark:bg-blue-900/10">
                            {row.opening_credit > 0 ? formatNumber(row.opening_credit) : '-'}
                          </TableCell>
                          <TableCell className="text-end border-s bg-amber-50/30 dark:bg-amber-900/10">
                            {row.period_debit > 0 ? formatNumber(row.period_debit) : '-'}
                          </TableCell>
                          <TableCell className="text-end bg-amber-50/30 dark:bg-amber-900/10">
                            {row.period_credit > 0 ? formatNumber(row.period_credit) : '-'}
                          </TableCell>
                          <TableCell className="text-end border-s bg-green-50/30 dark:bg-green-900/10">
                            {row.closing_debit > 0 ? formatNumber(row.closing_debit) : '-'}
                          </TableCell>
                          <TableCell className="text-end bg-green-50/30 dark:bg-green-900/10">
                            {row.closing_credit > 0 ? formatNumber(row.closing_credit) : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totals Row */}
                      <TableRow className="font-bold bg-muted/50 border-t-2">
                        <TableCell colSpan={showSerial ? (mergeCodeWithName ? 2 : 3) : (mergeCodeWithName ? 1 : 2)} className="text-start">
                          {language === 'ar' ? 'الإجمالي' : 'Total'}
                        </TableCell>
                        <TableCell className="text-end border-s bg-blue-100/50 dark:bg-blue-900/30">
                          {formatNumber(totals.opening_debit)}
                        </TableCell>
                        <TableCell className="text-end bg-blue-100/50 dark:bg-blue-900/30">
                          {formatNumber(totals.opening_credit)}
                        </TableCell>
                        <TableCell className="text-end border-s bg-amber-100/50 dark:bg-amber-900/30">
                          {formatNumber(totals.period_debit)}
                        </TableCell>
                        <TableCell className="text-end bg-amber-100/50 dark:bg-amber-900/30">
                          {formatNumber(totals.period_credit)}
                        </TableCell>
                        <TableCell className="text-end border-s bg-green-100/50 dark:bg-green-900/30">
                          {formatNumber(totals.closing_debit)}
                        </TableCell>
                        <TableCell className="text-end bg-green-100/50 dark:bg-green-900/30">
                          {formatNumber(totals.closing_credit)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
