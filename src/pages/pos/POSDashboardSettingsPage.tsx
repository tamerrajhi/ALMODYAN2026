import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import POSLayout from "@/components/pos/POSLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutDashboard, ArrowRight, Save, RotateCcw, Loader2,
  ShoppingCart, TrendingUp, Users, Building2, Package, Clock, AlertTriangle,
} from "lucide-react";
import { dashboardWidgets } from "@/config/posDashboard";

const WIDGET_ICONS: Record<string, any> = {
  today_kpis: ShoppingCart,
  profit_snapshot: TrendingUp,
  top_sellers: Users,
  top_branches: Building2,
  inventory_valuation: Package,
  inventory_aging: Clock,
  reconciliation: AlertTriangle,
};

const WIDGET_DESCRIPTIONS: Record<string, string> = {
  today_kpis: "عدد المبيعات، الإيرادات، الضريبة، الخصومات، المرتجعات",
  profit_snapshot: "الإيرادات، تكلفة البضاعة، صافي الربح، هامش الربح",
  top_sellers: "ترتيب البائعين حسب الإيرادات والأرباح",
  top_branches: "ترتيب الفروع حسب الإيرادات والأرباح",
  inventory_valuation: "قيمة المخزون حسب الفرع (تكلفة وسعر بيع)",
  inventory_aging: "عمر المخزون (0-30، 31-60، 61-90، +90 يوم)",
  reconciliation: "الفواتير التي لها فروقات في التسديد",
};

type WidgetConfig = Record<string, boolean>;

export default function POSDashboardSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [localWidgets, setLocalWidgets] = useState<WidgetConfig | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const { data, isLoading } = useQuery<{ widgets: WidgetConfig }>({
    queryKey: ["pos-dashboard-settings"],
    queryFn: async () => {
      const res = await fetch("/api/pos/admin/settings/dashboard", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message || "خطأ");
      return json.data;
    },
  });

  useEffect(() => {
    if (data?.widgets && !localWidgets) {
      setLocalWidgets({ ...data.widgets });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (widgets: WidgetConfig) => {
      const res = await fetch("/api/pos/admin/settings/dashboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ widgets }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message || "خطأ في الحفظ");
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos-dashboard-settings"] });
      queryClient.invalidateQueries({ queryKey: ["pos-dashboard-widget-config"] });
      setHasChanges(false);
      toast({ title: "تم الحفظ", description: "تم تحديث إعدادات لوحة التحكم بنجاح" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const toggleWidget = (key: string) => {
    if (!localWidgets) return;
    setLocalWidgets(prev => ({ ...prev!, [key]: !prev![key] }));
    setHasChanges(true);
  };

  const resetAll = () => {
    const allTrue: WidgetConfig = {};
    dashboardWidgets.forEach(w => { allTrue[w.key] = true; });
    setLocalWidgets(allTrue);
    setHasChanges(true);
  };

  if (isLoading || !localWidgets) {
    return (
      <POSLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout>
      <div className="rtl-mode content-full-width page-container space-y-6 p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/pos/settings")} data-testid="button-back-settings">
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2" data-testid="text-settings-title">
                <LayoutDashboard className="h-6 w-6 text-cyan-600" />
                إعدادات لوحة التحكم
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">تحكم في الأقسام الظاهرة في لوحة التحكم</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetAll} disabled={saveMutation.isPending} data-testid="button-reset-all">
              <RotateCcw className="h-4 w-4 ml-1" />
              إعادة تعيين الكل
            </Button>
            <Button size="sm" onClick={() => saveMutation.mutate(localWidgets)} disabled={!hasChanges || saveMutation.isPending} data-testid="button-save-settings">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
              حفظ
            </Button>
          </div>
        </div>

        <Card data-testid="card-widget-toggles">
          <CardHeader className="border-b py-3 px-4 bg-gray-50/50 dark:bg-gray-800/30">
            <CardTitle className="text-base font-semibold">أقسام لوحة التحكم</CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y">
            {dashboardWidgets.map(widget => {
              const Icon = WIDGET_ICONS[widget.key] || Package;
              const isEnabled = localWidgets[widget.key] ?? true;
              return (
                <div key={widget.key} className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors" data-testid={`toggle-row-${widget.key}`}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`p-2 rounded-lg ${isEnabled ? 'bg-cyan-50 dark:bg-cyan-900/20' : 'bg-gray-100 dark:bg-gray-800'}`}>
                      <Icon className={`h-5 w-5 ${isEnabled ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-400'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`font-medium ${isEnabled ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>{widget.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{WIDGET_DESCRIPTIONS[widget.key]}</p>
                    </div>
                  </div>
                  <Switch checked={isEnabled} onCheckedChange={() => toggleWidget(widget.key)} data-testid={`switch-${widget.key}`} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </POSLayout>
  );
}
