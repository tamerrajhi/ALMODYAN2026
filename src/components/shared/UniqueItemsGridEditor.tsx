import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Plus, Trash2, ClipboardPaste, Undo2, X } from 'lucide-react';
import { ExcelPasteDialog } from './ExcelPasteDialog';
import { parseExcelClipboard, type ParsedRow, type ParseOptions } from '@/lib/excelClipboardParser';
import { toast } from 'sonner';

export interface EditableGridItem {
  _key: string;
  _isNew: boolean;
  _isDeleted: boolean;
  _isPasted?: boolean;
  item_id?: string;
  serial_no: string;
  stockcode: string;
  description: string;
  model: string;
  supp_ref: string;
  type: string;
  division: string;
  metal: string;
  stone: string;
  g_weight: number;
  d_weight: number;
  cost: number;
  tag_price: number;
  minimum_price: number;
  _original: Record<string, any> | null;
}

export interface GridColumnDef {
  key: keyof EditableGridItem;
  labelAr: string;
  labelEn: string;
  type: 'text' | 'number';
  width: string;
}

export interface UniqueItemsGridEditorProps {
  mode: 'purchase_invoice_edit' | 'transfer_prepare';
  columns: GridColumnDef[];
  rows: EditableGridItem[];
  onRowsChange: (rows: EditableGridItem[]) => void;
  readOnlyFields?: (keyof EditableGridItem)[];
  allowAddRows?: boolean;
  allowDeleteRows?: boolean;
  enableExcelPaste?: boolean;
  language: string;
}

export function makeEmptyRow(): EditableGridItem {
  return {
    _key: crypto.randomUUID(),
    _isNew: true,
    _isDeleted: false,
    _isPasted: false,
    serial_no: '',
    stockcode: '',
    description: '',
    model: '',
    supp_ref: '',
    type: '',
    division: '',
    metal: '',
    stone: '',
    g_weight: 0,
    d_weight: 0,
    cost: 0,
    tag_price: 0,
    minimum_price: 0,
    _original: null,
  };
}

export function apiItemToRow(item: any): EditableGridItem {
  return {
    _key: item.id,
    _isNew: false,
    _isDeleted: false,
    _isPasted: false,
    item_id: item.id,
    serial_no: item.serial_no || '',
    stockcode: item.stockcode || '',
    description: item.description || '',
    model: item.model || '',
    supp_ref: item.supp_ref || '',
    type: item.type || '',
    division: item.division || '',
    metal: item.metal || '',
    stone: item.stone || '',
    g_weight: Number(item.g_weight) || 0,
    d_weight: Number(item.d_weight) || 0,
    cost: Number(item.cost) || 0,
    tag_price: Number(item.tag_price) || 0,
    minimum_price: Number(item.minimum_price) || 0,
    _original: { ...item },
  };
}

function parsedRowToGridItem(parsed: ParsedRow): EditableGridItem {
  return {
    _key: crypto.randomUUID(),
    _isNew: true,
    _isDeleted: false,
    _isPasted: true,
    serial_no: parsed.serial_no || '',
    stockcode: parsed.stockcode || '',
    description: parsed.description || '',
    model: parsed.model || '',
    supp_ref: parsed.supp_ref || '',
    type: parsed.type || '',
    division: parsed.division || '',
    metal: parsed.metal || '',
    stone: parsed.stone || '',
    g_weight: parsed.g_weight || 0,
    d_weight: parsed.d_weight || 0,
    cost: parsed.cost || 0,
    tag_price: parsed.tag_price || 0,
    minimum_price: parsed.minimum_price || 0,
    _original: null,
  };
}

