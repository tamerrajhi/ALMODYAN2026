export interface ParseOptions {
  mode: 'with_headers' | 'no_headers' | 'template_supp_inv_10';
  existingSerials?: string[];
}

export interface ParsedRow {
  description: string;
  stockcode: string;
  model: string;
  metal: string;
  g_weight: number;
  d_weight: number;
  cost: number;
  tag_price: number;
  minimum_price: number;
  supp_ref: string;
  type: string;
  division: string;
  stone: string;
  serial_no: string;
}

export interface ParseError {
  row: number;
  column: string;
  reason_ar: string;
  reason_en: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
  meta: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    detectedColumns: string[];
  };
}

const VALID_KARATS = ['8', '9', '10', '12', '14', '18', '21', '22', '24'];

const HEADER_SYNONYMS: Record<string, string[]> = {
  serial_no: ['serial', 'serial_no', 'serialno', 'سريال', 'رقم مسلسل', 'رقم تسلسلي', 'مسلسل'],
  description: ['desc', 'description', 'وصف', 'الوصف', 'بيان'],
  stockcode: ['code', 'stock_code', 'stockcode', 'كود', 'موديل', 'رمز', 'كود المنتج'],
  model: ['model', 'الموديل', 'نموذج'],
  metal: ['metal', 'karat', 'عيار', 'المعدن', 'قيراط', 'معدن'],
  g_weight: ['weight', 'g_weight', 'gross_weight', 'وزن', 'الوزن', 'وزن اجمالي'],
  d_weight: ['d_weight', 'diamond_weight', 'وزن الماس', 'وزن حجر'],
  cost: ['cost', 'price', 'تكلفة', 'سعر', 'التكلفة', 'السعر'],
  tag_price: ['tag_price', 'tag', 'سعر البطاقة', 'سعر بيع', 'بطاقة'],
  minimum_price: ['minimum_price', 'min_price', 'الحد الادنى', 'اقل سعر'],
  supp_ref: ['supp_ref', 'supplier_ref', 'مرجع', 'مرجع المورد', 'ref'],
  type: ['type', 'نوع', 'category', 'فئة', 'صنف'],
  division: ['division', 'قسم', 'تصنيف'],
  stone: ['stone', 'stones', 'حجر', 'أحجار', 'الاحجار'],
};

const NO_HEADER_ORDER: (keyof ParsedRow)[] = [
  'description',
  'stockcode',
  'metal',
  'g_weight',
  'cost',
  'tag_price',
  'model',
  'supp_ref',
  'type',
  'stone',
];

const TEMPLATE_SUPP_INV_10_MAP: { field: keyof ParsedRow; index: number }[] = [
  { field: 'stockcode', index: 2 },
  { field: 'model', index: 3 },
  { field: 'supp_ref', index: 4 },
  { field: 'description', index: 6 },
  { field: 'type', index: 7 },
  { field: 'cost', index: 13 },
  { field: 'tag_price', index: 14 },
  { field: 'minimum_price', index: 15 },
  { field: 'g_weight', index: 16 },
  { field: 'd_weight', index: 17 },
  { field: 'stone', index: 22 },
];

function extractKaratFromDescription(desc: string): string | null {
  const m1 = desc.match(/عيار\s*(\d{1,2})/);
  if (m1 && VALID_KARATS.includes(m1[1])) return m1[1];
  const m2 = desc.match(/\b(8|9|10|12|14|18|21|22|24)\b/);
  if (m2) return m2[1];
  return null;
}

function normalizeHeader(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '');
  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    if (synonyms.some((s) => s === trimmed)) {
      return field;
    }
  }
  return null;
}

function makeEmptyParsedRow(): ParsedRow {
  return {
    description: '',
    stockcode: '',
    model: '',
    metal: '',
    g_weight: 0,
    d_weight: 0,
    cost: 0,
    tag_price: 0,
    minimum_price: 0,
    supp_ref: '',
    type: '',
    division: '',
    stone: '',
    serial_no: '',
  };
}

