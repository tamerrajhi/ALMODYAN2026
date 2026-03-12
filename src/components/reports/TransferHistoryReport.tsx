import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowRightLeft, Calendar, Package, Building2, FileSpreadsheet, Eye, TrendingUp, TrendingDown, Loader2, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { useBranches } from '@/hooks/useBranches';
import { useTransferHistoryReport } from '@/hooks/useTransfersV2ReadModel';
import { TransferFiltersDTO } from '@/types/transfers.v2.dto';
import { TransferDetailsDialog } from '@/components/transfers/TransferDetailsDialog';
import { getTransferStatusDisplay } from '@/lib/transfer-accounting';

export default function TransferHistoryReport() {
  const navigate = useNavigate();
  const { data: branches } = useBranches(true);
  const [filters, setFilters] = useState<TransferFiltersDTO>({});
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  // Use unified read hook - NO N+1 queries
  const { data: transfers = [], isLoading } = useTransferHistoryReport(filters);

  // Calculate statistics using total_items from DTO (not N+1)
  const stats = {
    totalTransfers: transfers.length,
    totalItems: transfers.reduce((sum, t) => sum + t.total_items, 0),
    incomingToSelected: filters.branch_id 
      ? transfers.filter(t => t.to_branch?.id === filters.branch_id).reduce((sum, t) => sum + t.total_items, 0)
      : 0,
    outgoingFromSelected: filters.branch_id
      ? transfers.filter(t => t.from_branch?.id === filters.branch_id).reduce((sum, t) => sum + t.total_items, 0)
      : 0,
  };

  const handleExport = () => {
    const exportData = transfers.map(transfer => {
      const statusDisplay = getTransferStatusDisplay(transfer.status as any);
      return {
        'رقم العملية': transfer.transfer_code || transfer.id.slice(0, 8),
        'التاريخ': format(new Date(transfer.transfer_date), 'yyyy-MM-dd HH:mm', { locale: ar }),
        'الحالة': statusDisplay.label,
        'من فرع': transfer.from_branch?.branch_name || 'المستودع',
        'إلى فرع': transfer.to_branch?.branch_name || '-',
        'عدد القطع': transfer.total_items,
        'التكلفة': transfer.total_cost || 0,
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'حركة المخزون');
    XLSX.writeFile(wb, `تقرير_حركة_المخزون_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const handleViewDetails = (transferId: string) => {
    setSelectedTransferId(transferId);
    setShowDetailsDialog(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-gold" />
            تقرير حركة المخزون بين الفروع
          </h2>
          <p className="text-muted-foreground text-sm">عرض جميع عمليات النقل مع التفاصيل</p>
        </div>
        <Button onClick={handleExport} disabled={transfers.length === 0}>
          <FileSpreadsheet className="w-4 h-4 ml-2" />
          تصدير Excel
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">الفرع</label>
              <Select 
                value={filters.branch_id || 'all'} 
                onValueChange={(v) => setFilters({...filters, branch_id: v === 'all' ? undefined : v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="جميع الفروع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الفروع</SelectItem>
                  {branches?.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">من تاريخ</label>
              <Input
                type="date"
                value={filters.date_from || ''}
                onChange={(e) => setFilters({...filters, date_from: e.target.value || undefined})}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">إلى تاريخ</label>
              <Input
                type="date"
                value={filters.date_to || ''}
                onChange={(e) => setFilters({...filters, date_to: e.target.value || undefined})}
              />
            </div>
            <div className="flex items-end">
              <Button 
                variant="outline" 
                onClick={() => setFilters({})}
              >
                إعادة تعيين
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalTransfers}</p>
              <p className="text-xs text-muted-foreground">عملية نقل</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-gold" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalItems}</p>
              <p className="text-xs text-muted-foreground">إجمالي القطع المنقولة</p>
            </div>
          </CardContent>
        </Card>
        {filters.branch_id && (
          <>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.incomingToSelected}</p>
                  <p className="text-xs text-muted-foreground">وارد للفرع</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.outgoingFromSelected}</p>
                  <p className="text-xs text-muted-foreground">صادر من الفرع</p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Transfers Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">سجل عمليات النقل</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : transfers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ArrowRightLeft className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>لا توجد عمليات نقل</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">من</TableHead>
                  <TableHead className="text-right">إلى</TableHead>
                  <TableHead className="text-right">عدد القطع</TableHead>
                  <TableHead className="text-right">التكلفة</TableHead>
                  <TableHead className="text-right">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((transfer) => {
                  const statusDisplay = getTransferStatusDisplay(transfer.status as any);
                  return (
                    <TableRow key={transfer.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-muted-foreground" />
                          {format(new Date(transfer.transfer_date), 'yyyy/MM/dd HH:mm', { locale: ar })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${statusDisplay.bgColor} ${statusDisplay.color} border-0`}>
                          {statusDisplay.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          {transfer.from_branch?.branch_name || (
                            <Badge variant="outline">المستودع</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          {transfer.to_branch?.branch_name || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono">
                          {transfer.total_items} قطعة
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        {transfer.total_cost?.toLocaleString() || '-'} ر.س
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewDetails(transfer.id)}
                          >
                            <Eye className="w-4 h-4 ml-1" />
                            التفاصيل
                          </Button>
                          {transfer.journal_entry_id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => navigate(`/accounting/journal-entries?entry=${transfer.journal_entry_id}`)}
                            >
                              <BookOpen className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog - Now accepts transferId */}
      <TransferDetailsDialog
        transferId={selectedTransferId}
        open={showDetailsDialog}
        onOpenChange={setShowDetailsDialog}
      />
    </div>
  );
}