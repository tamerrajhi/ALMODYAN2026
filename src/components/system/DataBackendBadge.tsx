import { useQuery } from '@tanstack/react-query';

interface FingerprintData {
  ok: boolean;
  db: string;
  schema: string;
  server_version: string;
  invariants: {
    invoices_supplier_invoice_no_column: boolean;
    invoices_purchase_supp_inv_uq_index: boolean;
    required_functions: {
      required: string[];
      missing: string[];
      ok: boolean;
    };
  };
  timestamp: string;
  error?: string;
}

type BadgeStatus = 'loading' | 'ok' | 'warning' | 'error' | 'hidden';

export default function DataBackendBadge() {
  const { data: fingerprint, isLoading, isError, error } = useQuery<FingerprintData>({
    queryKey: ['health-fingerprint'],
    queryFn: async () => {
      const resp = await fetch('/api/health/fingerprint');
      if (resp.status === 401 || resp.status === 403) {
        throw Object.assign(new Error('unauthorized'), { status: resp.status });
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json() as Promise<FingerprintData>;
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const errStatus = isError ? (error as (Error & { status?: number }))?.status : undefined;
  if (errStatus === 401 || errStatus === 403) return null;

  const status: BadgeStatus = (() => {
    if (isLoading) return 'loading';
    if (isError) return 'error';
    if (!fingerprint) return 'loading';
    if (fingerprint.ok) return 'ok';
    return 'warning';
  })();

  const errorMsg = (() => {
    if (!fingerprint || fingerprint.ok) return '';
    const missing = fingerprint.invariants?.required_functions?.missing || [];
    if (missing.length > 0) return `Missing: ${missing.join(', ')}`;
    return 'Some invariants failed';
  })();

  const colors: Record<BadgeStatus, string> = {
    loading: 'bg-muted text-muted-foreground',
    ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    hidden: '',
  };

  const dotColors: Record<BadgeStatus, string> = {
    loading: 'bg-muted-foreground',
    ok: 'bg-emerald-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
    hidden: '',
  };

  const buildLabel = () => {
    if (status === 'loading') return 'CHECKING...';
    if (status === 'error') return 'NEON: ERROR';
    if (status === 'ok') {
      return `NEON | ${fingerprint?.db} | PG ${fingerprint?.server_version}`;
    }
    return `NEON | ${fingerprint?.db || '?'} | ${errorMsg}`;
  };

  const buildTitle = () => {
    const parts = ['Active: neon'];
    if (fingerprint) {
      parts.push(`Schema: ${fingerprint.schema}`);
      parts.push(`Time: ${fingerprint.timestamp}`);
    }
    if (errorMsg && status === 'warning') parts.push(errorMsg);
    return parts.join(' | ');
  };

  return (
    <span className="inline-flex items-center gap-1" data-testid="badge-data-backend-wrapper">
      <span
        data-testid="badge-data-backend"
        title={buildTitle()}
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium tracking-wide select-none ${colors[status]}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${status === 'loading' ? 'animate-pulse' : ''} ${dotColors[status]}`} />
        {buildLabel()}
      </span>
    </span>
  );
}
