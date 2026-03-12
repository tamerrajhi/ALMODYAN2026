import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Search,
  FileSpreadsheet,
  FileText,
  Calendar,
  ArrowUpDown,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HealthCheckIssue, HealthCheckSeverity } from '@/lib/accounting-health-checks';
import {
  fetchAffectedRecords,
  exportToExcel,
  exportToPDF,
  type AffectedRecord,
  type RecordFilters,
  type FetchResult,
} from '@/lib/accounting-health-records';
import { IssueRecordsTable } from './IssueRecordsTable';

interface IssueDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: HealthCheckIssue;
}

const severityConfig: Record<HealthCheckSeverity, { icon: typeof XCircle; color: string; bg: string }> = {
  critical: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
  warning: { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  info: { icon: Info, color: 'text-blue-500', bg: 'bg-blue-500/10' },
};

export function IssueDetailsDialog({ open, onOpenChange, issue }: IssueDetailsDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [filters, setFilters] = useState<RecordFilters>({
    page: 1,
    pageSize: 10,
    sortBy: 'date',
    sortOrder: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');

  const config = severityConfig[issue.severity];
  const Icon = config.icon;

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchAffectedRecords(issue, filters);
      setResult(data);
    } catch (error) {
      console.error('Error loading records:', error);
    } finally {
      setIsLoading(false);
    }
  }, [issue, filters]);

  useEffect(() => {
    if (open) {
      loadRecords();
    }
  }, [open, loadRecords]);

  const handleSearch = () => {
    setFilters(prev => ({ ...prev, search: searchInput, page: 1 }));
  };

  const handleClearFilters = () => {
    setSearchInput('');
    setFilters({
      page: 1,
      pageSize: 10,
      sortBy: 'date',
      sortOrder: 'desc',
    });
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const handleExportExcel = async () => {
    if (!result) return;
    // Fetch all records for export
    const allData = await fetchAffectedRecords(issue, { ...filters, page: 1, pageSize: 1000 });
    exportToExcel(allData.records, issue.title);
  };

  const handleExportPDF = async () => {
    if (!result) return;
    // Fetch all records for export
    const allData = await fetchAffectedRecords(issue, { ...filters, page: 1, pageSize: 1000 });
    exportToPDF(allData.records, issue.title, {
      totalRecords: allData.totalCount,
      totalAmount: allData.totalAmount,
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
    }).format(amount);
  };

  const showExtraColumns = ['JE001', 'BL001', 'BL002', 'PY002'].includes(issue.issueCode);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="shrink-0">
          <div className="flex items-start gap-3">
            <div className={cn('p-2 rounded-lg', config.bg)}>
              <Icon className={cn('w-5 h-5', config.color)} />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg">{issue.title}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">{issue.description}</p>
            </div>
          </div>
          
          {/* Summary Badges */}
          <div className="flex items-center gap-3 mt-4">
            <Badge variant="secondary" className="text-sm">
              <FileText className="w-4 h-4 ml-1" />
              {result?.totalCount || issue.affectedRecords} سجل
            </Badge>
            {(result?.totalAmount || issue.affectedAmount) && (
              <Badge variant="outline" className="text-sm">
                {formatCurrency(result?.totalAmount || issue.affectedAmount || 0)}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {issue.issueCode}
            </Badge>
          </div>
        </DialogHeader>

        {/* Filters */}
        <div className="shrink-0 flex flex-wrap items-center gap-3 py-4 border-b">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم المستند..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="pr-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleSearch}>
              بحث
            </Button>
          </div>
          
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <Input
              type="date"
              placeholder="من تاريخ"
              className="w-36"
              onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value, page: 1 }))}
            />
            <span className="text-muted-foreground">-</span>
            <Input
              type="date"
              placeholder="إلى تاريخ"
              className="w-36"
              onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value, page: 1 }))}
            />
          </div>

          <Select
            value={filters.sortBy}
            onValueChange={(value) => setFilters(prev => ({ 
              ...prev, 
              sortBy: value as 'date' | 'amount' | 'number',
              page: 1,
            }))}
          >
            <SelectTrigger className="w-32">
              <ArrowUpDown className="w-4 h-4 ml-2" />
              <SelectValue placeholder="ترتيب حسب" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">التاريخ</SelectItem>
              <SelectItem value="amount">المبلغ</SelectItem>
              <SelectItem value="number">الرقم</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.sortOrder}
            onValueChange={(value) => setFilters(prev => ({ 
              ...prev, 
              sortOrder: value as 'asc' | 'desc',
              page: 1,
            }))}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">تنازلي</SelectItem>
              <SelectItem value="asc">تصاعدي</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="ghost" size="sm" onClick={handleClearFilters}>
            مسح الفلاتر
          </Button>
        </div>

        {/* Records Table */}
        <div className="flex-1 overflow-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <IssueRecordsTable 
              records={result?.records || []} 
              showExtraColumns={showExtraColumns}
            />
          )}
        </div>

        {/* Footer with Pagination and Export */}
        <div className="shrink-0 flex items-center justify-between pt-4 border-t">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-2">
              <FileText className="w-4 h-4" />
              تصدير PDF
            </Button>
          </div>

          {result && result.totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious 
                    onClick={() => handlePageChange(Math.max(1, (filters.page || 1) - 1))}
                    className={cn((filters.page || 1) <= 1 && 'pointer-events-none opacity-50')}
                  />
                </PaginationItem>
                
                {Array.from({ length: Math.min(5, result.totalPages) }, (_, i) => {
                  const page = i + 1;
                  return (
                    <PaginationItem key={page}>
                      <PaginationLink
                        onClick={() => handlePageChange(page)}
                        isActive={page === (filters.page || 1)}
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}
                
                {result.totalPages > 5 && (
                  <PaginationItem>
                    <span className="px-2">...</span>
                  </PaginationItem>
                )}
                
                <PaginationItem>
                  <PaginationNext 
                    onClick={() => handlePageChange(Math.min(result.totalPages, (filters.page || 1) + 1))}
                    className={cn((filters.page || 1) >= result.totalPages && 'pointer-events-none opacity-50')}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}

          <div className="text-sm text-muted-foreground">
            صفحة {filters.page || 1} من {result?.totalPages || 1}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
