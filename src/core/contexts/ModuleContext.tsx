import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { moduleRegistry } from '@/shared/registry/ModuleRegistry';
import { registerAllModules } from '@/modules';
import { ModuleConfig } from '@/core/types/module.types';
import { useAuth } from '@/contexts/AuthContext';

interface ScreenPermission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

interface AccessContextData {
  user_id: string;
  is_admin: boolean;
  roles: string[];
  modules: string[];
  screen_permissions: Record<string, ScreenPermission>;
}

interface ModuleContextType {
  isLoading: boolean;
  isInitialized: boolean;
  enabledModules: ModuleConfig[];
  allModules: ModuleConfig[];
  userAccessibleModules: string[];
  isModuleEnabled: (moduleId: string) => boolean;
  userHasModuleAccess: (moduleId: string) => boolean;
  toggleModule: (moduleId: string, enabled: boolean) => Promise<boolean>;
  refresh: () => Promise<void>;
  isAdmin: boolean;
  screenPermissions: Record<string, ScreenPermission>;
  accessLoading: boolean;
}

const ModuleContext = createContext<ModuleContextType | undefined>(undefined);

export function ModuleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [enabledModules, setEnabledModules] = useState<ModuleConfig[]>([]);
  const [allModules, setAllModules] = useState<ModuleConfig[]>([]);

  const { data: accessData, isLoading: accessLoading } = useQuery<AccessContextData>({
    queryKey: ['access-context', user?.id],
    enabled: !!user?.id && isInitialized,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await fetch('/api/access-context', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch access context');
      return res.json();
    },
  });

  const isAdmin = accessData?.is_admin ?? false;
  const userAccessibleModules = accessData?.modules ?? [];
  const screenPermissions = accessData?.screen_permissions ?? {};

  useEffect(() => {
    const initModules = async () => {
      try {
        registerAllModules(moduleRegistry);
        await moduleRegistry.loadSettings();
        setAllModules(moduleRegistry.getAllModules());
        setEnabledModules(moduleRegistry.getEnabledModules());
        setIsInitialized(true);
      } catch (error) {
        console.error('Error initializing modules:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initModules();
  }, []);

  const isModuleEnabled = useCallback((moduleId: string): boolean => {
    return moduleRegistry.isEnabled(moduleId);
  }, []);

  const userHasModuleAccess = useCallback((moduleId: string): boolean => {
    if (!moduleRegistry.isEnabled(moduleId)) {
      return false;
    }
    if (isAdmin) return true;
    return userAccessibleModules.includes(moduleId);
  }, [userAccessibleModules, isAdmin]);

  const toggleModule = useCallback(async (moduleId: string, enabled: boolean): Promise<boolean> => {
    const success = await moduleRegistry.toggleModule(moduleId, enabled);
    if (success) {
      setEnabledModules(moduleRegistry.getEnabledModules());
      setAllModules(moduleRegistry.getAllModules());
    }
    return success;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    await moduleRegistry.refresh();
    setAllModules(moduleRegistry.getAllModules());
    setEnabledModules(moduleRegistry.getEnabledModules());
    queryClient.invalidateQueries({ queryKey: ['access-context'] });
    setIsLoading(false);
  }, [queryClient]);

  return (
    <ModuleContext.Provider
      value={{
        isLoading,
        isInitialized,
        enabledModules,
        allModules,
        userAccessibleModules,
        isModuleEnabled,
        userHasModuleAccess,
        toggleModule,
        refresh,
        isAdmin,
        screenPermissions,
        accessLoading,
      }}
    >
      {children}
    </ModuleContext.Provider>
  );
}

export function useModules() {
  const context = useContext(ModuleContext);
  if (context === undefined) {
    throw new Error('useModules must be used within a ModuleProvider');
  }
  return context;
}

export default ModuleProvider;