const NUMERIC_FIELDS = new Set(['g_weight', 'd_weight', 'cost', 'tag_price', 'minimum_price']);

function parseValue(field: string, raw: string): string | number {
  const trimmed = raw.trim();
  if (NUMERIC_FIELDS.has(field)) {
    const cleaned = trimmed.replace(/[, ]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return trimmed;
}

export function parseExcelClipboard(text: string, options: ParseOptions): ParseResult {
  const { mode, existingSerials = [] } = options;
  if (!text || !text.trim()) {
    return { rows: [], errors: [], meta: { totalRows: 0, validRows: 0, errorRows: 0, detectedColumns: [] } };
  }

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [], meta: { totalRows: 0, validRows: 0, errorRows: 0, detectedColumns: [] } };
  }

  let columnMap: { field: string; index: number }[] = [];
  let dataStartIndex = 0;
  const detectedColumns: string[] = [];

  if (mode === 'template_supp_inv_10') {
    for (const m of TEMPLATE_SUPP_INV_10_MAP) {
      columnMap.push({ field: m.field, index: m.index });
      detectedColumns.push(m.field);
    }
    dataStartIndex = 0;
  } else if (mode === 'with_headers') {
    const headerCells = lines[0].split('\t');
    for (let i = 0; i < headerCells.length; i++) {
      const mapped = normalizeHeader(headerCells[i]);
      if (mapped) {
        columnMap.push({ field: mapped, index: i });
        detectedColumns.push(mapped);
      }
    }
    dataStartIndex = 1;
  } else {
    for (let i = 0; i < NO_HEADER_ORDER.length; i++) {
      columnMap.push({ field: NO_HEADER_ORDER[i], index: i });
      detectedColumns.push(NO_HEADER_ORDER[i]);
    }
    dataStartIndex = 0;
  }

  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];
  const seenSerials = new Set<string>();
  const existingSet = new Set(existingSerials.map((s) => s.toLowerCase().trim()));

  for (let lineIdx = dataStartIndex; lineIdx < lines.length; lineIdx++) {
    const cells = lines[lineIdx].split('\t');
    const row = makeEmptyParsedRow();
    const rowNum = lineIdx - dataStartIndex + 1;

    const maxRequiredIdx = mode === 'template_supp_inv_10' ? 17 : -1;
    if (mode === 'template_supp_inv_10' && cells.length <= maxRequiredIdx) {
      errors.push({ row: rowNum, column: '-', reason_ar: `الصف يحتوي على أعمدة غير كافية (${cells.length})`, reason_en: `Row has insufficient columns (${cells.length}, need at least ${maxRequiredIdx + 1})` });
      rows.push(row);
      continue;
    }

    for (const col of columnMap) {
      if (col.index < cells.length) {
        const val = parseValue(col.field, cells[col.index]);
        (row as any)[col.field] = val;
      }
    }

    if (mode === 'template_supp_inv_10') {
      const karat = extractKaratFromDescription(row.description);
      if (karat) {
        row.metal = karat;
      } else {
        errors.push({ row: rowNum, column: 'metal', reason_ar: 'لم يتم العثور على العيار في الوصف', reason_en: 'Missing karat — could not extract from description' });
      }
      if (!row.stockcode && !row.description) {
        errors.push({ row: rowNum, column: 'description', reason_ar: 'يجب إدخال وصف أو كود المنتج', reason_en: 'Must have stockcode or description' });
      }
    }

    if (row.cost <= 0) {
      errors.push({ row: rowNum, column: 'cost', reason_ar: 'التكلفة يجب أن تكون أكبر من صفر', reason_en: 'Cost must be > 0' });
    }

    if (row.g_weight < 0) {
      errors.push({ row: rowNum, column: 'g_weight', reason_ar: 'الوزن يجب أن يكون صفر أو أكبر', reason_en: 'Weight must be >= 0' });
    }

    if (row.d_weight < 0) {
      errors.push({ row: rowNum, column: 'd_weight', reason_ar: 'وزن الألماس يجب أن يكون صفر أو أكبر', reason_en: 'Diamond weight must be >= 0' });
    }

    if (mode !== 'template_supp_inv_10' && row.metal && !VALID_KARATS.includes(row.metal.replace(/[kK]/, '').trim())) {
      const cleaned = row.metal.replace(/[kK]/, '').trim();
      if (cleaned && !VALID_KARATS.includes(cleaned)) {
        errors.push({
          row: rowNum,
          column: 'metal',
          reason_ar: `عيار غير صالح: ${row.metal} (القيم المسموحة: ${VALID_KARATS.join(', ')})`,
          reason_en: `Invalid karat: ${row.metal} (allowed: ${VALID_KARATS.join(', ')})`,
        });
      }
    }

    if (row.serial_no) {
      const sn = row.serial_no.toLowerCase().trim();
      if (seenSerials.has(sn)) {
        errors.push({ row: rowNum, column: 'serial_no', reason_ar: 'رقم تسلسلي مكرر في البيانات الملصقة', reason_en: 'Duplicate serial in pasted data' });
      }
      if (existingSet.has(sn)) {
        errors.push({ row: rowNum, column: 'serial_no', reason_ar: 'رقم تسلسلي موجود مسبقاً', reason_en: 'Serial already exists' });
      }
      seenSerials.add(sn);
    }

    rows.push(row);
  }

  const errorRowNums = new Set(errors.map((e) => e.row));

  return {
    rows,
    errors,
    meta: {
      totalRows: rows.length,
      validRows: rows.length - errorRowNums.size,
      errorRows: errorRowNums.size,
      detectedColumns,
    },
  };
}

