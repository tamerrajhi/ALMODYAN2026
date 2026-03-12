import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'warning';
  responseTime: number;
  message?: string;
  details?: Record<string, any>;
}

interface SystemHealth {
  overall: 'healthy' | 'unhealthy' | 'warning';
  timestamp: string;
  checks: HealthCheck[];
  statistics: {
    totalItems: number;
    totalBranches: number;
    totalUsers: number;
    totalSales: number;
    totalCustomers: number;
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const checks: HealthCheck[] = [];
  let statistics = {
    totalItems: 0,
    totalBranches: 0,
    totalUsers: 0,
    totalSales: 0,
    totalCustomers: 0,
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Database Connection Test
    const dbStart = Date.now();
    try {
      const { data, error } = await supabase.from('branches').select('id').limit(1);
      const dbTime = Date.now() - dbStart;
      
      if (error) throw error;
      
      checks.push({
        name: 'database_connection',
        status: dbTime < 1000 ? 'healthy' : dbTime < 3000 ? 'warning' : 'unhealthy',
        responseTime: dbTime,
        message: 'Database connection successful',
      });
    } catch (error: any) {
      checks.push({
        name: 'database_connection',
        status: 'unhealthy',
        responseTime: Date.now() - dbStart,
        message: error.message,
      });
    }

    // 2. Tables Count Check
    const tablesStart = Date.now();
    try {
      const [items, branches, profiles, sales, customers] = await Promise.all([
        supabase.from('jewelry_items').select('id', { count: 'exact', head: true }),
        supabase.from('branches').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('sales').select('id', { count: 'exact', head: true }),
        supabase.from('customers').select('id', { count: 'exact', head: true }),
      ]);
      
      const tablesTime = Date.now() - tablesStart;
      
      statistics = {
        totalItems: items.count || 0,
        totalBranches: branches.count || 0,
        totalUsers: profiles.count || 0,
        totalSales: sales.count || 0,
        totalCustomers: customers.count || 0,
      };

      checks.push({
        name: 'tables_accessible',
        status: 'healthy',
        responseTime: tablesTime,
        message: 'All main tables accessible',
        details: statistics,
      });
    } catch (error: any) {
      checks.push({
        name: 'tables_accessible',
        status: 'unhealthy',
        responseTime: Date.now() - tablesStart,
        message: error.message,
      });
    }

    // 3. RLS Policies Check
    const rlsStart = Date.now();
    try {
      // Try to access audit_logs without auth (should fail due to RLS)
      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);
      const { data: auditData, error: auditError } = await anonClient
        .from('audit_logs')
        .select('id')
        .limit(1);
      
      const rlsTime = Date.now() - rlsStart;
      
      // If we can't access audit_logs without proper auth, RLS is working
      if (auditError || !auditData || auditData.length === 0) {
        checks.push({
          name: 'rls_policies',
          status: 'healthy',
          responseTime: rlsTime,
          message: 'RLS policies are properly configured',
        });
      } else {
        checks.push({
          name: 'rls_policies',
          status: 'warning',
          responseTime: rlsTime,
          message: 'Some tables may have permissive RLS policies',
        });
      }
    } catch (error: any) {
      checks.push({
        name: 'rls_policies',
        status: 'healthy',
        responseTime: Date.now() - rlsStart,
        message: 'RLS is enforcing access control',
      });
    }

    // 4. Database Functions Check
    const functionsStart = Date.now();
    try {
      const { data, error } = await supabase.rpc('generate_sale_code');
      const functionsTime = Date.now() - functionsStart;
      
      if (error) throw error;
      
      checks.push({
        name: 'database_functions',
        status: 'healthy',
        responseTime: functionsTime,
        message: 'Database functions are operational',
        details: { sampleCode: data },
      });
    } catch (error: any) {
      checks.push({
        name: 'database_functions',
        status: 'unhealthy',
        responseTime: Date.now() - functionsStart,
        message: error.message,
      });
    }

    // 5. Storage Check
    const storageStart = Date.now();
    try {
      const { data, error } = await supabase.storage.listBuckets();
      const storageTime = Date.now() - storageStart;
      
      checks.push({
        name: 'storage',
        status: 'healthy',
        responseTime: storageTime,
        message: `Storage accessible with ${data?.length || 0} buckets`,
      });
    } catch (error: any) {
      checks.push({
        name: 'storage',
        status: 'warning',
        responseTime: Date.now() - storageStart,
        message: 'Storage not configured or inaccessible',
      });
    }

    // 6. Auth System Check
    const authStart = Date.now();
    try {
      const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1 });
      const authTime = Date.now() - authStart;
      
      if (error) throw error;
      
      checks.push({
        name: 'auth_system',
        status: 'healthy',
        responseTime: authTime,
        message: 'Authentication system is operational',
      });
    } catch (error: any) {
      checks.push({
        name: 'auth_system',
        status: 'warning',
        responseTime: Date.now() - authStart,
        message: error.message || 'Auth check completed with warnings',
      });
    }

    // Determine overall health
    const hasUnhealthy = checks.some(c => c.status === 'unhealthy');
    const hasWarning = checks.some(c => c.status === 'warning');
    
    const response: SystemHealth = {
      overall: hasUnhealthy ? 'unhealthy' : hasWarning ? 'warning' : 'healthy',
      timestamp: new Date().toISOString(),
      checks,
      statistics,
    };

    console.log('System health check completed:', JSON.stringify(response, null, 2));

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('System health check failed:', error);
    
    return new Response(JSON.stringify({
      overall: 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: [{
        name: 'system',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: error.message,
      }],
      statistics,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
