import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Shield, 
  Plus, 
  Edit2, 
  Trash2, 
  Save, 
  Loader2,
  Users,
  Lock,
  Eye,
  FilePlus,
  Pencil,
  Trash,
  RefreshCw,
  CheckSquare,
  XSquare
} from 'lucide-react';
import { toast } from 'sonner';

interface CustomRole {
  id: string;
  role_name: string;
  role_name_en: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

interface Screen {
  id: string;
  screen_key: string;
  screen_name: string;
  screen_name_en: string | null;
  screen_path: string;
  icon: string | null;
  sort_order: number;
}

interface RolePermission {
  id: string;
  role_id: string;
  screen_id: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export default function RolesPage() {
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<CustomRole | null>(null);
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false);
  const [roleForm, setRoleForm] = useState({
    role_name: '',
    role_name_en: '',
    description: '',
  });
  const [permissions, setPermissions] = useState<Record<string, { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }>>({});

  // Fetch roles
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: async () => {
      const res = await fetch('/api/custom-roles', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as CustomRole[];
    },
  });

  // Fetch screens
  const { data: screens = [] } = useQuery({
    queryKey: ['screens'],
    queryFn: async () => {
      const res = await fetch('/api/screens', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as Screen[];
    },
  });

  // Fetch role permissions
  const { data: rolePermissions = [] } = useQuery({
    queryKey: ['role-permissions', selectedRole?.id],
    queryFn: async () => {
      if (!selectedRole) return [];
      
      const res = await fetch(`/api/role-permissions/${selectedRole!.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as RolePermission[];
    },
    enabled: !!selectedRole,
  });

  // Count users per role
  const { data: userCounts = {} } = useQuery({
    queryKey: ['role-user-counts'],
    queryFn: async () => {
      const res = await fetch('/api/role-user-counts', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Create role mutation
  const createRoleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/roles', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleForm),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'فشل في إنشاء الدور'); }
      return res.json();
    },
    onSuccess: () => {
      toast.success('تم إنشاء الدور بنجاح');
      setShowRoleDialog(false);
      setRoleForm({ role_name: '', role_name_en: '', description: '' });
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في إنشاء الدور');
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRole) throw new Error('No role selected');
      const res = await fetch(`/api/roles/${selectedRole.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleForm),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'فشل في تحديث الدور'); }
      return res.json();
    },
    onSuccess: () => {
      toast.success('تم تحديث الدور بنجاح');
      setShowRoleDialog(false);
      setSelectedRole(null);
      setRoleForm({ role_name: '', role_name_en: '', description: '' });
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في تحديث الدور');
    },
  });

