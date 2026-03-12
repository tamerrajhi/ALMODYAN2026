import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Clock, UserCheck, UserX } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import ReportFilters from '../ReportFilters';

interface AttendanceReportProps {
  onBack: () => void;
}

export default function AttendanceReport({ onBack }: AttendanceReportProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  const { data: attendance, isLoading } = useQuery({
    queryKey: ['attendance-report', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', format(dateFrom, 'yyyy-MM-dd'));
      if (dateTo) params.set('dateTo', format(dateTo, 'yyyy-MM-dd'));
      const res = await fetch(`/api/reports/attendance?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      return res.json();
    }
  });

  const totalRecords = attendance?.length || 0;
  const presentCount = attendance?.filter(a => a.status === 'present').length || 0;
  const absentCount = attendance?.filter(a => a.status === 'absent').length || 0;
  const lateCount = attendance?.filter(a => a.status === 'late').length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'تقرير الحضور والانصراف' : 'Attendance Report'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'تحليل حضور الموظفين' : 'Employee attendance analysis'}</p>
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
            <CardTitle className="text-sm font-medium text-muted-foreground">{language === 'ar' ? 'إجمالي السجلات' : 'Total Records'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRecords}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-green-600" />
              {language === 'ar' ? 'حاضر' : 'Present'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{presentCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <UserX className="w-4 h-4 text-red-600" />
              {language === 'ar' ? 'غائب' : 'Absent'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{absentCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              {language === 'ar' ? 'متأخر' : 'Late'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{lateCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'الموظف' : 'Employee'}</TableHead>
                <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                <TableHead>{language === 'ar' ? 'وقت الحضور' : 'Check In'}</TableHead>
                <TableHead>{language === 'ar' ? 'وقت الانصراف' : 'Check Out'}</TableHead>
                <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                <TableHead>{language === 'ar' ? 'ساعات إضافية' : 'Overtime'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : attendance?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                attendance?.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">{record.employees?.full_name || '-'}</TableCell>
                    <TableCell>{format(new Date(record.attendance_date), 'PP', { locale: dateLocale })}</TableCell>
                    <TableCell>{record.check_in_time || '-'}</TableCell>
                    <TableCell>{record.check_out_time || '-'}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        record.status === 'present' ? 'bg-green-100 text-green-700' :
                        record.status === 'absent' ? 'bg-red-100 text-red-700' :
                        record.status === 'late' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {record.status}
                      </span>
                    </TableCell>
                    <TableCell>{record.overtime_hours || 0} {language === 'ar' ? 'ساعة' : 'hrs'}</TableCell>
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
