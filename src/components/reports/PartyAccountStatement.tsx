import { useState, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ArrowRight, CalendarIcon, Download, Printer, FileText, Users, Building } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { useReactToPrint } from 'react-to-print';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { addCairoFont, processTextForPDF } from '@/lib/fonts/cairo-font';

interface PartyAccountStatementProps {
  onBack: () => void;
}

interface Transaction {
  id: string;
  date: string;
  type: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

type PartyType = 'customer' | 'supplier';

export default function PartyAccountStatement({ onBack }: PartyAccountStatementProps) {
  const { t, language } = useLanguage();
  const printRef = useRef<HTMLDivElement>(null);
  
  const [partyType, setPartyType] = useState<PartyType>('customer');
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [startDate, setStartDate] = useState<Date>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [showReport, setShowReport] = useState(false);

  const dateLocale = language === 'ar' ? ar : enUS;

  const { data: customers } = useQuery({
    queryKey: ['customers-for-statement'],
    queryFn: async () => {
      const res = await fetch('/api/customers');
      if (!res.ok) throw new Error('Failed to fetch customers');
      return res.json();
    },
    enabled: partyType === 'customer',
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-for-statement'],
    queryFn: async () => {
      const res = await fetch('/api/suppliers');
      if (!res.ok) throw new Error('Failed to fetch suppliers');
      return res.json();
    },
    enabled: partyType === 'supplier',
  });

  // Get selected party details
  const selectedParty = useMemo(() => {
    if (partyType === 'customer') {
      return customers?.find(c => c.id === selectedPartyId);
    } else {
      return suppliers?.find(s => s.id === selectedPartyId);
    }
  }, [partyType, selectedPartyId, customers, suppliers]);

  const typeLabels: Record<string, Record<string, string>> = {
    ar: { sale: 'فاتورة مبيعات', receipt: 'سند قبض', return: 'مرتجع مبيعات', credit_note: 'إشعار دائن', purchase: 'فاتورة مشتريات', purchase_return: 'مرتجع مشتريات', payment: 'سند صرف' },
    en: { sale: 'Sales Invoice', receipt: 'Receipt', return: 'Sales Return', credit_note: 'Credit Note', purchase: 'Purchase Invoice', purchase_return: 'Purchase Return', payment: 'Payment' },
  };

  const { data: statementData, isLoading: isLoadingStatement } = useQuery({
    queryKey: ['party-statement', partyType, selectedPartyId, startDate, endDate],
    queryFn: async () => {
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');
      const res = await fetch(`/api/reports/party-statement?party_type=${partyType}&party_id=${selectedPartyId}&start_date=${startDateStr}&end_date=${endDateStr}`);
      if (!res.ok) throw new Error('Failed to fetch statement');
      const data = await res.json();

      const lang = language === 'ar' ? 'ar' : 'en';
      const transactions: Omit<Transaction, 'balance'>[] = data.transactions.map((tx: any) => {
        const typeLabel = typeLabels[lang][tx.type] || tx.type;
        let description = '';
        if (tx.type === 'sale') description = lang === 'ar' ? `فاتورة مبيعات رقم ${tx.reference}` : `Sales Invoice #${tx.reference}`;
        else if (tx.type === 'receipt') description = lang === 'ar' ? `سند قبض - ${tx.payment_method === 'cash' ? 'نقدي' : tx.payment_method === 'card' ? 'بطاقة' : tx.payment_method}` : `Receipt - ${tx.payment_method}`;
        else if (tx.type === 'return') description = lang === 'ar' ? `مرتجع مبيعات رقم ${tx.reference}` : `Sales Return #${tx.reference}`;
        else if (tx.type === 'credit_note') description = tx.reason || typeLabel;
        else if (tx.type === 'purchase') description = lang === 'ar' ? `فاتورة مشتريات رقم ${tx.reference}` : `Purchase Invoice #${tx.reference}`;
        else if (tx.type === 'purchase_return') description = lang === 'ar' ? `مرتجع مشتريات رقم ${tx.reference}` : `Purchase Return #${tx.reference}`;
        else if (tx.type === 'payment') description = lang === 'ar' ? `سند صرف - ${tx.payment_method === 'cash' ? 'نقدي' : tx.payment_method === 'check' ? 'شيك' : tx.payment_method}` : `Payment - ${tx.payment_method}`;

        return { id: tx.id, date: tx.date, type: typeLabel, reference: tx.reference, description, debit: tx.debit, credit: tx.credit };
      });

      return { openingBalance: data.openingBalance, transactions };
    },
    enabled: showReport && !!selectedPartyId,
  });

  const openingBalance = statementData?.openingBalance ?? 0;

  const transactionsWithBalance = useMemo(() => {
    const rawTransactions = statementData?.transactions;
    if (!rawTransactions) return [];

    let runningBalance = openingBalance || 0;
    
    return rawTransactions.map(tx => {
      runningBalance = runningBalance + tx.debit - tx.credit;
      return {
        ...tx,
        balance: runningBalance,
      };
    });
  }, [statementData, openingBalance]);

  // Summary calculations
  const totalDebit = transactionsWithBalance.reduce((sum, tx) => sum + tx.debit, 0);
  const totalCredit = transactionsWithBalance.reduce((sum, tx) => sum + tx.credit, 0);
  const closingBalance = (openingBalance || 0) + totalDebit - totalCredit;

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: language === 'ar' 
      ? `كشف حساب - ${selectedParty ? (partyType === 'customer' ? (selectedParty as any).full_name : (selectedParty as any).supplier_name) : ''}`
      : `Account Statement - ${selectedParty ? (partyType === 'customer' ? (selectedParty as any).full_name : (selectedParty as any).supplier_name) : ''}`,
  });

  const handleExportExcel = () => {
    const partyName = selectedParty 
      ? (partyType === 'customer' ? (selectedParty as any).full_name : (selectedParty as any).supplier_name)
      : '';

    const data = [
      {
        [language === 'ar' ? 'التاريخ' : 'Date']: language === 'ar' ? 'رصيد أول المدة' : 'Opening Balance',
        [language === 'ar' ? 'النوع' : 'Type']: '',
        [language === 'ar' ? 'المرجع' : 'Reference']: '',
        [language === 'ar' ? 'البيان' : 'Description']: '',
        [language === 'ar' ? 'مدين' : 'Debit']: openingBalance || 0 > 0 ? openingBalance : 0,
        [language === 'ar' ? 'دائن' : 'Credit']: openingBalance || 0 < 0 ? Math.abs(openingBalance || 0) : 0,
        [language === 'ar' ? 'الرصيد' : 'Balance']: openingBalance || 0,
      },
      ...transactionsWithBalance.map(tx => ({
        [language === 'ar' ? 'التاريخ' : 'Date']: format(new Date(tx.date), 'yyyy-MM-dd'),
        [language === 'ar' ? 'النوع' : 'Type']: tx.type,
        [language === 'ar' ? 'المرجع' : 'Reference']: tx.reference,
        [language === 'ar' ? 'البيان' : 'Description']: tx.description,
        [language === 'ar' ? 'مدين' : 'Debit']: tx.debit,
        [language === 'ar' ? 'دائن' : 'Credit']: tx.credit,
        [language === 'ar' ? 'الرصيد' : 'Balance']: tx.balance,
      })),
      {
        [language === 'ar' ? 'التاريخ' : 'Date']: '',
        [language === 'ar' ? 'النوع' : 'Type']: '',
        [language === 'ar' ? 'المرجع' : 'Reference']: '',
        [language === 'ar' ? 'البيان' : 'Description']: language === 'ar' ? 'الإجمالي' : 'Total',
        [language === 'ar' ? 'مدين' : 'Debit']: totalDebit,
        [language === 'ar' ? 'دائن' : 'Credit']: totalCredit,
        [language === 'ar' ? 'الرصيد' : 'Balance']: closingBalance,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'كشف الحساب' : 'Account Statement');
    XLSX.writeFile(wb, `statement-${partyName}-${format(startDate, 'yyyy-MM-dd')}-${format(endDate, 'yyyy-MM-dd')}.xlsx`);
  };

  const handleExportPDF = async () => {
    const partyName = selectedParty 
      ? (partyType === 'customer' ? (selectedParty as any).full_name : (selectedParty as any).supplier_name)
      : '';

    const doc = new jsPDF('landscape', 'mm', 'a4');
    await addCairoFont(doc);
    
    doc.setFontSize(16);
    doc.text(
      language === 'ar' ? 'كشف حساب' : 'Account Statement',
      doc.internal.pageSize.getWidth() / 2,
      15,
      { align: 'center' }
    );
    
    doc.setFontSize(12);
    doc.text(
      `${language === 'ar' ? (partyType === 'customer' ? 'العميل' : 'المورد') : (partyType === 'customer' ? 'Customer' : 'Supplier')}: ${partyName}`,
      doc.internal.pageSize.getWidth() / 2,
      25,
      { align: 'center' }
    );
    
    doc.setFontSize(10);
    doc.text(
      `${language === 'ar' ? 'الفترة' : 'Period'}: ${format(startDate, 'yyyy-MM-dd')} - ${format(endDate, 'yyyy-MM-dd')}`,
      doc.internal.pageSize.getWidth() / 2,
      32,
      { align: 'center' }
    );

    const headers = language === 'ar'
      ? ['الرصيد', 'دائن', 'مدين', 'البيان', 'المرجع', 'النوع', 'التاريخ']
      : ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'];

    const body = [
      language === 'ar'
        ? [formatCurrency(openingBalance || 0), '', '', 'رصيد أول المدة', '', '', '']
        : ['', '', '', 'Opening Balance', '', '', formatCurrency(openingBalance || 0)],
      ...transactionsWithBalance.map(tx => 
        language === 'ar'
          ? [
              formatCurrency(tx.balance),
              tx.credit > 0 ? formatCurrency(tx.credit) : '',
              tx.debit > 0 ? formatCurrency(tx.debit) : '',
              processTextForPDF(tx.description, 40),
              tx.reference,
              tx.type,
              format(new Date(tx.date), 'yyyy-MM-dd'),
            ]
          : [
              format(new Date(tx.date), 'yyyy-MM-dd'),
              tx.type,
              tx.reference,
              processTextForPDF(tx.description, 40),
              tx.debit > 0 ? formatCurrency(tx.debit) : '',
              tx.credit > 0 ? formatCurrency(tx.credit) : '',
              formatCurrency(tx.balance),
            ]
      ),
      language === 'ar'
        ? [formatCurrency(closingBalance), formatCurrency(totalCredit), formatCurrency(totalDebit), 'الإجمالي', '', '', '']
        : ['', '', '', 'Total', formatCurrency(totalDebit), formatCurrency(totalCredit), formatCurrency(closingBalance)],
    ];

    (doc as any).autoTable({
      head: [headers],
      body,
      startY: 40,
      styles: {
        font: 'Cairo',
        fontSize: 9,
        halign: language === 'ar' ? 'right' : 'left',
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: 255,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [245, 247, 250],
      },
    });

    doc.save(`statement-${partyName}-${format(startDate, 'yyyy-MM-dd')}-${format(endDate, 'yyyy-MM-dd')}.pdf`);
  };

  const isLoading = isLoadingStatement;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">
              {language === 'ar' ? 'كشف حساب العملاء / الموردين' : 'Customer / Supplier Account Statement'}
            </h2>
            <p className="text-muted-foreground text-sm">
              {language === 'ar' ? 'تقرير تفصيلي لحركة الحساب' : 'Detailed account movement report'}
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            {language === 'ar' ? 'معايير التقرير' : 'Report Criteria'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-5">
            {/* Party Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {language === 'ar' ? 'نوع الحساب' : 'Account Type'}
              </label>
              <Select 
                value={partyType} 
                onValueChange={(value: PartyType) => {
                  setPartyType(value);
                  setSelectedPartyId('');
                  setShowReport(false);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      {language === 'ar' ? 'عملاء' : 'Customers'}
                    </div>
                  </SelectItem>
                  <SelectItem value="supplier">
                    <div className="flex items-center gap-2">
                      <Building className="w-4 h-4" />
                      {language === 'ar' ? 'موردين' : 'Suppliers'}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Party Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {partyType === 'customer' 
                  ? (language === 'ar' ? 'اختر العميل' : 'Select Customer')
                  : (language === 'ar' ? 'اختر المورد' : 'Select Supplier')
                }
              </label>
              <Select 
                value={selectedPartyId} 
                onValueChange={(value) => {
                  setSelectedPartyId(value);
                  setShowReport(false);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'اختر...' : 'Select...'} />
                </SelectTrigger>
                <SelectContent>
                  {partyType === 'customer' ? (
                    customers?.map(customer => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.customer_code} - {customer.full_name}
                      </SelectItem>
                    ))
                  ) : (
                    suppliers?.map(supplier => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.supplier_ref || supplier.id.slice(0, 8)} - {supplier.supplier_name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Start Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {language === 'ar' ? 'من تاريخ' : 'From Date'}
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(startDate, 'PPP', { locale: dateLocale })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    locale={dateLocale}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {language === 'ar' ? 'إلى تاريخ' : 'To Date'}
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(endDate, 'PPP', { locale: dateLocale })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => date && setEndDate(date)}
                    locale={dateLocale}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Run Report Button */}
            <div className="space-y-2">
              <label className="text-sm font-medium invisible">Action</label>
              <Button 
                onClick={() => setShowReport(true)} 
                disabled={!selectedPartyId}
                className="w-full"
              >
                {language === 'ar' ? 'عرض التقرير' : 'Run Report'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Results */}
      {showReport && selectedPartyId && (
        <>
          {/* Export Actions */}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-2">
              <Download className="w-4 h-4" />
              {language === 'ar' ? 'Excel' : 'Excel'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-2">
              <FileText className="w-4 h-4" />
              {language === 'ar' ? 'PDF' : 'PDF'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePrint()} className="gap-2">
              <Printer className="w-4 h-4" />
              {language === 'ar' ? 'طباعة' : 'Print'}
            </Button>
          </div>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {language === 'ar' ? 'رصيد أول المدة' : 'Opening Balance'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-xl font-bold ${(openingBalance || 0) >= 0 ? 'text-blue-600' : 'text-red-600'}`} dir="ltr">
                  {formatCurrency(openingBalance || 0)} {t.currency.sar}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {language === 'ar' ? 'إجمالي المدين' : 'Total Debit'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-green-600" dir="ltr">
                  {formatCurrency(totalDebit)} {t.currency.sar}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {language === 'ar' ? 'إجمالي الدائن' : 'Total Credit'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-orange-600" dir="ltr">
                  {formatCurrency(totalCredit)} {t.currency.sar}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-primary/10 to-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {language === 'ar' ? 'رصيد آخر المدة' : 'Closing Balance'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-xl font-bold ${closingBalance >= 0 ? 'text-primary' : 'text-destructive'}`} dir="ltr">
                  {formatCurrency(closingBalance)} {t.currency.sar}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Transactions Table */}
          <Card>
            <CardContent className="p-0">
              <div ref={printRef} className="print:p-4">
                {/* Print Header */}
                <div className="hidden print:block text-center mb-4">
                  <h1 className="text-xl font-bold">
                    {language === 'ar' ? 'كشف حساب' : 'Account Statement'}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {partyType === 'customer' 
                      ? (language === 'ar' ? 'العميل' : 'Customer')
                      : (language === 'ar' ? 'المورد' : 'Supplier')
                    }: {selectedParty 
                      ? (partyType === 'customer' ? (selectedParty as any).full_name : (selectedParty as any).supplier_name)
                      : ''
                    }
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'الفترة' : 'Period'}: {format(startDate, 'yyyy-MM-dd')} - {format(endDate, 'yyyy-MM-dd')}
                  </p>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                      <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                      <TableHead>{language === 'ar' ? 'المرجع' : 'Reference'}</TableHead>
                      <TableHead>{language === 'ar' ? 'البيان' : 'Description'}</TableHead>
                      <TableHead className="text-end">{language === 'ar' ? 'مدين' : 'Debit'}</TableHead>
                      <TableHead className="text-end">{language === 'ar' ? 'دائن' : 'Credit'}</TableHead>
                      <TableHead className="text-end">{language === 'ar' ? 'الرصيد' : 'Balance'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Opening Balance Row */}
                    <TableRow className="bg-muted/30 font-medium">
                      <TableCell colSpan={4}>
                        {language === 'ar' ? 'رصيد أول المدة' : 'Opening Balance'}
                      </TableCell>
                      <TableCell className="text-end" dir="ltr">
                        {(openingBalance || 0) > 0 ? formatCurrency(openingBalance || 0) : '-'}
                      </TableCell>
                      <TableCell className="text-end" dir="ltr">
                        {(openingBalance || 0) < 0 ? formatCurrency(Math.abs(openingBalance || 0)) : '-'}
                      </TableCell>
                      <TableCell className="text-end font-bold" dir="ltr">
                        {formatCurrency(openingBalance || 0)}
                      </TableCell>
                    </TableRow>

                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">{t.common.loading}</TableCell>
                      </TableRow>
                    ) : transactionsWithBalance.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">{t.common.noData}</TableCell>
                      </TableRow>
                    ) : (
                      transactionsWithBalance.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell>{format(new Date(tx.date), 'yyyy-MM-dd')}</TableCell>
                          <TableCell>{tx.type}</TableCell>
                          <TableCell className="font-medium">{tx.reference}</TableCell>
                          <TableCell>{tx.description}</TableCell>
                          <TableCell className="text-end text-green-600" dir="ltr">
                            {tx.debit > 0 ? formatCurrency(tx.debit) : '-'}
                          </TableCell>
                          <TableCell className="text-end text-orange-600" dir="ltr">
                            {tx.credit > 0 ? formatCurrency(tx.credit) : '-'}
                          </TableCell>
                          <TableCell className={`text-end font-medium ${tx.balance >= 0 ? 'text-blue-600' : 'text-red-600'}`} dir="ltr">
                            {formatCurrency(tx.balance)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}

                    {/* Totals Row */}
                    <TableRow className="bg-muted/50 font-bold border-t-2">
                      <TableCell colSpan={4}>
                        {language === 'ar' ? 'الإجمالي' : 'Total'}
                      </TableCell>
                      <TableCell className="text-end text-green-700" dir="ltr">
                        {formatCurrency(totalDebit)}
                      </TableCell>
                      <TableCell className="text-end text-orange-700" dir="ltr">
                        {formatCurrency(totalCredit)}
                      </TableCell>
                      <TableCell className={`text-end ${closingBalance >= 0 ? 'text-blue-700' : 'text-red-700'}`} dir="ltr">
                        {formatCurrency(closingBalance)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
