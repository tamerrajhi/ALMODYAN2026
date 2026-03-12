import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryTable } from '@/lib/dataGateway';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';

export interface ZatcaSettings {
  id: string;
  environment: 'sandbox' | 'production';
  is_active: boolean;
  api_base_url: string | null;
  csr_common_name: string | null;
  csr_organization_unit: string | null;
  csr_organization: string | null;
  csr_country: string | null;
  csr_serial_number: string | null;
  csr_location: string | null;
  csr_industry: string | null;
  otp: string | null;
  private_key: string | null;
  compliance_csid: string | null;
  compliance_csid_secret: string | null;
  production_csid: string | null;
  production_csid_secret: string | null;
  csid_expiry: string | null;
  onboarding_status: 'not_started' | 'in_progress' | 'compliance_done' | 'production_ready' | 'completed';
  last_invoice_hash: string | null;
  invoice_counter: number;
  registration_mode: 'unified' | 'per_branch';
  branch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanySettings {
  id: string;
  company_name: string;
  company_name_en: string | null;
  tax_number: string | null;
  commercial_registration: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
}

export interface BranchZatcaInfo {
  branchId: string;
  status: 'not_started' | 'in_progress' | 'compliance_done' | 'production_ready' | 'completed';
  csidExpiry: string | null;
  environment: 'sandbox' | 'production';
}

export function useZatcaSettings(branchId?: string | null) {
  const queryClient = useQueryClient();
  const { language } = useLanguage();

  const { data: mainSettings, isLoading: isLoadingMain } = useQuery({
    queryKey: ['zatca-settings-main'],
    queryFn: async () => {
      const { data, error } = await queryTable<ZatcaSettings>('zatca_settings', {
        select: '*',
        filters: [{ type: 'is', column: 'branch_id', value: null }],
        maybeSingle: true,
      });
      if (error) throw new Error(error.message);
      return data as ZatcaSettings | null;
    },
  });

  const registrationMode = mainSettings?.registration_mode || 'unified';

  const { data: settings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ['zatca-settings', registrationMode, branchId],
    queryFn: async () => {
      if (registrationMode === 'unified') {
        return mainSettings ?? null;
      } else {
        if (!branchId) return null;
        const { data, error } = await queryTable<ZatcaSettings>('zatca_settings', {
          select: '*',
          filters: [{ type: 'eq', column: 'branch_id', value: branchId }],
          maybeSingle: true,
        });
        if (error) throw new Error(error.message);
        return data as ZatcaSettings | null;
      }
    },
    enabled: registrationMode === 'unified' || !!branchId,
  });

  const { data: allBranchSettings } = useQuery({
    queryKey: ['zatca-settings-all-branches'],
    queryFn: async () => {
      const { data, error } = await queryTable<any[]>('zatca_settings', {
        select: 'branch_id, onboarding_status, csid_expiry, environment',
        filters: [{ type: 'not', column: 'branch_id', operator: 'is', value: null }],
      });
      if (error) throw new Error(error.message);
      return (data || []).map((s: any) => ({
        branchId: s.branch_id!,
        status: s.onboarding_status as BranchZatcaInfo['status'],
        csidExpiry: s.csid_expiry,
        environment: s.environment as 'sandbox' | 'production',
      })) as BranchZatcaInfo[];
    },
  });

  const { data: companySettings, isLoading: isLoadingCompany } = useQuery({
    queryKey: ['company-settings'],
    queryFn: async () => {
      const { data, error } = await queryTable<CompanySettings>('company_settings', {
        select: '*',
        maybeSingle: true,
      });
      if (error) throw new Error(error.message);
      return data as CompanySettings | null;
    },
  });

  const updateRegistrationMode = useMutation({
    mutationFn: async (mode: 'unified' | 'per_branch') => {
      if (!mainSettings?.id) throw new Error('No main settings found');
      forbidDirectWrite('update', 'useZatcaSettings.ts:137');
      return null as any;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zatca-settings-main'] });
      queryClient.invalidateQueries({ queryKey: ['zatca-settings'] });
      toast.success(language === 'ar' ? 'تم تحديث وضع التسجيل' : 'Registration mode updated');
    },
    onError: (error) => {
      toast.error(language === 'ar' ? 'فشل في تحديث وضع التسجيل' : 'Failed to update registration mode');
      console.error('Error updating registration mode:', error);
    },
  });