if (typeof window !== 'undefined' && (window as any).__RUN_PARSE_TESTS__) {
  const tests = [
    () => {
      const result = parseExcelClipboard('desc\tcode\tcost\nRing\tR001\t500', { mode: 'with_headers' });
      console.assert(result.rows.length === 1, 'Test 1 fail: expected 1 row, got', result.rows.length);
      console.assert(result.rows[0].description === 'Ring', 'Test 1 fail: description');
      console.assert(result.rows[0].cost === 500, 'Test 1 fail: cost');
      console.log('Test 1 PASS: with_headers basic');
    },
    () => {
      const result = parseExcelClipboard('خاتم\tR002\t18\t5.5\t1200\t1800', { mode: 'no_headers' });
      console.assert(result.rows.length === 1, 'Test 2 fail: row count');
      console.assert(result.rows[0].description === 'خاتم', 'Test 2 fail: description');
      console.assert(result.rows[0].metal === '18', 'Test 2 fail: metal');
      console.assert(result.rows[0].g_weight === 5.5, 'Test 2 fail: g_weight');
      console.log('Test 2 PASS: no_headers Arabic');
    },
    () => {
      const result = parseExcelClipboard('وصف\tكود\tعيار\tوزن\tتكلفة\nسوار\tB01\t99\t3\t-100', { mode: 'with_headers' });
      console.assert(result.errors.length >= 2, 'Test 3 fail: expected >= 2 errors, got', result.errors.length);
      console.log('Test 3 PASS: validation errors for karat & negative cost');
    },
    () => {
      const result = parseExcelClipboard('serial\tdesc\tcost\nSN1\tRing\t100\nSN1\tBracelet\t200', { mode: 'with_headers' });
      const dupeErrors = result.errors.filter((e) => e.column === 'serial_no');
      console.assert(dupeErrors.length === 1, 'Test 4 fail: expected 1 dupe error');
      console.log('Test 4 PASS: duplicate serial detection');
    },
    () => {
      const result = parseExcelClipboard('description\tstockcode\tcost\nRing\tR1\t500\nBracelet\tB1\t300', {
        mode: 'with_headers',
        existingSerials: [],
      });
      console.assert(result.meta.totalRows === 2, 'Test 5 fail');
      console.assert(result.meta.validRows === 2, 'Test 5 fail: valid');
      console.log('Test 5 PASS: multi-row parse');
    },
  ];
  tests.forEach((t) => t());
  console.log('All parseExcelClipboard tests complete');

  const templateTests = [
    () => {
      const row = 'INV1\tDIV1\tSTK001\tMDL01\tSR001\tSUPP1\tسوار ذهب عيار18 فاخر\tBracelet\tCC1\tT1\tT2\tT3\tT4\t 26,391 \t30000\t25000\t12.34\t0.5\tRT1\tX\tY\tZ\tDiamond';
      const result = parseExcelClipboard(row, { mode: 'template_supp_inv_10' });
      console.assert(result.rows.length === 1, 'Tmpl T1 fail: row count');
      console.assert(result.rows[0].stockcode === 'STK001', 'Tmpl T1 fail: stockcode');
      console.assert(result.rows[0].model === 'MDL01', 'Tmpl T1 fail: model');
      console.assert(result.rows[0].supp_ref === 'SR001', 'Tmpl T1 fail: supp_ref');
      console.assert(result.rows[0].description === 'سوار ذهب عيار18 فاخر', 'Tmpl T1 fail: description');
      console.assert(result.rows[0].type === 'Bracelet', 'Tmpl T1 fail: type');
      console.assert(result.rows[0].cost === 26391, 'Tmpl T1 fail: cost=' + result.rows[0].cost);
      console.assert(result.rows[0].tag_price === 30000, 'Tmpl T1 fail: tag_price');
      console.assert(result.rows[0].minimum_price === 25000, 'Tmpl T1 fail: minimum_price');
      console.assert(result.rows[0].g_weight === 12.34, 'Tmpl T1 fail: g_weight');
      console.assert(result.rows[0].d_weight === 0.5, 'Tmpl T1 fail: d_weight');
      console.assert(result.rows[0].stone === 'Diamond', 'Tmpl T1 fail: stone');
      console.assert(result.rows[0].metal === '18', 'Tmpl T1 fail: metal/karat=' + result.rows[0].metal);
      console.assert(result.errors.length === 0, 'Tmpl T1 fail: errors=' + result.errors.length);
      console.log('Template Test 1 PASS: full row mapping + karat extraction from عيار18');
    },
    () => {
      const row = 'INV2\tDIV2\tSTK002\tMDL02\tSR002\tSUPP2\tخاتم ألماس فاخر\tRing\tCC2\tT1\tT2\tT3\tT4\t5000\t7000\t4500\t3.2\t1.1\tRT2\tX\tY\tZ\tRuby';
      const result = parseExcelClipboard(row, { mode: 'template_supp_inv_10' });
      console.assert(result.rows.length === 1, 'Tmpl T2 fail: row count');
      console.assert(result.rows[0].metal === '', 'Tmpl T2 fail: metal should be empty=' + result.rows[0].metal);
      const karatErrors = result.errors.filter(e => e.column === 'metal');
      console.assert(karatErrors.length === 1, 'Tmpl T2 fail: expected 1 karat error');
      console.log('Template Test 2 PASS: missing karat → error');
    },
    () => {
      const row = 'A\tB\tC';
      const result = parseExcelClipboard(row, { mode: 'template_supp_inv_10' });
      console.assert(result.errors.length >= 1, 'Tmpl T3 fail: insufficient columns error');
      const colErr = result.errors.find(e => e.column === '-');
      console.assert(!!colErr, 'Tmpl T3 fail: should have insufficient column error');
      console.log('Template Test 3 PASS: insufficient columns');
    },
  ];
  templateTests.forEach((t) => t());
  console.log('All template_supp_inv_10 tests complete');
}
