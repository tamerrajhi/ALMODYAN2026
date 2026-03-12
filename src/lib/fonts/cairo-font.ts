// Cairo Arabic Font for jsPDF - Base64 encoded
// This is the Cairo Regular font for Arabic text support

// Font will be loaded dynamically from Google Fonts CDN
export const loadCairoFont = async (): Promise<string | null> => {
  try {
    // Fetch Cairo font from Google Fonts
    const response = await fetch(
      'https://fonts.gstatic.com/s/cairo/v28/SLXgc1nY6HkvangtZmpQdkhzfH5lkSs2SgRjCAGMQ1z0hGA-W1ToLQ-HmkA.ttf'
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch font');
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );
    
    return base64;
  } catch (error) {
    console.warn('Failed to load Cairo font:', error);
    return null;
  }
};

// Add Cairo font to jsPDF document
export const addCairoFont = async (doc: any): Promise<boolean> => {
  try {
    const fontBase64 = await loadCairoFont();
    
    if (!fontBase64) {
      return false;
    }
    
    doc.addFileToVFS('Cairo-Regular.ttf', fontBase64);
    doc.addFont('Cairo-Regular.ttf', 'Cairo', 'normal');
    doc.setFont('Cairo');
    
    return true;
  } catch (error) {
    console.warn('Failed to add Cairo font to PDF:', error);
    return false;
  }
};

// Function to reshape Arabic text for proper display
// Arabic letters change shape based on position in word
export const reshapeArabicText = (text: string): string => {
  if (!text) return '';
  
  // Check if text contains Arabic
  const arabicPattern = /[\u0600-\u06FF]/;
  if (!arabicPattern.test(text)) {
    return text;
  }
  
  // Return text as-is - the font should handle shaping
  return text;
};

// Process text for PDF - handles both Arabic and English
export const processTextForPDF = (text: string, maxLength?: number): string => {
  if (!text) return '-';
  
  let processed = text.trim();
  
  if (maxLength && processed.length > maxLength) {
    processed = processed.substring(0, maxLength) + '...';
  }
  
  return processed;
};
