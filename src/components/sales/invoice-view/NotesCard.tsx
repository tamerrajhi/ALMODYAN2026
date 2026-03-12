import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Lock } from 'lucide-react';

interface NotesCardProps {
  publicNotes?: string | null;
  internalNotes?: string | null;
}

export default function NotesCard({
  publicNotes,
  internalNotes,
}: NotesCardProps) {
  const hasPublicNotes = publicNotes && publicNotes.trim().length > 0;
  const hasInternalNotes = internalNotes && internalNotes.trim().length > 0;
  const hasAnyNotes = hasPublicNotes || hasInternalNotes;

  if (!hasAnyNotes) {
    return null;
  }

  // If only one type of notes, show simple card
  if (hasPublicNotes && !hasInternalNotes) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            ملاحظات
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3">
            {publicNotes}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hasPublicNotes && hasInternalNotes) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="w-4 h-4" />
            ملاحظات داخلية
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm whitespace-pre-wrap bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
            {internalNotes}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Both types of notes - use tabs
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4" />
          الملاحظات
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="public" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="public" className="text-xs">
              <FileText className="w-3 h-3 ml-1" />
              عامة
            </TabsTrigger>
            <TabsTrigger value="internal" className="text-xs">
              <Lock className="w-3 h-3 ml-1" />
              داخلية
            </TabsTrigger>
          </TabsList>
          <TabsContent value="public" className="mt-3">
            <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3">
              {publicNotes || 'لا توجد ملاحظات عامة'}
            </div>
          </TabsContent>
          <TabsContent value="internal" className="mt-3">
            <div className="text-sm whitespace-pre-wrap bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
              {internalNotes || 'لا توجد ملاحظات داخلية'}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
