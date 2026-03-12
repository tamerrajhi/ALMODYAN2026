import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Search, Package, Eye, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface ImportBatchesReportProps {
  onBack: () => void;
}

export default function ImportBatchesReport({ onBack }: ImportBatchesReportProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const { data: batches, isLoading } = useQuery({
    queryKey: ['import-batches-report'],
    queryFn: async () => {
      const res = await fetch('/api/reports/import-batches', { credentials: 'include' });
      if (res.status === 501) return [];
      const data = await res.json();
      return (data || []).map((item: any) => ({
        ...item,
        branches: { branch_name: item.branch_name },
      }));
    },
  });

  const filteredBatches = batches?.filter(batch => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      batch.batch_no?.toLowerCase().includes(query) ||
      batch.uploaded_file_name?.toLowerCase().includes(query) ||
      batch.uploaded_by?.toLowerCase().includes(query)
    );
  }) || [];

  const totalPages = Math.ceil(filteredBatches.length / pageSize);
  const paginatedBatches = filteredBatches.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'IMPORTED':
        return <Badge className="bg-green-500/10 text-green-600">مكتمل</Badge>;
      case 'DRAFT':
        return <Badge className="bg-yellow-500/10 text-yellow-600">مسودة</Badge>;
      case 'FAILED':
        return <Badge className="bg-red-500/10 text-red-600">فشل</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const totalImported = batches?.reduce((sum, b) => sum + (b.imported_rows || 0), 0) || 0;
  const totalFailed = batches?.reduce((sum, b) => sum + (b.failed_rows || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack} className="gap-2">
            <ArrowRight className="h-4 w-4" />
            رجوع
          </Button>
          <h2 className="text-2xl font-bold">دفعات الاستيراد</h2>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">إجمالي الدفعات</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{batches?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">القطع المستوردة</CardTitle>
            <Package className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalImported.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">القطع الفاشلة</CardTitle>
            <Package className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{totalFailed.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">نسبة النجاح</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalImported + totalFailed > 0
                ? ((totalImported / (totalImported + totalFailed)) * 100).toFixed(1)
                : 0}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="بحث برقم الدفعة أو اسم الملف..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="pr-10"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">رقم الدفعة</TableHead>
                <TableHead className="text-right">اسم الملف</TableHead>
                <TableHead className="text-right">الفرع</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">مستورد</TableHead>
                <TableHead className="text-right">فاشل</TableHead>
                <TableHead className="text-right">التاريخ</TableHead>
                <TableHead className="text-right">المستخدم</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    جاري التحميل...
                  </TableCell>
                </TableRow>
              ) : paginatedBatches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    لا توجد دفعات
                  </TableCell>
                </TableRow>
              ) : (
                paginatedBatches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-mono">{batch.batch_no}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{batch.uploaded_file_name}</TableCell>
                    <TableCell>{(batch.branches as any)?.branch_name || '-'}</TableCell>
                    <TableCell>{getStatusBadge(batch.status)}</TableCell>
                    <TableCell className="text-green-600">{batch.imported_rows || 0}</TableCell>
                    <TableCell className="text-red-600">{batch.failed_rows || 0}</TableCell>
                    <TableCell>
                      {batch.created_at
                        ? format(new Date(batch.created_at), 'dd MMM yyyy', { locale: ar })
                        : '-'}
                    </TableCell>
                    <TableCell>{batch.uploaded_by || '-'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/batches/${batch.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            صفحة {currentPage} من {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
