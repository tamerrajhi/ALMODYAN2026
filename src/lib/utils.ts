import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as Saudi Riyal currency
 * Uses the new SAR symbol (ر.س) with proper formatting
 */
export function formatCurrency(amount: number | null | undefined, showSymbol: boolean = true): string {
  if (amount === null || amount === undefined) return '-';
  
  const formatted = new Intl.NumberFormat('ar-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  
  return showSymbol ? `${formatted} ر.س` : formatted;
}

/**
 * Format a number with thousand separators (no currency symbol)
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('ar-SA').format(value);
}

/**
 * Debounce function - delays execution until after wait ms have elapsed since last call
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, wait);
  };
}
