import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import POSLayout from '@/components/pos/POSLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UserCog, KeyRound, Loader2, CheckCircle, XCircle, ShieldCheck, Store, BadgeCheck, Building2, Plus, Trash2, UserPlus, AlertTriangle, Shield, Eye, EyeOff, RotateCcw, Pencil, Mail, Phone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface POSUser {
  user_id: string;
  username: string;
  full_name: string;
  is_active: boolean;
  role_key: string;
  role_name: string;
  has_pin: boolean;
  is_supervisor: boolean;
  branch_names: string;
}

export default function POSUsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState<POSUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<POSUser | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [settingPin, setSettingPin] = useState(false);

  const [sellerBranchId, setSellerBranchId] = useState('');
  const [showAssignSellerDialog, setShowAssignSellerDialog] = useState(false);
  const [assignProfileId, setAssignProfileId] = useState('');

  const [showCreateAdminDialog, setShowCreateAdminDialog] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [resetAdminId, setResetAdminId] = useState('');
  const [resetAdminName, setResetAdminName] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [showEditAdminDialog, setShowEditAdminDialog] = useState(false);
  const [editAdminId, setEditAdminId] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/pos/users', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setUsers(json.data || []);
      }
    } catch {
      toast({ title: 'خطأ', description: 'تعذر تحميل قائمة المستخدمين', variant: 'destructive' });
    }
    setLoading(false);
  };

  const handleSetPin = async () => {
    if (!selectedUser) return;
    if (!/^\d{4}$/.test(newPin)) {
      toast({ title: 'خطأ', description: 'PIN يجب أن يكون 4 أرقام', variant: 'destructive' });
      return;
    }
    if (newPin !== confirmPin) {
      toast({ title: 'خطأ', description: 'رمز PIN غير متطابق', variant: 'destructive' });
      return;
    }

    setSettingPin(true);
    try {
      const res = await fetch('/api/pos/users/set-pin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUser.user_id, pin: newPin }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: 'خطأ', description: json.error || 'تعذر تعيين PIN', variant: 'destructive' });
        return;
      }
      toast({ title: 'تم', description: `تم تعيين PIN لـ ${selectedUser.full_name || selectedUser.username}` });
      setShowPinDialog(false);
      setNewPin('');
      setConfirmPin('');
      setSelectedUser(null);
      fetchUsers();
    } catch {
      toast({ title: 'خطأ', description: 'تعذر الاتصال بالخادم', variant: 'destructive' });
    }
    setSettingPin(false);
  };

  const { data: adminAccounts = [], isLoading: isAdminsLoading } = useQuery({
    queryKey: ['pos-admin-accounts'],
    queryFn: async () => {
      const res = await fetch('/api/pos/admin-accounts', { credentials: 'include' });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json.data || [];
    },
    enabled: activeTab === 'admins',
  });

  const createAdminMutation = useMutation({
    mutationFn: async (data: { username: string; password: string; display_name: string; email?: string; phone?: string }) => {
      const res = await fetch('/api/pos/admin-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pos-admin-accounts'] });
      toast({ title: 'تم', description: 'تم إنشاء حساب الأدمن بنجاح' });
      setShowCreateAdminDialog(false);
      setAdminUsername('');
      setAdminPassword('');
      setAdminDisplayName('');
      setAdminEmail('');
      setAdminPhone('');
    },
    onError: (e: Error) => toast({ title: 'خطأ', description: e.message, variant: 'destructive' }),
  });

  const toggleAdminMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/pos/admin-accounts/${id}/toggle-active`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pos-admin-accounts'] });
      toast({ title: 'تم', description: 'تم تحديث حالة الحساب' });
    },
    onError: (e: Error) => toast({ title: 'خطأ', description: e.message, variant: 'destructive' }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => {
      const res = await fetch(`/api/pos/admin-accounts/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pos-admin-accounts'] });
      toast({ title: 'تم', description: 'تم تغيير كلمة المرور بنجاح' });
      setShowResetPasswordDialog(false);
      setResetPassword('');
      setResetAdminId('');
      setResetAdminName('');
    },
    onError: (e: Error) => toast({ title: 'خطأ', description: e.message, variant: 'destructive' }),
  });

  const editAdminMutation = useMutation({
    mutationFn: async (data: { id: string; display_name: string; username: string; email: string; phone: string }) => {
      const res = await fetch(`/api/pos/admin-accounts/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pos-admin-accounts'] });
      toast({ title: 'تم', description: 'تم تحديث بيانات الأدمن' });
      setShowEditAdminDialog(false);
    },
    onError: (e: Error) => toast({ title: 'خطأ', description: e.message, variant: 'destructive' }),
  });

  const { data: branchesWithSellers, isLoading: isSellersLoading } = useQuery({
    queryKey: ['admin-branches-with-sellers'],
    queryFn: async () => {
      const res = await fetch('/api/pos/admin/branches-with-sellers', { credentials: 'include' });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data?.branches || [];
    },
    enabled: activeTab === 'sellers',
  });

  const { data: activeProfiles = [] } = useQuery({
    queryKey: ['admin-active-profiles'],
    queryFn: async () => {
      const res = await fetch('/api/pos/admin/profiles-active', { credentials: 'include' });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data?.profiles || [];
    },
    enabled: showAssignSellerDialog,
  });

  const selectedBranchSellers = useMemo(() => {
    if (!branchesWithSellers || !sellerBranchId) return [];
    const branch = branchesWithSellers.find((b: any) => b.id === sellerBranchId);
    return branch?.sellers || [];
  }, [branchesWithSellers, sellerBranchId]);

  const availableProfiles = useMemo(() => {
    const assignedIds = new Set(selectedBranchSellers.map((s: any) => s.profile_id));
    return activeProfiles.filter((p: any) => !assignedIds.has(p.id));
  }, [activeProfiles, selectedBranchSellers]);

  const assignSellerMutation = useMutation({
    mutationFn: async ({ branch_id, profile_id }: { branch_id: string; profile_id: string }) => {
      const res = await fetch('/api/pos/admin/branch-sellers/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ branch_id, profile_id }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-branches-with-sellers'] });
      toast({ title: 'تم', description: 'تم تعيين البائع بنجاح' });
      setShowAssignSellerDialog(false);
      setAssignProfileId('');
    },
    onError: (e: Error) => toast({ title: 'خطأ', description: e.message, variant: 'destructive' }),
  });

  const removeSellerMutation = useMutation({
    mutationFn: async ({ branch_id, profile_id }: { branch_id: string; profile_id: string }) => {
      const res = await fetch('/api/pos/admin/branch-sellers/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ branch_id, profile_id }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-branches-with-sellers'] });
      toast({ title: 'تم', description: 'تم إزالة البائع من الفرع' });
    },
    onError: (e: Error) => toast({ title: 'خطأ', description: e.message, variant: 'destructive' }),
  });

  return (
    <POSLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="page-header-rtl">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <UserCog className="w-6 h-6 text-primary" />
              إدارة مستخدمين نقاط البيع
            </h1>
            <p className="page-description">الكاشير والمشرفين وإدارة رموز PIN والبائعين</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 w-full max-w-lg">
            <TabsTrigger value="users" data-testid="tab-pos-users">
              <UserCog className="w-4 h-4 ml-2" />
              المستخدمون
            </TabsTrigger>
            <TabsTrigger value="sellers" data-testid="tab-pos-sellers">
              <BadgeCheck className="w-4 h-4 ml-2" />
              البائعون
            </TabsTrigger>
            <TabsTrigger value="admins" data-testid="tab-pos-admins">
              <Shield className="w-4 h-4 ml-2" />
              الأدمن
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-6 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">مستخدمو نقطة البيع</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : users.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <UserCog className="w-10 h-10 mb-3 opacity-40" />
                    <p className="text-sm">لا يوجد مستخدمين لنقاط البيع</p>
                  </div>
                ) : (
                  <div className="responsive-table-wrapper">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الاسم</TableHead>
                          <TableHead>اسم المستخدم</TableHead>
                          <TableHead>الدور</TableHead>
                          <TableHead>الفروع</TableHead>
                          <TableHead>PIN</TableHead>
                          <TableHead>إجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map(u => (
                          <TableRow key={u.user_id} data-testid={`row-pos-user-${u.user_id}`}>
                            <TableCell className="font-medium">{u.full_name || u.username}</TableCell>
                            <TableCell className="text-muted-foreground">{u.username}</TableCell>
                            <TableCell>
                              <Badge variant={u.is_supervisor ? 'default' : 'secondary'}>
                                {u.is_supervisor ? (
                                  <span className="flex items-center gap-1">
                                    <ShieldCheck className="w-3 h-3" />
                                    مشرف
                                  </span>
                                ) : 'كاشير'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {u.branch_names ? (
                                <span className="flex items-center gap-1 text-sm">
                                  <Store className="w-3 h-3 text-muted-foreground shrink-0" />
                                  {u.branch_names}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-sm">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {u.has_pin ? (
                                <Badge variant="outline" className="gap-1">
                                  <CheckCircle className="w-3 h-3 text-green-600" />
                                  مفعّل
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                                  <XCircle className="w-3 h-3" />
                                  غير مضبوط
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { setSelectedUser(u); setShowPinDialog(true); setNewPin(''); setConfirmPin(''); }}
                                data-testid={`button-set-pin-${u.user_id}`}
                              >
                                <KeyRound className="w-3.5 h-3.5 ml-1" />
                                {u.has_pin ? 'تغيير PIN' : 'تعيين PIN'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sellers" className="space-y-6 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BadgeCheck className="w-5 h-5" />
                  إدارة البائعين حسب الفرع
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <Label className="mb-1.5 block">اختر الفرع</Label>
                    <Select value={sellerBranchId} onValueChange={setSellerBranchId}>
                      <SelectTrigger data-testid="select-seller-branch">
                        <Building2 className="w-4 h-4 ml-2 flex-shrink-0" />
                        <SelectValue placeholder="اختر الفرع" />
                      </SelectTrigger>
                      <SelectContent>
                        {(branchesWithSellers || []).map((b: any) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name} ({b.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {sellerBranchId && (
                    <Button
                      onClick={() => setShowAssignSellerDialog(true)}
                      data-testid="button-add-seller"
                    >
                      <Plus className="w-4 h-4 ml-2" />
                      إضافة بائع للفرع
                    </Button>
                  )}
                </div>

                {isSellersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : !sellerBranchId ? (
                  <div className="text-center py-8 text-muted-foreground">
                    اختر فرعاً لعرض البائعين المسجلين فيه
                  </div>
                ) : selectedBranchSellers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-orange-400" />
                    لا يوجد بائعون مسجلون في هذا الفرع
                  </div>
                ) : (
                  <div className="responsive-table-wrapper">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>اسم البائع</TableHead>
                          <TableHead>اسم المستخدم</TableHead>
                          <TableHead>الإجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedBranchSellers.map((seller: any) => (
                          <TableRow key={seller.profile_id} data-testid={`row-seller-${seller.profile_id}`}>
                            <TableCell className="font-medium">{seller.display_name}</TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground">{seller.username || '-'}</TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive"
                                disabled={removeSellerMutation.isPending}
                                onClick={() => {
                                  if (confirm(`هل تريد إزالة "${seller.display_name}" من هذا الفرع؟`)) {
                                    removeSellerMutation.mutate({ branch_id: sellerBranchId, profile_id: seller.profile_id });
                                  }
                                }}
                                data-testid={`button-remove-seller-${seller.profile_id}`}
                              >
                                <Trash2 className="w-4 h-4 ml-1" />
                                إزالة
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="admins" className="space-y-6 mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">حسابات أدمن نقطة البيع</CardTitle>
                <Button
                  size="sm"
                  onClick={() => setShowCreateAdminDialog(true)}
                  data-testid="button-create-admin"
                >
                  <Plus className="w-4 h-4 ml-1" />
                  إضافة أدمن
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {isAdminsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : adminAccounts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Shield className="w-10 h-10 mb-3 opacity-40" />
                    <p className="text-sm">لا يوجد حسابات أدمن</p>
                  </div>
                ) : (
                  <div className="responsive-table-wrapper">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الاسم</TableHead>
                          <TableHead>اسم المستخدم</TableHead>
                          <TableHead>البريد الإلكتروني</TableHead>
                          <TableHead>رقم الجوال</TableHead>
                          <TableHead>الحالة</TableHead>
                          <TableHead>الإجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adminAccounts.map((admin: any) => (
                          <TableRow key={admin.id} data-testid={`row-admin-${admin.id}`}>
                            <TableCell className="font-medium">{admin.display_name}</TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground">{admin.username}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{admin.email || '-'}</TableCell>
                            <TableCell className="text-sm text-muted-foreground" dir="ltr">{admin.phone || '-'}</TableCell>
                            <TableCell>
                              <Badge variant={admin.is_active ? 'default' : 'secondary'}>
                                {admin.is_active ? 'نشط' : 'معطل'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditAdminId(admin.id);
                                    setEditDisplayName(admin.display_name);
                                    setEditUsername(admin.username);
                                    setEditEmail(admin.email || '');
                                    setEditPhone(admin.phone || '');
                                    setShowEditAdminDialog(true);
                                  }}
                                  data-testid={`button-edit-admin-${admin.id}`}
                                >
                                  <Pencil className="w-4 h-4 ml-1" />
                                  تعديل
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setResetAdminId(admin.id);
                                    setResetAdminName(admin.display_name);
                                    setResetPassword('');
                                    setShowResetPassword(false);
                                    setShowResetPasswordDialog(true);
                                  }}
                                  data-testid={`button-reset-password-${admin.id}`}
                                >
                                  <RotateCcw className="w-4 h-4 ml-1" />
                                  كلمة المرور
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={admin.is_active ? 'text-destructive' : 'text-green-600'}
                                  disabled={toggleAdminMutation.isPending}
                                  onClick={() => toggleAdminMutation.mutate(admin.id)}
                                  data-testid={`button-toggle-admin-${admin.id}`}
                                >
                                  {admin.is_active ? (
                                    <><XCircle className="w-4 h-4 ml-1" /> تعطيل</>
                                  ) : (
                                    <><CheckCircle className="w-4 h-4 ml-1" /> تفعيل</>
                                  )}
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
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5" />
              {selectedUser?.has_pin ? 'تغيير' : 'تعيين'} رمز PIN
            </DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {selectedUser?.has_pin ? 'تغيير' : 'تعيين'} رمز PIN لـ: <strong>{selectedUser.full_name || selectedUser.username}</strong>
              </p>
              <div className="space-y-2">
                <Label>رمز PIN الجديد (4 أرقام)</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="****"
                  className="text-center text-lg tracking-widest"
                  data-testid="input-new-pin"
                />
              </div>
              <div className="space-y-2">
                <Label>تأكيد رمز PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={confirmPin}
                  onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="****"
                  className="text-center text-lg tracking-widest"
                  onKeyDown={e => e.key === 'Enter' && !settingPin && handleSetPin()}
                  data-testid="input-confirm-pin"
                />
              </div>
              {newPin.length === 4 && confirmPin.length === 4 && newPin !== confirmPin && (
                <p className="text-sm text-destructive">رمز PIN غير متطابق</p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowPinDialog(false)} data-testid="button-cancel-pin">
              إلغاء
            </Button>
            <Button
              onClick={handleSetPin}
              disabled={settingPin || newPin.length !== 4 || confirmPin.length !== 4 || newPin !== confirmPin}
              data-testid="button-confirm-pin"
            >
              {settingPin ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <KeyRound className="w-4 h-4 ml-2" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAssignSellerDialog} onOpenChange={setShowAssignSellerDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-gold" />
              إضافة بائع للفرع
            </DialogTitle>
            <DialogDescription>
              اختر مستخدماً لتعيينه كبائع في الفرع المحدد
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>المستخدم</Label>
              <Select value={assignProfileId} onValueChange={setAssignProfileId}>
                <SelectTrigger data-testid="select-assign-profile">
                  <SelectValue placeholder="اختر مستخدم" />
                </SelectTrigger>
                <SelectContent>
                  {availableProfiles.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.display_name} {p.username ? `(${p.username})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableProfiles.length === 0 && (
                <p className="text-xs text-muted-foreground">جميع المستخدمين النشطين مسجلون بالفعل في هذا الفرع</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignSellerDialog(false)}>
              إلغاء
            </Button>
            <Button
              disabled={!assignProfileId || assignSellerMutation.isPending}
              onClick={() => assignSellerMutation.mutate({ branch_id: sellerBranchId, profile_id: assignProfileId })}
              data-testid="button-confirm-assign"
            >
              {assignSellerMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              تعيين
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showCreateAdminDialog} onOpenChange={setShowCreateAdminDialog}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              إضافة أدمن نقطة بيع
            </DialogTitle>
            <DialogDescription>
              إنشاء حساب أدمن جديد لنقطة البيع
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>الاسم</Label>
              <Input
                value={adminDisplayName}
                onChange={e => setAdminDisplayName(e.target.value)}
                placeholder="مثال: أحمد المشرف"
                data-testid="input-admin-display-name"
              />
            </div>
            <div className="space-y-2">
              <Label>اسم المستخدم</Label>
              <Input
                value={adminUsername}
                onChange={e => setAdminUsername(e.target.value)}
                placeholder="مثال: admin2"
                dir="ltr"
                className="text-left"
                data-testid="input-admin-username"
              />
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور</Label>
              <div className="relative">
                <Input
                  type={showAdminPassword ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={e => setAdminPassword(e.target.value)}
                  placeholder="****"
                  dir="ltr"
                  className="text-left pl-10"
                  data-testid="input-admin-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1/2 -translate-y-1/2"
                  onClick={() => setShowAdminPassword(!showAdminPassword)}
                >
                  {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>البريد الإلكتروني (اختياري)</Label>
              <Input
                type="email"
                value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)}
                placeholder="example@email.com"
                dir="ltr"
                className="text-left"
                data-testid="input-admin-email"
              />
            </div>
            <div className="space-y-2">
              <Label>رقم الجوال (اختياري)</Label>
              <Input
                value={adminPhone}
                onChange={e => setAdminPhone(e.target.value)}
                placeholder="05xxxxxxxx"
                dir="ltr"
                className="text-left"
                data-testid="input-admin-phone"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateAdminDialog(false)}>
              إلغاء
            </Button>
            <Button
              disabled={!adminUsername || !adminPassword || !adminDisplayName || createAdminMutation.isPending}
              onClick={() => createAdminMutation.mutate({
                username: adminUsername,
                password: adminPassword,
                display_name: adminDisplayName,
                email: adminEmail,
                phone: adminPhone,
              })}
              data-testid="button-confirm-create-admin"
            >
              {createAdminMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              إنشاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditAdminDialog} onOpenChange={setShowEditAdminDialog}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              تعديل بيانات الأدمن
            </DialogTitle>
            <DialogDescription>
              تعديل بيانات حساب أدمن نقطة البيع
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>الاسم</Label>
              <Input
                value={editDisplayName}
                onChange={e => setEditDisplayName(e.target.value)}
                data-testid="input-edit-display-name"
              />
            </div>
            <div className="space-y-2">
              <Label>اسم المستخدم</Label>
              <Input
                value={editUsername}
                onChange={e => setEditUsername(e.target.value)}
                dir="ltr"
                className="text-left"
                data-testid="input-edit-username"
              />
            </div>
            <div className="space-y-2">
              <Label>البريد الإلكتروني</Label>
              <Input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                placeholder="example@email.com"
                dir="ltr"
                className="text-left"
                data-testid="input-edit-email"
              />
            </div>
            <div className="space-y-2">
              <Label>رقم الجوال</Label>
              <Input
                value={editPhone}
                onChange={e => setEditPhone(e.target.value)}
                placeholder="05xxxxxxxx"
                dir="ltr"
                className="text-left"
                data-testid="input-edit-phone"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowEditAdminDialog(false)}>
              إلغاء
            </Button>
            <Button
              disabled={!editDisplayName || !editUsername || editAdminMutation.isPending}
              onClick={() => editAdminMutation.mutate({
                id: editAdminId,
                display_name: editDisplayName,
                username: editUsername,
                email: editEmail,
                phone: editPhone,
              })}
              data-testid="button-confirm-edit-admin"
            >
              {editAdminMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showResetPasswordDialog} onOpenChange={setShowResetPasswordDialog}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5" />
              تغيير كلمة المرور
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              تغيير كلمة المرور لـ: <strong>{resetAdminName}</strong>
            </p>
            <div className="space-y-2">
              <Label>كلمة المرور الجديدة</Label>
              <div className="relative">
                <Input
                  type={showResetPassword ? 'text' : 'password'}
                  value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                  placeholder="****"
                  dir="ltr"
                  className="text-left pl-10"
                  data-testid="input-reset-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1/2 -translate-y-1/2"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                >
                  {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowResetPasswordDialog(false)}>
              إلغاء
            </Button>
            <Button
              disabled={!resetPassword || resetPassword.length < 4 || resetPasswordMutation.isPending}
              onClick={() => resetPasswordMutation.mutate({ id: resetAdminId, password: resetPassword })}
              data-testid="button-confirm-reset-password"
            >
              {resetPasswordMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </POSLayout>
  );
}
