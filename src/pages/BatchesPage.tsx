import { useNavigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import * as dataGateway from '@/lib/dataGateway';

export default function BatchesPage() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  
  const { data: batches, isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('unique_purchase_batches', {
        select: '*',
        order: { column: 'created_at', ascending: false },
      });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: returnedCounts } = useQuery({
    queryKey: ['batch-returned-counts'],
    queryFn: async () => {
      const res = await fetch('/api/batch-returned-counts', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch returned counts');
      return res.json() as Promise<Record<string, number>>;
    },
  });

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      DRAFT: 'status-draft',
      VALIDATED: 'status-validated',
      IMPORTED: 'status-imported',
      FAILED: 'status-failed',
      completed: 'status-imported',
      processing: 'status-validated',
    };
    const labels: Record<string, string> = {
      DRAFT: language === 'ar' ? 'مسودة' : 'Draft',
      VALIDATED: language === 'ar' ? 'تم التحقق' : 'Validated',
      IMPORTED: language === 'ar' ? 'تم الاستيراد' : 'Imported',
      FAILED: language === 'ar' ? 'فشل' : 'Failed',
      completed: language === 'ar' ? 'مكتمل' : 'Completed',
      processing: language === 'ar' ? 'جاري المعالجة' : 'Processing',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || ''}`}>
        {labels[status] || status}
      </span>
    );
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const locale = language === 'ar' ? 'ar-EG' : 'en-US';
    const date = d.toLocaleDateString(locale);
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
    return (
      <div className="flex flex-col">
        <span>{date}</span>
        <span className="text-xs text-muted-foreground">{time}</span>
      </div>
    );
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6 animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">{t.batches.title}</h1>
          <p className="page-description">{t.batches.subtitle}</p>
        </div>

        <Card className="border-0 shadow-md">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-gold mx-auto" />
              </div>
            ) : batches && batches.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t.batches.batchNumber}</th>
                      <th>{t.batches.fileName}</th>
                      <th>{t.common.status}</th>
                      <th>{t.batches.importedRows}</th>
                      <th>{language === 'ar' ? 'المسترجع' : 'Returned'}</th>
                      <th>{t.batches.uploadDate}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr 
                        key={batch.id} 
                        data-testid={`row-batch-${batch.id}`}
                        className="cursor-pointer hover-elevate"
                        onClick={() => navigate(`/batches/${batch.id}`)}
                      >
                        <td className="font-mono text-sm">{batch.batch_no}</td>
                        <td>{batch.uploaded_file_name}</td>
                        <td>{getStatusBadge(batch.status || 'DRAFT')}</td>
                        <td>{batch.rows_imported} / {batch.rows_total}</td>
                        <td className={returnedCounts?.[batch.id] ? 'text-orange-500 font-medium' : 'text-muted-foreground'}>{returnedCounts?.[batch.id] || 0}</td>
                        <td className="text-muted-foreground">
                          {formatDateTime(batch.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground">
                {language === 'ar' ? 'لا توجد دفعات مستوردة حتى الآن' : 'No batches imported yet'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
