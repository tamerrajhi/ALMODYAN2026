-- جدول سجل التدقيق المحاسبي
CREATE TABLE public.accounting_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_type TEXT NOT NULL CHECK (audit_type IN ('health_check', 'auto_fix', 'manual_fix', 'system')),
  category TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  entity_code TEXT,
  old_value JSONB,
  new_value JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'executed', 'rejected', 'completed')),
  user_id UUID,
  user_name TEXT,
  description TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  executed_at TIMESTAMPTZ,
  executed_by UUID
);

-- جدول نتائج فحص الصحة المحاسبية
CREATE TABLE public.accounting_health_check_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  run_date TIMESTAMPTZ DEFAULT now(),
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  issue_code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  affected_records INTEGER DEFAULT 0,
  affected_amount NUMERIC(15,2),
  can_auto_fix BOOLEAN DEFAULT false,
  auto_fix_function TEXT,
  fix_status TEXT DEFAULT 'pending' CHECK (fix_status IN ('pending', 'in_progress', 'fixed', 'skipped', 'failed')),
  fix_notes TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  fixed_at TIMESTAMPTZ,
  fixed_by UUID
);

-- جدول جلسات الفحص
CREATE TABLE public.accounting_health_check_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number TEXT NOT NULL,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  mode TEXT DEFAULT 'read_only' CHECK (mode IN ('read_only', 'with_fixes')),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  started_by UUID,
  started_by_name TEXT,
  total_checks INTEGER DEFAULT 0,
  passed_checks INTEGER DEFAULT 0,
  warning_checks INTEGER DEFAULT 0,
  critical_checks INTEGER DEFAULT 0,
  health_score NUMERIC(5,2),
  categories_checked TEXT[],
  summary JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.accounting_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_health_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_health_check_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for accounting_audit_logs
CREATE POLICY "Admins can view accounting audit logs"
  ON public.accounting_audit_logs FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert accounting audit logs"
  ON public.accounting_audit_logs FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update accounting audit logs"
  ON public.accounting_audit_logs FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for accounting_health_check_results
CREATE POLICY "Admins can view health check results"
  ON public.accounting_health_check_results FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert health check results"
  ON public.accounting_health_check_results FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update health check results"
  ON public.accounting_health_check_results FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for accounting_health_check_runs
CREATE POLICY "Admins can view health check runs"
  ON public.accounting_health_check_runs FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert health check runs"
  ON public.accounting_health_check_runs FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update health check runs"
  ON public.accounting_health_check_runs FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- Indexes for better performance
CREATE INDEX idx_accounting_audit_logs_category ON public.accounting_audit_logs(category);
CREATE INDEX idx_accounting_audit_logs_created_at ON public.accounting_audit_logs(created_at DESC);
CREATE INDEX idx_accounting_audit_logs_user_id ON public.accounting_audit_logs(user_id);
CREATE INDEX idx_health_check_results_run_id ON public.accounting_health_check_results(run_id);
CREATE INDEX idx_health_check_results_severity ON public.accounting_health_check_results(severity);
CREATE INDEX idx_health_check_results_category ON public.accounting_health_check_results(category);
CREATE INDEX idx_health_check_runs_status ON public.accounting_health_check_runs(status);
CREATE INDEX idx_health_check_runs_started_at ON public.accounting_health_check_runs(started_at DESC);