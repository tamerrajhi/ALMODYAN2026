
-- Create departments table
CREATE TABLE public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_code TEXT NOT NULL UNIQUE,
  department_name TEXT NOT NULL,
  department_name_en TEXT,
  manager_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create positions table
CREATE TABLE public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_code TEXT NOT NULL UNIQUE,
  position_name TEXT NOT NULL,
  position_name_en TEXT,
  department_id UUID REFERENCES public.departments(id),
  base_salary NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create employees table
CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  full_name_en TEXT,
  national_id TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  date_of_birth DATE,
  hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
  termination_date DATE,
  department_id UUID REFERENCES public.departments(id),
  position_id UUID REFERENCES public.positions(id),
  branch_id UUID REFERENCES public.branches(id),
  user_id UUID,
  base_salary NUMERIC DEFAULT 0,
  housing_allowance NUMERIC DEFAULT 0,
  transport_allowance NUMERIC DEFAULT 0,
  other_allowances NUMERIC DEFAULT 0,
  bank_name TEXT,
  iban TEXT,
  employment_status TEXT DEFAULT 'active' CHECK (employment_status IN ('active', 'on_leave', 'terminated', 'suspended')),
  contract_type TEXT DEFAULT 'full_time' CHECK (contract_type IN ('full_time', 'part_time', 'contract', 'temporary')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create payroll periods table
CREATE TABLE public.payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_code TEXT NOT NULL UNIQUE,
  period_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  payment_date DATE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'approved', 'paid', 'cancelled')),
  total_gross NUMERIC DEFAULT 0,
  total_deductions NUMERIC DEFAULT 0,
  total_net NUMERIC DEFAULT 0,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create payroll records table
CREATE TABLE public.payroll_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id UUID NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  base_salary NUMERIC DEFAULT 0,
  housing_allowance NUMERIC DEFAULT 0,
  transport_allowance NUMERIC DEFAULT 0,
  other_allowances NUMERIC DEFAULT 0,
  overtime_hours NUMERIC DEFAULT 0,
  overtime_amount NUMERIC DEFAULT 0,
  bonus NUMERIC DEFAULT 0,
  gross_salary NUMERIC DEFAULT 0,
  gosi_deduction NUMERIC DEFAULT 0,
  absence_deduction NUMERIC DEFAULT 0,
  loan_deduction NUMERIC DEFAULT 0,
  other_deductions NUMERIC DEFAULT 0,
  total_deductions NUMERIC DEFAULT 0,
  net_salary NUMERIC DEFAULT 0,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'cancelled')),
  payment_date DATE,
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create attendance table
CREATE TABLE public.employee_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  attendance_date DATE NOT NULL,
  check_in_time TIME,
  check_out_time TIME,
  status TEXT DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late', 'half_day', 'holiday', 'weekend')),
  overtime_hours NUMERIC DEFAULT 0,
  notes TEXT,
  recorded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, attendance_date)
);

-- Create leaves table
CREATE TABLE public.employee_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'maternity', 'paternity', 'emergency', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create employee loans table
CREATE TABLE public.employee_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  loan_amount NUMERIC NOT NULL,
  remaining_amount NUMERIC NOT NULL,
  monthly_deduction NUMERIC NOT NULL,
  start_date DATE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  reason TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_loans ENABLE ROW LEVEL SECURITY;

-- RLS Policies for departments
CREATE POLICY "Authenticated users can view departments" ON public.departments FOR SELECT USING (true);
CREATE POLICY "Admins can manage departments" ON public.departments FOR ALL USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for positions
CREATE POLICY "Authenticated users can view positions" ON public.positions FOR SELECT USING (true);
CREATE POLICY "Admins can manage positions" ON public.positions FOR ALL USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for employees
CREATE POLICY "Admins can manage employees" ON public.employees FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view employees in their branch" ON public.employees FOR SELECT 
  USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

-- RLS Policies for payroll_periods
CREATE POLICY "Admins can manage payroll periods" ON public.payroll_periods FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated users can view payroll periods" ON public.payroll_periods FOR SELECT USING (true);

-- RLS Policies for payroll_records
CREATE POLICY "Admins can manage payroll records" ON public.payroll_records FOR ALL USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for attendance
CREATE POLICY "Users can view attendance in their branch" ON public.employee_attendance FOR SELECT 
  USING (has_role(auth.uid(), 'admin') OR EXISTS (
    SELECT 1 FROM employees e WHERE e.id = employee_id AND e.branch_id = ANY(get_user_branches(auth.uid()))
  ));
CREATE POLICY "Users can insert attendance" ON public.employee_attendance FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can update attendance" ON public.employee_attendance FOR UPDATE USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for leaves
CREATE POLICY "Admins can manage leaves" ON public.employee_leaves FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view leaves" ON public.employee_leaves FOR SELECT USING (true);
CREATE POLICY "Users can request leaves" ON public.employee_leaves FOR INSERT WITH CHECK (true);

-- RLS Policies for loans
CREATE POLICY "Admins can manage loans" ON public.employee_loans FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Function to generate employee code
CREATE OR REPLACE FUNCTION generate_employee_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  new_code TEXT;
  seq_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(employee_code FROM 4) AS INTEGER)), 0) + 1
  INTO seq_num
  FROM employees
  WHERE employee_code ~ '^EMP[0-9]+$';
  
  new_code := 'EMP' || LPAD(seq_num::TEXT, 4, '0');
  RETURN new_code;
END;
$$;

-- Function to generate payroll period code
CREATE OR REPLACE FUNCTION generate_payroll_period_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  new_code TEXT;
BEGIN
  new_code := 'PP-' || TO_CHAR(CURRENT_DATE, 'YYYYMM');
  RETURN new_code;
END;
$$;
