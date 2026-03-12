import { useMutation, useQueryClient } from '@tanstack/react-query';

import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

interface SubmitInvoiceParams {
  invoiceId: string;
  invoiceType: 'standard' | 'simplified';
}

interface ZatcaSubmitResult {
  success: boolean;
  clearanceId?: string;
  reportingId?: string;
  qrCode?: string;
  signedXml?: string;
  clearedXml?: string;
  errorMessage?: string;
  warnings?: string[];
}

export function useZatcaSubmit() {
  const queryClient = useQueryClient();
  const { language } = useLanguage();

  // Generate XML for invoice
  const generateXml = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch('/api/zatca/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const { data, error } = await res.json();
      
      if (error) throw new Error(error.message);
      return data;
    },
  });

  // Sign invoice
  const signInvoice = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch('/api/zatca/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const { data, error } = await res.json();
      
      if (error) throw new Error(error.message);
      return data;
    },
  });

  // Validate invoice
  const validateInvoice = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch('/api/zatca/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const { data, error } = await res.json();
      
      if (error) throw new Error(error.message);
      return data;
    },
  });

  // Submit invoice to ZATCA
  const submitInvoice = useMutation({
    mutationFn: async ({ invoiceId, invoiceType }: SubmitInvoiceParams): Promise<ZatcaSubmitResult> => {
      // Step 1: Generate XML
      const xmlRes = await fetch('/api/zatca/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const xmlResult = await xmlRes.json();
      if (xmlResult.error) throw new Error('Failed to generate XML');

      // Step 2: Sign the invoice
      const signRes = await fetch('/api/zatca/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const signResult = await signRes.json();
      if (signResult.error) throw new Error('Failed to sign invoice');

      // Step 3: Validate
      const valRes = await fetch('/api/zatca/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const validateResult = await valRes.json();
      if (validateResult.error || !validateResult.data?.isValid) {
        throw new Error(validateResult.data?.errors?.join(', ') || 'Validation failed');
      }

      // Step 4: Submit to ZATCA
      const submitType = invoiceType === 'standard' ? 'clearance' : 'reporting';
      const submitRes = await fetch('/api/zatca/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, submitType }),
      });
      const submitResult = await submitRes.json();
      
      if (submitResult.error) throw new Error(submitResult.error.message);
      return submitResult.data as ZatcaSubmitResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['zatca-logs'] });
      
      if (data.success) {
        toast.success(
          language === 'ar' 
            ? 'تم إرسال الفاتورة للهيئة بنجاح' 
            : 'Invoice submitted to ZATCA successfully'
        );
      } else {
        toast.error(data.errorMessage || (language === 'ar' ? 'فشل الإرسال' : 'Submission failed'));
      }
    },
    onError: (error: Error) => {
      toast.error(
        language === 'ar' 
          ? `فشل في إرسال الفاتورة: ${error.message}` 
          : `Failed to submit invoice: ${error.message}`
      );
    },
  });

  // Bulk submit invoices
  const bulkSubmit = useMutation({
    mutationFn: async (invoiceIds: string[]) => {
      const results = [];
      for (const invoiceId of invoiceIds) {
        try {
          const bulkRes = await fetch('/api/zatca/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId, submitType: 'reporting' }),
          });
          const { data, error } = await bulkRes.json();
          results.push({ invoiceId, success: !error, data, error });
        } catch (err) {
          results.push({ invoiceId, success: false, error: err });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      const successCount = results.filter(r => r.success).length;
      toast.success(
        language === 'ar'
          ? `تم إرسال ${successCount} من ${results.length} فاتورة`
          : `Submitted ${successCount} of ${results.length} invoices`
      );
    },
  });

  return {
    generateXml,
    signInvoice,
    validateInvoice,
    submitInvoice,
    bulkSubmit,
    isSubmitting: submitInvoice.isPending,
  };
}
