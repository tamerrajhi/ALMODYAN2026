import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp, Building2, StopCircle, Play, Clock, BarChart3, Timer, Zap, DollarSign, X, Trash2, Download, Database, Shield, FileText, Calendar, User, CreditCard, MapPin, Files } from 'lucide-react';
import { queryTable } from '@/lib/dataGateway';
import * as apiClient from '@/lib/apiClient';
import * as dataGateway from '@/lib/dataGateway';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBranches } from '@/hooks/useBranches';
import SupplierSelect from '@/components/purchasing/SupplierSelect';
import * as XLSX from 'xlsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { format, addDays } from 'date-fns';
import { getNextItemCodes } from '@/lib/codeGenerators';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ParsedRow {
  rowNumber: number;
  data: Record<string, any>;
  errors: string[];
  isValid: boolean;
  rawRowJson: Record<string, any>;
  extraFieldsJson: Record<string, any>;
  rawValuesArray: any[];
}

interface ValidationSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicates: number;
}

interface DuplicateRow {
  rowNumber: number;
  model: string;
  stockcode: string;
  suppRef: string;
  reason: string;
}

// Multi-file invoice data structure for SUPP INV preflight
interface FileInvoiceData {
  file: File;
  fileName: string;
  suppInv: string;  // Normalized SUPP INV (upper + trim)
  parsedRows: ParsedRow[];
  isValid: boolean;
  error?: string;
}

// Known/mapped columns - these get stored in structured fields
const KNOWN_COLUMNS = [
  'DIVISION', 'STOCKCODE', 'MODEL', 'SUPP.REF', 'SUPPLIER', 'DESCRIPTION', 
  'TYPE', 'COST CODE', 'TAG1', 'TAG2', 'TAG3', 'TAG4', 'TAG5',
  'COST', 'TAG PRICE', 'MINIMUM PRICE', 'G', 'D', 'B',
  'MQ', 'CS', // أعمدة الأوزان/الكميات الإضافية
  'STONE', 'METAL', 'M', 'RATE TYPE', 'CLARITY'
];

// جميع الأعمدة الرقمية
const NUMERIC_COLUMNS = ['COST', 'TAG PRICE', 'MINIMUM PRICE', 'G', 'D', 'B', 'MQ', 'CS', 'STONE', 'METAL', 'M'];

// الأعمدة الرقمية الإلزامية - تسبب أخطاء إذا كانت غير صالحة (غير رقمية)
const REQUIRED_NUMERIC_COLUMNS = ['COST', 'TAG PRICE'];

// الأعمدة الرقمية الاختيارية - لا تسبب أخطاء، تُحول إلى 0 إذا كانت فارغة أو غير صالحة
const OPTIONAL_NUMERIC_COLUMNS = ['G', 'D', 'B', 'MQ', 'CS', 'STONE', 'METAL', 'M'];

// دالة لتحويل القيم الرقمية الاختيارية - ترجع 0 إذا كانت فارغة أو غير صالحة
const parseOptionalNumeric = (value: any): number => {
  if (value === undefined || value === null || value === '') return 0;
  const num = parseFloat(value);
  return isNaN(num) || num < 0 ? 0 : num;
};

// دالة لتحليل القيم الرقمية التي قد تحتوي على فواصل آلاف (مثل 26,391 → 26391)
const parseNumericWithCommas = (value: any): number => {
  if (value === undefined || value === null || value === '') return 0;
  // إزالة الفواصل والمسافات من القيمة
  const cleaned = String(value).replace(/[,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) || num < 0 ? 0 : num;
};

// دالة لاستخراج كود الموديل الرئيسي (مثال: M8427 من M8427-A أو M8427/1)
const extractMainModelCode = (rawModel: any): string | null => {
  if (!rawModel) return null;
  const normalized = String(rawModel).trim().toUpperCase();
  if (!normalized) return null;
  // استخراج الكود الرئيسي (حروف اختيارية + أرقام) - مثال: M8427
  const match = normalized.match(/^([A-Z]*\d+)/);
  return match ? match[1] : normalized;
};

// Columns that should have values (soft validation - warns but doesn't block)
const PREFERRED_COLUMNS = ['DIVISION', 'STOCKCODE', 'MODEL', 'DESCRIPTION'];

// Helper function to compute SHA-256 hash of file content for duplicate detection
const computeFileHash = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
};

