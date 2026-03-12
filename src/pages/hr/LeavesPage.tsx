import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { forbidDirectWrite } from "@/lib/atomicWriteGuard";
import MainLayout from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Check, X, Calendar } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { format, differenceInDays } from "date-fns";

interface Leave {
  id: string;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_count: number;
  status: string;
  reason: string | null;
  employees?: { full_name: string; employee_code: string };
}

export default function LeavesPage() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formData, setFormData] = useState({
    employee_id: "",
    leave_type: "annual",
    start_date: format(new Date(), "yyyy-MM-dd"),
    end_date: format(new Date(), "yyyy-MM-dd"),
    reason: "",
  });

  const { data: leaves, isLoading } = useQuery({
    queryKey: ["leaves", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set('status', statusFilter);
      const res = await fetch(`/api/employee-leaves-list?${params}`, { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      return res.json() as Promise<Leave[]>;
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["active-employees"],
    queryFn: async () => {
      const res = await fetch('/api/employees-list', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const daysCount = differenceInDays(new Date(data.end_date), new Date(data.start_date)) + 1;
      forbidDirectWrite('insert', 'LeavesPage.tsx:createMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      toast.success(language === "ar" ? "تم تقديم طلب الإجازة" : "Leave request submitted");
      setIsDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast.error(language === "ar" ? "حدث خطأ" : "An error occurred");
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      forbidDirectWrite('update', 'LeavesPage.tsx:updateStatusMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      toast.success(language === "ar" ? "تم تحديث الحالة" : "Status updated");
    },
  });

  const resetForm = () => {
    setFormData({
      employee_id: "",
      leave_type: "annual",
      start_date: format(new Date(), "yyyy-MM-dd"),
      end_date: format(new Date(), "yyyy-MM-dd"),
      reason: "",
    });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "outline",
      approved: "default",
      rejected: "destructive",
      cancelled: "secondary",
    };
    const labels: Record<string, string> = {
      pending: language === "ar" ? "قيد الانتظار" : "Pending",
      approved: language === "ar" ? "معتمد" : "Approved",
      rejected: language === "ar" ? "مرفوض" : "Rejected",
      cancelled: language === "ar" ? "ملغي" : "Cancelled",
    };
    return <Badge variant={variants[status] || "default"}>{labels[status] || status}</Badge>;
  };

  const getLeaveTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      annual: language === "ar" ? "سنوية" : "Annual",
      sick: language === "ar" ? "مرضية" : "Sick",
      unpaid: language === "ar" ? "بدون راتب" : "Unpaid",
      maternity: language === "ar" ? "أمومة" : "Maternity",
      paternity: language === "ar" ? "أبوة" : "Paternity",
      emergency: language === "ar" ? "طارئة" : "Emergency",
      other: language === "ar" ? "أخرى" : "Other",
    };
    return labels[type] || type;
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-3xl font-bold">{language === "ar" ? "إدارة الإجازات" : "Leave Management"}</h1>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {language === "ar" ? "طلب إجازة" : "Request Leave"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{language === "ar" ? "طلب إجازة جديد" : "New Leave Request"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>{language === "ar" ? "الموظف" : "Employee"}</Label>
                  <Select
                    value={formData.employee_id}
                    onValueChange={(v) => setFormData({ ...formData, employee_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={language === "ar" ? "اختر الموظف" : "Select employee"} />
                    </SelectTrigger>
                    <SelectContent>
                      {employees?.map((emp: any) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.full_name} ({emp.employee_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "نوع الإجازة" : "Leave Type"}</Label>
                  <Select
                    value={formData.leave_type}
                    onValueChange={(v) => setFormData({ ...formData, leave_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="annual">{language === "ar" ? "سنوية" : "Annual"}</SelectItem>
                      <SelectItem value="sick">{language === "ar" ? "مرضية" : "Sick"}</SelectItem>
                      <SelectItem value="unpaid">{language === "ar" ? "بدون راتب" : "Unpaid"}</SelectItem>
                      <SelectItem value="emergency">{language === "ar" ? "طارئة" : "Emergency"}</SelectItem>
                      <SelectItem value="other">{language === "ar" ? "أخرى" : "Other"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{language === "ar" ? "من تاريخ" : "From Date"}</Label>
                    <Input
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{language === "ar" ? "إلى تاريخ" : "To Date"}</Label>
                    <Input
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "السبب" : "Reason"}</Label>
                  <Textarea
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  {language === "ar" ? "إلغاء" : "Cancel"}
                </Button>
                <Button 
                  onClick={() => createMutation.mutate(formData)} 
                  disabled={!formData.employee_id || createMutation.isPending}
                >
                  {language === "ar" ? "تقديم" : "Submit"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-4">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === "ar" ? "جميع الحالات" : "All Statuses"}</SelectItem>
                  <SelectItem value="pending">{language === "ar" ? "قيد الانتظار" : "Pending"}</SelectItem>
                  <SelectItem value="approved">{language === "ar" ? "معتمد" : "Approved"}</SelectItem>
                  <SelectItem value="rejected">{language === "ar" ? "مرفوض" : "Rejected"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="responsive-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === "ar" ? "الموظف" : "Employee"}</TableHead>
                  <TableHead>{language === "ar" ? "نوع الإجازة" : "Leave Type"}</TableHead>
                  <TableHead>{language === "ar" ? "من" : "From"}</TableHead>
                  <TableHead>{language === "ar" ? "إلى" : "To"}</TableHead>
                  <TableHead>{language === "ar" ? "الأيام" : "Days"}</TableHead>
                  <TableHead>{language === "ar" ? "الحالة" : "Status"}</TableHead>
                  <TableHead>{language === "ar" ? "الإجراءات" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      {language === "ar" ? "جاري التحميل..." : "Loading..."}
                    </TableCell>
                  </TableRow>
                ) : leaves?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      {language === "ar" ? "لا توجد إجازات" : "No leaves found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  leaves?.map((leave) => (
                    <TableRow key={leave.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{leave.employees?.full_name}</div>
                          <div className="text-sm text-muted-foreground">{leave.employees?.employee_code}</div>
                        </div>
                      </TableCell>
                      <TableCell>{getLeaveTypeLabel(leave.leave_type)}</TableCell>
                      <TableCell>{format(new Date(leave.start_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{format(new Date(leave.end_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>{leave.days_count}</TableCell>
                      <TableCell>{getStatusBadge(leave.status)}</TableCell>
                      <TableCell>
                        {leave.status === "pending" && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateStatusMutation.mutate({ id: leave.id, status: "approved" })}
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateStatusMutation.mutate({ id: leave.id, status: "rejected" })}
                            >
                              <X className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
