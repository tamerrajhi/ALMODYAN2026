import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  ShoppingCart, 
  Search, 
  Calendar,
  Building2,
  User,
  Banknote,
  Package,
  Loader2,
  Download
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { formatCurrency } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface Sale {
  id: string;
  sale_code: string;
  invoice_number?: string;
  invoice_id?: string;
  sale_date: string;
  total_items: number;
  total_amount: number;
  discount_amount: number;
  final_amount: number;
  payment_method: string;
  notes: string | null;
  sold_by: string | null;
  branches: { branch_name: string } | null;
  customers: { full_name: string } | null;
}

export default function SalesHistoryPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch branches');
      return await res.json();
    },
  });

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ['sales-history', selectedBranch, searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      const res = await fetch(`/api/sales-with-details?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch sales');
      const data = await res.json();
      let mapped = (data || []).map((s: any) => ({
        ...s,
        branches: s.branch_name ? { branch_name: s.branch_name } : null,
        customers: s.full_name ? { full_name: s.full_name } : null,
      })) as Sale[];

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        mapped = mapped.filter(sale => 
          sale.sale_code.toLowerCase().includes(term) ||
          sale.invoice_number?.toLowerCase().includes(term) ||
          sale.customers?.full_name?.toLowerCase().includes(term) ||
          sale.branches?.branch_name?.toLowerCase().includes(term)
        );
      }

      return mapped;
    },
  });

  const getPaymentMethodBadge = (method: string) => {
    const styles: Record<string, string> = {
      cash: 'bg-green-100 text-green-800',
      card: 'bg-blue-100 text-blue-800',
      bank_transfer: 'bg-purple-100 text-purple-800',
    };
    const labels: Record<string, string> = {
      cash: t.pos.cash,
      card: t.pos.card,
      bank_transfer: t.pos.transfer,
    };
    return (
      <Badge className={styles[method] || 'bg-gray-100 text-gray-800'}>
        {labels[method] || method}
      </Badge>
    );
  };

  const handleExport = () => {
    const exportData = sales.map((sale) => ({
      [t.salesHistory.saleCode]: sale.invoice_number || sale.sale_code,
      [t.salesHistory.saleDate]: format(new Date(sale.sale_date), 'yyyy-MM-dd HH:mm', { locale: ar }),
      [t.branches.branchName]: sale.branches?.branch_name || '-',
      [t.salesHistory.customer]: sale.customers?.full_name || t.salesHistory.generalCustomer,
      [t.salesHistory.itemsCount]: sale.total_items,
      [t.salesHistory.totalAmount]: sale.total_amount,
      [t.salesHistory.discount]: sale.discount_amount,
      [t.salesHistory.finalAmount]: sale.final_amount,
      [t.salesHistory.paymentMethod]: sale.payment_method === 'cash' ? t.pos.cash : sale.payment_method === 'card' ? t.pos.card : t.pos.transfer,
      [t.salesHistory.seller]: sale.sold_by || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t.salesHistory.title);
    XLSX.writeFile(wb, `${t.salesHistory.title}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const handleRowClick = (sale: Sale) => {
    if (sale.invoice_id) {
      navigate(`/sales/invoices/${sale.invoice_id}/view`);
    }
  };

  const totalSalesAmount = sales.reduce((sum, s) => sum + (Number(s.final_amount) || 0), 0);
  const totalItemsSold = sales.reduce((sum, s) => sum + (s.total_items || 0), 0);

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container animate-fade-in">
        <div className="page-header-rtl">
          <div>
            <h1 className="page-title">{t.salesHistory.title}</h1>
            <p className="page-description">{t.salesHistory.subtitle}</p>
          </div>
          <Button onClick={handleExport} disabled={sales.length === 0}>
            <Download className="w-4 h-4 ml-2" />
            {t.common.exportExcel}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{sales.length}</p>
                  <p className="text-sm text-muted-foreground">{t.salesHistory.totalOperations}</p>
                </div>
                <ShoppingCart className="w-8 h-8 text-primary/50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{totalItemsSold}</p>
                  <p className="text-sm text-muted-foreground">{t.salesHistory.totalItemsSold}</p>
                </div>
                <Package className="w-8 h-8 text-primary/50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{formatCurrency(totalSalesAmount)}</p>
                  <p className="text-sm text-muted-foreground">{t.salesHistory.totalSalesAmount}</p>
                </div>
                <Banknote className="w-8 h-8 text-primary/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t.salesHistory.searchPlaceholder}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-10"
                  data-testid="input-search-sales"
                />
              </div>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="w-48" data-testid="select-branch-filter">
                  <Building2 className="w-4 h-4 ml-2" />
                  <SelectValue placeholder={t.dashboard.allBranches} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.dashboard.allBranches}</SelectItem>
                  {branches.map((branch: any) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              {t.menu.salesHistory} ({sales.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : sales.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {t.salesHistory.noSales}
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">{t.salesHistory.saleCode}</TableHead>
                      <TableHead className="text-right">{t.common.date}</TableHead>
                      <TableHead className="text-right">{t.branches.branchName}</TableHead>
                      <TableHead className="text-right">{t.salesHistory.customer}</TableHead>
                      <TableHead className="text-right">{t.common.items}</TableHead>
                      <TableHead className="text-right">{t.common.amount}</TableHead>
                      <TableHead className="text-right">{t.salesHistory.discount}</TableHead>
                      <TableHead className="text-right">{t.salesHistory.finalAmount}</TableHead>
                      <TableHead className="text-right">{t.salesHistory.paymentMethod}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.map((sale) => (
                      <TableRow 
                        key={sale.id} 
                        className="cursor-pointer hover-elevate"
                        onClick={() => handleRowClick(sale)}
                        data-testid={`row-sale-${sale.id}`}
                      >
                        <TableCell className="font-mono text-sm">{sale.invoice_number || sale.sale_code}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-muted-foreground" />
                            {format(new Date(sale.sale_date), 'yyyy/MM/dd', { locale: ar })}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(sale.sale_date), 'HH:mm')}
                          </span>
                        </TableCell>
                        <TableCell>
                          {sale.branches?.branch_name || '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-muted-foreground" />
                            {sale.customers?.full_name || t.salesHistory.generalCustomer}
                          </div>
                        </TableCell>
                        <TableCell>{sale.total_items}</TableCell>
                        <TableCell>{Number(sale.total_amount).toLocaleString()}</TableCell>
                        <TableCell className="text-destructive">
                          {Number(sale.discount_amount) > 0 ? `-${Number(sale.discount_amount).toLocaleString()}` : '-'}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {Number(sale.final_amount).toLocaleString()}
                        </TableCell>
                        <TableCell>{getPaymentMethodBadge(sale.payment_method)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
