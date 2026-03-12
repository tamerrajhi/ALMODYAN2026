import { useState, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, Upload, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { InvoiceLine, calculateLine } from './InvoiceLineRow';

interface ExcelImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: { id: string; item_code: string; description: string | null }[];
  onImport: (lines: InvoiceLine[]) => void;
}

interface ImportError {
  row: number;
  message: string;
}

export const ExcelImportDialog = ({ open, onOpenChange, products, onImport }: ExcelImportDialogProps) => {
  const { t } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const templateData = [
      {
        'كود المنتج / Product Code': 'ITM-00000001',
        'الوصف / Description': 'Product description',
        'الكمية / Quantity': 1,
        'سعر الوحدة / Unit Price': 100,
        'شامل الضريبة؟ (0/1) / Tax Inclusive?': 0,
        'الخصم / Discount': 0,
        'نسبة الضريبة % / Tax Rate %': 15,
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoice Lines');
    
    // Set column widths
    ws['!cols'] = [
      { wch: 25 }, { wch: 30 }, { wch: 15 }, { wch: 18 },
      { wch: 25 }, { wch: 15 }, { wch: 20 }
    ];

    XLSX.writeFile(wb, 'purchase_invoice_template.xlsx');
    toast.success(t.purchaseInvoices.templateDownloaded);
  };

  const processExcelFile = async (file: File) => {
    setIsLoading(true);
    setErrors([]);
    setImportedCount(0);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const newErrors: ImportError[] = [];
      const validLines: InvoiceLine[] = [];

      jsonData.forEach((row: any, index: number) => {
        const rowNum = index + 2; // Excel rows start at 1, header is row 1
        
        // Get product code from various possible column names
        const productCode = row['كود المنتج / Product Code'] || row['Product Code'] || row['كود المنتج'] || '';
        const description = row['الوصف / Description'] || row['Description'] || row['الوصف'] || '';
        const quantity = parseFloat(row['الكمية / Quantity'] || row['Quantity'] || row['الكمية'] || 0);
        const unitPrice = parseFloat(row['سعر الوحدة / Unit Price'] || row['Unit Price'] || row['سعر الوحدة'] || 0);
        const isInclusive = (row['شامل الضريبة؟ (0/1) / Tax Inclusive?'] || row['Tax Inclusive?'] || row['شامل الضريبة'] || 0) == 1;
        const discount = parseFloat(row['الخصم / Discount'] || row['Discount'] || row['الخصم'] || 0);
        const taxRate = parseFloat(row['نسبة الضريبة % / Tax Rate %'] || row['Tax Rate %'] || row['نسبة الضريبة'] || 15);

        // Validate
        if (!productCode && !description) {
          newErrors.push({ row: rowNum, message: t.purchaseInvoices.errorNoProduct });
          return;
        }

        if (isNaN(quantity) || quantity <= 0) {
          newErrors.push({ row: rowNum, message: t.purchaseInvoices.errorInvalidQuantity });
          return;
        }

        if (isNaN(unitPrice) || unitPrice < 0) {
          newErrors.push({ row: rowNum, message: t.purchaseInvoices.errorInvalidPrice });
          return;
        }

        // Find product by code
        const product = products.find(p => p.item_code.toLowerCase() === productCode.toString().toLowerCase());
        
        if (productCode && !product) {
          newErrors.push({ row: rowNum, message: `${t.purchaseInvoices.errorProductNotFound}: ${productCode}` });
          return;
        }

        const line: InvoiceLine = calculateLine({
          id: `temp-${Date.now()}-${index}`,
          line_number: validLines.length + 1,
          product_id: product?.id || null,
          product_code: product?.item_code || productCode,
          description: description || product?.description || '',
          quantity,
          unit_price: unitPrice,
          is_inclusive: isInclusive,
          discount_amount: discount,
          subtotal: 0,
          tax_rate: taxRate,
          tax_amount: 0,
          total_amount: 0,
        });

        validLines.push(line);
      });

      setErrors(newErrors);
      setImportedCount(validLines.length);

      if (validLines.length > 0) {
        onImport(validLines);
        if (newErrors.length === 0) {
          onOpenChange(false);
        }
        toast.success(`${t.purchaseInvoices.importedLines}: ${validLines.length}`);
      }
    } catch (error) {
      console.error('Error processing Excel file:', error);
      toast.error(t.purchaseInvoices.errorReadingFile);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processExcelFile(file);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.purchaseInvoices.importFromExcel}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Download Template */}
          <div className="p-4 border rounded-lg bg-muted/30">
            <p className="text-sm text-muted-foreground mb-3">
              {t.purchaseInvoices.downloadTemplateDescription}
            </p>
            <Button variant="outline" onClick={downloadTemplate} className="gap-2">
              <Download className="w-4 h-4" />
              {t.purchaseInvoices.downloadTemplate}
            </Button>
          </div>

          {/* Upload File */}
          <div className="p-4 border-2 border-dashed rounded-lg text-center">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx,.xls"
              className="hidden"
            />
            <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              {t.purchaseInvoices.uploadExcelFile}
            </p>
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isLoading}
              className="gap-2"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t.purchaseInvoices.selectFile}
            </Button>
          </div>

          {/* Success message */}
          {importedCount > 0 && errors.length === 0 && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-700">
                {t.purchaseInvoices.importSuccess}: {importedCount} {t.purchaseInvoices.lines}
              </AlertDescription>
            </Alert>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>
                <div className="font-medium mb-2">
                  {t.purchaseInvoices.importErrors} ({errors.length}):
                </div>
                <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                  {errors.map((error, idx) => (
                    <li key={idx}>
                      {t.purchaseInvoices.row} {error.row}: {error.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ExcelImportDialog;
