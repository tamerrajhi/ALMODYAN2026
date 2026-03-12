import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { forbidDirectWrite } from "@/lib/atomicWriteGuard";
import MainLayout from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Calculator, FileText, Check, DollarSign } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { format } from "date-fns";

interface PayrollPeriod {
  id: string;
  period_code: string;
  period_name: string;
  start_date: string;
  end_date: string;
  payment_date: string | null;
  status: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
}

interface PayrollRecord {
  id: string;
  payroll_period_id: string;
  employee_id: string;
  base_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  overtime_amount: number;
  bonus: number;
  gross_salary: number;
  gosi_deduction: number;
  absence_deduction: number;
  loan_deduction: number;
  other_deductions: number;
  total_deductions: number;
  net_salary: number;
  payment_status: string;
  employees?: { full_name: string; employee_code: string };
}

export default function PayrollPage() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    period_name: "",
    start_date: format(new Date(), "yyyy-MM-01"),
    end_date: format(new Date(), "yyyy-MM-dd"),
  });

  const { data: periods, isLoading } = useQuery({
    queryKey: ["payroll-periods"],
    queryFn: async () => {
      const res = await fetch('/api/payroll-periods', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json() as PayrollPeriod[];
    },
  });

  const { data: payrollRecords } = useQuery({
    queryKey: ["payroll-records", selectedPeriod],
    queryFn: async () => {
      if (!selectedPeriod) return [];
      const res = await fetch(`/api/payroll-records/${selectedPeriod}`, { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json() as PayrollRecord[];
    },
    enabled: !!selectedPeriod,
  });

  const { data: employees } = useQuery({
    queryKey: ["active-employees"],
    queryFn: async () => {
      const res = await fetch('/api/employees-list', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json();
    },
  });

  const createPeriodMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const period_code = `PP-${format(new Date(data.start_date), "yyyyMM")}`;
      forbidDirectWrite('insert', 'PayrollPage.tsx:createPeriodMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      toast.success(language === "ar" ? "تم إنشاء الفترة بنجاح" : "Period created successfully");
      setIsDialogOpen(false);
      setFormData({
        period_name: "",
        start_date: format(new Date(), "yyyy-MM-01"),
        end_date: format(new Date(), "yyyy-MM-dd"),
      });
    },
    onError: () => {
      toast.error(language === "ar" ? "حدث خطأ" : "An error occurred");
    },
  });

  const generatePayrollMutation = useMutation({
    mutationFn: async (periodId: string) => {
      if (!employees || employees.length === 0) {
        throw new Error("No active employees");
      }

      forbidDirectWrite('insert', 'PayrollPage.tsx:generatePayrollMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-records"] });
      toast.success(language === "ar" ? "تم إنشاء مسير الرواتب بنجاح" : "Payroll generated successfully");
    },
    onError: () => {
      toast.error(language === "ar" ? "حدث خطأ" : "An error occurred");
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (periodId: string) => {
      forbidDirectWrite('update', 'PayrollPage.tsx:approveMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      toast.success(language === "ar" ? "تم اعتماد المسير" : "Payroll approved");
    },
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      draft: "outline",
      processing: "secondary",
      approved: "default",
      paid: "default",
      cancelled: "destructive",
    };
    const labels: Record<string, string> = {
      draft: language === "ar" ? "مسودة" : "Draft",
      processing: language === "ar" ? "قيد المعالجة" : "Processing",
      approved: language === "ar" ? "معتمد" : "Approved",
      paid: language === "ar" ? "مدفوع" : "Paid",
      cancelled: language === "ar" ? "ملغي" : "Cancelled",
    };
    return <Badge variant={variants[status] || "default"}>{labels[status] || status}</Badge>;
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-3xl font-bold">{language === "ar" ? "إدارة الرواتب" : "Payroll Management"}</h1>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {language === "ar" ? "فترة جديدة" : "New Period"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{language === "ar" ? "إنشاء فترة رواتب جديدة" : "Create New Payroll Period"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>{language === "ar" ? "اسم الفترة" : "Period Name"}</Label>
                  <Input
                    value={formData.period_name}
                    onChange={(e) => setFormData({ ...formData, period_name: e.target.value })}
                    placeholder={language === "ar" ? "مثال: رواتب يناير 2025" : "e.g., January 2025 Payroll"}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{language === "ar" ? "تاريخ البداية" : "Start Date"}</Label>
                    <Input
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{language === "ar" ? "تاريخ النهاية" : "End Date"}</Label>
                    <Input
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  {language === "ar" ? "إلغاء" : "Cancel"}
                </Button>
                <Button onClick={() => createPeriodMutation.mutate(formData)} disabled={createPeriodMutation.isPending}>
                  {language === "ar" ? "إنشاء" : "Create"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="periods" className="space-y-4">
          <TabsList>
            <TabsTrigger value="periods">{language === "ar" ? "فترات الرواتب" : "Payroll Periods"}</TabsTrigger>
            <TabsTrigger value="details" disabled={!selectedPeriod}>
              {language === "ar" ? "تفاصيل المسير" : "Payroll Details"}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="periods">
            <Card>
              <CardContent className="pt-6">
                <div className="responsive-table-wrapper">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{language === "ar" ? "الكود" : "Code"}</TableHead>
                      <TableHead>{language === "ar" ? "الاسم" : "Name"}</TableHead>
                      <TableHead>{language === "ar" ? "الفترة" : "Period"}</TableHead>
                      <TableHead>{language === "ar" ? "إجمالي الرواتب" : "Gross Total"}</TableHead>
                      <TableHead>{language === "ar" ? "الاستقطاعات" : "Deductions"}</TableHead>
                      <TableHead>{language === "ar" ? "الصافي" : "Net Total"}</TableHead>
                      <TableHead>{language === "ar" ? "الحالة" : "Status"}</TableHead>
                      <TableHead>{language === "ar" ? "الإجراءات" : "Actions"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8">
                          {language === "ar" ? "جاري التحميل..." : "Loading..."}
                        </TableCell>
                      </TableRow>
                    ) : periods?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8">
                          {language === "ar" ? "لا توجد فترات رواتب" : "No payroll periods"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      periods?.map((period) => (
                        <TableRow key={period.id}>
                          <TableCell className="font-mono">{period.period_code}</TableCell>
                          <TableCell>{period.period_name}</TableCell>
                          <TableCell>
                            {format(new Date(period.start_date), "dd/MM")} - {format(new Date(period.end_date), "dd/MM/yyyy")}
                          </TableCell>
                          <TableCell>{period.total_gross.toLocaleString()} ر.س</TableCell>
                          <TableCell className="text-destructive">{period.total_deductions.toLocaleString()} ر.س</TableCell>
                          <TableCell className="font-bold">{period.total_net.toLocaleString()} ر.س</TableCell>
                          <TableCell>{getStatusBadge(period.status)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {period.status === "draft" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => generatePayrollMutation.mutate(period.id)}
                                  disabled={generatePayrollMutation.isPending}
                                >
                                  <Calculator className="h-4 w-4 mr-1" />
                                  {language === "ar" ? "إنشاء" : "Generate"}
                                </Button>
                              )}
                              {period.status === "processing" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => approveMutation.mutate(period.id)}
                                >
                                  <Check className="h-4 w-4 mr-1" />
                                  {language === "ar" ? "اعتماد" : "Approve"}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedPeriod(period.id)}
                              >
                                <FileText className="h-4 w-4 mr-1" />
                                {language === "ar" ? "تفاصيل" : "Details"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details">
            <Card>
              <CardHeader>
                <CardTitle>{language === "ar" ? "تفاصيل مسير الرواتب" : "Payroll Details"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="responsive-table-wrapper">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{language === "ar" ? "الموظف" : "Employee"}</TableHead>
                      <TableHead>{language === "ar" ? "الراتب الأساسي" : "Base Salary"}</TableHead>
                      <TableHead>{language === "ar" ? "البدلات" : "Allowances"}</TableHead>
                      <TableHead>{language === "ar" ? "الإجمالي" : "Gross"}</TableHead>
                      <TableHead>{language === "ar" ? "الاستقطاعات" : "Deductions"}</TableHead>
                      <TableHead>{language === "ar" ? "الصافي" : "Net"}</TableHead>
                      <TableHead>{language === "ar" ? "الحالة" : "Status"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollRecords?.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{record.employees?.full_name}</div>
                            <div className="text-sm text-muted-foreground">{record.employees?.employee_code}</div>
                          </div>
                        </TableCell>
                        <TableCell>{record.base_salary.toLocaleString()}</TableCell>
                        <TableCell>
                          {(record.housing_allowance + record.transport_allowance + record.other_allowances).toLocaleString()}
                        </TableCell>
                        <TableCell>{record.gross_salary.toLocaleString()}</TableCell>
                        <TableCell className="text-destructive">{record.total_deductions.toLocaleString()}</TableCell>
                        <TableCell className="font-bold">{record.net_salary.toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={record.payment_status === "paid" ? "default" : "outline"}>
                            {record.payment_status === "paid"
                              ? (language === "ar" ? "مدفوع" : "Paid")
                              : (language === "ar" ? "معلق" : "Pending")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