  const createBranchSettings = useMutation({
    mutationFn: async (targetBranchId: string) => {
      forbidDirectWrite('insert', 'useZatcaSettings.ts:161');
      return null as any;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zatca-settings'] });
      queryClient.invalidateQueries({ queryKey: ['zatca-settings-all-branches'] });
    },
    onError: (error) => {
      console.error('Error creating branch settings:', error);
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: Partial<ZatcaSettings>) => {
      const targetId = registrationMode === 'unified' 
        ? mainSettings?.id 
        : settings?.id;
      
      if (!targetId) throw new Error('No settings found');
      forbidDirectWrite('update', 'useZatcaSettings.ts:195');
      return null as any;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zatca-settings'] });
      queryClient.invalidateQueries({ queryKey: ['zatca-settings-main'] });
      queryClient.invalidateQueries({ queryKey: ['zatca-settings-all-branches'] });
      toast.success(language === 'ar' ? 'تم حفظ الإعدادات' : 'Settings saved');
    },
    onError: (error) => {
      toast.error(language === 'ar' ? 'فشل في حفظ الإعدادات' : 'Failed to save settings');
      console.error('Error updating ZATCA settings:', error);
    },
  });

  const startOnboarding = useMutation({
    mutationFn: async (otp: string) => {
      const res = await fetch('/api/zatca/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'start', 
          otp,
          branchId: registrationMode === 'per_branch' ? branchId : null,
        }),
      });
      const { data, error } = await res.json();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zatca-settings'] });
      queryClient.invalidateQueries({ queryKey: ['zatca-settings-all-branches'] });
      toast.success(language === 'ar' ? 'تم بدء عملية التسجيل' : 'Onboarding started');
    },
    onError: (error) => {
      toast.error(language === 'ar' ? 'فشل في بدء التسجيل' : 'Failed to start onboarding');
      console.error('Error starting onboarding:', error);
    },
  });

  const completeCompliance = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/zatca/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'complete_compliance',
          branchId: registrationMode === 'per_branch' ? branchId : null,
        }),
      });
      const { data, error } = await res.json();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zatca-settings'] });
      queryClient.invalidateQueries({ queryKey: ['zatca-settings-all-branches'] });
      toast.success(language === 'ar' ? 'تم إكمال اختبارات الامتثال' : 'Compliance testing completed');
    },
    onError: (error) => {
      toast.error(language === 'ar' ? 'فشل في إكمال الاختبارات' : 'Failed to complete testing');
      console.error('Error completing compliance:', error);
    },
  });

  const requestProductionCSID = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/zatca/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'production_csid',
          branchId: registrationMode === 'per_branch' ? branchId : null,
        }),
      });
      const { data, error } = await res.json();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zatca-settings'] });
      queryClient.invalidateQueries({ queryKey: ['zatca-settings-all-branches'] });
      toast.success(language === 'ar' ? 'تم الحصول على شهادة الإنتاج' : 'Production certificate obtained');
    },
    onError: (error) => {
      toast.error(language === 'ar' ? 'فشل في الحصول على الشهادة' : 'Failed to obtain certificate');
      console.error('Error requesting production CSID:', error);
    },
  });

  const effectiveSettings = settings || mainSettings;

  const zatca_mode: 'sandbox' | 'production' = effectiveSettings?.environment || 'sandbox';
  const integration_enabled: boolean = effectiveSettings?.is_active || false;

  const onboardingStatus = effectiveSettings?.onboarding_status || 'not_started';
  const isProductionReady = onboardingStatus === 'completed' &&
    !!effectiveSettings?.production_csid &&
    !!effectiveSettings?.production_csid_secret;

  const isSandboxReady = !!effectiveSettings?.compliance_csid &&
    !!effectiveSettings?.compliance_csid_secret;

  let canSubmit = false;
  let disabledReason = '';

  if (!integration_enabled) {
    canSubmit = false;
    disabledReason = zatca_mode === 'sandbox'
      ? 'وضع تجريبي (Virtual) — فعّل التكامل للإرسال'
      : 'التكامل غير مفعّل — فعّل التكامل للإرسال';
  } else if (zatca_mode === 'production') {
    if (!isProductionReady) {
      canSubmit = false;
      disabledReason = 'إعدادات الشهادة/التسجيل غير مكتملة للإنتاج';
    } else {
      canSubmit = true;
    }
  } else {
    canSubmit = true;
  }

  return {
    settings: effectiveSettings,
    mainSettings,
    companySettings,
    registrationMode,
    allBranchSettings: allBranchSettings || [],
    isLoading: isLoadingMain || isLoadingSettings || isLoadingCompany,
    updateSettings,
    updateRegistrationMode,
    createBranchSettings,
    startOnboarding,
    completeCompliance,
    requestProductionCSID,
    zatca_mode,
    integration_enabled,
    canSubmit,
    disabledReason,
    isProductionReady,
    isSandboxReady,
  };
}
