import { useState } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as apiClient from '@/lib/apiClient';
import { toast } from 'sonner';
import { Plus, Building2, MapPin, Phone, User, Loader2, KeyRound, LogOut, Shield, ShoppingCart, RotateCcw, AlertTriangle } from 'lucide-react';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { useLanguage } from '@/contexts/LanguageContext';
import { createBranchInventoryAccounts } from '@/lib/branch-inventory-accounts';
import { useModules } from '@/core/contexts/ModuleContext';

interface Branch {
  id: string;
  branch_code: string;
  branch_name: string;
  branch_type: 'gold' | 'jewelry';
  address: string | null;
  phone: string | null;
  manager_name: string | null;
  is_active: boolean;
  created_at: string;
}

interface BranchFormData {
  branch_code: string;
  branch_name: string;
  branch_type: 'gold' | 'jewelry';
  address: string;
  phone: string;
  manager_name: string;
  is_active: boolean;
}

interface BranchFormData {
  branch_code: string;
  branch_name: string;
  address: string;
  phone: string;
  manager_name: string;
  is_active: boolean;
}

const initialFormData: BranchFormData = {
  branch_code: '',
  branch_name: '',
  branch_type: 'jewelry',
  address: '',
  phone: '',
  manager_name: '',
  is_active: true,
};

interface BranchAccount {
  branch_id: string;
  branch_name: string;
  branch_code: string;
  username: string | null;
  is_active: boolean | null;
  has_account: boolean;
}

