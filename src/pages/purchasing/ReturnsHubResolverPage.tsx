import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertTriangle, ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { queryTable } from '@/lib/dataGateway';

// Now supports 'import' as a distinct return type route
type ReturnType = 'unique' | 'general' | 'import';

interface ResolveResult {
  return_type: ReturnType;
  canonical_id: string;
}

/**
 * Resolver page that determines return type from ID and redirects to the correct Hub detail page.
 * Falls back to legacy detail page if type cannot be determined.
 */
export default function ReturnsHubResolverPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError(isAr ? 'معرف المرتجع غير صالح' : 'Invalid return ID');
      setIsLoading(false);
      return;
    }

    resolveReturnType(id);
  }, [id]);

  const resolveReturnType = async (returnId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Query v_returns_hub view which already has return_type field
      const { data, error: queryError } = await queryTable('v_returns_hub', {
        select: 'return_type, canonical_id',
        filters: [{ type: 'eq', column: 'canonical_id', value: returnId }],
        maybeSingle: true,
      });

      if (queryError) {
        console.error('[Resolver] Query error:', queryError);
        throw new Error(queryError.message);
      }

      if (data) {
        const result: ResolveResult = {
          return_type: data.return_type as ReturnType,
          canonical_id: data.canonical_id,
        };
        
        navigate(`/purchasing/returns-hub/${result.return_type}/${result.canonical_id}`, { 
          replace: true 
        });
        return;
      }

      // v_returns_hub is the single source of truth
      // If not found there, the return does not exist
      setError(isAr 
        ? 'لم يتم العثور على المرتجع في مركز المرتجعات'
        : 'Return not found in Returns Hub'
      );

    } catch (err) {
      console.error('[Resolver] Error resolving return type:', err);
      setError(isAr 
        ? 'حدث خطأ أثناء تحديد نوع المرتجع'
        : 'Error determining return type'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenLegacy = () => {
    navigate(`/purchasing/returns/${id}/view`);
  };

  const handleBackToList = () => {
    navigate('/purchasing/returns-hub');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">
            {isAr ? 'جارٍ تحديد نوع المرتجع...' : 'Resolving return type...'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-6">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-2" />
            <CardTitle className="text-lg">
              {isAr ? 'تعذر تحديد نوع المرتجع' : 'Could not resolve return type'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-muted-foreground text-sm">
              {error}
            </p>
            <p className="text-center text-muted-foreground text-xs">
              ID: {id}
            </p>
            <div className="flex flex-col gap-2">
              <Button 
                variant="outline" 
                className="w-full gap-2"
                onClick={handleOpenLegacy}
              >
                <ExternalLink className="w-4 h-4" />
                {isAr ? 'فتح في الصفحة القديمة' : 'Open Legacy Detail'}
              </Button>
              <Button 
                variant="ghost" 
                className="w-full gap-2"
                onClick={handleBackToList}
              >
                <ArrowLeft className="w-4 h-4" />
                {isAr ? 'العودة للقائمة' : 'Back to List'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
