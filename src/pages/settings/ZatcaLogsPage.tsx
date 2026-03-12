import { useState } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { arSA, enUS } from 'date-fns/locale';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  FileText, 
  Search, 
  CheckCircle, 
  XCircle, 
  Clock,
  RefreshCw,
  Eye,
  Loader2
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ZatcaLog {
  id: string;
  invoice_id: string | null;
  action: string;
  request_payload: string | null;
  response_payload: string | null;
  success: boolean | null;
  error_message: string | null;
  created_at: string;
}

export default function ZatcaLogsPage() {
  const { language } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<ZatcaLog | null>(null);

  const { data: logs, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['zatca-logs', statusFilter, actionFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (actionFilter !== 'all') params.set('action', actionFilter);
      const url = `/api/zatca-logs-list${params.toString() ? '?' + params.toString() : ''}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch ZATCA logs');
      return (await res.json()) as ZatcaLog[];
    },
  });

  const filteredLogs = logs?.filter(log => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      log.id.toLowerCase().includes(searchLower) ||
      log.invoice_id?.toLowerCase().includes(searchLower) ||
      log.action.toLowerCase().includes(searchLower) ||
      log.error_message?.toLowerCase().includes(searchLower)
    );
  });

  const getActionLabel = (action: string) => {
    const labels: Record<string, { ar: string; en: string }> = {
      generate_xml: { ar: 'إنشاء XML', en: 'Generate XML' },
      sign: { ar: 'التوقيع', en: 'Sign' },
      submit: { ar: 'الإرسال', en: 'Submit' },
      validate: { ar: 'التحقق', en: 'Validate' },
      onboard: { ar: 'الربط', en: 'Onboard' },
    };
    return labels[action]?.[language as 'ar' | 'en'] || action;
  };

  const getActionBadgeVariant = (action: string) => {
    switch (action) {
      case 'submit': return 'default';
      case 'sign': return 'secondary';
      case 'generate_xml': return 'outline';
      case 'validate': return 'secondary';
      case 'onboard': return 'default';
      default: return 'outline';
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return format(date, 'yyyy-MM-dd HH:mm:ss', {
      locale: language === 'ar' ? arSA : enUS,
    });
  };

  const formatJson = (jsonStr: string | null) => {
    if (!jsonStr) return null;
    try {
      return JSON.stringify(JSON.parse(jsonStr), null, 2);
    } catch {
      return jsonStr;
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" />
            <div>
              <h1 className="page-title">
                {language === 'ar' ? 'سجل عمليات ZATCA' : 'ZATCA Operations Log'}
              </h1>
              <p className="page-description">
                {language === 'ar'
                  ? 'عرض جميع عمليات الربط والإرسال مع هيئة الزكاة'
                  : 'View all ZATCA integration and submission operations'}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
            <span className="mr-2">
              {language === 'ar' ? 'تحديث' : 'Refresh'}
            </span>
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={language === 'ar' ? 'بحث...' : 'Search...'}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={language === 'ar' ? 'الحالة' : 'Status'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {language === 'ar' ? 'جميع الحالات' : 'All Statuses'}
                  </SelectItem>
                  <SelectItem value="success">
                    {language === 'ar' ? 'ناجح' : 'Success'}
                  </SelectItem>
                  <SelectItem value="error">
                    {language === 'ar' ? 'فشل' : 'Failed'}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={language === 'ar' ? 'نوع العملية' : 'Action Type'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {language === 'ar' ? 'جميع العمليات' : 'All Actions'}
                  </SelectItem>
                  <SelectItem value="generate_xml">
                    {language === 'ar' ? 'إنشاء XML' : 'Generate XML'}
                  </SelectItem>
                  <SelectItem value="sign">
                    {language === 'ar' ? 'التوقيع' : 'Sign'}
                  </SelectItem>
                  <SelectItem value="submit">
                    {language === 'ar' ? 'الإرسال' : 'Submit'}
                  </SelectItem>
                  <SelectItem value="validate">
                    {language === 'ar' ? 'التحقق' : 'Validate'}
                  </SelectItem>
                  <SelectItem value="onboard">
                    {language === 'ar' ? 'الربط' : 'Onboard'}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {language === 'ar' ? 'سجل العمليات' : 'Operations Log'}
              {filteredLogs && (
                <Badge variant="secondary" className="mr-2">
                  {filteredLogs.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : !filteredLogs?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                {language === 'ar' ? 'لا توجد سجلات' : 'No logs found'}
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                      <TableHead>{language === 'ar' ? 'العملية' : 'Action'}</TableHead>
                      <TableHead>{language === 'ar' ? 'رقم الفاتورة' : 'Invoice ID'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الرسالة' : 'Message'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الإجراءات' : 'Actions'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap font-mono text-sm">
                          {formatDate(log.created_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getActionBadgeVariant(log.action)}>
                            {getActionLabel(log.action)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {log.invoice_id ? log.invoice_id.substring(0, 8) + '...' : '-'}
                        </TableCell>
                        <TableCell>
                          {log.success ? (
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              <span>{language === 'ar' ? 'نجاح' : 'Success'}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-destructive">
                              <XCircle className="h-4 w-4" />
                              <span>{language === 'ar' ? 'فشل' : 'Failed'}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {log.error_message || '-'}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedLog(log)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              {language === 'ar' ? 'تفاصيل العملية' : 'Operation Details'}
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {language === 'ar' ? 'التاريخ' : 'Date'}
                    </label>
                    <p className="font-mono">{formatDate(selectedLog.created_at)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {language === 'ar' ? 'العملية' : 'Action'}
                    </label>
                    <p>
                      <Badge variant={getActionBadgeVariant(selectedLog.action)}>
                        {getActionLabel(selectedLog.action)}
                      </Badge>
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {language === 'ar' ? 'رقم الفاتورة' : 'Invoice ID'}
                    </label>
                    <p className="font-mono">{selectedLog.invoice_id || '-'}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {language === 'ar' ? 'الحالة' : 'Status'}
                    </label>
                    <p>
                      {selectedLog.success ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <CheckCircle className="h-4 w-4" />
                          {language === 'ar' ? 'نجاح' : 'Success'}
                        </span>
                      ) : (
                        <span className="text-destructive flex items-center gap-1">
                          <XCircle className="h-4 w-4" />
                          {language === 'ar' ? 'فشل' : 'Failed'}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {selectedLog.error_message && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {language === 'ar' ? 'رسالة الخطأ' : 'Error Message'}
                    </label>
                    <p className="text-destructive bg-destructive/10 p-2 rounded mt-1">
                      {selectedLog.error_message}
                    </p>
                  </div>
                )}

                {selectedLog.request_payload && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {language === 'ar' ? 'بيانات الطلب' : 'Request Payload'}
                    </label>
                    <pre className="bg-muted p-3 rounded mt-1 text-xs overflow-x-auto">
                      {formatJson(selectedLog.request_payload)}
                    </pre>
                  </div>
                )}

                {selectedLog.response_payload && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {language === 'ar' ? 'بيانات الاستجابة' : 'Response Payload'}
                    </label>
                    <pre className="bg-muted p-3 rounded mt-1 text-xs overflow-x-auto">
                      {formatJson(selectedLog.response_payload)}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
