import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Building2, Download, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatNumber } from '@/lib/utils';

interface Props {
  onBack: () => void;
}

export default function BranchDailyPerformanceReport({ onBack }: Props) {
  const { isRTL } = useLanguage();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const { data: branchStats, isLoading, refetch } = useQuery({
    queryKey: ['branch-daily-performance', selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/reports/branch-daily-performance?date=${selectedDate}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch branch daily performance');
      const data = await res.json();
      return (data || []).map((b: any) => ({
        id: b.branch_id,
        branch_name: b.branch_name,
        branch_code: b.branch_code,
        branch_type: b.branch_type || 'gold',
        totalSales: b.sales_count || 0,
        salesAmount: Number(b.sales_total) || 0,
        inventoryCount: b.inventory_count || 0,
        inventoryValue: Number(b.inventory_cost) || 0,
        totalWeight: Number(b.inventory_weight) || 0,
      }));
    },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="w-6 h-6 text-blue-500" />
              {isRTL ? 'تقرير الأداء اليومي للفروع' : 'Branch Daily Performance Report'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isRTL ? 'ملخص أداء جميع الفروع لليوم المحدد' : 'Summary of all branch performance for selected date'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
          />
          <Button variant="outline" size="icon" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            {isRTL ? 'تصدير' : 'Export'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isRTL ? 'أداء الفروع' : 'Branch Performance'}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{isRTL ? 'الفرع' : 'Branch'}</th>
                    <th>{isRTL ? 'النوع' : 'Type'}</th>
                    <th>{isRTL ? 'عمليات البيع' : 'Sales Count'}</th>
                    <th>{isRTL ? 'قيمة المبيعات' : 'Sales Amount'}</th>
                    <th>{isRTL ? 'المخزون' : 'Inventory'}</th>
                    <th>{isRTL ? 'قيمة المخزون' : 'Inventory Value'}</th>
                    <th>{isRTL ? 'الوزن (جم)' : 'Weight (g)'}</th>
                  </tr>
                </thead>
                <tbody>
                  {branchStats?.map((branch: any) => (
                    <tr key={branch.id}>
                      <td className="font-medium">{branch.branch_name}</td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          branch.branch_type === 'gold' 
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' 
                            : 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300'
                        }`}>
                          {branch.branch_type === 'gold' ? (isRTL ? 'ذهب' : 'Gold') : (isRTL ? 'مجوهرات' : 'Jewelry')}
                        </span>
                      </td>
                      <td>{formatNumber(branch.totalSales)}</td>
                      <td>{formatCurrency(branch.salesAmount)}</td>
                      <td>{formatNumber(branch.inventoryCount)}</td>
                      <td>{formatCurrency(branch.inventoryValue)}</td>
                      <td>{branch.totalWeight.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
