import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Building2, 
  Plus, 
  Pencil, 
  Trash2, 
  Loader2,
  Search,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';

interface Department {
  id: string;
  department_code: string;
  department_name: string;
  department_name_en: string | null;
  is_active: boolean;
  manager_id: string | null;
  created_at: string;
  updated_at: string;
  purchase_requisitions_count?: number;
  employees_count?: number;
}

export default function DepartmentsPage() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);
  const [formData, setFormData] = useState({
    department_code: '',
    department_name: '',
    department_name_en: '',
    is_active: true,
  });

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments-management'],
    queryFn: async () => {
      const res = await fetch('/api/departments-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch departments');
      return (await res.json()) as Department[];
    },
  });

  const checkDepartmentUsage = async (departmentId: string) => {
    const dept = departments.find(d => d.id === departmentId);
    if (!dept) return false;
    return ((dept.purchase_requisitions_count || 0) + (dept.employees_count || 0)) > 0;
  };

  const generateDepartmentCode = async () => {
    try {
      const res = await fetch('/api/departments-next-code', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        return data.next_code || 'DEP-001';
      }
    } catch {}
    return 'DEP-001';
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (selectedDepartment) {
        forbidDirectWrite('update', 'DepartmentsPage.tsx:130');
      } else {
        forbidDirectWrite('insert', 'DepartmentsPage.tsx:143');
      }
    },
    onSuccess: () => {
      toast.success(selectedDepartment ? t.departments.updatedSuccessfully : t.departments.createdSuccessfully);
      setDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['departments-management'] });
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (error: any) => {
      if (error.message?.includes('unique') || error.code === '23505') {
        toast.error(t.departments.codeExists);
      } else {
        toast.error(error.message || t.common.error);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const isUsed = await checkDepartmentUsage(id);
      if (isUsed) {
        throw new Error(t.departments.cannotDelete);
      }
      forbidDirectWrite('delete', 'DepartmentsPage.tsx:177');
    },
    onSuccess: () => {
      toast.success(t.departments.deletedSuccessfully);
      setDeleteDialogOpen(false);
      setSelectedDepartment(null);
      queryClient.invalidateQueries({ queryKey: ['departments-management'] });
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (error: any) => {
      toast.error(error.message || t.common.error);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      forbidDirectWrite('update', 'DepartmentsPage.tsx:198');
    },
    onSuccess: () => {
      toast.success(t.departments.updatedSuccessfully);
      queryClient.invalidateQueries({ queryKey: ['departments-management'] });
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (error: any) => {
      toast.error(error.message || t.common.error);
    },
  });

  const resetForm = () => {
    setFormData({
      department_code: '',
      department_name: '',
      department_name_en: '',
      is_active: true,
    });
    setSelectedDepartment(null);
  };

  const handleEdit = (department: Department) => {
    setSelectedDepartment(department);
    setFormData({
      department_code: department.department_code,
      department_name: department.department_name,
      department_name_en: department.department_name_en || '',
      is_active: department.is_active,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (department: Department) => {
    const isUsed = await checkDepartmentUsage(department.id);
    if (isUsed) {
      toast.error(t.departments.cannotDelete);
      return;
    }
    setSelectedDepartment(department);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.department_name.trim()) {
      toast.error(t.departments.nameRequired);
      return;
    }
    saveMutation.mutate();
  };

  const filteredDepartments = departments.filter(dept => 
    dept.department_name.toLowerCase().includes(search.toLowerCase()) ||
    dept.department_code.toLowerCase().includes(search.toLowerCase()) ||
    (dept.department_name_en && dept.department_name_en.toLowerCase().includes(search.toLowerCase()))
  );

  const activeDepartments = departments.filter(d => d.is_active).length;
  const inactiveDepartments = departments.filter(d => !d.is_active).length;

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t.departments.title}</h1>
              <p className="text-muted-foreground text-sm">{t.departments.subtitle}</p>
            </div>
          </div>
          <Button onClick={() => { resetForm(); setDialogOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            {t.departments.addDepartment}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t.departments.totalDepartments}</p>
                  <p className="text-2xl font-bold">{departments.length}</p>
                </div>
                <Building2 className="w-8 h-8 text-primary/40" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t.departments.activeDepartments}</p>
                  <p className="text-2xl font-bold text-green-600">{activeDepartments}</p>
                </div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t.departments.inactiveDepartments}</p>
                  <p className="text-2xl font-bold text-gray-500">{inactiveDepartments}</p>
                </div>
                <div className="w-3 h-3 rounded-full bg-gray-400"></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t.departments.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-10"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredDepartments.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <Building2 className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">{t.departments.noDepartments}</p>
              </div>
            ) : (
              <div className="responsive-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.departments.departmentCode}</TableHead>
                    <TableHead>{t.departments.departmentName}</TableHead>
                    <TableHead>{t.departments.departmentNameEn}</TableHead>
                    <TableHead className="text-center">{t.common.status}</TableHead>
                    <TableHead>{t.common.createdAt}</TableHead>
                    <TableHead className="text-center">{t.common.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDepartments.map((dept) => (
                    <TableRow key={dept.id}>
                      <TableCell className="font-mono">{dept.department_code}</TableCell>
                      <TableCell className="font-medium">{dept.department_name}</TableCell>
                      <TableCell>{dept.department_name_en || '-'}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Switch
                            checked={dept.is_active}
                            onCheckedChange={(checked) => 
                              toggleActiveMutation.mutate({ id: dept.id, isActive: checked })
                            }
                          />
                          <Badge variant={dept.is_active ? 'default' : 'secondary'}>
                            {dept.is_active ? t.common.active : t.common.inactive}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {format(new Date(dept.created_at), 'yyyy-MM-dd')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(dept)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(dept)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDepartment ? t.departments.editDepartment : t.departments.addDepartment}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>{t.departments.departmentCode}</Label>
              <Input
                value={formData.department_code}
                onChange={(e) => setFormData({ ...formData, department_code: e.target.value })}
                placeholder={t.departments.autoGenerate}
                disabled={!!selectedDepartment}
              />
              {!selectedDepartment && (
                <p className="text-xs text-muted-foreground">{t.departments.codeHint}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t.departments.departmentName} *</Label>
              <Input
                value={formData.department_name}
                onChange={(e) => setFormData({ ...formData, department_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t.departments.departmentNameEn}</Label>
              <Input
                value={formData.department_name_en}
                onChange={(e) => setFormData({ ...formData, department_name_en: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">{t.departments.isActive}</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin me-2" />}
                {t.common.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.departments.deleteConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.departments.deleteConfirmMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedDepartment && deleteMutation.mutate(selectedDepartment.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin me-2" />}
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
