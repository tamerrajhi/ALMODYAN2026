import { ReactNode } from 'react';
import { useModules } from '@/core/contexts/ModuleContext';
import { Loader2, AlertCircle, Lock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

interface ModuleAwareRouteProps {
  children: ReactNode;
  moduleId: string;
}

// Mapping of routes to module IDs
const routeToModuleMap: Record<string, string> = {
  // Dashboard
  '/': 'dashboard',
  '/dashboard-settings': 'dashboard',
  
  // Sales
  '/pos': 'sales',
  '/pos/invoices': 'sales',
  '/pos/returns': 'sales',
  '/returns': 'sales',
  '/customers': 'sales',
  
  // Purchases
  '/import': 'purchases',
  '/batches': 'purchases',
  '/suppliers': 'purchases',
  '/purchasing/requisitions': 'purchases',
  '/purchasing/orders': 'purchases',
  
  // Inventory
  '/transfers': 'inventory',
  '/transfer-requests': 'inventory',
  '/item-history': 'inventory',
  '/raw-materials': 'inventory',
  '/inventory-counts': 'inventory',
  
  // Production
  '/production/wip': 'production',
  '/production/planning': 'production',
  '/production/loss-report': 'production',
  '/finished-goods/factory': 'production',
  '/finished-goods/showroom': 'production',
  '/gemstones': 'production',
  '/gemstones/link': 'production',
  
  // Accounting
  '/accounting': 'accounting',
  '/accounting/chart-of-accounts': 'accounting',
  '/accounting/journal-entries': 'accounting',
  '/accounting/invoices': 'accounting',
  '/accounting/payments': 'accounting',
  '/accounting/financial-reports': 'accounting',
  '/accounting/account-ledger': 'accounting',
  
  // Vaults
  '/gold/karats': 'vaults',
  '/gold/prices': 'vaults',
  '/gold/scrap': 'vaults',
  '/gold/vault': 'vaults',
  '/cash-vault': 'vaults',
  '/vaults/settlements': 'vaults',
  
  // HR
  '/hr/employees': 'hr',
  '/hr/payroll': 'hr',
  '/hr/attendance': 'hr',
  '/hr/leaves': 'hr',
  
  // Reports
  '/reports': 'reports',
  '/audit-logs': 'reports',
  
  // Settings
  '/settings': 'settings',
  '/settings/modules': 'settings',
  '/users': 'settings',
  '/roles': 'settings',
  '/branches': 'settings',
  '/backup': 'settings',
};

// Get module ID from route path
export function getModuleIdFromPath(pathname: string): string | null {
  // Direct match
  if (routeToModuleMap[pathname]) {
    return routeToModuleMap[pathname];
  }
  
  // Check for partial matches (for routes with params like /batches/:id)
  for (const [route, moduleId] of Object.entries(routeToModuleMap)) {
    if (pathname.startsWith(route) && route !== '/') {
      return moduleId;
    }
  }
  
  return null;
}

export default function ModuleAwareRoute({ children, moduleId }: ModuleAwareRouteProps) {
  const { isLoading, isModuleEnabled, userHasModuleAccess } = useModules();
  const { isRTL } = useLanguage();

  // Show loading while modules are being loaded
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  // Check if module is enabled globally
  if (!isModuleEnabled(moduleId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{isRTL ? 'الموديول غير مفعّل' : 'Module Disabled'}</AlertTitle>
            <AlertDescription>
              {isRTL 
                ? 'هذه الصفحة تابعة لموديول معطّل حالياً. يرجى التواصل مع مدير النظام لتفعيله.'
                : 'This page belongs to a currently disabled module. Please contact the system administrator to enable it.'}
            </AlertDescription>
          </Alert>
          <Button 
            variant="outline" 
            className="w-full"
            onClick={() => window.history.back()}
          >
            {isRTL ? 'العودة' : 'Go Back'}
          </Button>
          <Button 
            className="w-full"
            onClick={() => window.location.href = '/'}
          >
            {isRTL ? 'الذهاب للوحة التحكم' : 'Go to Dashboard'}
          </Button>
        </div>
      </div>
    );
  }

  // Check if user has access to this module
  if (!userHasModuleAccess(moduleId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full space-y-4">
          <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
            <Lock className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-700 dark:text-amber-400">
              {isRTL ? 'غير مصرح بالوصول' : 'Access Denied'}
            </AlertTitle>
            <AlertDescription className="text-amber-600 dark:text-amber-300">
              {isRTL 
                ? 'ليس لديك صلاحية الوصول لهذا الموديول. يرجى التواصل مع مدير النظام لمنحك الصلاحيات المطلوبة.'
                : 'You do not have permission to access this module. Please contact the system administrator to grant you the required permissions.'}
            </AlertDescription>
          </Alert>
          <Button 
            variant="outline" 
            className="w-full"
            onClick={() => window.history.back()}
          >
            {isRTL ? 'العودة' : 'Go Back'}
          </Button>
          <Button 
            className="w-full"
            onClick={() => window.location.href = '/'}
          >
            {isRTL ? 'الذهاب للوحة التحكم' : 'Go to Dashboard'}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
