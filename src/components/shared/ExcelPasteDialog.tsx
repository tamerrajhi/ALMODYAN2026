import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Check, ClipboardPaste, Eye } from 'lucide-react';
import { parseExcelClipboard, type ParseResult, type ParseOptions } from '@/lib/excelClipboardParser';

interface ExcelPasteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (rows: ParseResult['rows']) => void;
  existingSerials?: string[];
  language: string;
}

export function ExcelPasteDialog({
  open,
  onOpenChange,
  onApply,
  existingSerials = [],
  language,
}: ExcelPasteDialogProps) {
  const [rawText, setRawText] = useState('');
  const [mode, setMode] = useState<'with_headers' | 'no_headers' | 'template_supp_inv_10'>('with_headers');
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const isAr = language === 'ar';

  const handlePreview = () => {
    const opts: ParseOptions = { mode, existingSerials };
    const result = parseExcelClipboard(rawText, opts);
    setPreview(result);
  };

  const handleApply = (validOnly: boolean) => {
    if (!preview) return;
    if (validOnly) {
      const errorRowNums = new Set(preview.errors.map((e) => e.row));
      const validRows = preview.rows.filter((_, i) => !errorRowNums.has(i + 1));
      onApply(validRows);
    } else {
      onApply(preview.rows);
    }
    setRawText('');
    setPreview(null);
    onOpenChange(false);
  };

  const handleClose = () => {
    setRawText('');
    setPreview(null);
    onOpenChange(false);
  };

  const hasErrors = preview && preview.errors.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-[700px] max-h-[85vh] overflow-hidden flex flex-col"
        dir={isAr ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle data-testid="text-paste-dialog-title">
            <ClipboardPaste className="w-5 h-5 inline-block mx-1" />
            {isAr ? 'لصق من Excel' : 'Paste from Excel'}
          </DialogTitle>
          <DialogDescription>
            {isAr
              ? 'انسخ البيانات من Excel وألصقها هنا. تأكد أن الأعمدة مفصولة بـ Tab'
              : 'Copy data from Excel and paste here. Ensure columns are Tab-separated'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="text-sm font-medium">
              {isAr ? 'نوع الإدخال:' : 'Input mode:'}
            </Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={mode === 'with_headers' ? 'default' : 'outline'}
                onClick={() => { setMode('with_headers'); setPreview(null); }}
                data-testid="button-mode-headers"
                className="toggle-elevate"
              >
                {isAr ? 'مع عناوين أعمدة' : 'With Headers'}
              </Button>
              <Button
                size="sm"
                variant={mode === 'no_headers' ? 'default' : 'outline'}
                onClick={() => { setMode('no_headers'); setPreview(null); }}
                data-testid="button-mode-no-headers"
                className="toggle-elevate"
              >
                {isAr ? 'بدون عناوين' : 'No Headers'}
              </Button>
              <Button
                size="sm"
                variant={mode === 'template_supp_inv_10' ? 'default' : 'outline'}
                onClick={() => { setMode('template_supp_inv_10'); setPreview(null); }}
                data-testid="button-mode-template"
                className="toggle-elevate"
              >
                {isAr ? 'قالب SUPP INV_10' : 'Template: SUPP INV_10'}
              </Button>
            </div>
          </div>

          {mode === 'no_headers' && (
            <div className="text-xs text-muted-foreground bg-muted p-2 rounded-md">
              {isAr
                ? 'ترتيب الأعمدة: الوصف، كود المنتج، المعدن/العيار، الوزن، التكلفة، سعر البطاقة، الموديل، مرجع المورد، النوع، الحجر'
                : 'Column order: Description, Stockcode, Metal/Karat, Weight, Cost, Tag Price, Model, Supp Ref, Type, Stone'}
            </div>
          )}

          {mode === 'template_supp_inv_10' && (
            <div className="text-xs text-muted-foreground bg-muted p-2 rounded-md">
              {isAr
                ? 'الصق صفوف البيانات فقط (بدون سطر العناوين) من ملف SUPP INV_10. العيار يُستخرج تلقائياً من حقل الوصف (مثال: "عيار18").'
                : 'Paste data rows only (without header row) from SUPP INV_10 template. Karat is auto-extracted from the Description field (e.g. "عيار18").'}
            </div>
          )}

          {mode === 'with_headers' && (
            <div className="text-xs text-muted-foreground bg-muted p-2 rounded-md">
              {isAr
                ? 'العناوين المدعومة: وصف/desc، كود/code، عيار/karat، وزن/weight، تكلفة/cost، سريال/serial، سعر البطاقة/tag_price، موديل/model، مرجع/supp_ref'
                : 'Supported headers: desc/description, code/stockcode, karat/metal, weight/g_weight, cost/price, serial/serial_no, tag_price/tag, model, supp_ref/ref'}
            </div>
          )}

          <Textarea
            data-testid="textarea-paste-input"
            placeholder={isAr ? 'ألصق البيانات هنا (Ctrl+V)...' : 'Paste data here (Ctrl+V)...'}
            value={rawText}
            onChange={(e) => { setRawText(e.target.value); setPreview(null); }}
            className="min-h-[120px] font-mono text-xs"
            dir="ltr"
          />

          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={!rawText.trim()}
            data-testid="button-preview-paste"
          >
            <Eye className="w-4 h-4" />
            <span className="mx-1">{isAr ? 'معاينة' : 'Preview'}</span>
          </Button>

          {preview && (
            <div className="space-y-3">
              <div className="flex gap-3 flex-wrap items-center">
                <Badge variant="secondary" data-testid="badge-total-rows">
                  {isAr ? `إجمالي: ${preview.meta.totalRows}` : `Total: ${preview.meta.totalRows}`}
                </Badge>
                <Badge variant="default" data-testid="badge-valid-rows">
                  <Check className="w-3 h-3" />
                  <span className="mx-1">{isAr ? `صالح: ${preview.meta.validRows}` : `Valid: ${preview.meta.validRows}`}</span>
                </Badge>
                {preview.meta.errorRows > 0 && (
                  <Badge variant="destructive" data-testid="badge-error-rows">
                    <AlertTriangle className="w-3 h-3" />
                    <span className="mx-1">{isAr ? `أخطاء: ${preview.meta.errorRows}` : `Errors: ${preview.meta.errorRows}`}</span>
                  </Badge>
                )}
                <Badge variant="outline" data-testid="badge-detected-cols">
                  {isAr ? `أعمدة: ${preview.meta.detectedColumns.length}` : `Columns: ${preview.meta.detectedColumns.length}`}
                </Badge>
              </div>

              {preview.meta.detectedColumns.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {isAr ? 'الأعمدة المكتشفة: ' : 'Detected columns: '}
                  {preview.meta.detectedColumns.join(', ')}
                </div>
              )}

              {preview.errors.length > 0 && (
                <div className="border border-destructive/30 rounded-md overflow-auto max-h-[150px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">{isAr ? 'صف' : 'Row'}</TableHead>
                        <TableHead className="text-xs">{isAr ? 'عمود' : 'Column'}</TableHead>
                        <TableHead className="text-xs">{isAr ? 'السبب' : 'Reason'}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.errors.map((err, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{err.row}</TableCell>
                          <TableCell className="text-xs">{err.column}</TableCell>
                          <TableCell className="text-xs">{isAr ? err.reason_ar : err.reason_en}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {preview.rows.length > 0 && (
                <div className="border rounded-md overflow-auto max-h-[200px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">#</TableHead>
                        <TableHead className="text-xs">{isAr ? 'الوصف' : 'Desc'}</TableHead>
                        <TableHead className="text-xs">{isAr ? 'كود' : 'Code'}</TableHead>
                        <TableHead className="text-xs">{isAr ? 'عيار' : 'Karat'}</TableHead>
                        <TableHead className="text-xs">{isAr ? 'وزن' : 'Weight'}</TableHead>
                        <TableHead className="text-xs">{isAr ? 'تكلفة' : 'Cost'}</TableHead>
                        <TableHead className="text-xs">{isAr ? 'سعر بطاقة' : 'Tag'}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.slice(0, 20).map((row, i) => {
                        const errorRowNums = new Set(preview.errors.filter((e) => e.row === i + 1).map((e) => e.row));
                        const hasRowError = errorRowNums.size > 0;
                        return (
                          <TableRow key={i} className={hasRowError ? 'bg-destructive/10' : ''}>
                            <TableCell className="text-xs">{i + 1}</TableCell>
                            <TableCell className="text-xs">{row.description}</TableCell>
                            <TableCell className="text-xs">{row.stockcode}</TableCell>
                            <TableCell className="text-xs">{row.metal}</TableCell>
                            <TableCell className="text-xs">{row.g_weight}</TableCell>
                            <TableCell className="text-xs">{row.cost}</TableCell>
                            <TableCell className="text-xs">{row.tag_price}</TableCell>
                          </TableRow>
                        );
                      })}
                      {preview.rows.length > 20 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-xs text-center text-muted-foreground">
                            {isAr ? `... و ${preview.rows.length - 20} صف آخر` : `... and ${preview.rows.length - 20} more rows`}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2 border-t flex-wrap">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-paste">
            {isAr ? 'إلغاء' : 'Cancel'}
          </Button>
          {preview && !hasErrors && preview.rows.length > 0 && (
            <Button onClick={() => handleApply(false)} data-testid="button-apply-paste">
              <Check className="w-4 h-4" />
              <span className="mx-1">
                {isAr ? `تطبيق ${preview.rows.length} صف` : `Apply ${preview.rows.length} rows`}
              </span>
            </Button>
          )}
          {preview && hasErrors && preview.meta.validRows > 0 && (
            <Button onClick={() => handleApply(true)} variant="outline" data-testid="button-apply-valid-only">
              <Check className="w-4 h-4" />
              <span className="mx-1">
                {isAr ? `تطبيق الصفوف الصالحة فقط (${preview.meta.validRows})` : `Apply valid rows only (${preview.meta.validRows})`}
              </span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