export function UniqueItemsGridEditor({
  columns,
  rows,
  onRowsChange,
  readOnlyFields = [],
  allowAddRows = true,
  allowDeleteRows = true,
  enableExcelPaste = true,
  language,
}: UniqueItemsGridEditorProps) {
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<EditableGridItem[] | null>(null);
  const [pastedKeys, setPastedKeys] = useState<Set<string>>(new Set());
  const [pastedCells, setPastedCells] = useState<Set<string>>(new Set());
  const [activeCell, setActiveCell] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const isAr = language === 'ar';

  const visibleRows = rows.filter((r) => !r._isDeleted);
  const existingSerials = rows.filter((r) => !r._isNew).map((r) => r.serial_no).filter(Boolean);

  const handleFieldChange = useCallback(
    (key: string, fieldKey: keyof EditableGridItem, value: string) => {
      onRowsChange(
        rows.map((r) => {
          if (r._key !== key) return r;
          const col = columns.find((c) => c.key === fieldKey);
          if (col?.type === 'number') {
            return { ...r, [fieldKey]: parseFloat(value) || 0 };
          }
          return { ...r, [fieldKey]: value };
        })
      );
    },
    [rows, onRowsChange, columns]
  );

  const handleAddRow = useCallback(() => {
    onRowsChange([...rows, makeEmptyRow()]);
  }, [rows, onRowsChange]);

  const handleDeleteRow = useCallback(
    (key: string) => {
      onRowsChange(rows.map((r) => (r._key === key ? { ...r, _isDeleted: true } : r)));
    },
    [rows, onRowsChange]
  );

  const handleUndoDelete = useCallback(
    (key: string) => {
      onRowsChange(rows.map((r) => (r._key === key ? { ...r, _isDeleted: false } : r)));
    },
    [rows, onRowsChange]
  );

  const applyPastedRows = useCallback(
    (parsedRows: ParsedRow[]) => {
      setUndoStack([...rows]);
      const newItems = parsedRows.map(parsedRowToGridItem);
      const newKeys = new Set(newItems.map((i) => i._key));
      setPastedKeys(newKeys);
      onRowsChange([...rows, ...newItems]);
      toast.success(
        isAr
          ? `تمت إضافة ${newItems.length} صف من اللصق`
          : `Added ${newItems.length} rows from paste`
      );
    },
    [rows, onRowsChange, isAr]
  );

  const handleUndoPaste = useCallback(() => {
    if (undoStack) {
      onRowsChange(undoStack);
      setUndoStack(null);
      setPastedKeys(new Set());
      setPastedCells(new Set());
      toast.info(isAr ? 'تم التراجع عن اللصق' : 'Paste undone');
    }
  }, [undoStack, onRowsChange, isAr]);

  const handleClearPastedRows = useCallback(() => {
    if (pastedKeys.size > 0) {
      onRowsChange(rows.filter((r) => !pastedKeys.has(r._key)));
      setPastedKeys(new Set());
      setPastedCells(new Set());
      setUndoStack(null);
      toast.info(isAr ? 'تم مسح الصفوف الملصقة' : 'Pasted rows cleared');
    }
  }, [rows, pastedKeys, onRowsChange, isAr]);

  const handleGridPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      const hasTab = text.includes('\t');
      const hasMultiLine = text.split('\n').filter((l) => l.trim()).length > 1;
      if (!hasTab && !hasMultiLine) return;

      e.preventDefault();

      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) return;

      const startRowIdx = activeCell?.rowIdx ?? visibleRows.length;
      const startColIdx = activeCell?.colIdx ?? 0;
      const editableColKeys = columns.map((c) => c.key);

      setUndoStack([...rows]);
      const newPastedCells = new Set<string>();
      const newPastedKeys = new Set<string>();
      let nextRows = [...rows];
      const visibleIndexToRowKey = visibleRows.map((r) => r._key);

      for (let lineOff = 0; lineOff < lines.length; lineOff++) {
        const cells = lines[lineOff].split('\t');
        const targetVisibleIdx = startRowIdx + lineOff;

        if (targetVisibleIdx < visibleIndexToRowKey.length) {
          const rowKey = visibleIndexToRowKey[targetVisibleIdx];
          const rowIndex = nextRows.findIndex((r) => r._key === rowKey);
          if (rowIndex === -1) continue;
          const existingRow = nextRows[rowIndex];

          for (let cellOff = 0; cellOff < cells.length; cellOff++) {
            const colIdx = startColIdx + cellOff;
            if (colIdx >= editableColKeys.length) break;
            const fieldKey = editableColKeys[colIdx];
            if (fieldKey === 'serial_no' && !existingRow._isNew) continue;

            const col = columns[colIdx];
            const rawVal = cells[cellOff].trim();
            let val: string | number = rawVal;
            if (col.type === 'number') {
              val = parseFloat(rawVal.replace(/,/g, '')) || 0;
            }
            nextRows[rowIndex] = { ...nextRows[rowIndex], [fieldKey]: val };
            newPastedCells.add(`${nextRows[rowIndex]._key}:${fieldKey as string}`);
          }
        } else {
          const newRow = makeEmptyRow();
          newRow._isPasted = true;
          for (let cellOff = 0; cellOff < cells.length; cellOff++) {
            const colIdx = startColIdx + cellOff;
            if (colIdx >= editableColKeys.length) break;
            const fieldKey = editableColKeys[colIdx];
            if (fieldKey === 'serial_no') continue;

            const col = columns[colIdx];
            const rawVal = cells[cellOff].trim();
            let val: string | number = rawVal;
            if (col.type === 'number') {
              val = parseFloat(rawVal.replace(/,/g, '')) || 0;
            }
            (newRow as any)[fieldKey] = val;
            newPastedCells.add(`${newRow._key}:${fieldKey as string}`);
          }
          nextRows.push(newRow);
          newPastedKeys.add(newRow._key);
        }
      }

      setPastedCells(newPastedCells);
      setPastedKeys(newPastedKeys);
      onRowsChange(nextRows);

      const updatedCount = Math.min(lines.length, visibleRows.length - startRowIdx);
      const addedCount = Math.max(0, lines.length - (visibleRows.length - startRowIdx));
      toast.success(
        isAr
          ? `تم اللصق: ${updatedCount > 0 ? updatedCount + ' صف معدّل' : ''}${updatedCount > 0 && addedCount > 0 ? '، ' : ''}${addedCount > 0 ? addedCount + ' صف جديد' : ''}`
          : `Pasted: ${updatedCount > 0 ? updatedCount + ' updated' : ''}${updatedCount > 0 && addedCount > 0 ? ', ' : ''}${addedCount > 0 ? addedCount + ' added' : ''}`
      );
    },
    [activeCell, visibleRows, columns, rows, onRowsChange, isAr]
  );

  const deletedRows = rows.filter((r) => r._isDeleted && !r._isNew);

  const isFieldReadOnly = (row: EditableGridItem, fieldKey: keyof EditableGridItem) => {
    if (fieldKey === 'serial_no') return true;
    if (!row._isNew && readOnlyFields.includes(fieldKey)) return true;
    return false;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="text-base font-semibold">
          {isAr ? `القطع (${visibleRows.length})` : `Items (${visibleRows.length})`}
        </Label>
        <div className="flex items-center gap-2 flex-wrap">
          {enableExcelPaste && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPasteDialogOpen(true)}
                  data-testid="button-paste-from-excel"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  <span className="mx-1">{isAr ? 'لصق من Excel' : 'Paste from Excel'}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isAr
                  ? 'انسخ بيانات من Excel وألصقها هنا، أو استخدم Ctrl+V مباشرة في الجدول'
                  : 'Copy data from Excel and paste here, or use Ctrl+V directly in the grid'}
              </TooltipContent>
            </Tooltip>
          )}

          {undoStack && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleUndoPaste}
              data-testid="button-undo-paste"
            >
              <Undo2 className="w-4 h-4" />
              <span className="mx-1">{isAr ? 'تراجع عن اللصق' : 'Undo Paste'}</span>
            </Button>
          )}

          {(pastedKeys.size > 0 || pastedCells.size > 0) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { handleClearPastedRows(); setPastedCells(new Set()); }}
              data-testid="button-clear-pasted"
              className="text-destructive"
            >
              <X className="w-4 h-4" />
              <span className="mx-1">{isAr ? 'مسح الملصقة' : 'Clear Pasted'}</span>
            </Button>
          )}

          {allowAddRows && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddRow}
              data-testid="button-add-item"
            >
              <Plus className="w-4 h-4" />
              <span className="mx-1">{isAr ? 'إضافة قطعة' : 'Add Item'}</span>
            </Button>
          )}
        </div>
      </div>

      {(pastedKeys.size > 0 || pastedCells.size > 0) && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="badge-pasted-count">
            {isAr
              ? `ملصق: ${pastedCells.size} خلية${pastedKeys.size > 0 ? ` (${pastedKeys.size} صف جديد)` : ''}`
              : `Pasted: ${pastedCells.size} cells${pastedKeys.size > 0 ? ` (${pastedKeys.size} new rows)` : ''}`}
          </Badge>
        </div>
      )}

      <div
        ref={tableRef}
        className="responsive-table-wrapper border rounded-md"
        onPaste={enableExcelPaste ? handleGridPaste : undefined}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs w-10">#</TableHead>
              {columns.map((f) => (
                <TableHead key={f.key as string} className="text-xs">
                  {isAr ? f.labelAr : f.labelEn}
                </TableHead>
              ))}
              {allowDeleteRows && <TableHead className="text-xs w-12"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row, idx) => {
              const isPasted = pastedKeys.has(row._key);
              let rowClass = '';
              if (isPasted) rowClass = 'bg-blue-50 dark:bg-blue-950/20';
              else if (row._isNew) rowClass = 'bg-green-50 dark:bg-green-950/20';

              return (
                <TableRow key={row._key} className={rowClass}>
                  <TableCell className="text-xs text-muted-foreground">
                    {idx + 1}
                    {isPasted && (
                      <Badge variant="outline" className="mx-1 text-[10px] py-0">
                        {isAr ? 'ملصق' : 'Pasted'}
                      </Badge>
                    )}
                  </TableCell>
                  {columns.map((f, colIdx) => {
                    const cellKey = `${row._key}:${f.key as string}`;
                    const isCellPasted = pastedCells.has(cellKey);
                    const cellClass = isCellPasted ? 'p-1 bg-blue-100/50 dark:bg-blue-900/30' : 'p-1';
                    return (
                      <TableCell key={f.key as string} className={cellClass}>
                        {isFieldReadOnly(row, f.key) ? (
                          f.key === 'serial_no' && row._isNew ? (
                            <span className="text-xs text-muted-foreground italic px-1">
                              {isAr ? 'تلقائي' : 'Auto'}
                            </span>
                          ) : (
                            <span className="text-xs font-mono px-1">
                              {String(row[f.key] ?? '')}
                            </span>
                          )
                        ) : (
                          <Input
                            data-testid={`input-${f.key as string}-${idx}`}
                            type={f.type}
                            step={f.type === 'number' ? '0.01' : undefined}
                            min={f.type === 'number' ? '0' : undefined}
                            value={row[f.key] as string | number}
                            onChange={(e) => handleFieldChange(row._key, f.key, e.target.value)}
                            onFocus={() => setActiveCell({ rowIdx: idx, colIdx })}
                            className={`${f.width} text-xs h-8`}
                          />
                        )}
                      </TableCell>
                    );
                  })}
                  {allowDeleteRows && (
                    <TableCell className="p-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteRow(row._key)}
                        data-testid={`button-delete-item-${idx}`}
                        className="text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {visibleRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (allowDeleteRows ? 2 : 1)}
                  className="text-center text-muted-foreground py-6"
                >
                  {isAr ? 'لا توجد قطع' : 'No items'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {deletedRows.length > 0 && (
        <div className="border border-destructive/30 rounded-md p-2">
          <Label className="text-xs text-destructive mb-1 block">
            {isAr ? `قطع ستُحذف (${deletedRows.length})` : `Items to delete (${deletedRows.length})`}
          </Label>
          <div className="flex flex-wrap gap-2">
            {deletedRows.map((r) => (
              <Button
                key={r._key}
                size="sm"
                variant="outline"
                className="text-xs border-destructive/30"
                onClick={() => handleUndoDelete(r._key)}
                data-testid={`button-undo-delete-${r.serial_no}`}
              >
                {r.serial_no} - {r.description?.slice(0, 20)}
                <span className="mx-1 text-muted-foreground">
                  {isAr ? '(تراجع)' : '(undo)'}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {enableExcelPaste && (
        <ExcelPasteDialog
          open={pasteDialogOpen}
          onOpenChange={setPasteDialogOpen}
          onApply={applyPastedRows}
          existingSerials={existingSerials}
          language={language}
        />
      )}
    </div>
  );
}
