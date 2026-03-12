import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { TrendingUp, Calendar, Save } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';

interface GoldKarat {
  id: string;
  karat_value: number;
  karat_name: string;
  purity_percentage: number;
  is_active: boolean;
}

interface GoldPrice {
  id: string;
  karat_id: string;
  price_date: string;
  buy_price_per_gram: number;
  sell_price_per_gram: number;
  created_by: string | null;
  gold_karats?: GoldKarat;
}

export default function GoldPricesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});

  const { data: karats = [] } = useQuery({
    queryKey: ['gold-karats-active'],
    queryFn: async () => {
      const res = await fetch('/api/gold-karats-active', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch gold karats');
      return await res.json();
    },
  });

  const { data: todayPrices = [], isLoading } = useQuery({
    queryKey: ['gold-prices', selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/gold-prices-by-date?date=${selectedDate}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch gold prices');
      return await res.json();
    },
  });

  const { data: priceHistory = [] } = useQuery({
    queryKey: ['gold-prices-history'],
    queryFn: async () => {
      const res = await fetch('/api/gold-prices-history', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch price history');
      return await res.json();
    },
  });

  // Fetch the latest price for each karat (regardless of date)
  const { data: latestPricesMap = new Map<string, number>() } = useQuery({
    queryKey: ['latest-gold-prices-per-karat'],
    queryFn: async () => {
      const res = await fetch('/api/gold-prices-latest-per-karat', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch latest prices');
      const data = await res.json();

      // Extract the latest price for each karat
      const priceMap = new Map<string, number>();
      data?.forEach((price: any) => {
        if (!priceMap.has(price.karat_id)) {
          priceMap.set(price.karat_id, price.sell_price_per_gram);
        }
      });

      return priceMap;
    },
  });

  const savePricesMutation = useMutation({
    mutationFn: async () => {
      const pricesToSave = Object.entries(priceInputs)
        .filter(([_, price]) => price)
        .map(([karatId, price]) => ({
          karat_id: karatId,
          price_date: selectedDate,
          buy_price_per_gram: parseFloat(price),
          sell_price_per_gram: parseFloat(price),
          created_by: user?.user_metadata?.full_name || 'Unknown',
        }));

      if (pricesToSave.length === 0) {
        throw new Error('يرجى إدخال أسعار على الأقل لعيار واحد');
      }

      forbidDirectWrite('upsert', 'GoldPricesPage.tsx:savePricesMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gold-prices'] });
      queryClient.invalidateQueries({ queryKey: ['gold-prices-history'] });
      toast.success('تم حفظ الأسعار بنجاح');
      setIsDialogOpen(false);
      setPriceInputs({});
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء حفظ الأسعار');
    },
  });

  const openPriceDialog = () => {
    const inputs: Record<string, string> = {};
    karats.forEach((karat) => {
      // First: check for today's price
      const todayPrice = todayPrices.find((p) => p.karat_id === karat.id);
      if (todayPrice?.sell_price_per_gram) {
        inputs[karat.id] = todayPrice.sell_price_per_gram.toString();
      } else {
        // Second: use the latest available price
        const lastPrice = latestPricesMap.get(karat.id);
        inputs[karat.id] = lastPrice?.toString() || '';
      }
    });
    setPriceInputs(inputs);
    setIsDialogOpen(true);
  };

  // Group history by date
  const groupedHistory = priceHistory.reduce((acc, price) => {
    const date = price.price_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(price);
    return acc;
  }, {} as Record<string, GoldPrice[]>);

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-amber-500" />
            <div>
              <h1 className="text-3xl font-bold">أسعار الذهب اليومية</h1>
              <p className="text-muted-foreground">تحديث سعر الجرام لكل عيار</p>
            </div>
          </div>
          <Button onClick={openPriceDialog}>
            <Save className="ml-2 h-4 w-4" />
            تحديث الأسعار
          </Button>
        </div>

        {/* Today's Prices Card */}
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/20 dark:to-yellow-950/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                أسعار اليوم - {format(new Date(selectedDate), 'dd MMMM yyyy', { locale: ar })}
              </CardTitle>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-auto"
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">جاري التحميل...</div>
            ) : todayPrices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                لم يتم تسجيل أسعار لهذا اليوم بعد
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {todayPrices.map((price) => (
                  <Card key={price.id} className="bg-white dark:bg-background">
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-amber-600">
                        {price.gold_karats?.karat_value}K
                      </div>
                      <div className="text-sm text-muted-foreground mb-2">
                        {price.gold_karats?.karat_name}
                      </div>
                      <div className="text-lg font-semibold text-primary">
                        {formatCurrency(price.sell_price_per_gram)} / جرام
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Price History */}
        <Card>
          <CardHeader>
            <CardTitle>سجل الأسعار</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="responsive-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>العيار</TableHead>
                    <TableHead>سعر الجرام</TableHead>
                    <TableHead>بواسطة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {priceHistory.slice(0, 20).map((price) => (
                    <TableRow key={price.id}>
                      <TableCell>
                        {format(new Date(price.price_date), 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell className="font-bold text-amber-600">
                        {price.gold_karats?.karat_value}K
                      </TableCell>
                      <TableCell className="text-primary font-semibold">
                        {formatCurrency(price.sell_price_per_gram)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {price.created_by || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Price Update Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>تحديث أسعار الذهب</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <Label className="whitespace-nowrap">التاريخ:</Label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="flex-1"
                />
              </div>
              <ScrollArea className="max-h-[50vh] pr-3">
                <div className="space-y-2">
                  {karats.map((karat) => (
                    <div key={karat.id} className="flex items-center gap-3 py-2 border-b border-border last:border-b-0">
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-amber-600">{karat.karat_value}K</span>
                        <span className="text-sm text-muted-foreground mr-2">{karat.karat_name}</span>
                      </div>
                      <div className="w-28">
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          className="text-left h-9"
                          value={priceInputs[karat.id] || ''}
                          onChange={(e) =>
                            setPriceInputs({
                              ...priceInputs,
                              [karat.id]: e.target.value,
                            })
                          }
                        />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">ر.س</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <DialogFooter className="pt-4 border-t">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={() => savePricesMutation.mutate()}>
                حفظ الأسعار
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
