import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Banknote, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

interface PayrollReportProps {
  onBack: () => void;
}

export default function PayrollReport({ onBack }: PayrollReportProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;

  const { data: payrollRecords, isLoading } = useQuery({
    queryKey: ['payroll-report'],
    queryFn: async () => {
      const res = await fetch('/api/reports/payroll', { credentials: 'include' });
      if (res.status === 501) return [];
      return res.json();
    }
  });

  const totalRecords = payrollRecords?.length || 0;
  const totalNetSalary = payrollRecords?.reduce((sum, r) => sum + (r.net_salary || 0), 0) || 0;
  const totalDeductions = payrollRecords?.reduce((sum, r) => sum + (r.total_deductions || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'تقرير الرواتب' : 'Payroll Report'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'ملخص رواتب الموظفين' : 'Employee salary summary'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              {language === 'ar' ? 'عدد السجلات' : 'Total Records'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRecords}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Banknote className="w-4 h-4 text-green-600" />
              {language === 'ar' ? 'إجمالي الصافي' : 'Total Net Salary'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalNetSalary.toLocaleString()} {t.currency.sar}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'إجمالي الاستقطاعات' : 'Total Deductions'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{totalDeductions.toLocaleString()} {t.currency.sar}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'الموظف' : 'Employee'}</TableHead>
                <TableHead>{language === 'ar' ? 'الفترة' : 'Period'}</TableHead>
                <TableHead>{language === 'ar' ? 'الراتب الأساسي' : 'Base Salary'}</TableHead>
                <TableHead>{language === 'ar' ? 'البدلات' : 'Allowances'}</TableHead>
                <TableHead>{language === 'ar' ? 'الاستقطاعات' : 'Deductions'}</TableHead>
                <TableHead>{language === 'ar' ? 'الصافي' : 'Net Salary'}</TableHead>
                <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : payrollRecords?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                payrollRecords?.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">{record.employees?.full_name || '-'}</TableCell>
                    <TableCell>{record.payroll_periods?.period_name || '-'}</TableCell>
                    <TableCell>{(record.base_salary || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-green-600">+{((record.housing_allowance || 0) + (record.transport_allowance || 0) + (record.other_allowances || 0)).toLocaleString()}</TableCell>
                    <TableCell className="text-red-600">-{(record.total_deductions || 0).toLocaleString()}</TableCell>
                    <TableCell className="font-bold">{(record.net_salary || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">
                        {language === 'ar' ? 'مكتمل' : 'Completed'}
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