  // Delete role mutation
  const deleteRoleMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const res = await fetch(`/api/roles/${roleId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'فشل في حذف الدور'); }
      return res.json();
    },
    onSuccess: () => {
      toast.success('تم حذف الدور بنجاح');
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في حذف الدور');
    },
  });

  // Save permissions mutation
  const savePermissionsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRole) throw new Error('No role selected');

      const permissionsToSave = Object.entries(permissions)
        .filter(([, perms]) => perms.can_view || perms.can_create || perms.can_edit || perms.can_delete)
        .map(([screenId, perms]) => ({
          screen_id: screenId,
          can_view: perms.can_view,
          can_create: perms.can_create,
          can_edit: perms.can_edit,
          can_delete: perms.can_delete,
        }));

      const res = await fetch(`/api/roles/${selectedRole.id}/permissions`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: permissionsToSave }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'فشل في حفظ الصلاحيات'); }
      return res.json();
    },
    onSuccess: () => {
      toast.success('تم حفظ الصلاحيات بنجاح');
      setShowPermissionsDialog(false);
      queryClient.invalidateQueries({ queryKey: ['role-permissions'] });
      // Invalidate all users' permissions so changes reflect immediately
      queryClient.invalidateQueries({ queryKey: ['user-screen-permissions'] });
      queryClient.invalidateQueries({ queryKey: ['is-admin'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في حفظ الصلاحيات');
    },
  });

  // Reset/refresh permissions from database
  const resetToDefaultMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRole) throw new Error('No role selected');

      const permRes = await fetch(`/api/role-permissions/${selectedRole!.id}`, { credentials: 'include' });
      if (!permRes.ok) throw new Error('Failed to fetch');
      return await permRes.json();
    },
    onSuccess: (newPermissions) => {
      // Update local state with fetched permissions
      const initialPermissions: Record<string, { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }> = {};
      screens.forEach(screen => {
        const existingPerm = newPermissions?.find((p: any) => p.screen_id === screen.id);
        initialPermissions[screen.id] = {
          can_view: existingPerm?.can_view || false,
          can_create: existingPerm?.can_create || false,
          can_edit: existingPerm?.can_edit || false,
          can_delete: existingPerm?.can_delete || false,
        };
      });
      setPermissions(initialPermissions);
      queryClient.invalidateQueries({ queryKey: ['role-permissions'] });
      toast.success('تم تحديث الصلاحيات من قاعدة البيانات');
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في تحديث الصلاحيات');
    },
  });

  // Select all permissions for all screens
  const selectAllPermissions = () => {
    const allPermissions: Record<string, { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }> = {};
    screens.forEach(screen => {
      allPermissions[screen.id] = {
        can_view: true,
        can_create: true,
        can_edit: true,
        can_delete: true,
      };
    });
    setPermissions(allPermissions);
  };

  // Clear all permissions
  const clearAllPermissions = () => {
    const clearedPermissions: Record<string, { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }> = {};
    screens.forEach(screen => {
      clearedPermissions[screen.id] = {
        can_view: false,
        can_create: false,
        can_edit: false,
        can_delete: false,
      };
    });
    setPermissions(clearedPermissions);
  };

  const openEditRole = (role: CustomRole) => {
    setSelectedRole(role);
    setRoleForm({
      role_name: role.role_name,
      role_name_en: role.role_name_en || '',
      description: role.description || '',
    });
    setShowRoleDialog(true);
  };

  const openPermissions = (role: CustomRole) => {
    setSelectedRole(role);
    
    // Initialize permissions from existing data
    const initialPermissions: Record<string, { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }> = {};
    screens.forEach(screen => {
      const existingPerm = rolePermissions.find(p => p.screen_id === screen.id);
      initialPermissions[screen.id] = {
        can_view: existingPerm?.can_view || false,
        can_create: existingPerm?.can_create || false,
        can_edit: existingPerm?.can_edit || false,
        can_delete: existingPerm?.can_delete || false,
      };
    });
    setPermissions(initialPermissions);
    setShowPermissionsDialog(true);
  };

  // Update permissions when rolePermissions change
  const loadPermissionsForRole = () => {
    const initialPermissions: Record<string, { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }> = {};
    screens.forEach(screen => {
      const existingPerm = rolePermissions.find(p => p.screen_id === screen.id);
      initialPermissions[screen.id] = {
        can_view: existingPerm?.can_view || false,
        can_create: existingPerm?.can_create || false,
        can_edit: existingPerm?.can_edit || false,
        can_delete: existingPerm?.can_delete || false,
      };
    });
    setPermissions(initialPermissions);
  };

  const togglePermission = (screenId: string, permType: 'can_view' | 'can_create' | 'can_edit' | 'can_delete') => {
    setPermissions(prev => ({
      ...prev,
      [screenId]: {
        ...prev[screenId],
        [permType]: !prev[screenId]?.[permType],
        // If enabling create/edit/delete, also enable view
        ...(permType !== 'can_view' && !prev[screenId]?.[permType] ? { can_view: true } : {}),
      },
    }));
  };

  const toggleAllForScreen = (screenId: string, checked: boolean) => {
    setPermissions(prev => ({
      ...prev,
      [screenId]: {
        can_view: checked,
        can_create: checked,
        can_edit: checked,
        can_delete: checked,
      },
    }));
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Shield className="w-8 h-8 text-primary" />
              إدارة الأدوار والصلاحيات
            </h1>
            <p className="text-muted-foreground">إنشاء أدوار مخصصة وتحديد صلاحيات الوصول للشاشات</p>
          </div>
          <Button onClick={() => {
            setSelectedRole(null);
            setRoleForm({ role_name: '', role_name_en: '', description: '' });
            setShowRoleDialog(true);
          }} className="gap-2">
            <Plus className="w-4 h-4" />
            إضافة دور جديد
          </Button>
        </div>

        {/* Roles Grid */}
        {rolesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map(role => (
              <Card key={role.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      {role.role_name}
                    </CardTitle>
                    <Badge variant={role.is_active ? 'default' : 'secondary'}>
                      {role.is_active ? 'نشط' : 'غير نشط'}
                    </Badge>
                  </div>
                  {role.role_name_en && (
                    <p className="text-sm text-muted-foreground">{role.role_name_en}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {role.description && (
                    <p className="text-sm text-muted-foreground">{role.description}</p>
                  )}
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span>{userCounts[role.id] || 0} مستخدم</span>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => openEditRole(role)}
                    >
                      <Edit2 className="w-4 h-4 ml-1" />
                      تعديل
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setSelectedRole(role);
                        // Trigger refetch of permissions then open dialog
                        setTimeout(() => {
                          loadPermissionsForRole();
                          setShowPermissionsDialog(true);
                        }, 100);
                      }}
                    >
                      <Lock className="w-4 h-4 ml-1" />
                      الصلاحيات
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm('هل أنت متأكد من حذف هذا الدور؟')) {
                          deleteRoleMutation.mutate(role.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create/Edit Role Dialog */}
        <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedRole ? 'تعديل الدور' : 'إضافة دور جديد'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>اسم الدور (عربي) *</Label>
                <Input
                  value={roleForm.role_name}
                  onChange={(e) => setRoleForm({ ...roleForm, role_name: e.target.value })}
                  placeholder="مثال: موظف مبيعات"
                />
              </div>
              <div>
                <Label>اسم الدور (إنجليزي)</Label>
                <Input
                  value={roleForm.role_name_en}
                  onChange={(e) => setRoleForm({ ...roleForm, role_name_en: e.target.value })}
                  placeholder="e.g. Sales Staff"
                />
              </div>
              <div>
                <Label>الوصف</Label>
                <Textarea
                  value={roleForm.description}
                  onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                  placeholder="وصف مختصر للدور والصلاحيات..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRoleDialog(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => selectedRole ? updateRoleMutation.mutate() : createRoleMutation.mutate()}
                disabled={!roleForm.role_name || createRoleMutation.isPending || updateRoleMutation.isPending}
              >
                {(createRoleMutation.isPending || updateRoleMutation.isPending) && (
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                )}
                <Save className="w-4 h-4 ml-2" />
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Permissions Dialog */}
        <Dialog open={showPermissionsDialog} onOpenChange={setShowPermissionsDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                صلاحيات الدور: {selectedRole?.role_name}
              </DialogTitle>
            </DialogHeader>
            
            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2 border-b pb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllPermissions}
                className="gap-2"
              >
                <CheckSquare className="w-4 h-4" />
                تحديد الكل
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllPermissions}
                className="gap-2"
              >
                <XSquare className="w-4 h-4" />
                إلغاء الكل
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resetToDefaultMutation.mutate()}
                disabled={resetToDefaultMutation.isPending}
                className="gap-2"
              >
                {resetToDefaultMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                تحديث من قاعدة البيانات
              </Button>
            </div>
            
            <ScrollArea className="h-[50vh]">
              <div className="responsive-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">الشاشة</TableHead>
                    <TableHead className="text-center w-24">
                      <div className="flex flex-col items-center gap-1">
                        <Eye className="w-4 h-4" />
                        <span className="text-xs">عرض</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center w-24">
                      <div className="flex flex-col items-center gap-1">
                        <FilePlus className="w-4 h-4" />
                        <span className="text-xs">إنشاء</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center w-24">
                      <div className="flex flex-col items-center gap-1">
                        <Pencil className="w-4 h-4" />
                        <span className="text-xs">تعديل</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center w-24">
                      <div className="flex flex-col items-center gap-1">
                        <Trash className="w-4 h-4" />
                        <span className="text-xs">حذف</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center w-24">الكل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {screens.map(screen => {
                    const perm = permissions[screen.id] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
                    const allChecked = perm.can_view && perm.can_create && perm.can_edit && perm.can_delete;
                    
                    return (
                      <TableRow key={screen.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{screen.screen_name}</p>
                            <p className="text-xs text-muted-foreground">{screen.screen_path}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={perm.can_view}
                            onCheckedChange={() => togglePermission(screen.id, 'can_view')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={perm.can_create}
                            onCheckedChange={() => togglePermission(screen.id, 'can_create')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={perm.can_edit}
                            onCheckedChange={() => togglePermission(screen.id, 'can_edit')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={perm.can_delete}
                            onCheckedChange={() => togglePermission(screen.id, 'can_delete')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={allChecked}
                            onCheckedChange={(checked) => toggleAllForScreen(screen.id, !!checked)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPermissionsDialog(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => savePermissionsMutation.mutate()}
                disabled={savePermissionsMutation.isPending}
              >
                {savePermissionsMutation.isPending && (
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                )}
                <Save className="w-4 h-4 ml-2" />
                حفظ الصلاحيات
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
