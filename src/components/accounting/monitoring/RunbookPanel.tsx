/**
 * Phase 3-B: Runbook Panel Component
 */

import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Book, AlertCircle, User, ListOrdered } from 'lucide-react';
import type { DrillDownType, RunbookInfo, RUNBOOKS } from './types';

interface Props {
  type: DrillDownType;
  runbook: RunbookInfo;
}

export function RunbookPanel({ type, runbook }: Props) {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Book className="h-4 w-4" />
          {isAr ? 'دليل العمل' : 'Runbook'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* What */}
        <div>
          <div className="flex items-center gap-2 font-medium mb-1">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            {isAr ? 'المشكلة' : 'What'}
          </div>
          <p className="text-muted-foreground pl-6">
            {isAr ? runbook.whatAr : runbook.what}
          </p>
        </div>

        <Separator />

        {/* Why */}
        <div>
          <div className="flex items-center gap-2 font-medium mb-1">
            <Badge variant="outline" className="text-xs">
              {isAr ? 'لماذا' : 'Why'}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            {isAr ? runbook.whyAr : runbook.why}
          </p>
        </div>

        <Separator />

        {/* Owner */}
        <div>
          <div className="flex items-center gap-2 font-medium mb-1">
            <User className="h-4 w-4 text-muted-foreground" />
            {isAr ? 'المسؤول' : 'Owner'}
          </div>
          <Badge variant="secondary">
            {isAr ? runbook.ownerAr : runbook.owner}
          </Badge>
        </div>

        <Separator />

        {/* Steps */}
        <div>
          <div className="flex items-center gap-2 font-medium mb-2">
            <ListOrdered className="h-4 w-4 text-muted-foreground" />
            {isAr ? 'خطوات المعالجة' : 'Remediation Steps'}
          </div>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            {(isAr ? runbook.stepsAr : runbook.steps).map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
