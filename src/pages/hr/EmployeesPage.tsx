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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, User, Phone, Mail, Building } from "lucide-react";
import { RowActionsMenu } from "@/components/ui/RowActionsMenu";
import { useLanguage } from "@/contexts/LanguageContext";
import { format } from "date-fns";

interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  full_name_en: string | null;
  national_id: string | null;
  phone: string | null;
  email: string | null;
  hire_date: string;
  department_id: string | null;
  position_id: string | null;
  branch_id: string | null;
  base_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  employment_status: string;
  contract_type: string;
  departments?: { department_name: string } | null;
  positions?: { position_name: string } | null;
  branches?: { branch_name: string } | null;
}

export default function EmployeesPage() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    full_name: "",
    full_name_en: "",
    national_id: "",
    phone: "",
    email: "",
    hire_date: format(new Date(), "yyyy-MM-dd"),
    department_id: "",
    position_id: "",
    branch_id: "",
    base_salary: 0,
    housing_allowance: 0,
    transport_allowance: 0,
    other_allowances: 0,
    employment_status: "active",
    contract_type: "full_time",
  });

  const { data: employees, isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const res = await fetch('/api/employees-list', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json() as Employee[];
    },
  });

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const res = await fetch('/api/departments-active', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  const { data: positions } = useQuery({
    queryKey: ["positions"],
    queryFn: async () => {
      const res = await fetch('/api/positions-active', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  const generateEmployeeCode = async () => {
    const { data, error } = await dataGateway.rpc("generate_employee_code", {});
    if (error) throw error;
    return data;
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      forbidDirectWrite('insert', 'EmployeesPage.tsx:createMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(language === "ar" ? "تم إضافة الموظف بنجاح" : "Employee added successfully");
      resetForm();
      setIsDialogOpen(false);
    },
    onError: () => {
      toast.error(language === "ar" ? "حدث خطأ" : "An error occurred");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      forbidDirectWrite('update', 'EmployeesPage.tsx:updateMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(language === "ar" ? "تم تحديث الموظف بنجاح" : "Employee updated successfully");
      resetForm();
      setIsDialogOpen(false);
      setEditingEmployee(null);
    },
    onError: () => {
      toast.error(language === "ar" ? "حدث خطأ" : "An error occurred");
    },
  });

  const resetForm = () => {
    setFormData({
      full_name: "",
      full_name_en: "",
      national_id: "",
      phone: "",
      email: "",
      hire_date: format(new Date(), "yyyy-MM-dd"),
      department_id: "",
      position_id: "",
      branch_id: "",
      base_salary: 0,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
      employment_status: "active",
      contract_type: "full_time",
    });
  };

  const handleEdit = (employee: Employee) => {
    setEditingEmployee(employee);
    setFormData({
      full_name: employee.full_name,
      full_name_en: employee.full_name_en || "",
      national_id: employee.national_id || "",
      phone: employee.phone || "",
      email: employee.email || "",
      hire_date: employee.hire_date,
      department_id: employee.department_id || "",
      position_id: employee.position_id || "",
      branch_id: employee.branch_id || "",
      base_salary: employee.base_salary,
      housing_allowance: employee.housing_allowance,
      transport_allowance: employee.transport_allowance,
      other_allowances: employee.other_allowances,
      employment_status: employee.employment_status,
      contract_type: employee.contract_type,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.full_name) {
      toast.error(language === "ar" ? "الرجاء إدخال اسم الموظف" : "Please enter employee name");
      return;
    }
    if (editingEmployee) {
      updateMutation.mutate({ ...formData, id: editingEmployee.id });
    } else {
      createMutation.mutate(formData);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      on_leave: "secondary",
      terminated: "destructive",
      suspended: "outline",
    };
    const labels: Record<string, string> = {
      active: language === "ar" ? "نشط" : "Active",
      on_leave: language === "ar" ? "إجازة" : "On Leave",
      terminated: language === "ar" ? "منتهي" : "Terminated",
      suspended: language === "ar" ? "موقوف" : "Suspended",
    };
    return <Badge variant={variants[status] || "default"}>{labels[status] || status}</Badge>;
  };

  const filteredEmployees = employees?.filter(
    (emp) =>
      emp.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employee_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-3xl font-bold">{language === "ar" ? "إدارة الموظفين" : "Employee Management"}</h1>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
              setEditingEmployee(null);
              resetForm();
            }
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {language === "ar" ? "إضافة موظف" : "Add Employee"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingEmployee
                    ? (language === "ar" ? "تعديل موظف" : "Edit Employee")
                    : (language === "ar" ? "إضافة موظف جديد" : "Add New Employee")}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="space-y-2">
                  <Label>{language === "ar" ? "الاسم بالعربي" : "Name (Arabic)"}</Label>
                  <Input
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "الاسم بالإنجليزي" : "Name (English)"}</Label>
                  <Input
                    value={formData.full_name_en}
                    onChange={(e) => setFormData({ ...formData, full_name_en: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "رقم الهوية" : "National ID"}</Label>
                  <Input
                    value={formData.national_id}
                    onChange={(e) => setFormData({ ...formData, national_id: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "الجوال" : "Phone"}</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "البريد الإلكتروني" : "Email"}</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "تاريخ التعيين" : "Hire Date"}</Label>
                  <Input
                    type="date"
                    value={formData.hire_date}
                    onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "القسم" : "Department"}</Label>
                  <Select
                    value={formData.department_id}
                    onValueChange={(v) => setFormData({ ...formData, department_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={language === "ar" ? "اختر القسم" : "Select department"} />
                    </SelectTrigger>
                    <SelectContent>
                      {departments?.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.department_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "المسمى الوظيفي" : "Position"}</Label>
                  <Select
                    value={formData.position_id}
                    onValueChange={(v) => setFormData({ ...formData, position_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={language === "ar" ? "اختر المسمى" : "Select position"} />
                    </SelectTrigger>
                    <SelectContent>
                      {positions?.map((pos) => (
                        <SelectItem key={pos.id} value={pos.id}>
                          {pos.position_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "الفرع" : "Branch"}</Label>
                  <Select
                    value={formData.branch_id}
                    onValueChange={(v) => setFormData({ ...formData, branch_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={language === "ar" ? "اختر الفرع" : "Select branch"} />
                    </SelectTrigger>
                    <SelectContent>
                      {branches?.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "نوع العقد" : "Contract Type"}</Label>
                  <Select
                    value={formData.contract_type}
                    onValueChange={(v) => setFormData({ ...formData, contract_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_time">{language === "ar" ? "دوام كامل" : "Full Time"}</SelectItem>
                      <SelectItem value="part_time">{language === "ar" ? "دوام جزئي" : "Part Time"}</SelectItem>
                      <SelectItem value="contract">{language === "ar" ? "عقد" : "Contract"}</SelectItem>
                      <SelectItem value="temporary">{language === "ar" ? "مؤقت" : "Temporary"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "الراتب الأساسي" : "Base Salary"}</Label>
                  <Input
                    type="number"
                    value={formData.base_salary}
                    onChange={(e) => setFormData({ ...formData, base_salary: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "بدل السكن" : "Housing Allowance"}</Label>
                  <Input
                    type="number"
                    value={formData.housing_allowance}
                    onChange={(e) => setFormData({ ...formData, housing_allowance: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "بدل المواصلات" : "Transport Allowance"}</Label>
                  <Input
                    type="number"
                    value={formData.transport_allowance}
                    onChange={(e) => setFormData({ ...formData, transport_allowance: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === "ar" ? "بدلات أخرى" : "Other Allowances"}</Label>
                  <Input
                    type="number"
                    value={formData.other_allowances}
                    onChange={(e) => setFormData({ ...formData, other_allowances: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  {language === "ar" ? "إلغاء" : "Cancel"}
                </Button>
                <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingEmployee
                    ? (language === "ar" ? "تحديث" : "Update")
                    : (language === "ar" ? "إضافة" : "Add")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={language === "ar" ? "بحث بالاسم أو الكود..." : "Search by name or code..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="responsive-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === "ar" ? "الكود" : "Code"}</TableHead>
                  <TableHead>{language === "ar" ? "الاسم" : "Name"}</TableHead>
                  <TableHead>{language === "ar" ? "القسم" : "Department"}</TableHead>
                  <TableHead>{language === "ar" ? "المسمى" : "Position"}</TableHead>
                  <TableHead>{language === "ar" ? "الفرع" : "Branch"}</TableHead>
                  <TableHead>{language === "ar" ? "الراتب" : "Salary"}</TableHead>
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
                ) : filteredEmployees?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      {language === "ar" ? "لا يوجد موظفين" : "No employees found"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees?.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell className="font-mono">{employee.employee_code}</TableCell>
                      <TableCell>{employee.full_name}</TableCell>
                      <TableCell>{employee.departments?.department_name || "-"}</TableCell>
                      <TableCell>{employee.positions?.position_name || "-"}</TableCell>
                      <TableCell>{employee.branches?.branch_name || "-"}</TableCell>
                      <TableCell>
                        {(employee.base_salary + employee.housing_allowance + employee.transport_allowance + employee.other_allowances).toLocaleString()} ر.س
                      </TableCell>
                      <TableCell>{getStatusBadge(employee.employment_status)}</TableCell>
                      <TableCell>
                        <RowActionsMenu onEdit={() => handleEdit(employee)} />
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
