import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Alert,
  AlertDescription,
} from '@/components/ui/alert';
import SupplierSelect from '@/components/purchasing/SupplierSelect';
import { useAuth } from '@/contexts/AuthContext';
import { rpc } from '@/lib/dataGateway';
import { toast } from 'sonner';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Download,
  Package,
  RotateCcw,
} from 'lucide-react';
import { format } from 'date-fns';

// ── Gold-specific column contract ──────────────────────────────────────────
const GOLD_REQUIRED_COLS = ['KARAT', 'WEIGHT_GROSS', 'UNIT_COST'] as const;
const GOLD_OPTIONAL_COLS = [
  'STONE_WEIGHT',
  'MAKING_CHARGE',
  'SUPP_REF',
  'MODEL_CODE',
  'DESCRIPTION',
  'BARCODE',
  'NOTES',
] as const;
const ALL_GOLD_COLS = [...GOLD_REQUIRED_COLS, ...GOLD_OPTIONAL_COLS] as const;

type GoldColKey = (typeof ALL_GOLD_COLS)[number];

type CellValue = string | number | boolean | null;

interface GoldRawRow {
  rowIndex: number;
  raw: Record<string, CellValue>;
  data: Partial<Record<GoldColKey, CellValue>>;
}

interface GoldValidatedRow extends GoldRawRow {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface GoldPrecheckResponse {
  is_duplicate: boolean;
}

interface GoldImportAtomicResponse {
  batch_id: string;
  batch_no: string;
  invoice_number: string;
  items_created: number;
}

// ── Parser ─────────────────────────────────────────────────────────────────
function normalizeHeader(h: string): string {
  return String(h ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '_');
}

function parseGoldFileRows(sheetRows: CellValue[][]): GoldRawRow[] {
  if (!sheetRows || sheetRows.length < 2) return [];

  const headerRow = sheetRows[0].map((h) => normalizeHeader(String(h ?? '')));
  const dataRows = sheetRows.slice(1);

  return dataRows
    .map((row, idx) => {
      const raw: Record<string, CellValue> = {};
      headerRow.forEach((h, i) => {
        raw[h] = row[i] ?? null;
      });

      const data: Partial<Record<GoldColKey, CellValue>> = {};
      for (const col of ALL_GOLD_COLS) {
        const normalized = normalizeHeader(col);
        const val = raw[normalized];
        data[col] = val !== undefined && val !== '' ? val : null;
      }

      return { rowIndex: idx + 2, raw, data };
    })
    .filter((r) => {
      const vals = Object.values(r.raw);
      return vals.some((v) => v !== null && v !== undefined && v !== '');
    });
}

// ── Validator ──────────────────────────────────────────────────────────────
function validateGoldRows(rows: GoldRawRow[]): GoldValidatedRow[] {
  return rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const karat = row.data['KARAT'];
    if (karat === null || karat === undefined || String(karat).trim() === '') {
      errors.push('العيار (KARAT) مطلوب');
    } else if (isNaN(Number(karat))) {
      errors.push('العيار (KARAT) يجب أن يكون رقماً');
    }

    const weightGross = row.data['WEIGHT_GROSS'];
    const wgNum = parseFloat(String(weightGross ?? ''));
    if (weightGross === null || weightGross === undefined || String(weightGross).trim() === '') {
      errors.push('الوزن الإجمالي (WEIGHT_GROSS) مطلوب');
    } else if (isNaN(wgNum) || wgNum <= 0) {
      errors.push('الوزن الإجمالي (WEIGHT_GROSS) يجب أن يكون أكبر من صفر');
    }

    const unitCost = row.data['UNIT_COST'];
    const ucNum = parseFloat(String(unitCost ?? ''));
    if (unitCost === null || unitCost === undefined || String(unitCost).trim() === '') {
      errors.push('التكلفة (UNIT_COST) مطلوبة');
    } else if (isNaN(ucNum) || ucNum <= 0) {
      errors.push('التكلفة (UNIT_COST) يجب أن تكون أكبر من صفر');
    }

    if (!row.data['STONE_WEIGHT']) warnings.push('وزن الأحجار (STONE_WEIGHT) غير موجود — سيُعامَل كصفر');
    if (!row.data['MAKING_CHARGE']) warnings.push('أجرة الصنعة (MAKING_CHARGE) غير موجودة');
    if (!row.data['DESCRIPTION']) warnings.push('الوصف (DESCRIPTION) غير موجود');
    if (!row.data['MODEL_CODE']) warnings.push('كود الموديل (MODEL_CODE) غير موجود');
    if (!row.data['BARCODE']) warnings.push('الباركود (BARCODE) غير موجود — سيُولَّد تلقائياً');

    return { ...row, isValid: errors.length === 0, errors, warnings };
  });
}

