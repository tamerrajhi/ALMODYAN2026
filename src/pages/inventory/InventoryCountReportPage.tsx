import { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Printer, FileText, Download } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { useReactToPrint } from 'react-to-print';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

const statusLabels: Record<string, string> = {
  open: 'مفتوح',
  counting: 'قيد العد',
  reviewing: 'قيد المراجعة',
  approved: 'معتمد'
};

const resultTypeLabels: Record<string, string> = {
  matched: 'مطابق',
  shortage: 'عجز',
  overage: 'زيادة',
  weight_diff: 'اختلاف وزن'
};

export default function InventoryCountReportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);

  // Fetch count details
  const { data: count } = useQuery({
    queryKey: ['inventory-count', id],
    queryFn: async () => {
      const res = await fetch(`/api/inventory-count/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    }
  });

  // Fetch results
  const { data: results } = useQuery({
    queryKey: ['inventory-count-results', id],
    queryFn: async () => {
      const res = await fetch(`/api/inventory-count-results/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    }
  });

  // Fetch creator profile
  const { data: creator } = useQuery({
    queryKey: ['profile', count?.created_by],
    queryFn: async () => {
      if (!count?.created_by) return null;
      const res = await fetch(`/api/profile-by-user/${count.created_by}`, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    },
    enabled: !!count?.created_by
  });

  // Fetch approver profile
  const { data: approver } = useQuery({
    queryKey: ['profile', count?.approved_by],
    queryFn: async () => {
      if (!count?.approved_by) return null;
      const res = await fetch(`/api/profile-by-user/${count.approved_by}`, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    },
    enabled: !!count?.approved_by
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `محضر جرد ${count?.count_number || ''}`,
  });

  const handleExportExcel = () => {
    if (!count || !results) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }

    const workbook = XLSX.utils.book_new();

    // Summary Sheet
    const summaryData = [
      ['محضر جرد مخزون الذهب والمجوهرات'],
      [],
      ['رقم الجرد', count.count_number],
      ['الفرع', count.branch?.branch_name || '-'],
      ['نوع الجرد', count.count_type === 'full' ? 'جرد كامل' : count.count_type === 'partial' ? 'جرد جزئي' : 'أصناف محددة'],
      ['الحالة', statusLabels[count.status]],
      ['تاريخ البدء', new Date(count.start_date).toLocaleString('ar-EG')],
      ['تاريخ الانتهاء', count.end_date ? new Date(count.end_date).toLocaleString('ar-EG') : '-'],
      ['القائم بالجرد', creator?.full_name || '-'],
      ['المعتمد', approver?.full_name || '-'],
      [],
      ['ملخص الجرد'],
      ['قطع بالنظام', count.total_system_items],
      ['قطع معدودة', count.total_counted_items],
      ['مطابق', count.total_matched],
      ['عجز', count.total_shortage],
      ['زيادة', count.total_overage],
      ['اختلاف وزن', count.total_weight_diff],
      [],
      ['الملخص المالي'],
      ['قيمة العجز', count.shortage_value || 0],
      ['قيمة الزيادة', count.overage_value || 0],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'الملخص');

    // All Results Sheet
    const allResultsData: (string | number)[][] = [
      ['كود القطعة', 'نوع النتيجة', 'وزن النظام', 'الوزن الفعلي', 'فرق الوزن', 'العيار', 'التكلفة', 'القيمة المحسوبة', 'ملاحظات']
    ];
    results.forEach(r => {
      allResultsData.push([
        r.item_code,
        resultTypeLabels[r.result_type] || r.result_type,
        r.system_weight || '',
        r.actual_weight || '',
        r.weight_difference || '',
        r.karat || '',
        r.system_cost || '',
        r.calculated_value || '',
        r.notes || ''
      ]);
    });
    const allResultsSheet = XLSX.utils.aoa_to_sheet(allResultsData);
    XLSX.utils.book_append_sheet(workbook, allResultsSheet, 'جميع النتائج');

    // Shortage Sheet
    if (shortageResults.length > 0) {
      const shortageData: (string | number)[][] = [
        ['كود القطعة', 'الوزن', 'العيار', 'التكلفة', 'ملاحظات']
      ];
      shortageResults.forEach(r => {
        shortageData.push([
          r.item_code,
          r.system_weight || '',
          r.karat || '',
          r.system_cost || '',
          r.notes || ''
        ]);
      });
      const shortageSheet = XLSX.utils.aoa_to_sheet(shortageData);
      XLSX.utils.book_append_sheet(workbook, shortageSheet, 'العجز');
    }

    // Overage Sheet
    if (overageResults.length > 0) {
      const overageData: (string | number)[][] = [
        ['كود القطعة', 'الوزن الفعلي', 'ملاحظات']
      ];
      overageResults.forEach(r => {
        overageData.push([
          r.item_code,
          r.actual_weight || '',
          r.notes || ''
        ]);
      });
      const overageSheet = XLSX.utils.aoa_to_sheet(overageData);
      XLSX.utils.book_append_sheet(workbook, overageSheet, 'الزيادة');
    }

    // Weight Diff Sheet
    if (weightDiffResults.length > 0) {
      const weightDiffData: (string | number)[][] = [
        ['كود القطعة', 'وزن النظام', 'الوزن الفعلي', 'الفرق', 'التكلفة']
      ];
      weightDiffResults.forEach(r => {
        weightDiffData.push([
          r.item_code,
          r.system_weight || '',
          r.actual_weight || '',
          r.weight_difference || '',
          r.system_cost || ''
        ]);
      });
      const weightDiffSheet = XLSX.utils.aoa_to_sheet(weightDiffData);
      XLSX.utils.book_append_sheet(workbook, weightDiffSheet, 'اختلاف الوزن');
    }

    // Download
    XLSX.writeFile(workbook, `جرد_${count.count_number}.xlsx`);
    toast.success('تم تصدير التقرير بنجاح');
  };

  const shortageResults = results?.filter(r => r.result_type === 'shortage') || [];
  const overageResults = results?.filter(r => r.result_type === 'overage') || [];
  const weightDiffResults = results?.filter(r => r.result_type === 'weight_diff') || [];

  if (!count) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">جاري التحميل...</div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/inventory-counts/${id}`)}>
              <ArrowRight className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <FileText className="w-7 h-7 text-primary" />
                محضر جرد {count.count_number}
              </h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportExcel}>
              <Download className="w-4 h-4 ml-2" />
              تصدير Excel
            </Button>
            <Button variant="outline" onClick={() => handlePrint()}>
              <Printer className="w-4 h-4 ml-2" />
              طباعة
            </Button>
          </div>
        </div>

        {/* Printable Report */}
        <div ref={printRef} className="bg-background p-8 print:p-4">
          {/* Report Header */}
          <div className="text-center border-b pb-6 mb-6">
            <h1 className="text-3xl font-bold mb-2">محضر جرد مخزون الذهب والمجوهرات</h1>
            <p className="text-xl text-muted-foreground">{count.count_number}</p>
          </div>

          {/* Report Info */}
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div className="space-y-3">
              <div className="flex gap-2">
                <span className="font-semibold w-32">رقم الجرد:</span>
                <span>{count.count_number}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold w-32">الفرع:</span>
                <span>{count.branch?.branch_name}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold w-32">نوع الجرد:</span>
                <span>
                  {count.count_type === 'full' && 'جرد كامل'}
                  {count.count_type === 'partial' && 'جرد جزئي'}
                  {count.count_type === 'specific' && 'أصناف محددة'}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold w-32">الحالة:</span>
                <Badge>{statusLabels[count.status]}</Badge>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <span className="font-semibold w-32">تاريخ البدء:</span>
                <span>{new Date(count.start_date).toLocaleString('ar-EG')}</span>
              </div>
              {count.end_date && (
                <div className="flex gap-2">
                  <span className="font-semibold w-32">تاريخ الانتهاء:</span>
                  <span>{new Date(count.end_date).toLocaleString('ar-EG')}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="font-semibold w-32">القائم بالجرد:</span>
                <span>{creator?.full_name || '-'}</span>
              </div>
              {approver && (
                <div className="flex gap-2">
                  <span className="font-semibold w-32">المعتمد:</span>
                  <span>{approver.full_name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          <Card className="mb-8">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold mb-4">ملخص الجرد</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold">{count.total_system_items}</div>
                  <div className="text-sm text-muted-foreground">قطعة بالنظام</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold">{count.total_counted_items}</div>
                  <div className="text-sm text-muted-foreground">قطعة معدودة</div>
                </div>
                <div className="text-center p-4 bg-green-100 dark:bg-green-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-green-600">{count.total_matched}</div>
                  <div className="text-sm text-muted-foreground">مطابق</div>
                </div>
                <div className="text-center p-4 bg-red-100 dark:bg-red-900/20 rounded-lg">
                  <div className="text-3xl font-bold text-red-600">{count.total_shortage}</div>
                  <div className="text-sm text-muted-foreground">عجز</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Financial Summary */}
          <Card className="mb-8">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold mb-4">الملخص المالي للفروقات</h2>
              <div className="grid grid-cols-2 gap-6">
                <div className="p-4 border rounded-lg">
                  <div className="text-lg font-semibold text-red-600 mb-2">إجمالي العجز</div>
                  <div className="flex justify-between">
                    <span>عدد القطع:</span>
                    <span className="font-bold">{count.total_shortage}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>القيمة:</span>
                    <span className="font-bold text-red-600">{formatCurrency(count.shortage_value)}</span>
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <div className="text-lg font-semibold text-blue-600 mb-2">إجمالي الزيادة</div>
                  <div className="flex justify-between">
                    <span>عدد القطع:</span>
                    <span className="font-bold">{count.total_overage}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>القيمة:</span>
                    <span className="font-bold text-blue-600">{formatCurrency(count.overage_value)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Shortage Details */}
          {shortageResults.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-bold mb-4 text-red-600">تفاصيل العجز ({shortageResults.length} قطعة)</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>كود القطعة</TableHead>
                    <TableHead>فاتورة المورد</TableHead>
                    <TableHead>الوزن</TableHead>
                    <TableHead>العيار</TableHead>
                    <TableHead>التكلفة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shortageResults.map((result, index) => (
                    <TableRow key={result.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-mono">{result.item_code}</TableCell>
                      <TableCell className="text-sm">{result.supp_ref || '-'}</TableCell>
                      <TableCell>{result.system_weight ? `${result.system_weight} غ` : '-'}</TableCell>
                      <TableCell>{result.karat || '-'}</TableCell>
                      <TableCell>{result.system_cost ? formatCurrency(result.system_cost) : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Overage Details */}
          {overageResults.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-bold mb-4 text-blue-600">تفاصيل الزيادة ({overageResults.length} قطعة)</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>كود القطعة</TableHead>
                    <TableHead>فاتورة المورد</TableHead>
                    <TableHead>الوزن الفعلي</TableHead>
                    <TableHead>ملاحظات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overageResults.map((result, index) => (
                    <TableRow key={result.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-mono">{result.item_code}</TableCell>
                      <TableCell className="text-sm">{result.supp_ref || '-'}</TableCell>
                      <TableCell>{result.actual_weight ? `${result.actual_weight} غ` : '-'}</TableCell>
                      <TableCell>{result.notes || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Weight Difference Details */}
          {weightDiffResults.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-bold mb-4 text-yellow-600">اختلافات الوزن ({weightDiffResults.length} قطعة)</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>كود القطعة</TableHead>
                    <TableHead>فاتورة المورد</TableHead>
                    <TableHead>وزن النظام</TableHead>
                    <TableHead>الوزن الفعلي</TableHead>
                    <TableHead>الفرق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weightDiffResults.map((result, index) => (
                    <TableRow key={result.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-mono">{result.item_code}</TableCell>
                      <TableCell className="text-sm">{result.supp_ref || '-'}</TableCell>
                      <TableCell>{result.system_weight ? `${result.system_weight} غ` : '-'}</TableCell>
                      <TableCell>{result.actual_weight ? `${result.actual_weight} غ` : '-'}</TableCell>
                      <TableCell className={result.weight_difference && result.weight_difference > 0 ? 'text-green-600' : 'text-red-600'}>
                        {result.weight_difference ? `${result.weight_difference > 0 ? '+' : ''}${result.weight_difference} غ` : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Signatures */}
          <div className="grid grid-cols-3 gap-8 mt-12 pt-8 border-t">
            <div className="text-center">
              <div className="border-b border-dashed mb-2 pb-8"></div>
              <div className="font-semibold">القائم بالجرد</div>
              <div className="text-sm text-muted-foreground">{creator?.full_name || '-'}</div>
            </div>
            <div className="text-center">
              <div className="border-b border-dashed mb-2 pb-8"></div>
              <div className="font-semibold">المراجع</div>
              <div className="text-sm text-muted-foreground">-</div>
            </div>
            <div className="text-center">
              <div className="border-b border-dashed mb-2 pb-8"></div>
              <div className="font-semibold">المعتمد</div>
              <div className="text-sm text-muted-foreground">{approver?.full_name || '-'}</div>
            </div>
          </div>

          {/* Notes */}
          {count.notes && (
            <div className="mt-8 p-4 bg-muted rounded-lg">
              <h3 className="font-semibold mb-2">ملاحظات:</h3>
              <p>{count.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 pt-4 border-t text-center text-sm text-muted-foreground">
            <p>تم إنشاء هذا المحضر بواسطة نظام إدارة الذهب والمجوهرات</p>
            <p>تاريخ الطباعة: {new Date().toLocaleString('ar-EG')}</p>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
