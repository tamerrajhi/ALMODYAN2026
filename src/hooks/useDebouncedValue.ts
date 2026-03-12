import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook that debounces a value.
 * Returns the debounced value after the specified delay.
 * Uses a ref-based approach to ignore stale updates.
 * 
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 350ms)
 * @returns The debounced value
 */
export function useDebouncedValue<T>(value: T, delay: number = 350): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const requestIdRef = useRef<number>(0);

  useEffect(() => {
    // Increment request ID to invalidate previous pending updates
    const currentRequestId = ++requestIdRef.current;
    
    const timer = setTimeout(() => {
      // Only update if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        setDebouncedValue(value);
      }
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook that provides both debounced value and immediate setter.
 * Useful when you need to show immediate feedback while debouncing API calls.
 * 
 * @param initialValue - Initial value
 * @param delay - Delay in milliseconds (default: 350ms)
 * @returns [immediateValue, debouncedValue, setImmediateValue]
 */
export function useDebouncedState<T>(
  initialValue: T, 
  delay: number = 350
): [T, T, React.Dispatch<React.SetStateAction<T>>] {
  const [immediateValue, setImmediateValue] = useState<T>(initialValue);
  const debouncedValue = useDebouncedValue(immediateValue, delay);
  
  return [immediateValue, debouncedValue, setImmediateValue];
}