// ── Excel template download ─────────────────────────────────────────────────
function downloadGoldTemplate() {
  const headers = [
    'KARAT',
    'WEIGHT_GROSS',
    'UNIT_COST',
    'STONE_WEIGHT',
    'MAKING_CHARGE',
    'SUPP_REF',
    'MODEL_CODE',
    'DESCRIPTION',
    'BARCODE',
    'NOTES',
  ];
  const exampleRow = ['21', '10.5', '2500', '0.5', '15', 'SUP-001', 'MOD-100', 'خاتم ذهب', '', 'ملاحظات'];
  const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Gold Import');
  XLSX.writeFile(wb, 'gold_import_template.xlsx');
}

// ── Main Component ──────────────────────────────────────────────────────────
type ImportStep = 'setup' | 'preview' | 'importing' | 'result';

interface ImportResult {
  batch_no: string;
  invoice_number: string;
  items_created: number;
  batch_id?: string;
}

export default function GoldImportPage() {
  const { user } = useAuth();

  const [step, setStep] = useState<ImportStep>('setup');

  const [branchId, setBranchId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [suppInv, setSuppInv] = useState('');
  const [vatRate, setVatRate] = useState('0');

  const [fileName, setFileName] = useState('');
  const [validatedRows, setValidatedRows] = useState<GoldValidatedRow[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch gold branches only ──
  const { data: goldBranches = [], isLoading: branchesLoading } = useQuery({
    queryKey: ['branches', { branch_type: 'gold', active: true }],
    queryFn: async () => {
      const res = await fetch('/api/branches?branch_type=gold&active=true', { credentials: 'include' });
      if (!res.ok) throw new Error('فشل تحميل الفروع');
      const data = await res.json();
      return data as Array<{ id: string; branch_name: string; branch_code: string }>;
    },
  });

  // ── Fetch gold karats for validation display ──
  const { data: goldKarats = [] } = useQuery({
    queryKey: ['gold-karats-active'],
    queryFn: async () => {
      const res = await fetch('/api/gold-karats-active', { credentials: 'include' });
      if (!res.ok) return [];
      return await res.json() as Array<{ id: string; karat: number; name: string }>;
    },
  });

  // ── Excel parsing ──
  const processFile = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast.error('يُقبَل ملفات Excel فقط (.xlsx أو .xls)');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as CellValue[][];
        const raw = parseGoldFileRows(sheetRows);
        const validated = validateGoldRows(raw);
        setValidatedRows(validated);
        if (validated.length === 0) {
          toast.warning('الملف لا يحتوي على صفوف بيانات');
        } else {
          setStep('preview');
        }
      } catch {
        toast.error('فشل قراءة الملف');
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  // ── Submit ──
  const handleConfirmImport = async () => {
    if (!branchId || !supplierId || !invoiceDate) {
      toast.error('يرجى تحديد الفرع والمورد والتاريخ');
      return;
    }
    const validRows = validatedRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      toast.error('لا توجد صفوف صالحة للاستيراد');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setStep('importing');

    const clientRequestId = crypto.randomUUID();

    try {
      // Step 1: precheck duplicate supplier invoice
      if (suppInv.trim()) {
        const { data: precheckData, error: precheckError } = await rpc<GoldPrecheckResponse>('gold_purchase_supp_inv_precheck', {
          p_supplier_id: supplierId,
          p_branch_id: branchId,
          p_supp_inv: suppInv.trim(),
        });
        if (precheckError) {
          throw new Error(precheckError.message || 'فشل التحقق من رقم فاتورة المورد');
        }
        if (precheckData?.is_duplicate) {
          throw new Error(`رقم فاتورة المورد "${suppInv}" مسجّل مسبقاً`);
        }
      }

      // Step 2: build rows payload
      const rows = validRows.map((r) => ({
        karat: Number(r.data['KARAT']),
        g_weight_gross: parseFloat(String(r.data['WEIGHT_GROSS'])),
        stone_weight: r.data['STONE_WEIGHT'] ? parseFloat(String(r.data['STONE_WEIGHT'])) : 0,
        unit_cost: parseFloat(String(r.data['UNIT_COST'])),
        making_charge_per_gram: r.data['MAKING_CHARGE'] ? parseFloat(String(r.data['MAKING_CHARGE'])) : null,
        supp_ref: r.data['SUPP_REF'] ? String(r.data['SUPP_REF']) : null,
        model_code: r.data['MODEL_CODE'] ? String(r.data['MODEL_CODE']) : null,
        description: r.data['DESCRIPTION'] ? String(r.data['DESCRIPTION']) : null,
        barcode: r.data['BARCODE'] ? String(r.data['BARCODE']) : null,
        notes: r.data['NOTES'] ? String(r.data['NOTES']) : null,
      }));

      // Step 3: atomic import
      const { data: importData, error: importError } = await rpc<GoldImportAtomicResponse>('gold_purchase_import_excel_atomic', {
        p_supplier_id: supplierId,
        p_branch_id: branchId,
        p_invoice_date: invoiceDate,
        p_vat_rate: parseFloat(vatRate) || 0,
        p_supp_inv: suppInv.trim() || null,
        p_uploaded_file_name: fileName,
        p_created_by: user?.id || null,
        p_client_request_id: clientRequestId,
        p_rows: rows,
      });

      if (importError) {
        throw new Error(importError.message || 'فشل استيراد الملف');
      }

      // Strict guard: RPC must return identifiers — absence signals server failure
      if (!importData?.batch_no || !importData?.invoice_number) {
        throw new Error('استجابة غير متوقعة من السيرفر: لم يتم إرجاع رقم الدفعة أو رقم الفاتورة');
      }

      // Step 4: backup log (non-blocking, with observability logging)
      rpc('gold_import_backup_log_create_atomic', {
        p_client_request_id: clientRequestId,
        p_branch_id: branchId,
        p_supplier_id: supplierId,
        p_file_name: fileName,
        p_row_count: rows.length,
        p_batch_id: importData.batch_id,
      }).catch((logErr: unknown) => {
        console.warn('[GoldImport] backup log failed (non-critical):', logErr);
      });

      setImportResult({
        batch_no: importData.batch_no,
        invoice_number: importData.invoice_number,
        items_created: importData.items_created,
        batch_id: importData.batch_id,
      });
      setStep('result');
      toast.success('تم الاستيراد بنجاح');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء الاستيراد';
      setImportError(msg);
      setStep('preview');
      toast.error(msg);

      // cleanup on failure (non-blocking, with observability logging)
      rpc('cleanup_gold_import_batch_atomic', {
        p_client_request_id: clientRequestId,
      }).catch((cleanupErr: unknown) => {
        console.warn('[GoldImport] cleanup failed (non-critical):', cleanupErr);
      });
    } finally {
      setIsImporting(false);
    }
  };

  // ── Derived stats ──
  const validRows = validatedRows.filter((r) => r.isValid);
  const invalidRows = validatedRows.filter((r) => !r.isValid);
  const warnRows = validatedRows.filter((r) => r.isValid && r.warnings.length > 0);
  const canSubmit = branchId && supplierId && invoiceDate && validRows.length > 0;

  const resetAll = () => {
    setStep('setup');
    setValidatedRows([]);
    setFileName('');
    setImportResult(null);
    setImportError(null);
    setSuppInv('');
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-8 w-8 text-amber-500" />
            <div>
              <h1 className="text-3xl font-bold">استيراد قطع الذهب</h1>
              <p className="text-muted-foreground">رفع ملف Excel لإضافة قطع ذهب مشتراة</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={downloadGoldTemplate} data-testid="button-download-template">
            <Download className="h-4 w-4 ml-2" />
            تحميل نموذج Excel
          </Button>
        </div>

        {/* ── Step: Result ──────────────────────────────────────── */}
        {step === 'result' && importResult && (
          <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-6 w-6" />
                تم الاستيراد بنجاح
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white dark:bg-background rounded-lg p-4 text-center border">
                  <div className="text-2xl font-bold text-amber-600">{importResult.items_created}</div>
                  <div className="text-sm text-muted-foreground">قطعة مستوردة</div>
                </div>
                <div className="bg-white dark:bg-background rounded-lg p-4 text-center border">
                  <div className="text-lg font-bold">{importResult.batch_no}</div>
                  <div className="text-sm text-muted-foreground">رقم الدفعة</div>
                </div>
                <div className="bg-white dark:bg-background rounded-lg p-4 text-center border">
                  <div className="text-lg font-bold">{importResult.invoice_number}</div>
                  <div className="text-sm text-muted-foreground">رقم الفاتورة</div>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button onClick={resetAll} variant="outline" data-testid="button-new-import">
                  <RotateCcw className="h-4 w-4 ml-2" />
                  استيراد دفعة جديدة
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step: Importing ───────────────────────────────────── */}
        {step === 'importing' && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-amber-500" />
              <p className="text-lg font-medium">جاري استيراد قطع الذهب...</p>
              <p className="text-sm text-muted-foreground">الرجاء الانتظار، لا تغلق الصفحة</p>
            </CardContent>
          </Card>
        )}

        {step !== 'result' && step !== 'importing' && (
          <>
            {/* ── Setup card ─────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle>بيانات الاستيراد</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Branch */}
                  <div className="space-y-2">
                    <Label htmlFor="branch-select">
                      الفرع (ذهب فقط) <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={branchId}
                      onValueChange={setBranchId}
                      disabled={branchesLoading}
                      data-testid="select-branch"
                    >
                      <SelectTrigger id="branch-select" data-testid="trigger-branch">
                        <SelectValue placeholder={branchesLoading ? 'جاري التحميل...' : 'اختر الفرع'} />
                      </SelectTrigger>
                      <SelectContent>
                        {goldBranches.map((b) => (
                          <SelectItem key={b.id} value={b.id} data-testid={`option-branch-${b.id}`}>
                            {b.branch_name}
                          </SelectItem>
                        ))}
                        {!branchesLoading && goldBranches.length === 0 && (
                          <SelectItem value="__none" disabled>
                            لا توجد فروع ذهب مسجّلة
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Supplier */}
                  <div className="space-y-2">
                    <Label>
                      المورد <span className="text-destructive">*</span>
                    </Label>
                    <SupplierSelect
                      value={supplierId}
                      onSelect={setSupplierId}
                      placeholder="اختر المورد"
                      showAddButton
                    />
                  </div>

                  {/* Invoice date */}
                  <div className="space-y-2">
                    <Label htmlFor="invoice-date">
                      تاريخ الفاتورة <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="invoice-date"
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      data-testid="input-invoice-date"
                    />
                  </div>

                  {/* Supplier invoice ref */}
                  <div className="space-y-2">
                    <Label htmlFor="supp-inv">رقم فاتورة المورد</Label>
                    <Input
                      id="supp-inv"
                      placeholder="اختياري — للتحقق من التكرار"
                      value={suppInv}
                      onChange={(e) => setSuppInv(e.target.value)}
                      data-testid="input-supp-inv"
                    />
                  </div>

                  {/* VAT */}
                  <div className="space-y-2">
                    <Label htmlFor="vat-rate">نسبة الضريبة % (الافتراضي: 0)</Label>
                    <Input
                      id="vat-rate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={vatRate}
                      onChange={(e) => setVatRate(e.target.value)}
                      data-testid="input-vat-rate"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Upload zone ─────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle>رفع ملف Excel</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20'
                      : 'border-border hover:border-amber-300 hover:bg-muted/30'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="dropzone-upload"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFileChange}
                    data-testid="input-file"
                  />
                  <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  {fileName ? (
                    <div>
                      <p className="font-medium text-amber-600">{fileName}</p>
                      <p className="text-sm text-muted-foreground mt-1">اضغط لتغيير الملف</p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium">اسحب ملف Excel هنا أو اضغط للاختيار</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        الأعمدة المطلوبة: KARAT، WEIGHT_GROSS، UNIT_COST
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── Validation summary + Preview ─────────────────────── */}
            {validatedRows.length > 0 && step === 'preview' && (
              <>
                {/* Error alert */}
                {importError && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{importError}</AlertDescription>
                  </Alert>
                )}

                {/* Summary badges */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>ملخص التحقق</span>
                      <div className="flex gap-2">
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="badge-valid-count">
                          <CheckCircle2 className="h-3 w-3 ml-1" />
                          {validRows.length} صحيح
                        </Badge>
                        {invalidRows.length > 0 && (
                          <Badge variant="destructive" data-testid="badge-invalid-count">
                            <XCircle className="h-3 w-3 ml-1" />
                            {invalidRows.length} خطأ
                          </Badge>
                        )}
                        {warnRows.length > 0 && (
                          <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" data-testid="badge-warn-count">
                            <AlertTriangle className="h-3 w-3 ml-1" />
                            {warnRows.length} تحذير
                          </Badge>
                        )}
                      </div>
                    </CardTitle>
                  </CardHeader>
                </Card>

                {/* Error rows */}
                {invalidRows.length > 0 && (
                  <Card className="border-destructive/50">
                    <CardHeader>
                      <CardTitle className="text-destructive text-base">صفوف مرفوضة</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="max-h-48">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>رقم الصف</TableHead>
                              <TableHead>العيار</TableHead>
                              <TableHead>الوزن</TableHead>
                              <TableHead>التكلفة</TableHead>
                              <TableHead>الأخطاء</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {invalidRows.map((r) => (
                              <TableRow key={r.rowIndex} className="bg-red-50 dark:bg-red-950/20" data-testid={`row-error-${r.rowIndex}`}>
                                <TableCell className="font-mono">{r.rowIndex}</TableCell>
                                <TableCell>{String(r.data['KARAT'] ?? '-')}</TableCell>
                                <TableCell>{String(r.data['WEIGHT_GROSS'] ?? '-')}</TableCell>
                                <TableCell>{String(r.data['UNIT_COST'] ?? '-')}</TableCell>
                                <TableCell className="text-destructive text-sm">
                                  {r.errors.join('، ')}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {/* Preview of valid rows */}
                {validRows.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5 text-amber-500" />
                        معاينة القطع ({validRows.length} قطعة)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="max-h-96">
                        <div className="responsive-table-wrapper">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>العيار</TableHead>
                                <TableHead>الوزن الإجمالي (جم)</TableHead>
                                <TableHead>وزن الأحجار (جم)</TableHead>
                                <TableHead>التكلفة (ر.س)</TableHead>
                                <TableHead>أجرة الصنعة</TableHead>
                                <TableHead>مرجع المورد</TableHead>
                                <TableHead>كود الموديل</TableHead>
                                <TableHead>الوصف</TableHead>
                                <TableHead>حالة</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {validRows.map((r, idx) => (
                                <TableRow key={r.rowIndex} data-testid={`row-preview-${r.rowIndex}`}>
                                  <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                                  <TableCell className="font-bold text-amber-600">
                                    {String(r.data['KARAT'])}K
                                  </TableCell>
                                  <TableCell>{String(r.data['WEIGHT_GROSS'])}</TableCell>
                                  <TableCell>{r.data['STONE_WEIGHT'] ? String(r.data['STONE_WEIGHT']) : '—'}</TableCell>
                                  <TableCell>{String(r.data['UNIT_COST'])}</TableCell>
                                  <TableCell>{r.data['MAKING_CHARGE'] ? String(r.data['MAKING_CHARGE']) : '—'}</TableCell>
                                  <TableCell className="text-muted-foreground">{r.data['SUPP_REF'] ? String(r.data['SUPP_REF']) : '—'}</TableCell>
                                  <TableCell className="text-muted-foreground">{r.data['MODEL_CODE'] ? String(r.data['MODEL_CODE']) : '—'}</TableCell>
                                  <TableCell className="text-muted-foreground">{r.data['DESCRIPTION'] ? String(r.data['DESCRIPTION']) : '—'}</TableCell>
                                  <TableCell>
                                    {r.warnings.length > 0 ? (
                                      <Badge className="bg-yellow-100 text-yellow-800 text-xs">
                                        <AlertTriangle className="h-3 w-3 ml-1" />
                                        تحذير
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-green-100 text-green-800 text-xs">
                                        <CheckCircle2 className="h-3 w-3 ml-1" />
                                        صحيح
                                      </Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {/* Confirm / Reset buttons */}
                <div className="flex gap-3 justify-end">
                  <Button
                    variant="outline"
                    onClick={resetAll}
                    data-testid="button-reset"
                  >
                    <RotateCcw className="h-4 w-4 ml-2" />
                    إعادة تعيين
                  </Button>
                  <Button
                    onClick={handleConfirmImport}
                    disabled={!canSubmit || isImporting}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    data-testid="button-confirm-import"
                  >
                    {isImporting ? (
                      <Loader2 className="h-4 w-4 animate-spin ml-2" />
                    ) : (
                      <Upload className="h-4 w-4 ml-2" />
                    )}
                    تأكيد الاستيراد ({validRows.length} قطعة)
                  </Button>
                </div>

                {!canSubmit && (
                  <p className="text-sm text-muted-foreground text-left">
                    {!branchId && 'يرجى اختيار الفرع. '}
                    {!supplierId && 'يرجى اختيار المورد. '}
                    {!invoiceDate && 'يرجى تحديد تاريخ الفاتورة. '}
                    {validRows.length === 0 && 'لا توجد صفوف صالحة. '}
                  </p>
                )}
              </>
            )}
          </>
        )}

        {/* Karat reference */}
        {goldKarats.length > 0 && (
          <Card className="border-amber-100">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">العيارات المدعومة</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {goldKarats.map((k) => (
                  <Badge key={k.id} className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid={`badge-karat-${k.karat}`}>
                    {k.karat}K
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
