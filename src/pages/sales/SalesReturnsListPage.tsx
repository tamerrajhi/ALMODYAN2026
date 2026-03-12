import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as apiClient from '@/lib/apiClient';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Search, RotateCcw, FileText, Loader2 } from 'lucide-react';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface SalesReturnsListPageProps {
  mode?: 'pos' | 'erp';
}

const SalesReturnsListPage = ({ mode: modeProp }: SalesReturnsListPageProps = {}) => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const modeParam = new URLSearchParams(location.search).get('mode') || 'erp';
  const mode: 'pos' | 'erp' = modeProp || (modeParam === 'pos' ? 'pos' : 'erp');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Fetch sales returns — POS mode uses dedicated POS endpoint (branch-scoped, no ERP session needed)
  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['sales-returns', mode],
    queryFn: async () => {
      if (mode === 'pos') {
        const res = await fetch('/api/pos/sales-returns', { credentials: 'include' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to fetch POS returns');
        }
        return await res.json();
      }
      const { data, error } = await apiClient.get<any[]>('/api/sales-returns-invoices');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const modeFiltered = mode === 'pos'
    ? returns
    : returns.filter((ret: any) => ret.original_sale_id === null);

  const filteredReturns = modeFiltered.filter(ret => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = 
      ret.invoice_number?.toLowerCase().includes(q) ||
      ret.original_invoice_number?.toLowerCase().includes(q) ||
      ret.customers?.full_name?.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || ret.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: modeFiltered.length,
    pending: modeFiltered.filter(r => r.status === 'pending').length,
    approved: modeFiltered.filter(r => r.status === 'approved' || r.status === 'completed').length,
    totalAmount: modeFiltered.reduce((sum, r) => sum + (r.total_amount || 0), 0),
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: language === 'ar' ? 'معلق' : 'Pending', variant: 'secondary' },
      approved: { label: language === 'ar' ? 'معتمد' : 'Approved', variant: 'default' },
      completed: { label: language === 'ar' ? 'مكتمل' : 'Completed', variant: 'default' },
      cancelled: { label: language === 'ar' ? 'ملغي' : 'Cancelled', variant: 'destructive' },
    };
    const config = statusConfig[status] || statusConfig.pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Tabs: فواتير / مرتجعات */}
        <div className="flex items-center gap-1 border-b">
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground"
            data-testid="tab-invoices"
            onClick={() => navigate(mode === 'pos' ? '/pos/invoices' : '/sales/invoices')}
          >
            {language === 'ar' ? 'فواتير' : 'Invoices'}
          </button>
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
            data-testid="tab-returns"
          >
            {language === 'ar' ? 'مرتجعات' : 'Returns'}
          </button>
        </div>

        {/* Header */}
        <div className="page-header-rtl">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RotateCcw className="w-6 h-6 text-blue-500" />
              {mode === 'pos'
                ? (language === 'ar' ? 'مرتجعات مبيعات POS' : 'POS Sales Returns')
                : (language === 'ar' ? 'مرتجعات المبيعات العامة' : 'ERP Sales Returns')}
            </h1>
            <p className="text-muted-foreground">
              {mode === 'pos'
                ? (language === 'ar' ? 'إدارة مرتجعات مبيعات نقاط البيع' : 'Manage POS sales returns')
                : (language === 'ar' ? 'إدارة مرتجعات المبيعات العامة من العملاء' : 'Manage ERP sales returns from customers')}
            </p>
          </div>
          <Button onClick={() => navigate(mode === 'pos' ? '/pos/return' : '/sales/returns/new')} className="gap-2" data-testid="button-new-return">
            <Plus className="w-4 h-4" />
            {language === 'ar' ? 'مرتجع جديد' : 'New Return'}
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'إجمالي المرتجعات' : 'Total Returns'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'معلقة' : 'Pending'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'مكتملة' : 'Completed'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {language === 'ar' ? 'إجمالي القيمة' : 'Total Value'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600" dir="ltr">
                {formatCurrency(stats.totalAmount)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={language === 'ar' ? 'بحث برقم المرتجع أو رقم الفاتورة أو اسم العميل...' : 'Search by return no., invoice no. or customer...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ps-10"
                />
              </div>
              
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder={language === 'ar' ? 'الحالة' : 'Status'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="pending">{language === 'ar' ? 'معلق' : 'Pending'}</SelectItem>
                  <SelectItem value="approved">{language === 'ar' ? 'معتمد' : 'Approved'}</SelectItem>
                  <SelectItem value="completed">{language === 'ar' ? 'مكتمل' : 'Completed'}</SelectItem>
                  <SelectItem value="cancelled">{language === 'ar' ? 'ملغي' : 'Cancelled'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Returns Table */}
        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredReturns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{language === 'ar' ? 'لا توجد مرتجعات' : 'No returns found'}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{language === 'ar' ? 'رقم المرتجع' : 'Return No.'}</TableHead>
                    <TableHead>{language === 'ar' ? 'الفاتورة الأصلية' : 'Original Invoice'}</TableHead>
                    <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                    <TableHead>{language === 'ar' ? 'العميل' : 'Customer'}</TableHead>
                    <TableHead>{language === 'ar' ? 'الفرع' : 'Branch'}</TableHead>
                    <TableHead className="text-center">{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                    <TableHead className="text-center">{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                    <TableHead className="text-center">{language === 'ar' ? 'الإجراءات' : 'Actions'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReturns.map((ret) => (
                    <TableRow key={ret.id}>
                      <TableCell className="font-medium">{ret.invoice_number}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {ret.original_invoice_number || '-'}
                      </TableCell>
                      <TableCell>
                        {format(new Date(ret.invoice_date), 'dd/MM/yyyy', {
                          locale: language === 'ar' ? ar : undefined,
                        })}
                      </TableCell>
                      <TableCell>{ret.customers?.full_name || '-'}</TableCell>
                      <TableCell>{ret.branches?.branch_name || '-'}</TableCell>
                      <TableCell className="text-center font-medium text-blue-600" dir="ltr">
                        -{formatCurrency(ret.total_amount || 0)}
                      </TableCell>
                      <TableCell className="text-center">{getStatusBadge(ret.status)}</TableCell>
                      <TableCell className="text-center">
                        <RowActionsMenu
                          onPreview={() => navigate(mode === 'pos' ? `/pos/returns/${ret.id}/view` : `/sales/returns/${ret.id}/view`)}
                          onEdit={ret.status === 'pending' ? () => navigate(mode === 'pos' ? `/pos/returns/${ret.id}` : `/sales/returns/${ret.id}`) : undefined}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default SalesReturnsListPage;
