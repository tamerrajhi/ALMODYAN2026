import { useState, useEffect, useCallback } from 'react';
import { moduleRegistry } from '@/shared/registry/ModuleRegistry';
import { ModuleConfig } from '@/core/types/module.types';

export function useModuleRegistry() {
  const [isLoading, setIsLoading] = useState(!moduleRegistry.isInitialized());
  const [enabledModules, setEnabledModules] = useState<ModuleConfig[]>([]);
  const [allModules, setAllModules] = useState<ModuleConfig[]>([]);

  // تحميل الإعدادات عند البداية
  useEffect(() => {
    const loadModules = async () => {
      if (!moduleRegistry.isInitialized()) {
        setIsLoading(true);
        await moduleRegistry.loadSettings();
      }
      
      setAllModules(moduleRegistry.getAllModules());
      setEnabledModules(moduleRegistry.getEnabledModules());
      setIsLoading(false);
    };

    loadModules();
  }, []);

  // التحقق من تفعيل موديول
  const isModuleEnabled = useCallback((moduleId: string): boolean => {
    return moduleRegistry.isEnabled(moduleId);
  }, []);

  // الحصول على موديول معين
  const getModule = useCallback((moduleId: string): ModuleConfig | undefined => {
    return moduleRegistry.getModule(moduleId);
  }, []);

  // تفعيل/تعطيل موديول
  const toggleModule = useCallback(async (moduleId: string, enabled: boolean): Promise<boolean> => {
    const success = await moduleRegistry.toggleModule(moduleId, enabled);
    if (success) {
      setEnabledModules(moduleRegistry.getEnabledModules());
      setAllModules(moduleRegistry.getAllModules());
    }
    return success;
  }, []);

  // التحقق من إمكانية تعطيل موديول
  const canDisableModule = useCallback((moduleId: string) => {
    return moduleRegistry.canDisableModule(moduleId);
  }, []);

  // إعادة تحميل الإعدادات
  const refresh = useCallback(async () => {
    setIsLoading(true);
    await moduleRegistry.refresh();
    setAllModules(moduleRegistry.getAllModules());
    setEnabledModules(moduleRegistry.getEnabledModules());
    setIsLoading(false);
  }, []);

  // الحصول على Routes
  const getRoutes = useCallback(() => {
    return moduleRegistry.getRoutes();
  }, []);

  // الحصول على عناصر القائمة
  const getMenuItems = useCallback(() => {
    return moduleRegistry.getMenuItems();
  }, []);

  return {
    isLoading,
    allModules,
    enabledModules,
    isModuleEnabled,
    getModule,
    toggleModule,
    canDisableModule,
    refresh,
    getRoutes,
    getMenuItems,
  };
}

export default useModuleRegistry;
