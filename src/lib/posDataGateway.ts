import type { FilterOp, QueryOptions } from './dataGateway';

export async function queryTable<T = any>(
  tableName: string,
  options?: QueryOptions
): Promise<{ data: T | null; error: { message: string } | null; count?: number | null }> {
  try {
    const response = await fetch('/api/pos/table-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        table: tableName,
        select: options?.select,
        filters: options?.filters,
        order: options?.order,
        limit: options?.limit,
        single: options?.single,
        maybeSingle: options?.maybeSingle,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { data: null, error: { message: err?.error?.message || `HTTP ${response.status}` } };
    }
    const result = await response.json();
    return { data: result.data as T, error: result.error, count: result.count };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Network error' } };
  }
}

export async function rpc<T = any>(
  fnName: string,
  args: Record<string, any>
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const response = await fetch(`/api/pos/rpc/${fnName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ args }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        data: null,
        error: { message: errorData?.error?.message || `HTTP ${response.status}` },
      };
    }
    const result = await response.json();
    return { data: result.data, error: result.error };
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : 'Network error' },
    };
  }
}
