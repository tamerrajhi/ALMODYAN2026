import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BookOpen, User, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { PurchasingDrillDownType, RunbookInfo } from './types';

interface Props {
  type: PurchasingDrillDownType;
  runbook: RunbookInfo;
}

export function PurchasingRunbookPanel({ type, runbook }: Props) {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4" />
          {isAr ? 'دليل الإجراءات' : 'Runbook'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScrollArea className="h-[430px] pr-4">
          {/* What */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              {isAr ? 'الوصف' : 'What'}
            </div>
            <p className="text-sm text-muted-foreground">
              {isAr ? runbook.whatAr : runbook.what}
            </p>
          </div>

          {/* Why */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              {isAr ? 'السبب' : 'Why'}
            </div>
            <p className="text-sm text-muted-foreground">
              {isAr ? runbook.whyAr : runbook.why}
            </p>
          </div>

          {/* Owner */}
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <User className="h-4 w-4 text-purple-500" />
              {isAr ? 'المسؤول' : 'Owner'}
            </div>
            <Badge variant="outline">
              {isAr ? runbook.ownerAr : runbook.owner}
            </Badge>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              {isAr ? 'خطوات المعالجة' : 'Remediation Steps'}
            </div>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              {(isAr ? runbook.stepsAr : runbook.steps).map((step, index) => (
                <li key={index} className="leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
