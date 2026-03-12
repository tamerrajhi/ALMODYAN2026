import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Coins, Download, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';

interface Props {
  onBack: () => void;
}

export default function DailyGoldMovementReport({ onBack }: Props) {
  const { isRTL } = useLanguage();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const { data: movements, isLoading, refetch } = useQuery({
    queryKey: ['daily-gold-movement', selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/reports/daily-gold-movement?date=${selectedDate}`, { credentials: 'include' });
      if (res.status === 501) return [];
      return res.json();
    },
  });

  const totalIn = movements?.filter(m => m.transaction_type === 'deposit').reduce((sum, m) => sum + (m.weight_grams || 0), 0) || 0;
  const totalOut = movements?.filter(m => m.transaction_type === 'withdrawal').reduce((sum, m) => sum + (m.weight_grams || 0), 0) || 0;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Coins className="w-6 h-6 text-amber-500" />
              {isRTL ? 'تقرير حركة الذهب اليومية' : 'Daily Gold Movement Report'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isRTL ? 'حركة الذهب الداخل والخارج يومياً' : 'Daily gold inflow and outflow'}
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-green-50 dark:bg-green-950/30 border-green-200">
          <CardContent className="p-4 text-center">
            <TrendingUp className="w-8 h-8 mx-auto text-green-600 mb-2" />
            <p className="text-2xl font-bold text-green-700">{totalIn.toFixed(2)} g</p>
            <p className="text-sm text-green-600">{isRTL ? 'إجمالي الوارد' : 'Total In'}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50 dark:bg-red-950/30 border-red-200">
          <CardContent className="p-4 text-center">
            <TrendingDown className="w-8 h-8 mx-auto text-red-600 mb-2" />
            <p className="text-2xl font-bold text-red-700">{totalOut.toFixed(2)} g</p>
            <p className="text-sm text-red-600">{isRTL ? 'إجمالي الصادر' : 'Total Out'}</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200">
          <CardContent className="p-4 text-center">
            <Coins className="w-8 h-8 mx-auto text-blue-600 mb-2" />
            <p className="text-2xl font-bold text-blue-700">{(totalIn - totalOut).toFixed(2)} g</p>
            <p className="text-sm text-blue-600">{isRTL ? 'صافي الحركة' : 'Net Movement'}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isRTL ? 'تفاصيل الحركات' : 'Movement Details'}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : movements?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'لا توجد حركات في هذا اليوم' : 'No movements on this day'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{isRTL ? 'الخزينة' : 'Vault'}</th>
                    <th>{isRTL ? 'النوع' : 'Type'}</th>
                    <th>{isRTL ? 'العيار' : 'Karat'}</th>
                    <th>{isRTL ? 'الوزن (جم)' : 'Weight (g)'}</th>
                    <th>{isRTL ? 'ملاحظات' : 'Notes'}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements?.map((movement) => (
                    <tr key={movement.id}>
                      <td>{movement.vault_id || '-'}</td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          movement.transaction_type === 'deposit'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {movement.transaction_type === 'deposit' 
                            ? (isRTL ? 'إيداع' : 'Deposit') 
                            : (isRTL ? 'سحب' : 'Withdrawal')}
                        </span>
                      </td>
                      <td>{movement.gold_karats?.karat_name || '-'}</td>
                      <td>{movement.weight_grams?.toFixed(2)}</td>
                      <td className="max-w-xs truncate">{movement.notes || '-'}</td>
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
