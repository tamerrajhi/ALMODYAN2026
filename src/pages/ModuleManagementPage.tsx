import { useState, useEffect } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useModules } from '@/core/contexts/ModuleContext';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { toast } from '@/hooks/use-toast';
import { 
  Boxes, 
  RefreshCcw, 
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Package,
  ShoppingCart,
  Factory,
  Calculator,
  Users,
  Vault,
  BarChart3,
  Settings,
  LayoutDashboard,
  ShoppingBag,
  Shield,
  Save,
  Settings2
} from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from '@/components/ui/checkbox';
import { ModuleSettingsDialog } from '@/components/modules/ModuleSettingsDialog';

const moduleIcons: Record<string, any> = {
  dashboard: LayoutDashboard,
  sales: ShoppingCart,
  purchases: ShoppingBag,
  inventory: Package,
  production: Factory,
  accounting: Calculator,
  vaults: Vault,
  hr: Users,
  reports: BarChart3,
  settings: Settings,
};

interface CustomRole {
  id: string;
  role_name: string;
  role_name_en: string | null;
  description: string | null;
  is_active: boolean;
}

interface RoleModule {
  id: string;
  role_id: string;
  module_id: string;
  is_enabled: boolean;
}

export default function ModuleManagementPage() {
  const { t, isRTL, language } = useLanguage();
  const { allModules, isLoading: modulesLoading, toggleModule, refresh } = useModules();
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    moduleId: string;
    moduleName: string;
    action: 'enable' | 'disable';
    dependents?: string[];
  }>({ open: false, moduleId: '', moduleName: '', action: 'enable' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('modules');
  
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [roleModules, setRoleModules] = useState<RoleModule[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [savingRoleModules, setSavingRoleModules] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Map<string, boolean>>(new Map());

  const [settingsDialog, setSettingsDialog] = useState<{
    open: boolean;
    moduleId: string;
    moduleName: { ar: string; en: string };
  }>({ open: false, moduleId: '', moduleName: { ar: '', en: '' } });

  useEffect(() => {
    loadRolesAndModules();
  }, []);

  const loadRolesAndModules = async () => {
    setLoadingRoles(true);
    try {
      const rolesRes = await fetch('/api/custom-roles', { credentials: 'include' });
      const rolesData: CustomRole[] = (!rolesRes.ok && rolesRes.status === 501) ? [] : await rolesRes.json();
      setRoles(rolesData || []);

      const rmRes = await fetch('/api/role-modules-list', { credentials: 'include' });
      const roleModulesData: RoleModule[] = (!rmRes.ok && rmRes.status === 501) ? [] : await rmRes.json();
      setRoleModules(roleModulesData || []);
    } catch (error) {
      console.error('Error loading roles:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في تحميل الأدوار',
        variant: 'destructive',
      });
    } finally {
      setLoadingRoles(false);
    }
  };

  const isRoleModuleEnabled = (roleId: string, moduleId: string): boolean => {
    const key = `${roleId}-${moduleId}`;
    if (pendingChanges.has(key)) {
      return pendingChanges.get(key)!;
    }
    const rm = roleModules.find(rm => rm.role_id === roleId && rm.module_id === moduleId);
    return rm?.is_enabled ?? true;
  };

  const toggleRoleModule = (roleId: string, moduleId: string, currentValue: boolean) => {
    const key = `${roleId}-${moduleId}`;
    setPendingChanges(prev => {
      const newMap = new Map(prev);
      newMap.set(key, !currentValue);
      return newMap;
    });
  };

  const saveRoleModuleChanges = async () => {
    if (pendingChanges.size === 0) return;

    setSavingRoleModules(true);
    try {
      const updates: { role_id: string; module_id: string; is_enabled: boolean }[] = [];
      
      pendingChanges.forEach((isEnabled, key) => {
        const [roleId, moduleId] = key.split('-');
        updates.push({ role_id: roleId, module_id: moduleId, is_enabled: isEnabled });
      });

      for (const update of updates) {
        const existing = roleModules.find(
          rm => rm.role_id === update.role_id && rm.module_id === update.module_id
        );

        if (existing) {
          forbidDirectWrite('update', 'ModuleManagementPage.tsx:186');
        } else {
          forbidDirectWrite('insert', 'ModuleManagementPage.tsx:192');
        }
      }

      toast({
        title: 'تم الحفظ',
        description: 'تم حفظ تغييرات صلاحيات الموديولات',
      });

      await loadRolesAndModules();
      setPendingChanges(new Map());
      await refresh();
    } catch (error) {
      console.error('Error saving role modules:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في حفظ التغييرات',
        variant: 'destructive',
      });
    } finally {
      setSavingRoleModules(false);
    }
  };

  const handleToggleModule = async (moduleId: string, currentEnabled: boolean) => {
    const module = allModules.find(m => m.id === moduleId);
    if (!module) return;

    const moduleName = language === 'ar' ? module.name.ar : module.name.en;

    if (currentEnabled) {
      const dependents = allModules.filter(m => 
        m.enabled && m.dependencies.includes(moduleId)
      );
      
      if (dependents.length > 0) {
        setConfirmDialog({
          open: true,
          moduleId,
          moduleName,
          action: 'disable',
          dependents: dependents.map(d => language === 'ar' ? d.name.ar : d.name.en)
        });
        return;
      }
    }

    await executeToggle(moduleId, !currentEnabled, moduleName);
  };

  const executeToggle = async (moduleId: string, enabled: boolean, moduleName: string) => {
    setIsProcessing(true);
    try {
      const success = await toggleModule(moduleId, enabled);
      if (success) {
        toast({
          title: enabled ? 'تم تفعيل الموديول' : 'تم تعطيل الموديول',
          description: `${moduleName} ${enabled ? 'مفعّل الآن' : 'معطّل الآن'}`,
        });
      } else {
        toast({
          title: 'خطأ',
          description: 'فشل في تحديث حالة الموديول',
          variant: 'destructive',
        });
      }
    } finally {
      setIsProcessing(false);
      setConfirmDialog({ open: false, moduleId: '', moduleName: '', action: 'enable' });
    }
  };

  const handleConfirmDisable = async () => {
    await executeToggle(confirmDialog.moduleId, false, confirmDialog.moduleName);
  };

  const handleRefresh = async () => {
    await refresh();
    await loadRolesAndModules();
    toast({
      title: 'تم التحديث',
      description: 'تم تحديث إعدادات الموديولات',
    });
  };

  const enabledCount = allModules.filter(m => m.enabled).length;
  const disabledCount = allModules.length - enabledCount;

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Boxes className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">إدارة الموديولات</h1>
              <p className="text-muted-foreground text-sm">تفعيل وتعطيل موديولات النظام وربطها بالصلاحيات</p>
            </div>
          </div>
          <div className="flex gap-2">
            {pendingChanges.size > 0 && (
              <Button onClick={saveRoleModuleChanges} disabled={savingRoleModules}>
                {savingRoleModules ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                ) : (
                  <Save className="w-4 h-4 ml-2" />
                )}
                حفظ التغييرات ({pendingChanges.size})
              </Button>
            )}
            <Button variant="outline" onClick={handleRefresh} disabled={modulesLoading || loadingRoles}>
              <RefreshCcw className={`w-4 h-4 ${isRTL ? 'ml-2' : 'mr-2'} ${modulesLoading || loadingRoles ? 'animate-spin' : ''}`} />
              تحديث
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي الموديولات</p>
                  <p className="text-2xl font-bold">{allModules.length}</p>
                </div>
                <Boxes className="w-8 h-8 text-muted-foreground/20" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">مفعّلة</p>
                  <p className="text-2xl font-bold text-green-600">{enabledCount}</p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-500/20" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">معطّلة</p>
                  <p className="text-2xl font-bold text-orange-600">{disabledCount}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-orange-500/20" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">الأدوار</p>
                  <p className="text-2xl font-bold">{roles.length}</p>
                </div>
                <Shield className="w-8 h-8 text-blue-500/20" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="modules" className="gap-2">
              <Boxes className="w-4 h-4" />
              الموديولات
            </TabsTrigger>
            <TabsTrigger value="role-permissions" className="gap-2">
              <Shield className="w-4 h-4" />
              صلاحيات الأدوار
            </TabsTrigger>
          </TabsList>

          {/* Modules Tab */}
          <TabsContent value="modules" className="space-y-4">
            {/* Info Alert */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>ملاحظة هامة</AlertTitle>
              <AlertDescription>
                تعطيل موديول سيخفي جميع الشاشات والوظائف المرتبطة به من القائمة الجانبية. 
                الموديولات الأساسية (لوحة التحكم، الإعدادات) لا يمكن تعطيلها.
              </AlertDescription>
            </Alert>

            {/* Modules Grid */}
            {modulesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {allModules.map(module => {
                  const IconComponent = moduleIcons[module.id] || Boxes;
                  const isCore = ['dashboard', 'settings'].includes(module.id);
                  const hasDependents = allModules.some(m => 
                    m.enabled && m.id !== module.id && m.dependencies.includes(module.id)
                  );
                  
                  return (
                    <Card 
                      key={module.id}
                      className={`transition-all ${!module.enabled ? 'opacity-60' : ''}`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              module.enabled 
                                ? 'bg-primary/10 text-primary' 
                                : 'bg-muted text-muted-foreground'
                            }`}>
                              <IconComponent className="w-5 h-5" />
                            </div>
                            <div>
                              <CardTitle className="text-base">
                                {language === 'ar' ? module.name.ar : module.name.en}
                              </CardTitle>
                              <CardDescription className="text-xs">
                                v{module.version}
                              </CardDescription>
                            </div>
                          </div>
                          <Switch
                            checked={module.enabled}
                            onCheckedChange={() => handleToggleModule(module.id, module.enabled)}
                            disabled={isCore || isProcessing}
                          />
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-3">
                          {language === 'ar' ? module.description?.ar : module.description?.en}
                        </p>
                        
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={module.enabled ? 'default' : 'secondary'}>
                            {module.enabled ? 'مفعّل' : 'معطّل'}
                          </Badge>
                          {isCore && (
                            <Badge variant="outline">أساسي</Badge>
                          )}
                          {module.dependencies.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              يعتمد على: {module.dependencies.join(', ')}
                            </Badge>
                          )}
                          {hasDependents && module.enabled && (
                            <Badge variant="outline" className="text-xs text-amber-600">
                              موديولات أخرى تعتمد عليه
                            </Badge>
                          )}
                        </div>
                        
                        <div className="mt-3 flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">
                            <span>{module.routes.length} شاشة</span>
                            <span className="mx-2">•</span>
                            <span>{module.permissions.length} صلاحية</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSettingsDialog({
                              open: true,
                              moduleId: module.id,
                              moduleName: module.name
                            })}
                            className="h-8 px-2 text-muted-foreground hover:text-foreground"
                          >
                            <Settings2 className="w-4 h-4 ml-1" />
                            إعدادات
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Role Permissions Tab */}
          <TabsContent value="role-permissions" className="space-y-4">
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertTitle>إدارة صلاحيات الأدوار على الموديولات</AlertTitle>
              <AlertDescription>
                حدد الموديولات المتاحة لكل دور. المستخدمون سيرون فقط الموديولات المصرح لهم بها حسب دورهم.
              </AlertDescription>
            </Alert>

            {loadingRoles ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : roles.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Shield className="w-12 h-12 mx-auto text-muted-foreground/20 mb-4" />
                  <p className="text-muted-foreground">لا توجد أدوار مخصصة حالياً</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    قم بإنشاء أدوار من صفحة إدارة الأدوار أولاً
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right sticky right-0 bg-background">الدور</TableHead>
                          {allModules.filter(m => m.enabled).map(module => (
                            <TableHead key={module.id} className="text-center min-w-[100px]">
                              <div className="flex flex-col items-center gap-1">
                                {(() => {
                                  const Icon = moduleIcons[module.id] || Boxes;
                                  return <Icon className="w-4 h-4" />;
                                })()}
                                <span className="text-xs">
                                  {language === 'ar' ? module.name.ar : module.name.en}
                                </span>
                              </div>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {roles.map(role => (
                          <TableRow key={role.id}>
                            <TableCell className="font-medium sticky right-0 bg-background">
                              <div>
                                <p>{role.role_name}</p>
                                {role.role_name_en && (
                                  <p className="text-xs text-muted-foreground">{role.role_name_en}</p>
                                )}
                              </div>
                            </TableCell>
                            {allModules.filter(m => m.enabled).map(module => {
                              const isCore = ['dashboard', 'settings'].includes(module.id);
                              const isEnabled = isRoleModuleEnabled(role.id, module.id);
                              
                              return (
                                <TableCell key={module.id} className="text-center">
                                  <Checkbox
                                    checked={isCore || isEnabled}
                                    onCheckedChange={() => {
                                      if (!isCore) {
                                        toggleRoleModule(role.id, module.id, isEnabled);
                                      }
                                    }}
                                    disabled={isCore}
                                    className={isCore ? 'opacity-50 cursor-not-allowed' : ''}
                                  />
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Confirm Disable Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog(prev => ({ ...prev, open: false }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-amber-600 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              تحذير - تعطيل الموديول
            </DialogTitle>
            <DialogDescription>
              <div className="space-y-3 text-right">
                <p>
                  أنت على وشك تعطيل موديول <strong>{confirmDialog.moduleName}</strong>.
                </p>
                {confirmDialog.dependents && confirmDialog.dependents.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>موديولات تعتمد على هذا الموديول</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc list-inside mt-2">
                        {confirmDialog.dependents.map((dep, i) => (
                          <li key={i}>{dep}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}>
              إلغاء
            </Button>
            <Button variant="destructive" onClick={handleConfirmDisable}>
              تعطيل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Module Settings Dialog */}
      <ModuleSettingsDialog
        open={settingsDialog.open}
        onOpenChange={(open) => setSettingsDialog(prev => ({ ...prev, open }))}
        moduleId={settingsDialog.moduleId}
        moduleName={settingsDialog.moduleName}
      />
    </MainLayout>
  );
}