export default function ImportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { data: branches, isLoading: branchesLoading } = useBranches(true);
  
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const allowDuplicates = false; // دائماً false - التكرار ممنوع
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [validated, setValidated] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const cancelImportRef = useRef(false);
  
  // ==========================================
  // MULTI-FILE SUPP INV STATE
  // ==========================================
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInvoices, setFileInvoices] = useState<FileInvoiceData[]>([]);
  const [suppInvPreflightErrors, setSuppInvPreflightErrors] = useState<string[]>([]);
  const [isMultiFileMode, setIsMultiFileMode] = useState(false);
  
  // State for duplicate MODEL handling
  const [duplicateRows, setDuplicateRows] = useState<DuplicateRow[]>([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const checkModelDuplication = true; // دائماً true - التحقق مفعل دائماً
  
  // Invoice Header fields
  const [invoiceDescription, setInvoiceDescription] = useState<string>('');
  const [invoiceReference, setInvoiceReference] = useState<string>('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState<string>(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [paymentTerms, setPaymentTerms] = useState<string>('30');
  const [deliveryDate, setDeliveryDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Auto-generate invoice reference on mount
  useEffect(() => {
    const generateInvoiceReference = async () => {
      try {
        const branchCode = branches?.find(b => b.id === selectedBranchId)?.branch_code || '';
        const { data: invoiceNumber, error } = await dataGateway.generateInvoiceNumber('purchase', branchCode);
        if (!error && invoiceNumber) {
          setInvoiceReference(invoiceNumber);
        }
      } catch (error) {
        console.error('Failed to generate invoice reference:', error);
      }
    };
    
    if (selectedBranchId) {
      generateInvoiceReference();
    }
  }, [selectedBranchId, branches]);

  // Update due date when payment terms change
  useEffect(() => {
    if (issueDate && paymentTerms) {
      const days = parseInt(paymentTerms) || 0;
      setDueDate(format(addDays(new Date(issueDate), days), 'yyyy-MM-dd'));
    }
  }, [issueDate, paymentTerms]);
  
  // Re-check SUPP INV duplicates when supplier changes and files are already loaded
  useEffect(() => {
    if (!selectedSupplierId) return;
    
    const suppInvs: string[] = [];
    if (fileInvoices.length > 0) {
      fileInvoices.filter(f => f.suppInv && f.suppInv.trim() !== '').forEach(f => suppInvs.push(f.suppInv));
    } else if (parsedRows.length > 0) {
      const extracted = extractSuppInvFromSheet(parsedRows.map(r => r.rawRowJson));
      extracted.forEach(s => suppInvs.push(s));
    }
    const uniqueInvs = [...new Set(suppInvs)].filter(s => s && !s.startsWith('IMPORT-'));
    if (uniqueInvs.length === 0) return;

    const checkDuplicates = async () => {
      try {
        console.log('[SUPPLIER-CHANGE-CHECK] Checking DB for:', uniqueInvs, 'supplier:', selectedSupplierId);
        const res = await fetch('/api/rpc/unique_purchase_supp_inv_precheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ args: { p_supplier_id: selectedSupplierId, p_supp_invs: uniqueInvs } }),
        });
        const json = await res.json();
        console.log('[SUPPLIER-CHANGE-CHECK] Response:', JSON.stringify(json));
        const result = json.data as { success: boolean; exists?: string[] } | null;
        if (!json.error) {
          const existing = result?.exists || [];
          if (existing.length > 0) {
            console.log('[SUPPLIER-CHANGE-CHECK] DUPLICATES FOUND:', existing);
            setSuppInvPreflightErrors([`فواتير مورد مكررة في النظام: [${existing.join(', ')}]`]);
            setValidated(false);
            toast.error(`تنبيه: فواتير المورد [${existing.join(', ')}] موجودة مسبقاً عند هذا المورد`);
          } else {
            setSuppInvPreflightErrors(prev => prev.filter(e => !e.includes('فواتير مورد مكررة')));
          }
        }
      } catch (err) {
        console.error('[SUPPLIER-CHANGE-CHECK] Error:', err);
      }
    };
    checkDuplicates();
  }, [selectedSupplierId, fileInvoices, parsedRows]);

  // State for resumable import (not used with atomic RPC but kept for UI state)
  const [pausedImportState, setPausedImportState] = useState<null>(null);

  // State for cleanup confirmation dialog
  const [cleanupConfirmation, setCleanupConfirmation] = useState<{
    show: boolean;
    batchId: string | null;
    itemsCount: number;
    error: string;
  } | null>(null);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  
  // State for automatic backup before import
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState(0);
  
  // Available tables for backup
  const BACKUP_TABLES = [
    { id: 'unique_items', name: 'القطع الفريدة' },
    { id: 'unique_purchase_batches', name: 'دفعات الشراء' },
    { id: 'suppliers', name: 'الموردين' },
    { id: 'customers', name: 'العملاء' },
    { id: 'sales', name: 'المبيعات' },
    { id: 'branches', name: 'الفروع' },
    { id: 'gold_prices', name: 'أسعار الذهب' },
  ];
  const [selectedBackupTables, setSelectedBackupTables] = useState<string[]>(['unique_items', 'unique_purchase_batches', 'suppliers']);
  const [backupLogs, setBackupLogs] = useState<any[]>([]);
  const [showBackupHistory, setShowBackupHistory] = useState(false);
  
  // State for saving Excel copy after import
  const [isSavingExcel, setIsSavingExcel] = useState(false);
  const [excelSaved, setExcelSaved] = useState(false);
  
  // State for saved Excel files history
  const [savedExcelFiles, setSavedExcelFiles] = useState<any[]>([]);
  const [loadingExcelFiles, setLoadingExcelFiles] = useState(false);
  const [showExcelFilesHistory, setShowExcelFilesHistory] = useState(false);
  
  // State for pagination - display limits
  const [previewRowsLimit, setPreviewRowsLimit] = useState(50);
  const [duplicateModelsLimit, setDuplicateModelsLimit] = useState(10);
  
  // State for file hash (source_ref for duplicate detection)
  const [fileHash, setFileHash] = useState<string | null>(null);
  
  const fetchBackupLogs = async () => {
    const { data, error } = await queryTable<any[]>('backup_logs', {
      select: '*',
      order: { column: 'created_at', ascending: false },
      limit: 10,
    });
    if (!error && data) {
      setBackupLogs(data);
    }
  };
  
  // Delete a single backup log
  const deleteBackupLog = async (logId: string) => {
    toast.info('حذف سجلات النسخ الاحتياطية غير متاح حالياً');
  };
  
  // Delete old backup logs (older than 30 days)
  const deleteOldBackupLogs = async () => {
    toast.info('حذف سجلات النسخ الاحتياطية غير متاح حالياً');
  };
  
  // Delete all backup logs
  const deleteAllBackupLogs = async () => {
    if (!window.confirm('هل أنت متأكد من حذف جميع سجلات النسخ الاحتياطية؟')) return;
    toast.info('حذف سجلات النسخ الاحتياطية غير متاح حالياً');
  };

  const fetchSavedExcelFiles = async () => {
    setLoadingExcelFiles(true);
    const { data, error } = await queryTable<any[]>('attachments', {
      select: '*',
      filters: [
        { type: 'eq', column: 'related_module', value: 'imports' },
        { type: 'eq', column: 'attachment_type', value: 'import_excel' },
      ],
      order: { column: 'uploaded_at', ascending: false },
      limit: 20,
    });
    if (!error && data) {
      setSavedExcelFiles(data);
    }
    setLoadingExcelFiles(false);
  };

  // Save Excel copy after successful import
  const handleSaveExcelCopy = async () => {
    if (!file || !importStats) return;
    toast.error('هذه الميزة غير متاحة حالياً - جاري العمل على بديل');
  };

  // Download saved Excel file
  const handleDownloadExcel = async (_attachmentId: string) => {
    toast.error('هذه الميزة غير متاحة حالياً - جاري العمل على بديل');
  };

  const normalizeHeader = (header: string): string => {
    return header.trim().toUpperCase().replace(/\s+/g, ' ');
  };

  const isJunkColumn = (header: string): boolean => {
    const normalized = header.trim();
    if (!normalized) return true;
    if (normalized.toLowerCase().startsWith('unnamed:')) return true;
    if (/^unnamed:\s*\d+$/i.test(normalized)) return true;
    return false;
  };

  const toggleRowExpanded = (rowNumber: number) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rowNumber)) {
        newSet.delete(rowNumber);
      } else {
        newSet.add(rowNumber);
      }
      return newSet;
    });
  };

  // ==========================================
  // SUPP INV EXTRACTION FROM COLUMN "SUPP INV"
  // ==========================================
  const extractSuppInvFromSheet = (jsonData: any[]): string[] => {
    const suppInvs: string[] = [];
    
    jsonData.forEach((row: any) => {
      // Look for column exactly named "SUPP INV"
      const rawValue = row['SUPP INV'];
      if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
        // Normalize: upper(trim(value))
        const normalized = String(rawValue).trim().toUpperCase();
        suppInvs.push(normalized);
      }
    });
    
    return suppInvs;
  };

  // ==========================================
  // MULTI-FILE HANDLER WITH SUPP INV EXTRACTION
  // ==========================================
  const handleMultiFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Validate file extensions
    const fileList: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        toast.error(`يرجى رفع ملفات بصيغة .xlsx أو .xls فقط: ${file.name}`);
        return;
      }
      fileList.push(file);
    }

    setIsValidating(true);
    setSelectedFiles(fileList);
    setIsMultiFileMode(fileList.length > 1);
    setSuppInvPreflightErrors([]);
    setFileInvoices([]);

    try {
      const processedFiles: FileInvoiceData[] = [];

      for (const file of fileList) {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // Extract SUPP INV values from column "SUPP INV"
        const suppInvValues = extractSuppInvFromSheet(jsonData);
        const uniqueSuppInvs = [...new Set(suppInvValues)];

        // ==========================================
        // PER-FILE VALIDATION: Exactly ONE unique SUPP INV
        // ==========================================
        if (uniqueSuppInvs.length === 0) {
          processedFiles.push({
            file,
            fileName: file.name,
            suppInv: '',
            parsedRows: [],
            isValid: false,
            error: `الملف ${file.name} لا يحتوي على SUPP INV`
          });
          continue;
        }

        if (uniqueSuppInvs.length > 1) {
          processedFiles.push({
            file,
            fileName: file.name,
            suppInv: '',
            parsedRows: [],
            isValid: false,
            error: `الملف ${file.name} يحتوي على أكثر من SUPP INV: [${uniqueSuppInvs.join(', ')}]`
          });
          continue;
        }

        const suppInv = uniqueSuppInvs[0];
        processedFiles.push({
          file,
          fileName: file.name,
          suppInv,
          parsedRows: [],
          isValid: true
        });
      }

      // ==========================================
      // CHECK FOR PER-FILE VALIDATION ERRORS
      // ==========================================
      const filesWithErrors = processedFiles.filter(f => !f.isValid);
      if (filesWithErrors.length > 0) {
        const errorMessages = filesWithErrors.map(f => f.error || '');
        setSuppInvPreflightErrors(errorMessages);
        setFileInvoices([]);
        toast.error('فشل التحقق من الملفات');
        setIsValidating(false);
        return;
      }

      // ==========================================
      // CROSS-FILES DUPLICATE CHECK
      // ==========================================
      const suppInvToFiles: Map<string, string[]> = new Map();
      processedFiles.forEach(f => {
        if (f.suppInv) {
          const existing = suppInvToFiles.get(f.suppInv) || [];
          existing.push(f.fileName);
          suppInvToFiles.set(f.suppInv, existing);
        }
      });

      const crossFileDuplicates: string[] = [];
      suppInvToFiles.forEach((fileNames, suppInv) => {
        if (fileNames.length > 1) {
          crossFileDuplicates.push(`SUPP INV "${suppInv}" موجود في أكثر من ملف: [${fileNames.join(', ')}]`);
        }
      });

      if (crossFileDuplicates.length > 0) {
        setSuppInvPreflightErrors(crossFileDuplicates);
        setFileInvoices([]);
        toast.error('تكرار SUPP INV بين الملفات المحددة');
        setIsValidating(false);
        return;
      }

      // ==========================================
      // DB PRECHECK AT UPLOAD TIME: Check if SUPP INV already exists in DB
      // ==========================================
      const uploadSuppInvs = processedFiles
        .filter(f => f.suppInv && f.suppInv.trim() !== '' && !f.suppInv.startsWith('IMPORT-'))
        .map(f => f.suppInv);
      
      if (uploadSuppInvs.length > 0 && selectedSupplierId) {
        try {
          console.log('[UPLOAD-PRECHECK] Checking DB for existing SUPP INV:', uploadSuppInvs, 'supplier:', selectedSupplierId);
          const precheckRes = await fetch('/api/rpc/unique_purchase_supp_inv_precheck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              args: {
                p_supplier_id: selectedSupplierId,
                p_supp_invs: uploadSuppInvs,
              }
            }),
          });
          const precheckJson = await precheckRes.json();
          console.log('[UPLOAD-PRECHECK] RPC response:', JSON.stringify(precheckJson));
          const precheckResult = precheckJson.data as { success: boolean; exists?: string[] } | null;
          
          if (!precheckJson.error) {
            const existingInvs = precheckResult?.exists || [];
            if (existingInvs.length > 0) {
              console.log('[UPLOAD-PRECHECK] DUPLICATES FOUND:', existingInvs);
              const errorMsg = `فواتير مورد مكررة في النظام: [${existingInvs.join(', ')}]`;
              setSuppInvPreflightErrors([errorMsg]);
              setFileInvoices([]);
              toast.error('تنبيه: فواتير المورد موجودة مسبقاً في النظام');
              setIsValidating(false);
              return;
            }
          }
        } catch (err) {
          console.error('[UPLOAD-PRECHECK] Error:', err);
        }
      }

      // All preflight checks passed for file content
      setFileInvoices(processedFiles);
      
      // If single file, also set the legacy single-file state for backwards compatibility
      if (fileList.length === 1) {
        setFile(fileList[0]);
      }
      
      toast.success(`تم تحميل ${processedFiles.length} ملف بنجاح - SUPP INV: [${processedFiles.map(f => f.suppInv).join(', ')}]`);

    } catch (error) {
      console.error('Error processing files:', error);
      toast.error('خطأ في معالجة الملفات');
    } finally {
      setIsValidating(false);
      // Reset file input
      e.target.value = '';
    }
  }, [selectedSupplierId]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    if (!uploadedFile.name.endsWith('.xlsx') && !uploadedFile.name.endsWith('.xls')) {
      toast.error('يرجى رفع ملف بصيغة .xlsx أو .xls');
      return;
    }

    setFile(uploadedFile);
    setParsedRows([]);
    setSummary(null);
    setValidated(false);
    setDetectedHeaders([]);
    setExpandedRows(new Set());
    setPreviewRowsLimit(50);
    setDuplicateModelsLimit(10);
    setFileHash(null); // Reset file hash for new file
    setDuplicateRows([]); // Reset duplicate warnings
  }, []);

  const parseFileRows = async (targetFile: File) => {
    const arrayBuffer = await targetFile.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    if (jsonData.length < 2) {
      return { rows: [], rawHeaders: [], validHeaders: [], validCount: 0, errorCount: 0 };
    }

    const rawHeaders = (jsonData[0] as string[]).map(h => String(h || '').trim());
    const validHeaders = rawHeaders.filter(h => !isJunkColumn(h));

    const headerIndexMap: { index: number; original: string; normalized: string }[] = [];
    rawHeaders.forEach((h, i) => {
      if (!isJunkColumn(h)) {
        headerIndexMap.push({ index: i, original: h.trim(), normalized: normalizeHeader(h) });
      }
    });

    const rows: ParsedRow[] = [];
    let validCount = 0;
    let errorCount = 0;

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.every(cell => cell === null || cell === undefined || cell === '')) continue;

      const errors: string[] = [];
      const data: Record<string, any> = {};
      const rawRowJson: Record<string, any> = {};
      const extraFieldsJson: Record<string, any> = {};

      headerIndexMap.forEach(({ index, original, normalized }) => {
        const value = row[index];
        rawRowJson[original] = value;
        data[normalized] = value;
        if (!KNOWN_COLUMNS.includes(normalized)) {
          extraFieldsJson[original] = value;
        }
      });

      PREFERRED_COLUMNS.forEach(col => {
        const normalizedCol = normalizeHeader(col);
        if (!data[normalizedCol] && data[normalizedCol] !== 0) {
          // Just a warning, not blocking
        }
      });

      REQUIRED_NUMERIC_COLUMNS.forEach(col => {
        const normalizedCol = normalizeHeader(col);
        const val = data[normalizedCol];
        if (val !== undefined && val !== null && val !== '') {
          const num = parseNumericWithCommas(val);
          if (num === 0 && String(val).replace(/[,\s]/g, '') !== '0' && String(val).replace(/[,\s]/g, '') !== '') {
            errors.push(`${col} يجب أن يكون رقماً`);
          } else if (num < 0) {
            errors.push(`${col} لا يمكن أن يكون سالباً`);
          }
        }
      });

      const isValid = errors.length === 0;
      if (isValid) validCount++;
      else errorCount++;

      const rawValuesArray = rawHeaders.map((_, idx) => {
        const val = row[idx];
        return val === undefined || val === null ? '' : String(val);
      });

      rows.push({ 
        rowNumber: i + 1, 
        data, 
        errors, 
        isValid,
        rawRowJson,
        extraFieldsJson,
        rawValuesArray,
      });
    }

    return { rows, rawHeaders, validHeaders, validCount, errorCount };
  };

  const validateAndParse = async () => {
    const filesToValidate = fileInvoices.length > 0 
      ? fileInvoices.map(f => f.file) 
      : file ? [file] : [];
    if (filesToValidate.length === 0) return;
    setIsValidating(true);

    try {
      const hash = await computeFileHash(filesToValidate[0]);
      setFileHash(hash);
      console.log('[ImportPage] File hash computed:', hash.substring(0, 16) + '...');

      let allRows: ParsedRow[] = [];
      let totalValid = 0;
      let totalErrors = 0;
      let lastValidHeaders: string[] = [];

      if (fileInvoices.length > 0) {
        const updatedFileInvoices = [...fileInvoices];
        for (let fi = 0; fi < updatedFileInvoices.length; fi++) {
          const result = await parseFileRows(updatedFileInvoices[fi].file);
          updatedFileInvoices[fi] = { ...updatedFileInvoices[fi], parsedRows: result.rows };
          allRows = allRows.concat(result.rows);
          totalValid += result.validCount;
          totalErrors += result.errorCount;
          if (result.validHeaders.length > 0) lastValidHeaders = result.validHeaders;
        }
        setFileInvoices(updatedFileInvoices);
      } else {
        const result = await parseFileRows(filesToValidate[0]);
        allRows = result.rows;
        totalValid = result.validCount;
        totalErrors = result.errorCount;
        lastValidHeaders = result.validHeaders;
      }

      setDetectedHeaders(lastValidHeaders);
      setParsedRows(allRows);
      setDuplicateRows([]);

      // ==========================================
      // DB PRECHECK AT VALIDATION TIME
      // Uses allRows (freshly parsed) to extract SUPP INV - works for both modes
      // ==========================================
      if (selectedSupplierId) {
        const valSuppInvs: string[] = [];
        if (allRows.length > 0) {
          const extracted = extractSuppInvFromSheet(allRows.map(r => r.rawRowJson));
          extracted.forEach(s => valSuppInvs.push(s));
        }
        const uniqueValInvs = [...new Set(valSuppInvs)].filter(s => s && !s.startsWith('IMPORT-'));
        
        if (uniqueValInvs.length > 0) {
          try {
            console.log('[VALIDATE-PRECHECK] Checking DB for:', uniqueValInvs);
            const res = await fetch('/api/rpc/unique_purchase_supp_inv_precheck', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ args: { p_supplier_id: selectedSupplierId, p_supp_invs: uniqueValInvs } }),
            });
            const json = await res.json();
            console.log('[VALIDATE-PRECHECK] Response:', JSON.stringify(json));
            const result = json.data as { success: boolean; exists?: string[] } | null;
            if (!json.error) {
              const existing = result?.exists || [];
              if (existing.length > 0) {
                console.log('[VALIDATE-PRECHECK] DUPLICATES FOUND:', existing);
                setSuppInvPreflightErrors([`فواتير مورد مكررة في النظام: [${existing.join(', ')}]`]);
                setSummary({
                  totalRows: allRows.length,
                  validRows: totalValid,
                  errorRows: totalErrors,
                  duplicates: 0,
                });
                setValidated(false);
                toast.error(`تنبيه: فواتير المورد [${existing.join(', ')}] موجودة مسبقاً في النظام - لا يمكن الاستيراد`);
                setIsValidating(false);
                return;
              }
            }
          } catch (err) {
            console.error('[VALIDATE-PRECHECK] Error:', err);
          }
        }
      }

      setSummary({
        totalRows: allRows.length,
        validRows: totalValid,
        errorRows: totalErrors,
        duplicates: 0,
      });
      setValidated(true);
      const fileLabel = filesToValidate.length > 1 
        ? `${filesToValidate.length} ملفات` 
        : 'الملف';
      toast.success(`تم التحقق من ${fileLabel} - ${lastValidHeaders.length} عمود مكتشف، ${totalValid} صف صالح`);
    } catch (error) {
      console.error('Parse error:', error);
      toast.error('حدث خطأ أثناء قراءة الملف');
    }

    setIsValidating(false);
  };

  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importStartTime, setImportStartTime] = useState<number | null>(null);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string | null>(null);
  
  // Import statistics
  const [importStats, setImportStats] = useState<{
    totalTime: number; // in seconds
    itemsImported: number;
    itemsFailed: number;
    avgSpeed: number; // items per second
    totalCost: number;
    batchNo: string;
  } | null>(null);

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds < 60) {
      return `${Math.ceil(seconds)} ثانية`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.ceil(seconds % 60);
      return `${mins} دقيقة ${secs > 0 ? `و ${secs} ثانية` : ''}`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.ceil((seconds % 3600) / 60);
      return `${hours} ساعة ${mins > 0 ? `و ${mins} دقيقة` : ''}`;
    }
  };

  const updateTimeEstimate = (currentIndex: number, totalItems: number, startTime: number) => {
    const elapsed = (Date.now() - startTime) / 1000; // seconds
    if (currentIndex > 0 && elapsed > 0) {
      const itemsPerSecond = currentIndex / elapsed;
      const remainingItems = totalItems - currentIndex;
      const remainingSeconds = remainingItems / itemsPerSecond;
      setEstimatedTimeRemaining(formatTimeRemaining(remainingSeconds));
    }
  };

  // Play notification sound when import completes
  const playNotificationSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create a pleasant success sound (two ascending tones)
      const playTone = (frequency: number, startTime: number, duration: number) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };
      
      const now = audioContext.currentTime;
      playTone(523.25, now, 0.15); // C5
      playTone(659.25, now + 0.15, 0.15); // E5
      playTone(783.99, now + 0.30, 0.3); // G5
    } catch (error) {
      console.log('Could not play notification sound:', error);
    }
  }, []);

  // Cleanup function using Edge Function for reliable server-side cleanup
  const cleanupFailedImport = async (batchId: string | null) => {
    if (!batchId) {
      toast.error('لا توجد دفعة لتنظيفها');
      setCleanupConfirmation(null);
      return;
    }

    setIsCleaningUp(true);
    try {
      console.log('[ImportPage] Calling cleanup-import-batch for batch:', batchId);
      
      const cleanupRes = await fetch('/api/import/cleanup-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const { data, error } = await cleanupRes.json();

      if (error) {
        console.error('[ImportPage] Cleanup endpoint error:', error);
        toast.error(`فشل تنظيف الدفعة: ${error.message}`);
        return;
      }

      console.log('[ImportPage] Cleanup result:', data);

      if (data?.success) {
        const summary = [
          data.deleted_items > 0 ? `${data.deleted_items} قطعة` : null,
          data.deleted_errors > 0 ? `${data.deleted_errors} خطأ` : null,
          data.deleted_orphan_sets > 0 ? `${data.deleted_orphan_sets} طقم يتيم` : null,
          data.deleted_invoice ? 'الفاتورة المرتبطة' : null,
        ].filter(Boolean).join('، ');

        toast.success(`تم تنظيف الدفعة بالكامل ويمكن إعادة رفع نفس الملف${summary ? ` (حُذف: ${summary})` : ''}`);
        
        // Reset all import-related state
        setCleanupConfirmation(null);
        setPausedImportState(null);
        setFile(null);
        setParsedRows([]);
        setSummary(null);
        setValidated(false);
        setDuplicateRows([]);
        setImportStats(null);
        
      } else {
        const warnings = data?.warnings?.join(', ') || 'خطأ غير معروف';
        toast.error(`تنظيف جزئي: ${warnings}`);
      }
    } catch (cleanupError) {
      console.error('[ImportPage] Error during cleanup:', cleanupError);
      toast.error('حدث خطأ أثناء تنظيف البيانات');
    } finally {
      setIsCleaningUp(false);
    }
  };

  const getCleanupDetails = async (batchId: string | null): Promise<number> => {
    if (!batchId) return 0;
    const { count } = await queryTable('unique_items', {
      select: '*',
      filters: [{ type: 'eq', column: 'batch_id', value: batchId }],
      count: 'exact',
      head: true,
    });
    return count || 0;
  };

  // Automatic backup before import
  const performAutoBackup = async (): Promise<boolean> => {
    const tablesToBackup = selectedBackupTables.length > 0 ? selectedBackupTables : ['unique_items', 'unique_purchase_batches', 'suppliers'];
    setIsBackingUp(true);
    setBackupProgress(0);
    
    let totalRecords = 0;
    
    try {
      const workbook = XLSX.utils.book_new();
      
      for (let i = 0; i < tablesToBackup.length; i++) {
        const tableName = tablesToBackup[i];
        
        try {
          const { data, error } = await queryTable<any[]>(tableName, { select: '*' });
          
          if (error) {
            console.error(`Error fetching ${tableName}:`, error);
            continue;
          }

          if (data && data.length > 0) {
            const worksheet = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(workbook, worksheet, tableName.substring(0, 31));
            totalRecords += data.length;
          } else {
            const worksheet = XLSX.utils.json_to_sheet([]);
            XLSX.utils.book_append_sheet(workbook, worksheet, tableName.substring(0, 31));
          }
        } catch (err) {
          console.error(`Error processing ${tableName}:`, err);
        }

        setBackupProgress(Math.round(((i + 1) / tablesToBackup.length) * 100));
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `pre_import_backup_${timestamp}.xlsx`;

      XLSX.writeFile(workbook, filename);
      
      // Log the backup to database via atomic RPC
      const clientRequestId = crypto.randomUUID();
      await dataGateway.importBackupLogCreateAtomic(clientRequestId, {
        p_backup_type: 'pre_import',
        p_file_name: filename,
        p_tables_included: tablesToBackup,
        p_total_records: totalRecords,
        p_created_by: user?.email || null,
        p_notes: file ? `قبل استيراد: ${file.name}` : fileInvoices.length > 0 ? `قبل استيراد: ${fileInvoices.map(f => f.fileName).join(', ')}` : null,
      });
      
      // Refresh backup logs
      fetchBackupLogs();
      
      toast.success('تم إنشاء نسخة احتياطية تلقائية قبل الاستيراد');
      return true;
    } catch (error) {
      console.error('Backup failed:', error);
      toast.error('فشل إنشاء النسخة الاحتياطية');
      return false;
    } finally {
      setIsBackingUp(false);
      setBackupProgress(0);
    }
  };

  const handleImport = async () => {
    const activeFile = file || (fileInvoices.length > 0 ? fileInvoices[0].file : null);
    if (!activeFile || !validated) return;
    
    // Check if branch is selected
    if (!selectedBranchId) {
      toast.error('يرجى اختيار الفرع قبل الاستيراد');
      return;
    }
    
    // Check if supplier is selected
    if (!selectedSupplierId) {
      toast.error('يرجى اختيار المورد قبل الاستيراد');
      return;
    }
    
    // VALIDATION: يجب اختيار مورد قبل الاستيراد
    if (!selectedSupplierId) {
      toast.error('يجب اختيار المورد قبل بدء الاستيراد');
      return;
    }
    
    // Check if there are valid rows to import
    const validRowsCheck = parsedRows.filter(row => row.isValid);
    if (validRowsCheck.length === 0) {
      toast.error('لا توجد صفوف صالحة للاستيراد. جميع الصفوف تحتوي على أخطاء أو مكررات.');
      return;
    }

    // Multi-file safety: ensure parsedRows are populated per file
    if (isMultiFileMode && fileInvoices.length > 0) {
      const emptyFiles = fileInvoices.filter(f => f.isValid && f.parsedRows.length === 0);
      if (emptyFiles.length > 0) {
        toast.error('يرجى الضغط على "تحقق فقط" أولاً لتدقيق جميع الملفات');
        return;
      }
    }

    // ==========================================
    // DB PRECHECK: Call unique_purchase_supp_inv_precheck RPC
    // Works for BOTH single-file and multi-file modes
    // ==========================================
    {
      console.log('[PRECHECK] === START SUPP_INV DUPLICATE CHECK ===');
      console.log('[PRECHECK] fileInvoices.length:', fileInvoices.length);
      console.log('[PRECHECK] parsedRows.length:', parsedRows.length);
      console.log('[PRECHECK] isMultiFileMode:', isMultiFileMode);
      console.log('[PRECHECK] selectedSupplierId:', selectedSupplierId);

      const allSuppInvs: string[] = [];
      if (fileInvoices.length > 0) {
        console.log('[PRECHECK] Source: fileInvoices');
        fileInvoices.forEach(f => {
          console.log(`[PRECHECK]   file=${f.fileName}, suppInv="${f.suppInv}", isValid=${f.isValid}`);
          if (f.suppInv) allSuppInvs.push(f.suppInv);
        });
      } else if (parsedRows.length > 0) {
        console.log('[PRECHECK] Source: parsedRows (single-file fallback)');
        const extracted = extractSuppInvFromSheet(parsedRows.map(r => r.rawRowJson));
        console.log('[PRECHECK] Extracted from rows:', extracted);
        extracted.forEach(s => allSuppInvs.push(s));
      } else {
        console.log('[PRECHECK] WARNING: No fileInvoices and no parsedRows - cannot extract SUPP INV');
      }

      console.log('[PRECHECK] allSuppInvs (raw):', allSuppInvs);
      const uniqueSuppInvs = [...new Set(allSuppInvs)].filter(s => s && s.trim() !== '' && !s.startsWith('IMPORT-'));
      console.log('[PRECHECK] uniqueSuppInvs (filtered):', uniqueSuppInvs);

      if (uniqueSuppInvs.length > 0) {
        try {
          console.log('[PRECHECK] Calling RPC unique_purchase_supp_inv_precheck...');
          const precheckRes = await fetch('/api/rpc/unique_purchase_supp_inv_precheck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              args: {
                p_supplier_id: selectedSupplierId,
                p_supp_invs: uniqueSuppInvs,
              }
            }),
          });
          const precheckJson = await precheckRes.json();
          console.log('[PRECHECK] RPC response:', JSON.stringify(precheckJson));
          const precheckResult = precheckJson.data as { success: boolean; exists?: string[] } | null;
          const precheckError = precheckJson.error;

          if (precheckError) {
            console.error('[PRECHECK] RPC error:', precheckError);
            toast.error('خطأ في التحقق من قاعدة البيانات');
            return;
          }

          const existingInvs = precheckResult?.exists || [];
          console.log('[PRECHECK] Existing invoices found:', existingInvs);
          if (existingInvs.length > 0) {
            console.log('[PRECHECK] BLOCKING IMPORT - duplicates found:', existingInvs);
            const errorMsg = `هذه الفواتير موجودة بالفعل في النظام: [${existingInvs.join(', ')}]`;
            setSuppInvPreflightErrors([errorMsg]);
            toast.error('تم رفض الاستيراد - فواتير مكررة');
            return;
          }
          console.log('[PRECHECK] No duplicates found, proceeding...');
        } catch (precheckErr) {
          console.error('[PRECHECK] Network/parse error:', precheckErr);
          toast.error('خطأ في التحقق المسبق');
          return;
        }
      } else {
        console.log('[PRECHECK] SKIPPED - no valid SUPP INV values to check');
      }
      console.log('[PRECHECK] === END SUPP_INV DUPLICATE CHECK ===');
    }
    
    // Perform automatic backup if enabled
    if (autoBackupEnabled) {
      const backupSuccess = await performAutoBackup();
      if (!backupSuccess) {
        const proceed = window.confirm('فشل إنشاء النسخة الاحتياطية. هل تريد المتابعة بدونها؟');
        if (!proceed) return;
      }
    }
    
    setIsImporting(true);
    cancelImportRef.current = false;
    const validRows = parsedRows.filter(row => row.isValid);
    setImportProgress({ current: 0, total: validRows.length });
    setImportStartTime(Date.now());
    setEstimatedTimeRemaining(null);

    let batchId: string | null = null;

    try {
      // ==========================================
      // Build raw headers array (including empty strings, preserving order)
      // ==========================================
      const rawHeadersArray = detectedHeaders.map(h => h || '');

      // ==========================================
      // Build files payload for atomic RPC
      // One invoice per file (multi-file) or one invoice for single file
      // ==========================================
      // Resolve single-file SUPP INV from fileInvoices or parsed rows
      const resolveSingleFileSuppInv = (): string => {
        if (fileInvoices.length > 0 && fileInvoices[0]?.suppInv) {
          return fileInvoices[0].suppInv;
        }
        if (parsedRows.length > 0) {
          const extracted = extractSuppInvFromSheet(parsedRows.map(r => r.rawRowJson));
          const unique = [...new Set(extracted)].filter(s => s.trim() !== '');
          if (unique.length > 0) return unique[0];
        }
        return `IMPORT-${Date.now()}`;
      };

      const filesPayload = fileInvoices.length > 0 && isMultiFileMode
        ? fileInvoices.filter(f => f.isValid && f.suppInv).map(fileData => ({
            supp_inv: fileData.suppInv,
            invoice_date: issueDate || new Date().toISOString().split('T')[0],
            rows: fileData.parsedRows
              .filter((r: ParsedRow) => r.isValid)
              .map((r: ParsedRow) => ({
                raw_headers_json: rawHeadersArray,
                raw_values_json: r.rawValuesArray,
                raw_row_json: r.rawRowJson,
              })),
          }))
        : [{
            supp_inv: resolveSingleFileSuppInv(),
            invoice_date: issueDate || new Date().toISOString().split('T')[0],
            rows: validRows.map(r => ({
              raw_headers_json: rawHeadersArray,
              raw_values_json: r.rawValuesArray,
              raw_row_json: r.rawRowJson,
            })),
          }];

      // ==========================================
      // SINGLE ATOMIC RPC: unique_purchase_import_excel_atomic
      // Creates batch + invoices + items + movements + JE in one transaction
      // ==========================================
      const clientRequestId = crypto.randomUUID();
      const rpcPayload = {
        client_request_id: clientRequestId,
        supplier_id: selectedSupplierId,
        branch_id: selectedBranchId,
        vat_rate: 0,
        uploaded_file_name: activeFile.name,
        created_by: user?.id || null,
        files: filesPayload,
      };

      const importRes = await fetch('/api/rpc/unique_purchase_import_excel_atomic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ args: { p_payload: rpcPayload } }),
      });
      const importJson = await importRes.json();
      const importResult = importJson.data;
      const importError = importJson.error;

      if (importError || !importResult?.success) {
        if (importResult?.error === 'DUPLICATE_SUPP_INV') {
          const dupList = importResult?.duplicates || [];
          const errorMsg = `فواتير مورد مكررة في النظام: [${dupList.join(', ')}]`;
          setSuppInvPreflightErrors([errorMsg]);
          toast.error('تم رفض الاستيراد - فواتير مكررة في قاعدة البيانات');
          setIsImporting(false);
          return;
        }
        throw new Error(importError?.message || importResult?.error || importResult?.message_ar || 'فشل الاستيراد');
      }

      batchId = importResult.batch_id;
      const batchNo = importResult.batch_no || '';

      // Calculate and save import statistics
      const endTime = Date.now();
      const totalTimeSeconds = importStartTime ? (endTime - importStartTime) / 1000 : 0;
      const importedCount = importResult.items_created || validRows.length;
      const avgSpeed = totalTimeSeconds > 0 ? importedCount / totalTimeSeconds : 0;
      const totalCost = validRows.reduce((sum, row) => sum + parseNumericWithCommas(row.data['COST']), 0);
      
      setImportStats({
        totalTime: totalTimeSeconds,
        itemsImported: importedCount,
        itemsFailed: importResult.items_failed || 0,
        avgSpeed,
        totalCost,
        batchNo,
      });

      // Play success notification sound
      playNotificationSound();

      const invoiceCount = importResult.invoices_created || 0;
      if (invoiceCount > 0) {
        toast.success(`تم الاستيراد بنجاح: ${importedCount} قطعة، ${invoiceCount} فاتورة`, { duration: 6000 });
      } else {
        toast.success(`تم استيراد ${importedCount} قطعة بنجاح`, { duration: 6000 });
      }
    } catch (error) {
      console.error('Import error:', error);
      
      setCleanupConfirmation({
        show: true,
        batchId,
        itemsCount: 0,
        error: error instanceof Error ? error.message : 'خطأ غير معروف',
      });
    }

    setIsImporting(false);
    setImportProgress({ current: 0, total: 0 });
    setPausedImportState(null);
    setImportStartTime(null);
    setEstimatedTimeRemaining(null);
  };


  const knownDetected = detectedHeaders.filter(h => KNOWN_COLUMNS.includes(normalizeHeader(h)));
  const extraDetected = detectedHeaders.filter(h => !KNOWN_COLUMNS.includes(normalizeHeader(h)));

  return (
    <MainLayout>
      {/* Cleanup Confirmation Dialog */}
      <AlertDialog open={cleanupConfirmation?.show} onOpenChange={(open) => !open && setCleanupConfirmation(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              فشل الاستيراد - تأكيد التنظيف
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right space-y-4">
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm">
                <p className="font-medium text-destructive mb-1">سبب الفشل:</p>
                <p className="text-muted-foreground">{cleanupConfirmation?.error}</p>
              </div>
              
              <div className="bg-muted rounded-lg p-4 space-y-2">
                <p className="font-medium mb-2">سيتم حذف البيانات التالية:</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-destructive" />
                    قطع مجوهرات:
                  </span>
                  <span className="font-bold">{cleanupConfirmation?.itemsCount || 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-destructive" />
                    الدفعة:
                  </span>
                  <span className="font-bold">{cleanupConfirmation?.batchId ? '1' : '0'}</span>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                هل تريد حذف هذه البيانات؟ أو يمكنك إبقائها ومحاولة الإصلاح يدوياً.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction
              onClick={() => cleanupConfirmation && cleanupFailedImport(cleanupConfirmation.batchId)}
              disabled={isCleaningUp}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isCleaningUp ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري الحذف...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 ml-2" />
                  حذف البيانات
                </>
              )}
            </AlertDialogAction>
            <AlertDialogCancel disabled={isCleaningUp}>
              إبقاء البيانات
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicate MODEL Dialog */}
      <AlertDialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
              تم اكتشاف موديلات مكررة
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right space-y-4">
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-muted-foreground">أطقم مكررة:</span>
                  <span className="font-bold text-amber-600 text-lg">{summary?.duplicates || 0} مكرر</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">صفوف تنتمي للأطقم المكررة:</span>
                  <span className="font-bold text-amber-600">{summary?.duplicates || 0} صف</span>
                </div>
              </div>
              
              {/* Preview of duplicate models */}
              <div className="bg-muted rounded-lg p-3 max-h-60 overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">الأطقم المكررة:</p>
                  <p className="text-xs text-muted-foreground">
                    المعروض الآن {Math.min(duplicateModelsLimit, duplicateRows.length)} من {duplicateRows.length}
                  </p>
                </div>
                <div className="space-y-1">
                  {duplicateRows.slice(0, duplicateModelsLimit).map((item, idx) => (
                    <div key={idx} className="text-sm flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="font-mono">{item.model}</span>
                    </div>
                  ))}
                  {duplicateRows.length > duplicateModelsLimit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2 text-amber-600 hover:text-amber-700"
                      onClick={() => setDuplicateModelsLimit(prev => Math.min(prev + 50, duplicateRows.length))}
                    >
                      عرض المزيد ({duplicateRows.length - duplicateModelsLimit} متبقي)
                    </Button>
                  )}
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                اختر كيف تريد التعامل مع هذه المكررات:
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                // Download duplicates report
                const wb = XLSX.utils.book_new();
                const wsData = duplicateRows.map(row => ({
                  'رقم الصف': row.rowNumber,
                  'الموديل': row.model,
                  'STOCKCODE': row.stockcode,
                  'SUPP.REF': row.suppRef,
                  'السبب': row.reason
                }));
                const ws = XLSX.utils.json_to_sheet(wsData);
                XLSX.utils.book_append_sheet(wb, ws, 'المكررات');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                XLSX.writeFile(wb, `duplicates_report_${timestamp}.xlsx`);
                toast.success('تم تحميل تقرير المكررات');
              }}
            >
              <Download className="w-4 h-4 ml-2" />
              تحميل تقرير المكررات
            </Button>
            <AlertDialogCancel className="w-full sm:w-auto">
              إلغاء
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="animate-fade-in max-w-5xl">
        <div className="page-header">
          <h1 className="page-title">استيراد قطع من إكسل</h1>
          <p className="page-description">قم برفع ملف إكسل لاستيراد قطع المجوهرات - جميع الأعمدة ستُحفظ</p>
        </div>

        {/* Import Statistics Dialog */}
        {importStats && (
          <Card className="mb-6 border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2 text-green-700 dark:text-green-400">
                  <BarChart3 className="w-5 h-5" />
                  إحصائيات الاستيراد - الدفعة {importStats.batchNo}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setImportStats(null);
                    navigate('/batches');
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Total Time */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Timer className="w-4 h-4" />
                    <span className="text-sm">الوقت الإجمالي</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">
                    {formatTimeRemaining(importStats.totalTime)}
                  </p>
                </div>

                {/* Items Imported */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-sm">قطع تم استيرادها</span>
                  </div>
                  <p className="text-xl font-bold text-green-600">
                    {importStats.itemsImported.toLocaleString('ar-SA')}
                  </p>
                </div>

                {/* Items Failed */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <XCircle className="w-4 h-4 text-red-600" />
                    <span className="text-sm">قطع فاشلة</span>
                  </div>
                  <p className="text-xl font-bold text-red-600">
                    {importStats.itemsFailed.toLocaleString('ar-SA')}
                  </p>
                </div>

                {/* Average Speed */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Zap className="w-4 h-4 text-yellow-600" />
                    <span className="text-sm">سرعة الإدخال</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">
                    {importStats.avgSpeed.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">قطعة/ثانية</span>
                  </p>
                </div>
              </div>

              {/* Total Cost */}
              {importStats.totalCost > 0 && (
                <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-green-200 dark:border-green-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="w-4 h-4 text-gold" />
                      <span className="text-sm">إجمالي التكلفة</span>
                    </div>
                    <p className="text-xl font-bold text-gold">
                      {importStats.totalCost.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Button 
                  onClick={() => {
                    setImportStats(null);
                    setExcelSaved(false);
                    navigate('/batches');
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle className="w-4 h-4 ml-2" />
                  الذهاب إلى الدفعات
                </Button>
                
                {/* Save Excel Copy Button */}
                {file && !excelSaved && (
                  <Button 
                    onClick={handleSaveExcelCopy}
                    disabled={isSavingExcel}
                    variant="outline"
                    className="border-blue-500 text-blue-600 hover:bg-blue-50"
                  >
                    {isSavingExcel ? (
                      <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4 ml-2" />
                    )}
                    حفظ نسخة من ملف الإكسل
                  </Button>
                )}
                {excelSaved && (
                  <span className="text-green-600 flex items-center gap-1 px-4 py-2 bg-green-50 rounded-md">
                    <CheckCircle className="w-4 h-4" />
                    تم حفظ ملف الإكسل
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Branch Selection */}
        <Card className="mb-6 border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="w-5 h-5 text-gold" />
              اختيار الفرع
            </CardTitle>
          </CardHeader>
          <CardContent>
            {branchesLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري تحميل الفروع...
              </div>
            ) : branches && branches.length > 0 ? (
              <div className="flex items-center gap-4">
                <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="اختر الفرع..." />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name} ({branch.branch_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!selectedBranchId && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" />
                    يجب اختيار فرع قبل الاستيراد
                  </p>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                لا توجد فروع نشطة.{' '}
                <a href="/branches" className="text-gold hover:underline">أنشئ فرع جديد</a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoice Header Fields */}
        <Card className="mb-6 border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              بيانات رأس الفاتورة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Invoice Description */}
              <div className="lg:col-span-3">
                <Label htmlFor="invoice-description" className="text-sm font-medium mb-1.5 block">
                  وصف الفاتورة
                </Label>
                <Textarea
                  id="invoice-description"
                  value={invoiceDescription}
                  onChange={(e) => setInvoiceDescription(e.target.value)}
                  placeholder="أدخل وصف الفاتورة..."
                  className="resize-none"
                  rows={2}
                />
              </div>

              {/* Invoice Reference */}
              <div>
                <Label htmlFor="invoice-reference" className="text-sm font-medium mb-1.5 block">
                  المرجع (رقم الفاتورة)
                </Label>
                <div className="relative">
                  <Input
                    id="invoice-reference"
                    value={invoiceReference}
                    onChange={(e) => setInvoiceReference(e.target.value)}
                    placeholder="سيتم توليده تلقائياً..."
                    className="pl-8"
                    readOnly
                  />
                  <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">يتم توليده تلقائياً</p>
              </div>

              {/* Supplier Selection */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Label htmlFor="supplier" className="text-sm font-medium">
                    المورد
                  </Label>
                  {!selectedSupplierId && (
                    <span className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      يجب اختيار مورد قبل الاستيراد
                    </span>
                  )}
                </div>
                <SupplierSelect
                  value={selectedSupplierId}
                  onSelect={setSelectedSupplierId}
                  placeholder="ابحث عن مورد..."
                  showAddButton={true}
                />
              </div>

              {/* Issue Date */}
              <div>
                <Label htmlFor="issue-date" className="text-sm font-medium mb-1.5 block">
                  تاريخ الإصدار
                </Label>
                <div className="relative">
                  <Input
                    id="issue-date"
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="pl-8"
                  />
                  <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
              </div>

              {/* Payment Terms */}
              <div>
                <Label htmlFor="payment-terms" className="text-sm font-medium mb-1.5 block">
                  شروط الدفع
                </Label>
                <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر شروط الدفع..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">نقداً</SelectItem>
                    <SelectItem value="7">7 أيام</SelectItem>
                    <SelectItem value="15">15 يوم</SelectItem>
                    <SelectItem value="30">30 يوم</SelectItem>
                    <SelectItem value="45">45 يوم</SelectItem>
                    <SelectItem value="60">60 يوم</SelectItem>
                    <SelectItem value="90">90 يوم</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Due Date */}
              <div>
                <Label htmlFor="due-date" className="text-sm font-medium mb-1.5 block">
                  تاريخ الاستحقاق
                </Label>
                <div className="relative">
                  <Input
                    id="due-date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="pl-8"
                  />
                  <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
              </div>

              {/* Delivery Date */}
              <div>
                <Label htmlFor="delivery-date" className="text-sm font-medium mb-1.5 block">
                  تاريخ التوريد
                </Label>
                <div className="relative">
                  <Input
                    id="delivery-date"
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="pl-8"
                  />
                  <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Automatic Backup Settings */}
        <Card className="mb-6 border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-600" />
              النسخ الاحتياطي التلقائي
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  id="auto-backup"
                  checked={autoBackupEnabled}
                  onCheckedChange={setAutoBackupEnabled}
                />
                <div>
                  <Label htmlFor="auto-backup" className="font-medium">إنشاء نسخة احتياطية قبل الاستيراد</Label>
                  <p className="text-sm text-muted-foreground">
                    سيتم تصدير البيانات المحددة تلقائياً قبل بدء الاستيراد
                  </p>
                </div>
              </div>
              {isBackingUp && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin text-green-600" />
                    <span>جاري إنشاء النسخة الاحتياطية...</span>
                    <span className="font-medium">{backupProgress}%</span>
                  </div>
                </div>
              )}
            </div>
            
            {autoBackupEnabled && (
              <div className="border rounded-lg p-4 bg-muted/30">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-sm font-medium">الجداول المراد نسخها:</Label>
                  <div className="flex gap-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setSelectedBackupTables(BACKUP_TABLES.map(t => t.id))}
                      className="h-7 text-xs"
                    >
                      تحديد الكل
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setSelectedBackupTables([])}
                      className="h-7 text-xs"
                    >
                      إلغاء الكل
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {BACKUP_TABLES.map((table) => (
                    <label
                      key={table.id}
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        selectedBackupTables.includes(table.id)
                          ? 'bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-700'
                          : 'bg-background border-border hover:bg-muted/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedBackupTables.includes(table.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBackupTables(prev => [...prev, table.id]);
                          } else {
                            setSelectedBackupTables(prev => prev.filter(t => t !== table.id));
                          }
                        }}
                        className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                      />
                      <span className="text-sm">{table.name}</span>
                    </label>
                  ))}
                </div>
                {selectedBackupTables.length === 0 && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    سيتم استخدام الجداول الافتراضية إذا لم يتم تحديد أي جدول
                  </p>
                )}
              </div>
            )}
            
            {/* Backup History */}
            <div className="mt-4 pt-4 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowBackupHistory(!showBackupHistory);
                  if (!showBackupHistory) fetchBackupLogs();
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <Clock className="w-4 h-4 ml-2" />
                {showBackupHistory ? 'إخفاء السجل' : 'عرض سجل النسخ الاحتياطية'}
                {showBackupHistory ? <ChevronUp className="w-4 h-4 mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
              </Button>
              
              {showBackupHistory && (
                <div className="mt-3">
                  {/* Action buttons */}
                  {backupLogs.length > 0 && (
                    <div className="flex gap-2 mb-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={deleteOldBackupLogs}
                        className="text-amber-600 border-amber-300 hover:bg-amber-50"
                      >
                        <Clock className="w-4 h-4 ml-1" />
                        حذف الأقدم من 30 يوم
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={deleteAllBackupLogs}
                        className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4 ml-1" />
                        حذف الكل
                      </Button>
                    </div>
                  )}
                  
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {backupLogs.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">لا توجد نسخ احتياطية سابقة</p>
                    ) : (
                      backupLogs.map((log) => (
                        <div key={log.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border group">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Download className="w-4 h-4 text-green-600" />
                              <span className="font-medium text-sm">{log.file_name}</span>
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                              <span>{new Date(log.created_at).toLocaleString('ar-SA')}</span>
                              <span>{log.total_records} سجل</span>
                              <span>{log.tables_included?.length || 0} جدول</span>
                            </div>
                            {log.notes && (
                              <p className="text-xs text-muted-foreground mt-1">{log.notes}</p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteBackupLog(log.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Upload Card - MULTI-FILE INPUT */}
        <Card className="mb-6 border-0 shadow-md">
          <CardContent className="p-6">
            <div className="border-2 border-dashed border-gold/30 rounded-xl p-8 text-center bg-accent/20">
              <input
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={handleMultiFileUpload}
                className="hidden"
                id="file-upload"
                disabled={!selectedBranchId}
                data-testid="input-multi-file"
              />
              <label htmlFor="file-upload" className={selectedBranchId ? "cursor-pointer" : "cursor-not-allowed opacity-50"}>
                <div className="w-16 h-16 rounded-2xl bg-gradient-gold shadow-gold mx-auto mb-4 flex items-center justify-center">
                  {selectedFiles.length > 1 ? (
                    <Files className="w-8 h-8 text-navy" />
                  ) : (
                    <FileSpreadsheet className="w-8 h-8 text-navy" />
                  )}
                </div>
                <p className="font-semibold mb-1">
                  {selectedFiles.length > 0 
                    ? `${selectedFiles.length} ملف محدد`
                    : file 
                      ? file.name 
                      : 'اضغط لرفع ملف أو أكثر'}
                </p>
                <p className="text-sm text-muted-foreground">
                  صيغة .xlsx أو .xls — كل ملف = فاتورة واحدة مع SUPP INV فريد
                </p>
              </label>
            </div>

            {/* SUPP INV Preflight Errors */}
            {suppInvPreflightErrors.length > 0 && (
              <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <div className="flex items-center gap-2 text-destructive font-medium mb-2">
                  <AlertTriangle className="w-5 h-5" />
                  أخطاء التحقق المسبق (SUPP INV):
                </div>
                <ul className="text-sm space-y-1 text-destructive/80">
                  {suppInvPreflightErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Multi-file Summary */}
            {fileInvoices.length > 0 && (
              <div className="mt-4 p-4 bg-success/10 border border-success/20 rounded-lg">
                <div className="flex items-center gap-2 text-success font-medium mb-2">
                  <CheckCircle className="w-5 h-5" />
                  {fileInvoices.length} ملف جاهز للاستيراد
                </div>
                <div className="flex flex-wrap gap-2">
                  {fileInvoices.map((f, idx) => (
                    <span key={idx} className="px-2 py-1 bg-success/20 text-success rounded text-xs">
                      {f.fileName}: SUPP INV = {f.suppInv}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(file || fileInvoices.length > 0) && (
              <div className="mt-6 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-6">
                </div>
                <div className="flex gap-3 items-center">
                  {isImporting && importProgress.total > 0 && (
                    <>
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gold transition-all duration-300"
                              style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                            />
                          </div>
                          <span>{importProgress.current}/{importProgress.total}</span>
                        </div>
                        {estimatedTimeRemaining && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>الوقت المتبقي: {estimatedTimeRemaining}</span>
                          </div>
                        )}
                      </div>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => {
                          cancelImportRef.current = true;
                        }}
                      >
                        <StopCircle className="w-4 h-4 ml-1" />
                        إلغاء
                      </Button>
                    </>
                  )}
                  {pausedImportState && !isImporting && (
                    <>
                      <Button
                        variant="outline"
                        className="border-destructive text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          setPausedImportState(null);
                          toast.info('تم إلغاء حالة الاستئناف - يمكنك بدء استيراد جديد');
                        }}
                      >
                        <XCircle className="w-4 h-4 ml-1" />
                        تجاهل
                      </Button>
                    </>
                  )}
                  <Button variant="outline" onClick={validateAndParse} disabled={isValidating || isImporting}>
                    {isValidating && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                    تحقق فقط
                  </Button>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            className="bg-gradient-gold text-navy hover:opacity-90"
                            onClick={handleImport}
                            disabled={!validated || isImporting || !selectedBranchId || !selectedSupplierId || !!pausedImportState || (summary && summary.validRows === 0)}
                          >
                            {isImporting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                            استيراد الآن
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!selectedSupplierId && (
                        <TooltipContent side="top" className="bg-destructive text-destructive-foreground">
                          <p>يجب اختيار المورد قبل الاستيراد</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detected Columns */}
        {detectedHeaders.length > 0 && (
          <Card className="mb-6 border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                الأعمدة المكتشفة
                <span className="text-sm font-normal text-muted-foreground">({detectedHeaders.length} عمود)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2 text-success">أعمدة معروفة ({knownDetected.length}):</p>
                  <div className="flex flex-wrap gap-2">
                    {knownDetected.map(h => (
                      <span key={h} className="px-2 py-1 bg-success/10 text-success rounded text-xs">{h}</span>
                    ))}
                  </div>
                </div>
                {extraDetected.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2 text-gold">أعمدة إضافية ({extraDetected.length}):</p>
                    <div className="flex flex-wrap gap-2">
                      {extraDetected.map(h => (
                        <span key={h} className="px-2 py-1 bg-gold/10 text-gold rounded text-xs">{h}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary */}
        {summary && (
          <Card className="mb-6 border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-lg">ملخص التحقق</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">{summary.totalRows}</p>
                  <p className="text-sm text-muted-foreground">إجمالي الصفوف</p>
                </div>
                <div className="text-center p-4 bg-success/10 rounded-lg">
                  <p className="text-2xl font-bold text-success">{summary.validRows}</p>
                  <p className="text-sm text-muted-foreground">صفوف صحيحة</p>
                </div>
                <div className="text-center p-4 bg-destructive/10 rounded-lg">
                  <p className="text-2xl font-bold text-destructive">{summary.errorRows}</p>
                  <p className="text-sm text-muted-foreground">صفوف بأخطاء</p>
                </div>
                <div className="text-center p-4 bg-warning/10 rounded-lg">
                  <p className="text-2xl font-bold text-warning">{summary.duplicates}</p>
                  <p className="text-sm text-muted-foreground">قطع مكررة</p>
                </div>
              </div>
              {summary.duplicates > 0 && (
                <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-sm font-medium">يوجد {summary.duplicates} صف مكرر</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/50"
                      onClick={() => setShowDuplicateDialog(true)}
                    >
                      عرض الخيارات
                    </Button>
                  </div>
                </div>
              )}
              {summary.validRows === 0 && (
                <div className="mt-4 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
                  <div className="flex items-center gap-2 text-destructive">
                    <XCircle className="w-5 h-5" />
                    <span className="font-medium">لا يمكن الاستيراد</span>
                  </div>
                  <p className="text-sm text-destructive/80 mt-1">
                    جميع الصفوف في الملف تحتوي على أخطاء أو مكررات. يرجى مراجعة الملف وتصحيح الأخطاء.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Preview Table */}
        {parsedRows.length > 0 && (
          <Card className="border-0 shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-lg">
                  معاينة البيانات
                  {summary && summary.errorRows > 0 && (
                    <span className="text-sm font-normal text-destructive mr-2">
                      (إجمالي الصفوف التي بها أخطاء: {summary.errorRows})
                    </span>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>المعروض الآن {Math.min(previewRowsLimit, parsedRows.length)} من {parsedRows.length}</span>
                  {previewRowsLimit < parsedRows.length && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPreviewRowsLimit(parsedRows.length)}
                    >
                      عرض الكل
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[500px]">
                <table className="data-table text-xs">
                  <thead className="sticky top-0">
                    <tr>
                      <th>#</th>
                      <th>الحالة</th>
                      <th>MODEL</th>
                      <th>STOCKCODE</th>
                      <th>DIVISION</th>
                      <th>TYPE</th>
                      <th>COST</th>
                      <th>الأخطاء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, previewRowsLimit).map((row) => (
                      <tr key={row.rowNumber} className={row.isValid ? '' : 'bg-destructive/5'}>
                        <td>{row.rowNumber}</td>
                        <td>
                          {row.isValid ? (
                            <CheckCircle className="w-4 h-4 text-success" />
                          ) : (
                            <XCircle className="w-4 h-4 text-destructive" />
                          )}
                        </td>
                        <td>{row.data['MODEL']}</td>
                        <td>{row.data['STOCKCODE']}</td>
                        <td>{row.data['DIVISION']}</td>
                        <td>{row.data['TYPE']}</td>
                        <td>{row.data['COST']}</td>
                        <td className="text-destructive text-xs max-w-48 truncate">
                          {row.errors.join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewRowsLimit < parsedRows.length && (
                <div className="p-4 border-t flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => setPreviewRowsLimit(prev => Math.min(prev + 100, parsedRows.length))}
                  >
                    عرض المزيد (+100 صف) - متبقي {parsedRows.length - previewRowsLimit} صف
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Saved Excel Files History */}
        <Card className="mb-6 border-0 shadow-md">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                ملفات الاستيراد المحفوظة
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowExcelFilesHistory(!showExcelFilesHistory);
                  if (!showExcelFilesHistory) {
                    fetchSavedExcelFiles();
                  }
                }}
              >
                {showExcelFilesHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </div>
          </CardHeader>
          {showExcelFilesHistory && (
            <CardContent>
              {loadingExcelFiles ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري التحميل...
                </div>
              ) : savedExcelFiles.length === 0 ? (
                <p className="text-muted-foreground text-sm">لا توجد ملفات محفوظة</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-right">رقم الدفعة</th>
                        <th className="px-3 py-2 text-right">اسم الملف</th>
                        <th className="px-3 py-2 text-right">تاريخ الرفع</th>
                        <th className="px-3 py-2 text-right">الحجم</th>
                        <th className="px-3 py-2 text-center">تحميل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedExcelFiles.map((excelFile) => (
                        <tr key={excelFile.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-2 font-mono text-xs">{excelFile.related_record_id}</td>
                          <td className="px-3 py-2">{excelFile.file_name}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {format(new Date(excelFile.uploaded_at), 'yyyy-MM-dd HH:mm')}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {excelFile.file_size ? `${(excelFile.file_size / 1024).toFixed(1)} KB` : '-'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadExcel(excelFile.id)}
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </MainLayout>
  );
}
