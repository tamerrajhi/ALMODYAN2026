/**
 * Purchase Return Router Page
 * 
 * Routes to the correct return screen based on query params:
 * - ?type=unique&invoiceId=xxx → PurchaseReturnUniquePage
 * - ?type=general&invoiceId=xxx → PurchaseReturnGeneralPage
 * - ?invoiceId=xxx (no type) → Auto-detect based on invoice characteristics
 */

import { useSearchParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import MainLayout from '@/components/layout/MainLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { getPurchaseInvoice } from '@/domain/purchasing/purchasingReadService';
import { 
  determineReturnScreen, 
  MixedItemTypesError 
} from '@/domain/purchasing/returnRoutingService';

import PurchaseReturnUniquePage from './PurchaseReturnUniquePage';
import PurchaseReturnGeneralPage from './PurchaseReturnGeneralPage';

export default function PurchaseReturnRouterPage() {
  const { language } = useLanguage();
  const [searchParams] = useSearchParams();
  
  const type = searchParams.get('type');
  const invoiceId = searchParams.get('invoiceId');

  // If type is explicitly provided, route directly
  if (type === 'unique') {
    return <PurchaseReturnUniquePage />;
  }
  if (type === 'general') {
    return <PurchaseReturnGeneralPage />;
  }

  // If no type but invoiceId provided, auto-detect
  if (invoiceId && !type) {
    return <AutoDetectRouter invoiceId={invoiceId} />;
  }

  // No invoiceId - redirect to returns hub
  return <Navigate to="/purchasing/returns-hub" replace />;
}

/**
 * Auto-detect component that fetches invoice and determines screen type
 */
function AutoDetectRouter({ invoiceId }: { invoiceId: string }) {
  const { language } = useLanguage();

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ['invoice-for-return-routing', invoiceId],
    queryFn: () => getPurchaseInvoice(invoiceId),
  });

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  if (error || !invoice) {
    return (
      <MainLayout>
        <div className="p-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' 
                ? 'فشل في تحميل بيانات الفاتورة' 
                : 'Failed to load invoice data'}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  // Determine screen type
  try {
    const { screenType } = determineReturnScreen(invoice);
    
    // Redirect to the correct screen with type in URL
    return <Navigate 
      to={`/purchasing/returns/new?type=${screenType}&invoiceId=${invoiceId}`} 
      replace 
    />;
  } catch (err) {
    if (err instanceof MixedItemTypesError) {
      return (
        <MainLayout>
          <div className="p-8">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {language === 'ar' 
                  ? 'لا يمكن إنشاء مرتجع لفاتورة تحتوي على أنواع بنود مختلطة (قطع ذهب + منتجات/تكاليف). يرجى إنشاء مرتجعات منفصلة.'
                  : 'Cannot create return for invoice with mixed item types (jewelry + products/costs). Please create separate returns.'}
              </AlertDescription>
            </Alert>
          </div>
        </MainLayout>
      );
    }
    throw err;
  }
}
