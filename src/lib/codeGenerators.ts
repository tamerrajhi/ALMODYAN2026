/**
 * Code Generators - Simple wrapper for code generation RPCs
 * Returns string[] directly, no JSONB parsing needed
 */

import * as dataGateway from '@/lib/dataGateway';

/**
 * Get next item codes as string array
 * @param count Number of codes needed
 * @returns Promise<string[]> Array of item codes like ["ITM-00000001", "ITM-00000002", ...]
 */
export async function getNextItemCodes(count: number): Promise<string[]> {
  if (count <= 0) {
    return [];
  }

  const { data, error } = await dataGateway.getNextItemCodes(count);

  if (error) {
    console.error('Error generating item codes:', error);
    throw new Error(`فشل توليد أكواد القطع: ${error.message}`);
  }

  // Validate response is string array
  if (!Array.isArray(data)) {
    console.error('Invalid response format for item codes:', data);
    throw new Error('فشل توليد أكواد القطع: تنسيق استجابة غير صالح');
  }

  if (data.length !== count) {
    console.error(`Expected ${count} item codes, got ${data.length}`);
    throw new Error(`فشل توليد أكواد القطع: تم توليد ${data.length} بدلاً من ${count}`);
  }

  return data as string[];
}

/**
 * Get next set codes as string array
 * @param count Number of codes needed
 * @returns Promise<string[]> Array of set codes like ["SET-000001", "SET-000002", ...]
 */
export async function getNextSetCodes(count: number): Promise<string[]> {
  if (count <= 0) {
    return [];
  }

  const { data, error } = await dataGateway.getNextSetCodes(count);

  if (error) {
    console.error('Error generating set codes:', error);
    throw new Error(`فشل توليد أكواد الأطقم: ${error.message}`);
  }

  // Validate response is string array
  if (!Array.isArray(data)) {
    console.error('Invalid response format for set codes:', data);
    throw new Error('فشل توليد أكواد الأطقم: تنسيق استجابة غير صالح');
  }

  if (data.length !== count) {
    console.error(`Expected ${count} set codes, got ${data.length}`);
    throw new Error(`فشل توليد أكواد الأطقم: تم توليد ${data.length} بدلاً من ${count}`);
  }

  return data as string[];
}
