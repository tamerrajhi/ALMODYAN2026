import MainLayout from '@/components/layout/MainLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { HardDrive } from 'lucide-react';

export default function BackupPage() {
  const { language } = useLanguage();

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <HardDrive className="h-6 w-6" />
              {language === 'ar' ? 'النسخ الاحتياطي' : 'Backup'}
            </h1>
            <p className="text-muted-foreground">
              {language === 'ar' 
                ? 'تصدير وجدولة النسخ الاحتياطي لقاعدة البيانات' 
                : 'Export and schedule database backups'}
            </p>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-muted-foreground">
            {language === 'ar' ? 'لا توجد نسخة احتياطية متاحة' : 'No backup options available'}
          </p>
        </div>
      </div>
    </MainLayout>
  );
}
