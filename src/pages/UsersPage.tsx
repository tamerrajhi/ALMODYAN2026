import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { queryTable } from '@/lib/dataGateway';
import { useModules } from '@/core/contexts/ModuleContext';
import * as apiClient from '@/lib/apiClient';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { 
  Users, 
  Shield, 
  ShieldCheck, 
  UserCog, 
  Loader2, 
  Settings,
  KeyRound,
  Mail,
  MessageSquare,
  Save,
  Plus,
  UserPlus,
  Eye,
  EyeOff,
  Building2,
  BadgeCheck,
  Trash2,
  AlertTriangle,
  Lock
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

type AppRole = 'admin' | 'purchases_clerk' | 'manager' | 'sales' | 'accountant' | 'inventory' | 'viewer';

interface UserWithDetails {
  id: string;
  user_id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  mfa_enabled: boolean | null;
  mfa_method: string | null;
  created_at: string | null;
  is_active: boolean;
  has_pin: boolean;
  roles: AppRole[];
  permissions: Permission[];
  customRoles: { id: string; role_id: string; role_name: string }[];
  branches: { id: string; branch_id: string; branch_name: string; is_primary: boolean }[];
}

interface Permission {
  id: string;
  resource: string;
  can_create: boolean;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
}

interface CustomRole {
  id: string;
  role_name: string;
  role_name_en: string | null;
  role_key: string;
  description: string | null;
}

interface Branch {
  id: string;
  branch_name: string;
  branch_code: string;
  is_active: boolean;
}

const RESOURCES = [
  { key: 'dashboard', label: 'لوحة التحكم' },
  { key: 'import', label: 'استيراد البيانات' },
  { key: 'batches', label: 'دفعات الاستيراد' },
  { key: 'branches', label: 'إدارة الفروع' },
  { key: 'reports', label: 'التقارير' },
  { key: 'pos', label: 'نقطة البيع' },
  { key: 'customers', label: 'العملاء' },
  { key: 'users', label: 'إدارة مستخدمين النظام' },
];

const roleLabels: Record<AppRole, string> = {
  admin: 'مشرف',
  purchases_clerk: 'موظف مشتريات',
};

const PIN_REQUIRED_ROLE_KEYS = ['branch_seller_pos_only', 'branch_supervisor_pos_plus_unique_returns'];

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<UserWithDetails | null>(null);
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserWithDetails | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserWithDetails | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [showSetPinDialog, setShowSetPinDialog] = useState(false);
  const [setPinUser, setSetPinUser] = useState<UserWithDetails | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [isSettingPin, setIsSettingPin] = useState(false);
  const [activeTab, setActiveTab] = useState('customRoles');
  const [userPermissions, setUserPermissions] = useState<Record<string, Permission>>({});
  const [userMfaEnabled, setUserMfaEnabled] = useState(false);
  const [userMfaMethod, setUserMfaMethod] = useState<string>('');
  const [userPhone, setUserPhone] = useState('');

  // Create user form state
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newCustomRoleId, setNewCustomRoleId] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingBulk, setIsCreatingBulk] = useState(false);
  const [bulkResults, setBulkResults] = useState<any>(null);
  const [showBulkResultsDialog, setShowBulkResultsDialog] = useState(false);

  const { user: currentUser } = useAuth();

  const { isAdmin, accessLoading: isAdminLoading } = useModules();

  const canManageUsers = useMemo(() => !!isAdmin, [isAdmin]);

  const { data: customRoles } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: async () => {
      const { data, error } = await queryTable<CustomRole[]>('custom_roles', {
        select: '*',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'role_name', ascending: true },
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await queryTable<Branch[]>('branches', {
        select: '*',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'branch_name', ascending: true },
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: users, isLoading } = useQuery({
    queryKey: ['users-with-details'],
    enabled: canManageUsers,
    queryFn: async () => {
      const { data: details, error } = await apiClient.get<{
        profiles: any[];
        roles: any[];
        permissions: any[];
        userCustomRoles: any[];
        userBranches: any[];
        userPins: any[];
      }>('/api/users-with-details');
      if (error) throw new Error(error.message);
      if (!details) return [];

      const { profiles, roles, permissions, userCustomRoles, userBranches, userPins } = details;

      const usersWithDetails: UserWithDetails[] = (profiles || []).map((profile: any) => ({
        id: profile.id,
        user_id: profile.user_id,
        full_name: profile.full_name,
        username: profile.username || null,
        email: profile.email || null,
        phone: profile.phone || null,
        mfa_enabled: profile.mfa_enabled || false,
        mfa_method: profile.mfa_method || null,
        is_active: profile.is_active !== false,
        has_pin: (userPins || []).some((p: any) => p.user_id === profile.user_id),
        created_at: profile.created_at,
        roles: (roles || [])
          .filter((r: any) => r.user_id === profile.user_id)
          .map((r: any) => r.role),
        permissions: (permissions || [])
          .filter((p: any) => p.user_id === profile.user_id)
          .map((p: any) => ({
            id: p.id,
            resource: p.resource,
            can_create: p.can_create,
            can_read: p.can_read,
            can_update: p.can_update,
            can_delete: p.can_delete,
          })),
        customRoles: (userCustomRoles || [])
          .filter((ucr: any) => ucr.user_id === profile.user_id)
          .map((ucr: any) => ({
            id: ucr.id,
            role_id: ucr.role_id,
            role_name: ucr.role_name || '',
          })),
        branches: (userBranches || [])
          .filter((ub: any) => ub.user_id === profile.user_id)
          .map((ub: any) => ({
            id: ub.id,
            branch_id: ub.branch_id,
            branch_name: ub.branch_name || '',
            is_primary: ub.is_primary || false,
          })),
      }));

      return usersWithDetails;
    },
  });


  // Save permissions mutation
  const savePermissionsMutation = useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: Record<string, Permission> }) => {
      if (!canManageUsers) throw new Error('هذه العملية للمشرفين فقط');
      const permissionsArr = Object.entries(permissions).map(([resource, p]) => ({
        resource, can_create: p.can_create, can_read: p.can_read, can_update: p.can_update, can_delete: p.can_delete,
      }));
      const res = await fetch(`/api/users/${userId}/permissions`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: permissionsArr }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'فشل حفظ الصلاحيات');
    },
    onMutate: ({ userId, permissions }) => {
      // update local dialog state immediately so the UI reflects the change
      setSelectedUser((prev) => {
        if (!prev || prev.user_id !== userId) return prev;
        const nextPermissions: Permission[] = Object.entries(permissions).map(([resource, p]) => ({
          id: p.id,
          resource,
          can_create: p.can_create,
          can_read: p.can_read,
          can_update: p.can_update,
          can_delete: p.can_delete,
        }));
        return { ...prev, permissions: nextPermissions };
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.success('تم حفظ الصلاحيات بنجاح');
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.error('فشل حفظ الصلاحيات: ' + error.message);
    },
  });

  // Save MFA settings mutation
  const saveMfaMutation = useMutation({
    mutationFn: async ({ userId, mfaEnabled, mfaMethod, phone }: { userId: string; mfaEnabled: boolean; mfaMethod: string; phone: string }) => {
      if (!canManageUsers) throw new Error('هذه العملية للمشرفين فقط');
      const res = await fetch(`/api/users/${userId}/mfa`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_enabled: mfaEnabled, mfa_method: mfaMethod, phone }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'فشل حفظ إعدادات MFA');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.success('تم حفظ إعدادات المصادقة بنجاح');
    },
    onError: (error: Error) => {
      toast.error('فشل حفظ الإعدادات: ' + error.message);
    },
  });

  const handleCreateUser = async () => {
    if (!canManageUsers) {
      toast.error('هذه الصفحة للمشرفين فقط');
      return;
    }

    if (!newUsername.trim()) {
      toast.error('يرجى إدخال اسم المستخدم');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (!newFullName.trim()) {
      toast.error('يرجى إدخال الاسم الكامل');
      return;
    }

    setIsCreating(true);

    try {
      const createRes = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          fullName: newFullName,
          password: newPassword,
          customRoleId: newCustomRoleId || undefined,
          email: newEmail.trim(),
        }),
      });
      const { data, error } = await createRes.json();

      if (error) {
        throw new Error(error.message);
      }

      if (data?.error === 'username_exists') {
        toast.error('اسم المستخدم موجود مسبقاً');
        return;
      }

      toast.success('تم إنشاء المستخدم بنجاح');
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });

      setNewUsername('');
      setNewEmail('');
      setNewPassword('');
      setNewFullName('');
      setNewCustomRoleId('');
      setShowCreateDialog(false);
    } catch (error: any) {
      console.error('Error creating user:', error);
      toast.error('حدث خطأ أثناء إنشاء المستخدم');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete || !canManageUsers) return;

    // Prevent deleting self
    if (userToDelete.user_id === currentUser?.id) {
      toast.error('لا يمكنك حذف حسابك الخاص');
      return;
    }

    setIsDeleting(true);

    try {
      const deleteRes = await fetch('/api/admin/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userToDelete.user_id }),
      });
      const { data, error } = await deleteRes.json();

      if (error) {
        throw new Error(error.message);
      }

      if (data?.error === 'cannot_delete_self') {
        toast.error('لا يمكنك حذف حسابك الخاص');
        return;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast.success('تم حذف المستخدم بنجاح');
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      setShowDeleteDialog(false);
      setUserToDelete(null);
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast.error('حدث خطأ أثناء حذف المستخدم');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !canManageUsers) return;
    if (resetNewPassword.length < 8 || resetNewPassword !== resetConfirmPassword) return;

    setIsResettingPassword(true);
    try {
      const res = await fetch('/api/admin/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: resetPasswordUser.user_id, newPassword: resetNewPassword }),
      });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || result?.data?.error?.message || 'فشل إعادة تعيين كلمة المرور');
      }
      if (result.error) {
        throw new Error(typeof result.error === 'string' ? result.error : result.error.message);
      }

      toast.success('تم إعادة تعيين كلمة المرور');
      setShowResetPasswordDialog(false);
      setResetPasswordUser(null);
      setResetNewPassword('');
      setResetConfirmPassword('');
    } catch (error: any) {
      toast.error(error.message || 'حدث خطأ أثناء إعادة تعيين كلمة المرور');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleSetPin = async () => {
    if (!setPinUser || !canManageUsers) return;
    if (!/^\d{4}$/.test(pinValue) || pinValue !== pinConfirm) return;

    setIsSettingPin(true);
    try {
      const res = await fetch('/api/admin/users/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: setPinUser.user_id, pin: pinValue }),
      });
      const result = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('صلاحيات المشرف مطلوبة');
        }
        throw new Error(result?.error?.message || result?.error || 'حدث خطأ غير متوقع');
      }

      toast.success('تم تعيين PIN بنجاح');
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      setShowSetPinDialog(false);
      setSetPinUser(null);
      setPinValue('');
      setPinConfirm('');
    } catch (error: any) {
      toast.error(error.message || 'حدث خطأ غير متوقع');
    } finally {
      setIsSettingPin(false);
    }
  };

  const handleBulkCreateRoleUsers = async () => {
    if (!canManageUsers) {
      toast.error('هذه الصفحة للمشرفين فقط');
      return;
    }

    setIsCreatingBulk(true);
    setBulkResults(null);

    try {
      const bulkRes = await fetch('/api/admin/users/bulk-create-role-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '123456' }),
      });
      const { data, error } = await bulkRes.json();

      if (error) {
        throw new Error(error.message);
      }

      setBulkResults(data);
      setShowBulkResultsDialog(true);
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.success(`تم إنشاء ${data?.summary?.created || 0} مستخدم جديد`);
    } catch (error: any) {
      console.error('Error creating bulk users:', error);
      toast.error('حدث خطأ أثناء إنشاء المستخدمين');
    } finally {
      setIsCreatingBulk(false);
    }
  };

  // Add custom role mutation
  const addCustomRoleMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      const res = await fetch(`/api/users/${userId}/custom-roles`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: roleId, enabled: true }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'فشل إضافة الدور');
    },
    onMutate: ({ userId, roleId }) => {
      const roleName = customRoles?.find((r) => r.id === roleId)?.role_name || '';
      setSelectedUser((prev) => {
        if (!prev || prev.user_id !== userId) return prev;
        if (prev.customRoles.some((cr) => cr.role_id === roleId)) return prev;
        return {
          ...prev,
          customRoles: [...prev.customRoles, { id: crypto.randomUUID(), role_id: roleId, role_name: roleName }],
        };
      });
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      queryClient.invalidateQueries({ queryKey: ['user-screen-permissions', userId] });
      queryClient.invalidateQueries({ queryKey: ['is-admin', userId] });
      toast.success('تم إضافة الدور بنجاح');
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.error('فشل إضافة الدور: ' + error.message);
    },
  });

  // Remove custom role mutation
  const removeCustomRoleMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      const res = await fetch(`/api/users/${userId}/custom-roles`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: roleId, enabled: false }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'فشل إزالة الدور');
    },
    onMutate: ({ userId, roleId }) => {
      setSelectedUser((prev) => {
        if (!prev || prev.user_id !== userId) return prev;
        return {
          ...prev,
          customRoles: prev.customRoles.filter((cr) => cr.role_id !== roleId),
        };
      });
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      queryClient.invalidateQueries({ queryKey: ['user-screen-permissions', userId] });
      queryClient.invalidateQueries({ queryKey: ['is-admin', userId] });
      toast.success('تم إزالة الدور بنجاح');
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.error('فشل إزالة الدور: ' + error.message);
    },
  });

  // Toggle user active status mutation
  const toggleUserActiveMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const res = await fetch(`/api/users/${userId}/active`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'فشل تحديث الحالة');
    },
    onSuccess: (_, { isActive }) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.success(isActive ? 'تم تفعيل الحساب بنجاح' : 'تم تعطيل الحساب بنجاح');
    },
    onError: (error: Error) => {
      toast.error('فشل تحديث حالة الحساب: ' + error.message);
    },
  });

  // Add branch mutation
  const addBranchMutation = useMutation({
    mutationFn: async ({ userId, branchId, isPrimary }: { userId: string; branchId: string; isPrimary?: boolean }) => {
      const res = await fetch(`/api/users/${userId}/branches`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId, enabled: true, is_primary: isPrimary || false }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'فشل إضافة الفرع');
    },
    onMutate: ({ userId, branchId, isPrimary }) => {
      const branchName = branches?.find((b) => b.id === branchId)?.branch_name || '';
      setSelectedUser((prev) => {
        if (!prev || prev.user_id !== userId) return prev;
        if (prev.branches.some((ub) => ub.branch_id === branchId)) return prev;
        return {
          ...prev,
          branches: [...prev.branches, { id: crypto.randomUUID(), branch_id: branchId, branch_name: branchName, is_primary: isPrimary || false }],
        };
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.success('تم إضافة الفرع بنجاح');
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.error('فشل إضافة الفرع: ' + error.message);
    },
  });

  // Remove branch mutation
  const removeBranchMutation = useMutation({
    mutationFn: async ({ userId, branchId }: { userId: string; branchId: string }) => {
      const res = await fetch(`/api/users/${userId}/branches`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId, enabled: false }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'فشل إزالة الفرع');
    },
    onMutate: ({ userId, branchId }) => {
      setSelectedUser((prev) => {
        if (!prev || prev.user_id !== userId) return prev;
        return {
          ...prev,
          branches: prev.branches.filter((ub) => ub.branch_id !== branchId),
        };
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.success('تم إزالة الفرع بنجاح');
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.error('فشل إزالة الفرع: ' + error.message);
    },
  });

  const setPrimaryBranchMutation = useMutation({
    mutationFn: async ({ userId, branchId }: { userId: string; branchId: string }) => {
      const res = await fetch('/api/users/set-primary-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user_id: userId, branch_id: branchId }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error.message || result.error);
    },
    onMutate: ({ userId, branchId }) => {
      setSelectedUser((prev) => {
        if (!prev || prev.user_id !== userId) return prev;
        return {
          ...prev,
          branches: prev.branches.map((ub) => ({
            ...ub,
            is_primary: ub.branch_id === branchId,
          })),
        };
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.success('تم تعيين الفرع الأساسي');
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-details'] });
      toast.error('فشل تعيين الفرع: ' + error.message);
    },
  });

  const openUserDialog = (user: UserWithDetails) => {
    setSelectedUser(user);
    // Initialize permissions state
    const perms: Record<string, Permission> = {};
    RESOURCES.forEach((r) => {
      const existing = user.permissions.find((p) => p.resource === r.key);
      perms[r.key] = existing || {
        id: '',
        resource: r.key,
        can_create: false,
        can_read: false,
        can_update: false,
        can_delete: false,
      };
    });
    setUserPermissions(perms);
    setUserMfaEnabled(user.mfa_enabled || false);
    setUserMfaMethod(user.mfa_method || 'email');
    setUserPhone(user.phone || '');
    setShowUserDialog(true);
  };

  const togglePermission = (resource: string, action: 'can_create' | 'can_read' | 'can_update' | 'can_delete') => {
    setUserPermissions((prev) => ({
      ...prev,
      [resource]: {
        ...prev[resource],
        [action]: !prev[resource][action],
      },
    }));
  };

  const setAllPermissions = (resource: string, value: boolean) => {
    setUserPermissions((prev) => ({
      ...prev,
      [resource]: {
        ...prev[resource],
        can_create: value,
        can_read: value,
        can_update: value,
        can_delete: value,
      },
    }));
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <Users className="w-7 h-7 text-gold" />
              إدارة مستخدمين النظام
            </h1>
            <p className="text-muted-foreground mt-1">إدارة الصلاحيات والمصادقة الثنائية</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={handleBulkCreateRoleUsers} 
              disabled={!canManageUsers || isCreatingBulk}
            >
              {isCreatingBulk && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              <Users className="w-4 h-4 ml-2" />
              إنشاء مستخدمين لجميع الأدوار
            </Button>
            <Button onClick={() => setShowCreateDialog(true)} disabled={!canManageUsers}>
              <UserPlus className="w-4 h-4 ml-2" />
              إنشاء مستخدم جديد
            </Button>
          </div>
        </div>

        {isAdminLoading ? (
          <Card>
            <CardContent className="p-6 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : !canManageUsers ? (
          <Card>
            <CardHeader>
              <CardTitle>صلاحيات غير كافية</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                هذه الصفحة متاحة للمشرفين فقط. إذا قمت بإنشاء مستخدم سابقاً وتغيّر حسابك تلقائياً، سجّل خروج ثم ادخل بحساب المشرف.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{users?.length || 0}</p>
                <p className="text-sm text-muted-foreground">إجمالي المستخدمين</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {users?.filter((u) => u.roles.includes('admin')).length || 0}
                </p>
                <p className="text-sm text-muted-foreground">المشرفين</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gold/10 flex items-center justify-center">
                <KeyRound className="w-6 h-6 text-gold" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {users?.filter((u) => u.mfa_enabled).length || 0}
                </p>
                <p className="text-sm text-muted-foreground">مفعل MFA</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Users Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5" />
              قائمة المستخدمين
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : users && users.length > 0 ? (
              <div className="responsive-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>اسم المستخدم</TableHead>
                    <TableHead>الاسم الكامل</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>تاريخ التسجيل</TableHead>
                    <TableHead>الأدوار</TableHead>
                    <TableHead>الفروع</TableHead>
                    <TableHead>MFA</TableHead>
                    <TableHead>PIN</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                {users.map((user) => (
                    <TableRow 
                      key={user.id}
                      className={!user.is_active ? "bg-destructive/5 opacity-60" : ""}
                    >
                      <TableCell className={`font-mono ${!user.is_active ? "line-through text-muted-foreground" : ""}`}>
                        <div className="flex items-center gap-2">
                          {!user.is_active && (
                            <AlertTriangle className="w-4 h-4 text-destructive" />
                          )}
                          {user.username || <span className="text-muted-foreground">-</span>}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {user.full_name || 'بدون اسم'}
                      </TableCell>
                      <TableCell>
                        {user.is_active ? (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            نشط
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-destructive border-destructive">
                            معطل
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.created_at
                          ? format(new Date(user.created_at), 'dd MMM yyyy', { locale: ar })
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(user.roles || []).length > 0 && (user.roles || []).map((role) => (
                            <Badge key={role} variant={role === 'admin' ? 'default' : 'secondary'}>
                              {roleLabels[role]}
                            </Badge>
                          ))}
                          {(user.customRoles || []).length > 0 && (user.customRoles || []).map((cr) => (
                            <Badge key={cr.id} variant="outline" className="border-primary text-primary">
                              {cr.role_name}
                            </Badge>
                          ))}
                          {(user.roles || []).length === 0 && (user.customRoles || []).length === 0 && (
                            <span className="text-muted-foreground text-sm">لا توجد أدوار</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(user.branches || []).length > 0 ? (
                            (user.branches || []).map((ub) => (
                              <Badge 
                                key={ub.id} 
                                variant={ub.is_primary ? "default" : "outline"}
                                className={ub.is_primary ? "" : "border-amber-500 text-amber-600"}
                              >
                                <Building2 className="w-3 h-3 ml-1" />
                                {ub.branch_name}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-sm">لا توجد فروع</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.mfa_enabled ? (
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              <KeyRound className="w-3 h-3 ml-1" />
                              {user.mfa_method === 'whatsapp' ? 'واتساب' : 'إيميل'}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">غير مفعل</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={user.has_pin ? 'outline' : 'destructive'}
                          className={user.has_pin ? 'text-green-600 border-green-600' : ''}
                          data-testid={`badge-pin-${user.user_id}`}
                        >
                          <Lock className="w-3 h-3 ml-1" />
                          {user.has_pin ? 'PIN' : 'بدون PIN'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openUserDialog(user)}
                          >
                            <Settings className="w-4 h-4 ml-1" />
                            إدارة
                          </Button>
                          {user.user_id !== currentUser?.id && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className={user.is_active 
                                  ? "text-orange-600 hover:text-orange-600 hover:bg-orange-50" 
                                  : "text-green-600 hover:text-green-600 hover:bg-green-50"
                                }
                                onClick={() => {
                                  const wantsActivate = !user.is_active;
                                  if (wantsActivate && !user.has_pin) {
                                    const hasPosRole = (user.customRoles || []).some(cr => {
                                      const matched = (customRoles || []).find(r => r.id === cr.role_id);
                                      return matched && PIN_REQUIRED_ROLE_KEYS.includes(matched.role_key);
                                    });
                                    if (hasPosRole) {
                                      toast.error('لا يمكن تفعيل مستخدم لديه دور بائع/مشرف بدون PIN. عيّن PIN أولاً.', {
                                        action: {
                                          label: 'تعيين PIN',
                                          onClick: () => {
                                            setSetPinUser(user);
                                            setPinValue('');
                                            setPinConfirm('');
                                            setShowSetPinDialog(true);
                                          },
                                        },
                                      });
                                      return;
                                    }
                                  }
                                  toggleUserActiveMutation.mutate({ userId: user.user_id, isActive: wantsActivate });
                                }}
                                disabled={toggleUserActiveMutation.isPending}
                              >
                                {user.is_active ? 'تعطيل' : 'تفعيل'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => {
                                  setUserToDelete(user);
                                  setShowDeleteDialog(true);
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                              <Button
                                data-testid={`button-reset-password-${user.user_id}`}
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setResetPasswordUser(user);
                                  setResetNewPassword('');
                                  setResetConfirmPassword('');
                                  setShowResetPassword(false);
                                  setShowResetPasswordDialog(true);
                                }}
                              >
                                <KeyRound className="w-4 h-4 ml-1" />
                                كلمة المرور
                              </Button>
                              <Button
                                data-testid={`button-set-pin-${user.user_id}`}
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSetPinUser(user);
                                  setPinValue('');
                                  setPinConfirm('');
                                  setShowSetPinDialog(true);
                                }}
                              >
                                <Lock className="w-4 h-4 ml-1" />
                                تعيين PIN
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                لا يوجد مستخدمين
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-gold" />
              إنشاء مستخدم جديد
            </DialogTitle>
            <DialogDescription>
              أدخل بيانات المستخدم الجديد
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>اسم المستخدم <span className="text-destructive">*</span></Label>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                placeholder="username"
                dir="ltr"
                className="text-left"
              />
              <p className="text-xs text-muted-foreground">سيستخدم لتسجيل الدخول</p>
            </div>

            <div className="space-y-2">
              <Label>الاسم الكامل <span className="text-destructive">*</span></Label>
              <Input
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="أحمد محمد"
              />
            </div>

            <div className="space-y-2">
              <Label>البريد الإلكتروني <span className="text-muted-foreground text-xs">(اختياري)</span></Label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="user@example.com"
                dir="ltr"
                className="text-left"
              />
            </div>

            <div className="space-y-2">
              <Label>كلمة المرور <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  className="text-left pl-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">6 أحرف على الأقل</p>
            </div>

            <div className="space-y-2">
              <Label>الدور المخصص</Label>
              <Select 
                value={newCustomRoleId || "__none__"} 
                onValueChange={(v) => setNewCustomRoleId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر دور (اختياري)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      بدون دور
                    </div>
                  </SelectItem>
                  {customRoles?.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      <div className="flex items-center gap-2">
                        <BadgeCheck className="w-4 h-4" />
                        {role.role_name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">يمكنك إضافة أدوار أخرى بعد الإنشاء</p>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              إلغاء
            </Button>
            <Button onClick={handleCreateUser} disabled={isCreating}>
              {isCreating ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 ml-2" />
              )}
              إنشاء المستخدم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Management Dialog */}
      <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5" />
              إدارة المستخدم: {selectedUser?.full_name || selectedUser?.username || 'بدون اسم'}
            </DialogTitle>
            <DialogDescription>
              تعديل الأدوار والصلاحيات التفصيلية وإعدادات المصادقة الثنائية لهذا المستخدم.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="customRoles">
                <BadgeCheck className="w-4 h-4 ml-2" />
                الأدوار المخصصة
              </TabsTrigger>
              <TabsTrigger value="branches">
                <Building2 className="w-4 h-4 ml-2" />
                الفروع
              </TabsTrigger>
              <TabsTrigger value="mfa">
                <KeyRound className="w-4 h-4 ml-2" />
                MFA
              </TabsTrigger>
            </TabsList>

            {/* Custom Roles Tab */}
            <TabsContent value="customRoles" className="space-y-4 mt-4">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">اختر الأدوار المخصصة للمستخدم (تحدد صلاحيات الشاشات):</p>
                
                {customRoles && customRoles.length > 0 ? (
                  <div className="grid gap-3">
                    {customRoles.map((role) => {
                      const hasRole = selectedUser?.customRoles.some((cr) => cr.role_id === role.id);
                      return (
                        <div
                          key={role.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <BadgeCheck className={`w-5 h-5 ${hasRole ? 'text-primary' : 'text-muted-foreground'}`} />
                            <div>
                              <p className="font-medium">{role.role_name}</p>
                              {role.description && (
                                <p className="text-sm text-muted-foreground">{role.description}</p>
                              )}
                            </div>
                          </div>
                          <Switch
                            checked={hasRole}
                            disabled={!canManageUsers || addCustomRoleMutation.isPending || removeCustomRoleMutation.isPending}
                            onCheckedChange={(checked) => {
                              if (!canManageUsers) {
                                toast.error('فقط المشرف يمكنه تعديل الأدوار');
                                return;
                              }
                              if (selectedUser) {
                                if (checked && PIN_REQUIRED_ROLE_KEYS.includes(role.role_key) && !selectedUser.has_pin) {
                                  toast.error('لا يمكن تعيين دور بائع/مشرف بدون PIN. عيّن PIN أولاً.', {
                                    action: {
                                      label: 'تعيين PIN',
                                      onClick: () => {
                                        setSetPinUser(selectedUser);
                                        setPinValue('');
                                        setPinConfirm('');
                                        setShowSetPinDialog(true);
                                      },
                                    },
                                  });
                                  return;
                                }
                                if (checked) {
                                  addCustomRoleMutation.mutate({ userId: selectedUser.user_id, roleId: role.id });
                                } else {
                                  removeCustomRoleMutation.mutate({ userId: selectedUser.user_id, roleId: role.id });
                                }
                              }
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    لا توجد أدوار مخصصة. يمكنك إنشاؤها من صفحة الأدوار والصلاحيات.
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Branches Tab */}
            <TabsContent value="branches" className="space-y-4 mt-4">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">اختر الفروع التي يمكن للمستخدم الوصول إليها:</p>
                
                {branches && branches.length > 0 ? (
                  <div className="grid gap-3">
                    {branches.map((branch) => {
                      const userBranch = selectedUser?.branches.find((ub) => ub.branch_id === branch.id);
                      const hasBranch = !!userBranch;
                      const isPrimary = userBranch?.is_primary || false;
                      
                      return (
                        <div
                          key={branch.id}
                          className={`flex items-center justify-between p-3 border rounded-lg ${isPrimary ? 'border-primary bg-primary/5' : ''}`}
                        >
                          <div className="flex items-center gap-3">
                            <Building2 className={`w-5 h-5 ${hasBranch ? 'text-primary' : 'text-muted-foreground'}`} />
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{branch.branch_name}</p>
                                {isPrimary && (
                                  <Badge variant="default" className="text-xs">الفرع الأساسي</Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">كود: {branch.branch_code}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasBranch && !isPrimary && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (selectedUser) {
                                    setPrimaryBranchMutation.mutate({ 
                                      userId: selectedUser.user_id, 
                                      branchId: branch.id 
                                    });
                                  }
                                }}
                                disabled={setPrimaryBranchMutation.isPending}
                              >
                                تعيين أساسي
                              </Button>
                            )}
                            <Switch
                              checked={hasBranch}
                              disabled={!canManageUsers || addBranchMutation.isPending || removeBranchMutation.isPending}
                              onCheckedChange={(checked) => {
                                if (!canManageUsers) {
                                  toast.error('فقط المشرف يمكنه تعديل الفروع');
                                  return;
                                }
                                if (selectedUser) {
                                  if (checked) {
                                    // If this is the first branch, make it primary
                                    const isFirst = selectedUser.branches.length === 0;
                                    addBranchMutation.mutate({ 
                                      userId: selectedUser.user_id, 
                                      branchId: branch.id,
                                      isPrimary: isFirst
                                    });
                                  } else {
                                    removeBranchMutation.mutate({ userId: selectedUser.user_id, branchId: branch.id });
                                  }
                                }
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    لا توجد فروع. يمكنك إنشاؤها من صفحة إدارة الفروع.
                  </div>
                )}
              </div>
            </TabsContent>


            {/* MFA Tab */}
            <TabsContent value="mfa" className="space-y-4 mt-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <KeyRound className="w-5 h-5 text-primary" />
                  <div>
                    <p className="font-medium">تفعيل المصادقة الثنائية</p>
                    <p className="text-sm text-muted-foreground">
                      إرسال رمز تحقق عند تسجيل الدخول
                    </p>
                  </div>
                </div>
                <Switch
                  checked={userMfaEnabled}
                  onCheckedChange={setUserMfaEnabled}
                />
              </div>

              {userMfaEnabled && (
                <div className="space-y-4">
                  <div>
                    <Label>طريقة الإرسال</Label>
                    <Select value={userMfaMethod} onValueChange={setUserMfaMethod}>
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            البريد الإلكتروني
                          </div>
                        </SelectItem>
                        <SelectItem value="whatsapp">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4" />
                            واتساب
                          </div>
                        </SelectItem>
                        <SelectItem value="none">
                          <div className="flex items-center gap-2">
                            إلغاء المصادقة الثنائية
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {userMfaMethod === 'whatsapp' && (
                    <div>
                      <Label>رقم الهاتف (مع كود الدولة)</Label>
                      <Input
                        value={userPhone}
                        onChange={(e) => setUserPhone(e.target.value)}
                        placeholder="+966501234567"
                        className="mt-2"
                        dir="ltr"
                      />
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={() => {
                  if (selectedUser) {
                    saveMfaMutation.mutate({
                      userId: selectedUser.user_id,
                      mfaEnabled: userMfaEnabled && userMfaMethod !== 'none',
                      mfaMethod: userMfaMethod === 'none' ? '' : userMfaMethod,
                      phone: userPhone,
                    });
                  }
                }}
                disabled={saveMfaMutation.isPending}
              >
                {saveMfaMutation.isPending ? (
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 ml-2" />
                )}
                حفظ الإعدادات
              </Button>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserDialog(false)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              حذف المستخدم
            </DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف المستخدم "{userToDelete?.full_name || userToDelete?.username}"؟
              <br />
              <span className="text-destructive font-medium">هذا الإجراء لا يمكن التراجع عنه.</span>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setUserToDelete(null);
              }}
            >
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 ml-2" />
              )}
              حذف المستخدم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showResetPasswordDialog} onOpenChange={(open) => {
        if (!open) {
          setShowResetPasswordDialog(false);
          setResetPasswordUser(null);
          setResetNewPassword('');
          setResetConfirmPassword('');
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5" />
              إعادة تعيين كلمة المرور
            </DialogTitle>
            <DialogDescription>
              إعادة تعيين كلمة المرور للمستخدم "{resetPasswordUser?.full_name || resetPasswordUser?.username}"
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>كلمة المرور الجديدة <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input
                  data-testid="input-reset-new-password"
                  type={showResetPassword ? 'text' : 'password'}
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  className="text-left pl-10"
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
              {resetNewPassword.length > 0 && resetNewPassword.length < 8 && (
                <p className="text-sm text-destructive">كلمة المرور يجب أن تكون 8 أحرف على الأقل</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>تأكيد كلمة المرور <span className="text-destructive">*</span></Label>
              <Input
                data-testid="input-reset-confirm-password"
                type={showResetPassword ? 'text' : 'password'}
                value={resetConfirmPassword}
                onChange={(e) => setResetConfirmPassword(e.target.value)}
                placeholder="••••••••"
                dir="ltr"
                className="text-left"
              />
              {resetConfirmPassword.length > 0 && resetNewPassword !== resetConfirmPassword && (
                <p className="text-sm text-destructive">كلمتا المرور غير متطابقتين</p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowResetPasswordDialog(false);
                setResetPasswordUser(null);
                setResetNewPassword('');
                setResetConfirmPassword('');
              }}
            >
              إلغاء
            </Button>
            <Button
              data-testid="button-submit-reset-password"
              onClick={handleResetPassword}
              disabled={isResettingPassword || resetNewPassword.length < 8 || resetNewPassword !== resetConfirmPassword}
            >
              {isResettingPassword ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <KeyRound className="w-4 h-4 ml-2" />
              )}
              إعادة تعيين
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSetPinDialog} onOpenChange={(open) => {
        if (!open) {
          setShowSetPinDialog(false);
          setSetPinUser(null);
          setPinValue('');
          setPinConfirm('');
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              تعيين PIN
            </DialogTitle>
            <DialogDescription>
              تعيين رمز PIN للمستخدم "{setPinUser?.full_name || setPinUser?.username}"
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>رمز PIN <span className="text-destructive">*</span></Label>
              <Input
                data-testid="input-set-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="____"
                dir="ltr"
                className="text-center text-lg tracking-[0.5em]"
              />
              {pinValue.length > 0 && !/^\d{4}$/.test(pinValue) && (
                <p className="text-sm text-destructive">PIN يجب أن يكون 4 أرقام</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>تأكيد PIN <span className="text-destructive">*</span></Label>
              <Input
                data-testid="input-confirm-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="____"
                dir="ltr"
                className="text-center text-lg tracking-[0.5em]"
              />
              {pinConfirm.length > 0 && pinValue !== pinConfirm && (
                <p className="text-sm text-destructive">PIN غير متطابق</p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button
              data-testid="button-cancel-set-pin"
              variant="outline"
              onClick={() => {
                setShowSetPinDialog(false);
                setSetPinUser(null);
                setPinValue('');
                setPinConfirm('');
              }}
            >
              إلغاء
            </Button>
            <Button
              data-testid="button-submit-set-pin"
              onClick={handleSetPin}
              disabled={isSettingPin || !/^\d{4}$/.test(pinValue) || pinValue !== pinConfirm}
            >
              {isSettingPin ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <Lock className="w-4 h-4 ml-2" />
              )}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Create Results Dialog */}
      <Dialog open={showBulkResultsDialog} onOpenChange={setShowBulkResultsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              نتائج إنشاء المستخدمين
            </DialogTitle>
            <DialogDescription>
              كلمة المرور لجميع المستخدمين: <code className="bg-muted px-2 py-1 rounded">123456</code>
            </DialogDescription>
          </DialogHeader>
          {bulkResults && (
            <div className="space-y-4 overflow-auto flex-1">
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{bulkResults.summary?.created || 0}</p>
                    <p className="text-sm text-muted-foreground">تم إنشاؤهم</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-amber-600">{bulkResults.summary?.skipped || 0}</p>
                    <p className="text-sm text-muted-foreground">موجودون مسبقاً</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{bulkResults.summary?.errors || 0}</p>
                    <p className="text-sm text-muted-foreground">فشل</p>
                  </CardContent>
                </Card>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الدور</TableHead>
                    <TableHead>اسم المستخدم</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bulkResults.results?.map((result: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{result.role}</TableCell>
                      <TableCell className="font-mono text-sm">{result.username}</TableCell>
                      <TableCell>
                        <Badge className={
                          result.status === 'created' ? 'bg-green-500/20 text-green-600' :
                          result.status === 'skipped' ? 'bg-amber-500/20 text-amber-600' :
                          'bg-red-500/20 text-red-600'
                        }>
                          {result.status === 'created' ? 'تم الإنشاء' :
                           result.status === 'skipped' ? 'موجود' : 'فشل'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowBulkResultsDialog(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
