import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Users, Wallet } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface CustomerBalancesReportProps {
  onBack: () => void;
}

export default function CustomerBalancesReport({ onBack }: CustomerBalancesReportProps) {
  const { t, language } = useLanguage();

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customer-balances-report'],
    queryFn: async () => {
      const res = await fetch('/api/reports/customer-balances', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch customer balances');
      return await res.json();
    }
  });

  const totalCustomers = customers?.length || 0;
  const totalPurchases = customers?.reduce((sum, c) => sum + (c.total_purchases || 0), 0) || 0;
  const totalPoints = customers?.reduce((sum, c) => sum + (c.loyalty_points || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'تقرير أرصدة العملاء' : 'Customer Balances Report'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'ملخص مشتريات ونقاط العملاء' : 'Customer purchases and points summary'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              {language === 'ar' ? 'إجمالي العملاء' : 'Total Customers'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCustomers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="w-4 h-4 text-green-600" />
              {language === 'ar' ? 'إجمالي المشتريات' : 'Total Purchases'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalPurchases.toLocaleString()} {t.currency.sar}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'إجمالي النقاط' : 'Total Points'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{totalPoints.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'كود العميل' : 'Customer Code'}</TableHead>
                <TableHead>{language === 'ar' ? 'الاسم' : 'Name'}</TableHead>
                <TableHead>{language === 'ar' ? 'الهاتف' : 'Phone'}</TableHead>
                <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                <TableHead className="text-right">{language === 'ar' ? 'إجمالي المشتريات' : 'Total Purchases'}</TableHead>
                <TableHead className="text-right">{language === 'ar' ? 'نقاط الولاء' : 'Loyalty Points'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : customers?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                customers?.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.customer_code}</TableCell>
                    <TableCell>{customer.full_name}</TableCell>
                    <TableCell>{customer.phone || '-'}</TableCell>
                    <TableCell>{customer.customer_type || '-'}</TableCell>
                    <TableCell className="text-right">{(customer.total_purchases || 0).toLocaleString()} {t.currency.sar}</TableCell>
                    <TableCell className="text-right">{(customer.loyalty_points || 0).toLocaleString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
