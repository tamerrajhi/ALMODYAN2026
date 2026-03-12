import { useState, useEffect } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { useZatcaSettings } from '@/hooks/useZatcaSettings';
import { useBranches } from '@/hooks/useBranches';
import { ZatcaStatusCard } from '@/components/zatca/ZatcaStatusCard';
import { ZatcaSellerInfo } from '@/components/zatca/ZatcaSellerInfo';
import { ZatcaEnvironmentSettings } from '@/components/zatca/ZatcaEnvironmentSettings';
import { ZatcaCertificateSettings } from '@/components/zatca/ZatcaCertificateSettings';
import { ZatcaOnboardingSection } from '@/components/zatca/ZatcaOnboardingSection';
import { ZatcaCsidExpiryAlert } from '@/components/zatca/ZatcaCsidExpiryAlert';
import { ZatcaRegistrationModeSelector } from '@/components/zatca/ZatcaRegistrationModeSelector';
import { ZatcaBranchSelector } from '@/components/zatca/ZatcaBranchSelector';
import { ZatcaBranchesOverview } from '@/components/zatca/ZatcaBranchesOverview';
import { Loader2, FileCheck, AlertTriangle, TestTube, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export default function ZatcaSettingsPage() {
  const { language } = useLanguage();
  const { data: branches, isLoading: isLoadingBranches } = useBranches(true);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  const {
    settings,
    mainSettings,
    companySettings,
    registrationMode,
    allBranchSettings,
    isLoading,
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
  } = useZatcaSettings(selectedBranchId);

  // Auto-select first branch in per_branch mode
  useEffect(() => {
    if (registrationMode === 'per_branch' && branches?.length && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [registrationMode, branches, selectedBranchId]);

  // Create branch settings if not exists
  useEffect(() => {
    if (registrationMode === 'per_branch' && selectedBranchId && !settings?.id) {
      const branchHasSettings = allBranchSettings.some(s => s.branchId === selectedBranchId);
      if (!branchHasSettings) {
        createBranchSettings.mutate(selectedBranchId);
      }
    }
  }, [registrationMode, selectedBranchId, settings, allBranchSettings]);

  const handleModeChange = (mode: 'unified' | 'per_branch') => {
    updateRegistrationMode.mutate(mode);
    if (mode === 'per_branch' && branches?.length) {
      setSelectedBranchId(branches[0].id);
    } else {
      setSelectedBranchId(null);
    }
  };

  const handleBranchSelect = (branchId: string) => {
    setSelectedBranchId(branchId);
  };

  if (isLoading || isLoadingBranches) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  const currentSettings = settings || mainSettings;
  const branchStatuses = allBranchSettings.map(s => ({
    branchId: s.branchId,
    status: s.status,
  }));

  // Get selected branch info for serial number suggestion
  const selectedBranch = branches?.find(b => b.id === selectedBranchId);
  const suggestedSerialSuffix = registrationMode === 'unified' 
    ? 'MAIN' 
    : (selectedBranch?.branch_code || 'BR');

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <FileCheck className="h-8 w-8 text-primary" />
          <div>
            <h1 className="page-title">
              {language === 'ar' ? 'إعدادات ZATCA' : 'ZATCA Settings'}
            </h1>
            <p className="page-description">
              {language === 'ar' 
                ? 'إعدادات الربط مع هيئة الزكاة والضريبة والجمارك'
                : 'Settings for ZATCA e-invoicing integration'
              }
            </p>
          </div>
        </div>

        {/* Mode Status Banner */}
        {!integration_enabled && zatca_mode === 'sandbox' && (
          <Alert className="border-purple-500/30 bg-purple-500/10">
            <TestTube className="h-4 w-4 text-purple-600" />
            <AlertDescription className="text-purple-700 dark:text-purple-300 flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/20">Virtual</Badge>
              {language === 'ar' 
                ? 'وضع تجريبي (Virtual) — يمكنك توليد الفواتير محلياً للمعاينة بدون إرسال للهيئة. فعّل التكامل للإرسال الفعلي.'
                : 'Virtual mode — You can generate invoices locally for preview without submitting. Enable integration for actual submission.'
              }
            </AlertDescription>
          </Alert>
        )}
        {!integration_enabled && zatca_mode === 'production' && (
          <Alert className="border-red-500/30 bg-red-500/10">
            <ShieldAlert className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-700 dark:text-red-300">
              {language === 'ar' 
                ? 'بيئة الإنتاج مختارة لكن التكامل معطّل — لن يتم إرسال أي فواتير للهيئة. فعّل التكامل للبدء.'
                : 'Production environment selected but integration is disabled — no invoices will be submitted. Enable integration to start.'
              }
            </AlertDescription>
          </Alert>
        )}
        {integration_enabled && zatca_mode === 'production' && !isProductionReady && (
          <Alert className="border-orange-500/30 bg-orange-500/10">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
            <AlertDescription className="text-orange-700 dark:text-orange-300">
              {language === 'ar' 
                ? 'التكامل مفعّل في بيئة الإنتاج لكن إعدادات الشهادة/التسجيل غير مكتملة. أكمل عملية التسجيل أدناه.'
                : 'Integration enabled in production but certificate/onboarding is incomplete. Complete the onboarding process below.'
              }
            </AlertDescription>
          </Alert>
        )}
        {integration_enabled && canSubmit && (
          <Alert className="border-green-500/30 bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700 dark:text-green-300">
              {zatca_mode === 'sandbox'
                ? (language === 'ar' ? 'جاهز للإرسال — بيئة التجربة (Sandbox)' : 'Ready to submit — Sandbox environment')
                : (language === 'ar' ? 'جاهز للإرسال — بيئة الإنتاج (Production)' : 'Ready to submit — Production environment')
              }
            </AlertDescription>
          </Alert>
        )}

        {/* Registration Mode Selector */}
        <ZatcaRegistrationModeSelector
          mode={registrationMode}
          onModeChange={handleModeChange}
          isLoading={updateRegistrationMode.isPending}
        />

        {/* Per-Branch Mode: Branch Selector & Overview */}
        {registrationMode === 'per_branch' && branches && (
          <>
            <ZatcaBranchesOverview
              branches={branches}
              branchInfos={allBranchSettings}
              onSelectBranch={handleBranchSelect}
              selectedBranchId={selectedBranchId}
            />

            {!selectedBranchId && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {language === 'ar' 
                    ? 'اختر فرعاً من الجدول أعلاه لعرض أو تعديل إعداداته'
                    : 'Select a branch from the table above to view or edit its settings'
                  }
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        {/* Show settings only when a branch is selected (per_branch) or always (unified) */}
        {(registrationMode === 'unified' || selectedBranchId) && (
          <>
            {/* Selected Branch Header for per_branch mode */}
            {registrationMode === 'per_branch' && selectedBranch && (
              <div className="bg-muted/50 rounded-lg p-4 border">
                <h2 className="text-lg font-semibold">
                  {language === 'ar' ? 'إعدادات الفرع: ' : 'Branch Settings: '}
                  {selectedBranch.branch_name} ({selectedBranch.branch_code})
                </h2>
              </div>
            )}

            {/* CSID Expiry Alert */}
            <ZatcaCsidExpiryAlert 
              csidExpiry={currentSettings?.csid_expiry || null}
              onRenew={() => requestProductionCSID.mutate()}
              isRenewing={requestProductionCSID.isPending}
            />

            {/* Status Cards */}
            <ZatcaStatusCard
              onboardingStatus={currentSettings?.onboarding_status || 'not_started'}
              environment={currentSettings?.environment || 'sandbox'}
              isActive={currentSettings?.is_active || false}
              csidExpiry={currentSettings?.csid_expiry || null}
              invoiceCounter={currentSettings?.invoice_counter || 0}
            />

            {/* Seller Info */}
            <ZatcaSellerInfo companySettings={companySettings || null} />

            {/* Environment Settings */}
            <ZatcaEnvironmentSettings
              environment={currentSettings?.environment || 'sandbox'}
              isActive={currentSettings?.is_active || false}
              onEnvironmentChange={(env) => updateSettings.mutate({ environment: env })}
              onActiveChange={(active) => updateSettings.mutate({ is_active: active })}
              isLoading={updateSettings.isPending}
            />

            {/* Certificate Settings */}
            <ZatcaCertificateSettings
              settings={{
                csr_common_name: currentSettings?.csr_common_name || null,
                csr_organization_unit: currentSettings?.csr_organization_unit || null,
                csr_organization: currentSettings?.csr_organization || null,
                csr_country: currentSettings?.csr_country || 'SA',
                csr_serial_number: currentSettings?.csr_serial_number || null,
                csr_location: currentSettings?.csr_location || null,
                csr_industry: currentSettings?.csr_industry || null,
              }}
              onSave={(data) => updateSettings.mutate(data)}
              isLoading={updateSettings.isPending}
              suggestedSerialSuffix={suggestedSerialSuffix}
            />

            {/* Onboarding Section */}
            <ZatcaOnboardingSection
              onboardingStatus={currentSettings?.onboarding_status || 'not_started'}
              onStartOnboarding={(otp) => startOnboarding.mutate(otp)}
              onCompleteCompliance={() => completeCompliance.mutate()}
              onRequestProductionCSID={() => requestProductionCSID.mutate()}
              isLoading={startOnboarding.isPending || completeCompliance.isPending || requestProductionCSID.isPending}
            />
          </>
        )}
      </div>
    </MainLayout>
  );
}
