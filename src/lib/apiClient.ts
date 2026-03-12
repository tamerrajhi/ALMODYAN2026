const _envBackend = 'neon';

export function getActiveBackend(): 'neon' {
  return 'neon';
}

export function setBackendOverride(_value: 'neon' | null): void {
}

export function getEnvBackend(): string {
  return _envBackend;
}

export const dataBackend = getActiveBackend();

console.info(
  '%c[ACTIVE_DATA_BACKEND] neon',
  'color:#0ea5e9;font-weight:bold'
);

interface RpcResult<T = any> {
  data: T | null;
  error: { message: string } | null;
}

interface FetchResult<T = any> {
  data: T | null;
  error: { message: string } | null;
}

export async function rpc<T = any>(fnName: string, args: Record<string, any>): Promise<RpcResult<T>> {
  try {
    const response = await fetch(`/api/rpc/${fnName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { 
        data: null, 
        error: { message: errorData?.error?.message || `HTTP ${response.status}` } 
      };
    }

    const result = await response.json();
    return { data: result.data, error: result.error };
  } catch (error) {
    return { 
      data: null, 
      error: { message: error instanceof Error ? error.message : 'Network error' } 
    };
  }
}

export async function get<T = any>(path: string, params?: Record<string, string | number>): Promise<FetchResult<T>> {
  try {
    let url = path.startsWith('/api') ? path : `/api${path}`;
    
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { 
        data: null, 
        error: { message: errorData?.error || `HTTP ${response.status}` } 
      };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return { 
      data: null, 
      error: { message: error instanceof Error ? error.message : 'Network error' } 
    };
  }
}

export async function post<T = any>(path: string, body: Record<string, any>): Promise<FetchResult<T>> {
  try {
    const url = path.startsWith('/api') ? path : `/api${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { 
        data: null, 
        error: { message: errorData?.error || `HTTP ${response.status}` } 
      };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return { 
      data: null, 
      error: { message: error instanceof Error ? error.message : 'Network error' } 
    };
  }
}

export async function checkNeonHealth(): Promise<{
  dbOk: boolean;
  schemaOk: boolean;
  dbInfo?: { db: string; schema: string; time: string };
  schemaInfo?: Record<string, boolean>;
  errors: string[];
}> {
  const errors: string[] = [];
  let dbOk = false;
  let schemaOk = false;
  let dbInfo: any;
  let schemaInfo: any;

  try {
    const dbResponse = await fetch('/api/health/db');
    const dbData = await dbResponse.json();
    dbOk = dbData.ok === true;
    if (dbOk) {
      dbInfo = { db: dbData.db, schema: dbData.schema, time: dbData.time };
    } else {
      errors.push(`DB Check Failed: ${dbData.error || 'Unknown'}`);
    }
  } catch (e) {
    errors.push(`DB Check Network Error: ${e instanceof Error ? e.message : 'Unknown'}`);
  }

  try {
    const schemaResponse = await fetch('/api/health/schema');
    const schemaData = await schemaResponse.json();
    schemaOk = schemaData.ok === true;
    if (schemaOk) {
      schemaInfo = schemaData.schema;
      const allTrue = Object.values(schemaInfo).every(v => v === true);
      if (!allTrue) {
        const missing = Object.entries(schemaInfo)
          .filter(([_, v]) => v !== true)
          .map(([k]) => k);
        errors.push(`Missing schema objects: ${missing.join(', ')}`);
        schemaOk = false;
      }
    } else {
      errors.push(`Schema Check Failed: ${schemaData.error || 'Unknown'}`);
    }
  } catch (e) {
    errors.push(`Schema Check Network Error: ${e instanceof Error ? e.message : 'Unknown'}`);
  }

  return { dbOk, schemaOk, dbInfo, schemaInfo, errors };
}
