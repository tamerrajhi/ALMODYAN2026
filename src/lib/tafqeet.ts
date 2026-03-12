const ones = [
  '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة',
  'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
  'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'
];

const tens = [
  '', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون',
  'ستون', 'سبعون', 'ثمانون', 'تسعون'
];

const hundreds = [
  '', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة',
  'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'
];

function convertGroup(num: number): string {
  if (num === 0) return '';
  if (num < 20) return ones[num];

  if (num < 100) {
    const t = Math.floor(num / 10);
    const o = num % 10;
    if (o === 0) return tens[t];
    return ones[o] + ' و' + tens[t];
  }

  const h = Math.floor(num / 100);
  const remainder = num % 100;
  if (remainder === 0) return hundreds[h];
  return hundreds[h] + ' و' + convertGroup(remainder);
}

function getThousandWord(count: number): string {
  if (count >= 3 && count <= 10) return 'آلاف';
  return 'ألف';
}

function getMillionWord(count: number): string {
  if (count >= 3 && count <= 10) return 'ملايين';
  return 'مليون';
}

function numberToArabicWords(num: number): string {
  if (num === 0) return 'صفر';

  const parts: string[] = [];

  const millions = Math.floor(num / 1000000);
  const thousands = Math.floor((num % 1000000) / 1000);
  const remainder = num % 1000;

  if (millions > 0) {
    if (millions === 1) {
      parts.push('مليون');
    } else if (millions === 2) {
      parts.push('مليونان');
    } else {
      parts.push(convertGroup(millions) + ' ' + getMillionWord(millions));
    }
  }

  if (thousands > 0) {
    if (thousands === 1) {
      parts.push('ألف');
    } else if (thousands === 2) {
      parts.push('ألفان');
    } else {
      parts.push(convertGroup(thousands) + ' ' + getThousandWord(thousands));
    }
  }

  if (remainder > 0) {
    parts.push(convertGroup(remainder));
  }

  return parts.join(' و');
}

function getCurrencyWord(num: number): string {
  if (num === 0) return 'ريال';
  if (num === 1) return 'ريال';
  if (num === 2) return 'ريالان';
  if (num >= 3 && num <= 10) return 'ريالات';
  return 'ريالاً';
}

function getHalalaWord(num: number): string {
  if (num === 1) return 'هللة';
  if (num === 2) return 'هللتان';
  if (num >= 3 && num <= 10) return 'هللات';
  return 'هللة';
}

export function tafqeet(amount: number | string): string {
  const numAmount = Number(amount);
  if (!isFinite(numAmount) || isNaN(numAmount)) return 'مبلغ غير صالح';
  if (numAmount === 0) return 'صفر ريال سعودي';
  const intPart = Math.floor(Math.abs(numAmount));
  const decPart = Math.round((Math.abs(numAmount) - intPart) * 100);

  let result = '';

  if (intPart > 0) {
    result = numberToArabicWords(intPart) + ' ' + getCurrencyWord(intPart) + ' سعودي';
  }

  if (decPart > 0) {
    if (intPart > 0) {
      result += ' و';
    }
    result += numberToArabicWords(decPart) + ' ' + getHalalaWord(decPart);
  }

  result += ' فقط لا غير';

  return result;
}
