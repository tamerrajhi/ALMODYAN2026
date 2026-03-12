import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Calendar, Clock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import ReportFilters from '../ReportFilters';

interface LeavesReportProps {
  onBack: () => void;
}

export default function LeavesReport({ onBack }: LeavesReportProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  const { data: leaves, isLoading } = useQuery({
    queryKey: ['leaves-report', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', format(dateFrom, 'yyyy-MM-dd'));
      if (dateTo) params.set('dateTo', format(dateTo, 'yyyy-MM-dd'));
      const res = await fetch(`/api/reports/leaves?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      return res.json();
    }
  });

  const totalLeaves = leaves?.length || 0;
  const totalDays = leaves?.reduce((sum, l) => sum + (l.days_count || 0), 0) || 0;
  const pendingLeaves = leaves?.filter(l => l.status === 'pending').length || 0;
  const approvedLeaves = leaves?.filter(l => l.status === 'approved').length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'تقرير الإجازات' : 'Leaves Report'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'تحليل طلبات الإجازات' : 'Leave requests analysis'}</p>
          </div>
        </div>
      </div>

      <ReportFilters
        showBranchFilter={false}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onReset={() => { setDateFrom(undefined); setDateTo(undefined); }}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{language === 'ar' ? 'إجمالي الطلبات' : 'Total Requests'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalLeaves}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {language === 'ar' ? 'إجمالي الأيام' : 'Total Days'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDays}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{language === 'ar' ? 'معلق' : 'Pending'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{pendingLeaves}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{language === 'ar' ? 'معتمد' : 'Approved'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{approvedLeaves}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'الموظف' : 'Employee'}</TableHead>
                <TableHead>{language === 'ar' ? 'نوع الإجازة' : 'Leave Type'}</TableHead>
                <TableHead>{language === 'ar' ? 'من' : 'From'}</TableHead>
                <TableHead>{language === 'ar' ? 'إلى' : 'To'}</TableHead>
                <TableHead>{language === 'ar' ? 'عدد الأيام' : 'Days'}</TableHead>
                <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : leaves?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                leaves?.map((leave) => (
                  <TableRow key={leave.id}>
                    <TableCell className="font-medium">{leave.employees?.full_name || '-'}</TableCell>
                    <TableCell>{leave.leave_type}</TableCell>
                    <TableCell>{format(new Date(leave.start_date), 'PP', { locale: dateLocale })}</TableCell>
                    <TableCell>{format(new Date(leave.end_date), 'PP', { locale: dateLocale })}</TableCell>
                    <TableCell>{leave.days_count}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        leave.status === 'approved' ? 'bg-green-100 text-green-700' :
                        leave.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        leave.status === 'rejected' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {leave.status}
                      </span>
                    </TableCell>
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
