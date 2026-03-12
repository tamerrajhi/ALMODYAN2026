import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useModules } from '@/core/contexts/ModuleContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { 
  Search, 
  Eye, 
  Download, 
  CalendarIcon, 
  X, 
  FileText,
  Shield,
  Activity,
  Users,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { actionTypeLabels, entityTypeLabels, actionTypeColors } from '@/lib/audit';

interface AuditLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  timestamp: string;
  ip_address: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  entity_code: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  branch_id: string | null;
  branch_name: string | null;
  description: string | null;
  channel: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { isAdmin = false } = useModules();

  const { data: auditLogs = [], isLoading } = useQuery({
    queryKey: ['audit-logs', searchQuery, actionFilter, entityFilter, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      params.set('limit', '100');
      if (actionFilter !== 'all') params.set('actionType', actionFilter);
      if (entityFilter !== 'all') params.set('entityType', entityFilter);
      if (dateFrom) params.set('dateFrom', dateFrom.toISOString());
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        params.set('dateTo', endDate.toISOString());
      }
      const res = await fetch(`/api/audit-logs-search?${params}`, { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      return res.json() as Promise<AuditLog[]>;
    },
    enabled: isAdmin,
  });

  const actionTypes = ['Create', 'Update', 'Delete', 'Approve', 'Reject', 'Login', 'Logout', 'Import', 'Transfer', 'Post'];

  const entityTypes = [
    'Invoice', 'Item', 'JewelryItem', 'Stock', 'GoldPrice', 'JournalEntry',
    'User', 'Transfer', 'TransferRequest', 'InventoryCount', 'Sale', 'Return',
    'Payment', 'Customer', 'Supplier', 'Branch', 'PurchaseBatch', 'GoldScrap', 'Account', 'Role'
  ];

  const clearFilters = () => {
    setSearchQuery('');
    setActionFilter('all');
    setEntityFilter('all');
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const handleViewDetails = (log: AuditLog) => {
    setSelectedLog(log);
    setDetailsOpen(true);
  };

  const exportToExcel = () => {
    const data = auditLogs.map(log => ({
      'التاريخ والوقت': format(new Date(log.timestamp), 'yyyy/MM/dd HH:mm:ss'),
      'المستخدم': log.user_name || '-',
      'الدور': log.user_role || '-',
      'نوع العملية': actionTypeLabels[log.action_type] || log.action_type,
      'نوع الكيان': entityTypeLabels[log.entity_type] || log.entity_type,
      'رقم الكيان': log.entity_code || log.entity_id || '-',
      'الفرع': log.branch_name || '-',
      'الوصف': log.description || '-',
      'القناة': log.channel || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 15 },
      { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 40 }, { wch: 10 }
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سجل التدقيق');
    XLSX.writeFile(wb, `سجل_التدقيق_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('تم تصدير السجل بنجاح');
  };

  const todayLogs = auditLogs.filter(log => {
    const logDate = new Date(log.timestamp);
    const today = new Date();
    return logDate.toDateString() === today.toDateString();
  }).length;

  const criticalActions = auditLogs.filter(log => 
    ['Delete', 'Approve', 'Reject'].includes(log.action_type)
  ).length;

  const uniqueUsers = new Set(auditLogs.map(log => log.user_id)).size;

  if (!isAdmin) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Card className="w-96">
            <CardContent className="pt-6 text-center">
              <Shield className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">غير مصرح بالوصول</h2>
              <p className="text-muted-foreground">
                هذه الصفحة متاحة فقط للمدراء ومسؤولي النظام
              </p>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">سجل التدقيق</h1>
            <p className="text-muted-foreground">تتبع جميع العمليات الحساسة في النظام</p>
          </div>
          <Button onClick={exportToExcel} className="gap-2">
            <Download className="h-4 w-4" />
            تصدير Excel
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Activity className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي السجلات</p>
                  <p className="text-2xl font-bold">{auditLogs.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg">
                  <Clock className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">عمليات اليوم</p>
                  <p className="text-2xl font-bold">{todayLogs}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500/10 rounded-lg">
                  <Shield className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">عمليات حساسة</p>
                  <p className="text-2xl font-bold">{criticalActions}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Users className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">مستخدمين نشطين</p>
                  <p className="text-2xl font-bold">{uniqueUsers}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              {/* Search */}
              <div className="md:col-span-2">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث بالمستخدم، رقم الكيان، الوصف..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pr-10"
                  />
                </div>
              </div>

              {/* Action Filter */}
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="نوع العملية" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل العمليات</SelectItem>
                  {actionTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {actionTypeLabels[type] || type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Entity Filter */}
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="نوع الكيان" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الكيانات</SelectItem>
                  {entityTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {entityTypeLabels[type] || type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Date From */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("justify-start text-right", !dateFrom && "text-muted-foreground")}>
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, 'dd/MM/yyyy') : 'من تاريخ'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    locale={ar}
                  />
                </PopoverContent>
              </Popover>

              {/* Date To */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("justify-start text-right", !dateTo && "text-muted-foreground")}>
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {dateTo ? format(dateTo, 'dd/MM/yyyy') : 'إلى تاريخ'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    locale={ar}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {(searchQuery || actionFilter !== 'all' || entityFilter !== 'all' || dateFrom || dateTo) && (
              <div className="mt-4 flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                  <X className="h-4 w-4" />
                  مسح الفلاتر
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="h-[500px]">
            <div className="responsive-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ والوقت</TableHead>
                    <TableHead>المستخدم</TableHead>
                    <TableHead>الدور</TableHead>
                    <TableHead>العملية</TableHead>
                    <TableHead>الكيان</TableHead>
                    <TableHead>الرقم</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>الوصف</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8">
                        <span className="text-muted-foreground">جاري التحميل...</span>
                      </TableCell>
                    </TableRow>
                  ) : auditLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8">
                        <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                        <span className="text-muted-foreground">لا توجد سجلات</span>
                      </TableCell>
                    </TableRow>
                  ) : (
                    auditLogs.map((log) => (
                      <TableRow key={log.id} className="hover:bg-muted/50">
                        <TableCell className="font-mono text-sm">
                          {format(new Date(log.timestamp), 'yyyy/MM/dd HH:mm:ss')}
                        </TableCell>
                        <TableCell>{log.user_name || '-'}</TableCell>
                        <TableCell>
                          {log.user_role && (
                            <Badge variant="outline" className="text-xs">
                              {log.user_role}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={cn("text-xs", actionTypeColors[log.action_type])}
                          >
                            {actionTypeLabels[log.action_type] || log.action_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {entityTypeLabels[log.entity_type] || log.entity_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {log.entity_code || log.entity_id?.slice(0, 8) || '-'}
                        </TableCell>
                        <TableCell>{log.branch_name || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {log.description || '-'}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleViewDetails(log)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Details Dialog */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>تفاصيل السجل</DialogTitle>
            </DialogHeader>
            
            {selectedLog && (
              <div className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">التاريخ والوقت</CardTitle>
                    </CardHeader>
                    <CardContent className="font-mono text-sm">
                      {format(new Date(selectedLog.timestamp), 'yyyy/MM/dd HH:mm:ss')}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">المستخدم</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {selectedLog.user_name || '-'}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">الدور</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {selectedLog.user_role || '-'}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">الفرع</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {selectedLog.branch_name || '-'}
                    </CardContent>
                  </Card>
                </div>

                {/* Action Info */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">نوع العملية</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Badge 
                        variant="outline" 
                        className={actionTypeColors[selectedLog.action_type]}
                      >
                        {actionTypeLabels[selectedLog.action_type] || selectedLog.action_type}
                      </Badge>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">نوع الكيان</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Badge variant="secondary">
                        {entityTypeLabels[selectedLog.entity_type] || selectedLog.entity_type}
                      </Badge>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">رقم الكيان</CardTitle>
                    </CardHeader>
                    <CardContent className="font-mono">
                      {selectedLog.entity_code || selectedLog.entity_id || '-'}
                    </CardContent>
                  </Card>
                </div>

                {/* Description */}
                {selectedLog.description && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">الوصف</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {selectedLog.description}
                    </CardContent>
                  </Card>
                )}

                {/* Old Value */}
                {selectedLog.old_value && Object.keys(selectedLog.old_value).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">القيمة القديمة</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto" dir="ltr">
                        {JSON.stringify(selectedLog.old_value, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {/* New Value */}
                {selectedLog.new_value && Object.keys(selectedLog.new_value).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">القيمة الجديدة</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto" dir="ltr">
                        {JSON.stringify(selectedLog.new_value, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {/* Metadata */}
                {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">بيانات إضافية</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto" dir="ltr">
                        {JSON.stringify(selectedLog.metadata, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {/* Technical Info */}
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">IP Address</CardTitle>
                    </CardHeader>
                    <CardContent className="font-mono text-sm">
                      {selectedLog.ip_address || '-'}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">القناة</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {selectedLog.channel || '-'}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
