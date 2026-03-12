import { ModuleConfig, RouteConfig, MenuItem, ModuleSettings } from '@/core/types/module.types';
import * as dataGateway from '@/lib/dataGateway';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';

class ModuleRegistry {
  private static instance: ModuleRegistry;
  private modules: Map<string, ModuleConfig> = new Map();
  private moduleSettings: Map<string, ModuleSettings> = new Map();
  private initialized: boolean = false;

  private constructor() {}

  static getInstance(): ModuleRegistry {
    if (!ModuleRegistry.instance) {
      ModuleRegistry.instance = new ModuleRegistry();
    }
    return ModuleRegistry.instance;
  }

  // تسجيل موديول جديد
  register(module: ModuleConfig): void {
    this.modules.set(module.id, module);
  }

  // تسجيل عدة موديولات
  registerAll(modules: ModuleConfig[]): void {
    modules.forEach(module => this.register(module));
  }

  // تحميل إعدادات الموديولات من قاعدة البيانات
  async loadSettings(): Promise<void> {
    try {
      const { data, error } = await dataGateway.fetchModuleSettings();

      if (error) {
        console.error('Error loading module settings:', error);
        return;
      }

      if (data) {
        data.forEach((setting: ModuleSettings) => {
          this.moduleSettings.set(setting.module_id, setting);
          
          // تحديث حالة التفعيل في الموديول
          const module = this.modules.get(setting.module_id);
          if (module) {
            module.enabled = setting.is_enabled;
            module.displayOrder = setting.display_order;
          }
        });
      }

      this.initialized = true;
    } catch (error) {
      console.error('Error loading module settings:', error);
    }
  }

  // التحقق من تفعيل موديول
  isEnabled(moduleId: string): boolean {
    const settings = this.moduleSettings.get(moduleId);
    if (settings) {
      return settings.is_enabled;
    }
    
    const module = this.modules.get(moduleId);
    return module?.enabled ?? false;
  }

  // الحصول على موديول معين
  getModule(moduleId: string): ModuleConfig | undefined {
    return this.modules.get(moduleId);
  }

  // الحصول على جميع الموديولات
  getAllModules(): ModuleConfig[] {
    return Array.from(this.modules.values());
  }

  // الحصول على الموديولات المفعّلة فقط
  getEnabledModules(): ModuleConfig[] {
    return this.getAllModules()
      .filter(module => this.isEnabled(module.id))
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  // الحصول على جميع Routes من الموديولات المفعّلة
  getRoutes(): RouteConfig[] {
    return this.getEnabledModules().flatMap(module => module.routes);
  }

  // الحصول على عناصر القائمة من الموديولات المفعّلة
  getMenuItems(): { moduleId: string; config: ModuleConfig }[] {
    return this.getEnabledModules().map(module => ({
      moduleId: module.id,
      config: module
    }));
  }

  // الحصول على صلاحيات موديول معين
  getModulePermissions(moduleId: string): string[] {
    const module = this.modules.get(moduleId);
    return module?.permissions ?? [];
  }

  // الحصول على جميع الصلاحيات من جميع الموديولات
  getAllPermissions(): string[] {
    return this.getAllModules().flatMap(module => module.permissions);
  }

  // تفعيل/تعطيل موديول
  async toggleModule(moduleId: string, enabled: boolean): Promise<boolean> {
    // BLOCKED: Use atomic RPC
    forbidDirectWrite('update', 'ModuleRegistry.ts:118');
  }

  // التحقق من التبعيات قبل تعطيل موديول
  canDisableModule(moduleId: string): { canDisable: boolean; dependents: string[] } {
    const dependents: string[] = [];
    
    this.getEnabledModules().forEach(module => {
      if (module.dependencies.includes(moduleId)) {
        dependents.push(module.id);
      }
    });

    return {
      canDisable: dependents.length === 0,
      dependents
    };
  }

  // إعادة تحميل الإعدادات
  async refresh(): Promise<void> {
    this.initialized = false;
    await this.loadSettings();
  }

  // التحقق من التهيئة
  isInitialized(): boolean {
    return this.initialized;
  }
}

// تصدير instance واحد
export const moduleRegistry = ModuleRegistry.getInstance();
export default moduleRegistry;
