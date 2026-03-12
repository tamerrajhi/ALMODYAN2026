import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as dataGateway from "@/lib/dataGateway";
import { forbidDirectWrite } from "@/lib/atomicWriteGuard";
import MainLayout from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Calendar, Clock, UserCheck, UserX } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { format } from "date-fns";

export default function AttendancePage() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedBranch, setSelectedBranch] = useState<string>("all");

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable("branches", {
        select: "*",
        filters: { is_active: true },
      });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["employees-for-attendance", selectedBranch],
    queryFn: async () => {
      const filters: Record<string, any> = { employment_status: "active" };
      if (selectedBranch !== "all") {
        filters.branch_id = selectedBranch;
      }
      const { data, error } = await dataGateway.queryTable("employees", {
        select: "*",
        filters,
      });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: attendance, isLoading } = useQuery({
    queryKey: ["attendance", selectedDate, selectedBranch],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable("employee_attendance", {
        select: "*, employees(full_name, employee_code, branch_id)",
        filters: { attendance_date: selectedDate },
      });
      if (error) throw error;
      const rows = (data as any[]) || [];
      if (selectedBranch !== "all") {
        return rows.filter((a: any) => a.employees?.branch_id === selectedBranch);
      }
      return rows;
    },
  });

  const recordAttendanceMutation = useMutation({
    mutationFn: async ({ employeeId, status, checkIn, checkOut }: { 
      employeeId: string; 
      status: string; 
      checkIn?: string; 
      checkOut?: string 
    }) => {
      forbidDirectWrite('upsert', 'AttendancePage.tsx:recordAttendanceMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success(language === "ar" ? "تم تسجيل الحضور" : "Attendance recorded");
    },
    onError: () => {
      toast.error(language === "ar" ? "حدث خطأ" : "An error occurred");
    },
  });

  const markAllPresentMutation = useMutation({
    mutationFn: async () => {
      if (!employees) return;
      forbidDirectWrite('upsert', 'AttendancePage.tsx:markAllPresentMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success(language === "ar" ? "تم تسجيل حضور الجميع" : "All marked present");
    },
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      present: "default",
      absent: "destructive",
      late: "secondary",
      half_day: "outline",
    };
    const labels: Record<string, string> = {
      present: language === "ar" ? "حاضر" : "Present",
      absent: language === "ar" ? "غائب" : "Absent",
      late: language === "ar" ? "متأخر" : "Late",
      half_day: language === "ar" ? "نصف يوم" : "Half Day",
    };
    return <Badge variant={variants[status] || "default"}>{labels[status] || status}</Badge>;
  };

  const getEmployeeAttendance = (employeeId: string) => {
    return attendance?.find((a: any) => a.employee_id === employeeId);
  };

  const presentCount = attendance?.filter((a: any) => a.status === "present").length || 0;
  const absentCount = employees?.length ? employees.length - presentCount : 0;

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-3xl font-bold">{language === "ar" ? "سجل الحضور" : "Attendance"}</h1>
          <Button onClick={() => markAllPresentMutation.mutate()} disabled={markAllPresentMutation.isPending}>
            <UserCheck className="h-4 w-4 mr-2" />
            {language === "ar" ? "تسجيل حضور الجميع" : "Mark All Present"}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <UserCheck className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{language === "ar" ? "الحاضرون" : "Present"}</p>
                  <p className="text-2xl font-bold">{presentCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-destructive/10 rounded-lg">
                  <UserX className="h-6 w-6 text-destructive" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{language === "ar" ? "الغائبون" : "Absent"}</p>
                  <p className="text-2xl font-bold">{absentCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-4">
              <div className="space-y-1">
                <Label>{language === "ar" ? "التاريخ" : "Date"}</Label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-48"
                />
              </div>
              <div className="space-y-1">
                <Label>{language === "ar" ? "الفرع" : "Branch"}</Label>
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === "ar" ? "جميع الفروع" : "All Branches"}</SelectItem>
                    {branches?.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="responsive-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === "ar" ? "الكود" : "Code"}</TableHead>
                  <TableHead>{language === "ar" ? "الموظف" : "Employee"}</TableHead>
                  <TableHead>{language === "ar" ? "الحالة" : "Status"}</TableHead>
                  <TableHead>{language === "ar" ? "وقت الحضور" : "Check In"}</TableHead>
                  <TableHead>{language === "ar" ? "وقت الانصراف" : "Check Out"}</TableHead>
                  <TableHead>{language === "ar" ? "الإجراءات" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      {language === "ar" ? "جاري التحميل..." : "Loading..."}
                    </TableCell>
                  </TableRow>
                ) : employees?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      {language === "ar" ? "لا يوجد موظفين" : "No employees"}
                    </TableCell>
                  </TableRow>
                ) : (
                  employees?.map((employee) => {
                    const att = getEmployeeAttendance(employee.id);
                    return (
                      <TableRow key={employee.id}>
                        <TableCell className="font-mono">{employee.employee_code}</TableCell>
                        <TableCell>{employee.full_name}</TableCell>
                        <TableCell>
                          {att ? getStatusBadge(att.status) : (
                            <Badge variant="outline">{language === "ar" ? "لم يسجل" : "Not Recorded"}</Badge>
                          )}
                        </TableCell>
                        <TableCell>{att?.check_in_time || "-"}</TableCell>
                        <TableCell>{att?.check_out_time || "-"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => recordAttendanceMutation.mutate({
                                employeeId: employee.id,
                                status: "present",
                                checkIn: format(new Date(), "HH:mm"),
                              })}
                            >
                              <UserCheck className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => recordAttendanceMutation.mutate({
                                employeeId: employee.id,
                                status: "absent",
                              })}
                            >
                              <UserX className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
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
