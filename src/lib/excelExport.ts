import * as XLSX from 'xlsx';

export function createArabicWorkbook(
  data: Record<string, any>[],
  sheetName: string,
  fileName: string,
  options?: {
    colWidths?: number[];
    rtl?: boolean;
  }
) {
  if (!data || data.length === 0) return;

  const ws = XLSX.utils.json_to_sheet(data);

  const keys = Object.keys(data[0] || {});
  if (options?.colWidths) {
    ws['!cols'] = options.colWidths.map(w => ({ wch: w }));
  } else {
    ws['!cols'] = keys.map(key => {
      const maxLen = Math.max(
        key.length,
        ...data.slice(0, 50).map(row => String(row[key] ?? '').length)
      );
      return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
    });
  }

  const wb = XLSX.utils.book_new();

  if (options?.rtl !== false) {
    wb.Workbook = { Views: [{ RTL: true }] };
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));

  XLSX.writeFile(wb, fileName, {
    bookSST: true,
    compression: true,
  });
}