function BranchAccountsSection() {
  const queryClient = useQueryClient();
  const [credDialogOpen, setCredDialogOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<BranchAccount | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<BranchAccount | null>(null);
  const [credForm, setCredForm] = useState({ username: '', password: '', confirmPassword: '', isActive: true });

  const { data: accounts, isLoading } = useQuery<BranchAccount[]>({
    queryKey: ['branch-accounts'],
    queryFn: async () => {
      const { data, error } = await apiClient.get<any>('/api/admin/branch-accounts');
      if (error) throw new Error(error.message === 'HTTP 403' ? 'صلاحيات المشرف مطلوبة' : error.message);
      const rows = data?.data ?? data;
      return Array.isArray(rows) ? rows : [];
    },
  });

  const setCredMutation = useMutation({
    mutationFn: async (body: { branchId: string; username: string; password: string; isActive: boolean }) => {
      const { data, error } = await apiClient.post<{ ok: boolean }>('/api/admin/branch-accounts/set-credentials', body);
      if (error) {
        const msg = error.message.includes('403') ? 'صلاحيات المشرف مطلوبة' : error.message;
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: async (_data, variables) => {
      let revokedOk = false;
      try {
        await apiClient.post('/api/admin/branch-accounts/revoke-sessions', { branchId: variables.branchId });
        revokedOk = true;
      } catch {
        revokedOk = false;
      }
      queryClient.invalidateQueries({ queryKey: ['branch-accounts'] });
      if (revokedOk) {
        toast.success('تم حفظ بيانات دخول الفرع وإلغاء الجلسات السابقة');
      } else {
        toast.success('تم حفظ بيانات دخول الفرع');
        toast.warning('تعذّر إلغاء الجلسات تلقائيًا — يمكنك استخدام زر "إلغاء الجلسات"');
      }
      handleCloseCredDialog();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const { data, error } = await apiClient.post<{ ok: boolean; revoked_count: number }>('/api/admin/branch-accounts/revoke-sessions', { branchId });
      if (error) {
        const msg = error.message.includes('403') ? 'صلاحيات المشرف مطلوبة' : error.message;
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['branch-accounts'] });
      const count = data?.revoked_count ?? 0;
      toast.success(`تم إلغاء ${count} جلسة`);
      setRevokeTarget(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleOpenCredDialog = (branch: BranchAccount) => {
    setSelectedBranch(branch);
    setCredForm({
      username: branch.username || '',
      password: '',
      confirmPassword: '',
      isActive: branch.is_active ?? true,
    });
    setCredDialogOpen(true);
  };

  const handleCloseCredDialog = () => {
    setCredDialogOpen(false);
    setSelectedBranch(null);
    setCredForm({ username: '', password: '', confirmPassword: '', isActive: true });
  };

  const handleSaveCred = () => {
    const username = credForm.username.trim();
    if (username.length < 3 || username.length > 50) {
      toast.error('اسم المستخدم يجب أن يكون بين 3 و 50 حرف');
      return;
    }
    if (credForm.password.length < 8) {
      toast.error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      return;
    }
    if (credForm.password !== credForm.confirmPassword) {
      toast.error('كلمة المرور غير متطابقة');
      return;
    }
    if (!selectedBranch) return;
    setCredMutation.mutate({
      branchId: selectedBranch.branch_id,
      username,
      password: credForm.password,
      isActive: credForm.isActive,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">تسجيل دخول الفرع</h2>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="responsive-table-wrapper">
              <table className="w-full text-sm" data-testid="table-branch-accounts">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-right p-3 font-medium">الفرع</th>
                    <th className="text-right p-3 font-medium">الكود</th>
                    <th className="text-right p-3 font-medium">حساب دخول</th>
                    <th className="text-right p-3 font-medium">اسم المستخدم</th>
                    <th className="text-right p-3 font-medium">الحالة</th>
                    <th className="text-right p-3 font-medium">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts && accounts.length > 0 ? accounts.map((acc) => (
                    <tr key={acc.branch_id} className="border-b last:border-b-0" data-testid={`row-branch-account-${acc.branch_id}`}>
                      <td className="p-3 font-medium">{acc.branch_name}</td>
                      <td className="p-3 font-mono text-muted-foreground">{acc.branch_code}</td>
                      <td className="p-3">
                        <Badge variant={acc.has_account ? 'default' : 'secondary'} data-testid={`badge-has-account-${acc.branch_id}`}>
                          {acc.has_account ? 'نعم' : 'لا'}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono text-muted-foreground">{acc.username || '—'}</td>
                      <td className="p-3">
                        {acc.has_account ? (
                          <Badge variant={acc.is_active ? 'default' : 'destructive'} data-testid={`badge-active-${acc.branch_id}`}>
                            {acc.is_active ? 'نشط' : 'معطّل'}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenCredDialog(acc)}
                            data-testid={`button-set-cred-${acc.branch_id}`}
                          >
                            <KeyRound className="w-4 h-4 ml-1" />
                            {acc.has_account ? 'تغيير' : 'تعيين'}
                          </Button>
                          {acc.has_account && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRevokeTarget(acc)}
                              data-testid={`button-revoke-${acc.branch_id}`}
                            >
                              <LogOut className="w-4 h-4 ml-1" />
                              إلغاء الجلسات
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground">لا توجد فروع</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={credDialogOpen} onOpenChange={(v) => { if (!v) handleCloseCredDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedBranch?.has_account ? 'تغيير بيانات دخول الفرع' : 'تعيين بيانات دخول الفرع'}
            </DialogTitle>
            <DialogDescription>
              {selectedBranch?.branch_name} ({selectedBranch?.branch_code})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="ba-username">اسم المستخدم *</Label>
              <Input
                id="ba-username"
                value={credForm.username}
                onChange={(e) => setCredForm({ ...credForm, username: e.target.value })}
                placeholder="branch-main"
                data-testid="input-ba-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ba-password">كلمة المرور *</Label>
              <Input
                id="ba-password"
                type="password"
                value={credForm.password}
                onChange={(e) => setCredForm({ ...credForm, password: e.target.value })}
                placeholder="8 أحرف على الأقل"
                data-testid="input-ba-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ba-confirm">تأكيد كلمة المرور *</Label>
              <Input
                id="ba-confirm"
                type="password"
                value={credForm.confirmPassword}
                onChange={(e) => setCredForm({ ...credForm, confirmPassword: e.target.value })}
                placeholder="أعد إدخال كلمة المرور"
                data-testid="input-ba-confirm"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="ba-active"
                checked={credForm.isActive}
                onCheckedChange={(checked) => setCredForm({ ...credForm, isActive: checked })}
                data-testid="switch-ba-active"
              />
              <Label htmlFor="ba-active">نشط</Label>
            </div>
          </div>
          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={handleCloseCredDialog} data-testid="button-ba-cancel">
              إلغاء
            </Button>
            <Button onClick={handleSaveCred} disabled={setCredMutation.isPending} data-testid="button-ba-save">
              {setCredMutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!revokeTarget} onOpenChange={(v) => { if (!v) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء جلسات الفرع</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إلغاء جميع جلسات الفرع الحالية ({revokeTarget?.branch_name}). هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel data-testid="button-revoke-cancel">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.branch_id)}
              disabled={revokeMutation.isPending}
              data-testid="button-revoke-confirm"
            >
              {revokeMutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              تأكيد الإلغاء
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function BranchesPage() {
  const queryClient = useQueryClient();
  const { t, isRTL } = useLanguage();
  const { isAdmin } = useModules();
  const [isOpen, setIsOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [formData, setFormData] = useState<BranchFormData>(initialFormData);

  const { data: branches, isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await apiClient.get<Branch[]>('/api/branches-list');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: branchAccounts } = useQuery<BranchAccount[] | null>({
    queryKey: ['branch-accounts'],
    queryFn: async () => {
      const { data, error } = await apiClient.get<{ data: BranchAccount[] }>('/api/admin/branch-accounts');
      if (error) return null;
      const rows = (data as any)?.data ?? data;
      return Array.isArray(rows) ? rows : null;
    },
    enabled: isAdmin === true,
  });

  const branchHasAccount = (branchId: string): boolean | null => {
    if (branchAccounts === undefined || branchAccounts === null) return null;
    if (!Array.isArray(branchAccounts)) return null;
    const acc = branchAccounts.find(a => a.branch_id === branchId);
    return acc?.has_account ?? false;
  };

  const createMutation = useMutation({
    mutationFn: async (data: BranchFormData) => {
      const { data: result, error } = await apiClient.rpc<any>('branch_create_atomic', {
        p_client_request_id: crypto.randomUUID(),
        p_code: data.branch_code,
        p_name: data.branch_name,
        p_name_en: data.branch_name,
        p_branch_type: data.branch_type || 'jewelry',
        p_address: data.address || null,
        p_phone: data.phone || null,
        p_is_active: data.is_active,
      });
      if (error) throw error;
      if (result && !result.success) {
        const err: any = new Error(result.error || 'فشل في إنشاء الفرع');
        err.code = result.error_code;
        throw err;
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(t.branches.createdSuccessfully);
      handleClose();
    },
    onError: (error: any) => {
      if (error.code === '23505') {
        toast.error(t.branches.codeExists);
      } else {
        toast.error(t.branches.createError);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: BranchFormData }) => {
      const { data: result, error } = await apiClient.rpc<any>('branch_update_atomic', {
        p_client_request_id: crypto.randomUUID(),
        p_branch_id: id,
        p_code: data.branch_code,
        p_name: data.branch_name,
        p_name_en: data.branch_name,
        p_branch_type: data.branch_type || 'jewelry',
        p_address: data.address || null,
        p_phone: data.phone || null,
        p_is_active: data.is_active,
      });
      if (error) throw error;
      if (result && !result.success) throw new Error(result.error || 'فشل في تحديث الفرع');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(t.branches.updatedSuccessfully);
      handleClose();
    },
    onError: () => {
      toast.error(t.branches.updateError);
    },
  });

  const handleOpen = (branch?: Branch) => {
    if (branch) {
      setEditingBranch(branch);
      setFormData({
        branch_code: branch.branch_code,
        branch_name: branch.branch_name,
        branch_type: branch.branch_type,
        address: branch.address || '',
        phone: branch.phone || '',
        manager_name: branch.manager_name || '',
        is_active: branch.is_active,
      });
    } else {
      setEditingBranch(null);
      setFormData(initialFormData);
    }
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setEditingBranch(null);
    setFormData(initialFormData);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.branch_code.trim() || !formData.branch_name.trim()) {
      toast.error(t.validation.fillRequired);
      return;
    }
    if (editingBranch) {
      updateMutation.mutate({ id: editingBranch.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6 animate-fade-in">
        <div className="page-header flex items-start justify-between">
          <div>
            <h1 className="page-title">{t.branches.title}</h1>
            <p className="page-description">{t.branches.subtitle}</p>
          </div>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpen()} className="gap-2">
                <Plus className="w-4 h-4" />
                {t.branches.addBranch}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingBranch ? t.branches.editBranch : t.branches.addBranch}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="branch_code">{t.branches.branchCode} *</Label>
                    <Input
                      id="branch_code"
                      value={formData.branch_code}
                      onChange={(e) => setFormData({ ...formData, branch_code: e.target.value })}
                      placeholder="BR001"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="branch_name">{t.branches.branchName} *</Label>
                    <Input
                      id="branch_name"
                      value={formData.branch_name}
                      onChange={(e) => setFormData({ ...formData, branch_name: e.target.value })}
                      placeholder={isRTL ? "الفرع الرئيسي" : "Main Branch"}
                      required
                    />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branch_type">{t.branches.branchType} *</Label>
                  <Select
                    value={formData.branch_type}
                    onValueChange={(value: 'gold' | 'jewelry') => setFormData({ ...formData, branch_type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={isRTL ? "اختر نوع الفرع" : "Select branch type"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="jewelry">{t.branches.jewelry}</SelectItem>
                      <SelectItem value="gold">{t.branches.gold}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">{t.common.address}</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder={isRTL ? "شارع ..." : "Street ..."}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">{t.common.phone}</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+966..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manager_name">{t.branches.manager}</Label>
                    <Input
                      id="manager_name"
                      value={formData.manager_name}
                      onChange={(e) => setFormData({ ...formData, manager_name: e.target.value })}
                      placeholder={isRTL ? "أحمد ..." : "Ahmed ..."}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label htmlFor="is_active">{t.branches.isActive}</Label>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={handleClose}>
                    {t.common.cancel}
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                    {editingBranch ? t.common.saveChanges : t.common.create}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-gold" />
          </div>
        ) : branches && branches.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((branch) => (
              <Card key={branch.id} className="border-0 shadow-md hover:shadow-lg transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-gold flex items-center justify-center shadow-gold">
                        <Building2 className="w-5 h-5 text-navy" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{branch.branch_name}</CardTitle>
                        <p className="text-sm text-muted-foreground font-mono">{branch.branch_code}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={branch.is_active ? 'default' : 'secondary'}>
                        {branch.is_active ? t.status.active : t.status.inactive}
                      </Badge>
                      <Badge variant="outline" className={branch.branch_type === 'gold' ? 'border-amber-500 text-amber-600' : 'border-purple-500 text-purple-600'}>
                        {branch.branch_type === 'gold' ? t.branches.gold : t.branches.jewelry}
                      </Badge>
                      <RowActionsMenu onEdit={() => handleOpen(branch)} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  {isAdmin && branchHasAccount(branch.id) === false && (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400" data-testid={`warning-no-account-${branch.id}`}>
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="text-xs">لا يوجد حساب دخول للفرع — لن يتم فتح POS قبل إعداد الحساب</span>
                    </div>
                  )}
                  {branch.address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      <span>{branch.address}</span>
                    </div>
                  )}
                  {branch.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      <span dir="ltr">{branch.phone}</span>
                    </div>
                  )}
                  {branch.manager_name && (
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      <span>{branch.manager_name}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-0 shadow-md">
            <CardContent className="p-8 text-center">
              <Building2 className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">{t.branches.noBranches}</p>
              <Button className="mt-4" onClick={() => handleOpen()}>
                <Plus className="w-4 h-4 ml-2" />
                {t.branches.createFirst}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <ShoppingCart className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-base">نقاط البيع</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              بعد فتح نقطة البيع سيتم طلب بيانات دخول الفرع (يوزر/باسورد الفرع) ثم اختيار الكاشير وإدخال رقم PIN
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="outline" onClick={() => window.location.href = '/auth'} data-testid="button-open-pos">
                <ShoppingCart className="w-4 h-4 ml-1" />
                فتح نقطة البيع
              </Button>
            </div>
          </CardContent>
        </Card>

        {isAdmin && <BranchAccountsSection />}
      </div>
    </MainLayout>
  );
}
