import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, User, Plus, Loader2, Check, X, UserPlus } from 'lucide-react';
import * as dataGateway from '@/lib/dataGateway';

interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  loyalty_points: number;
  vat_number?: string | null;
  address?: string | null;
  customer_type?: 'individual' | 'company';
  company_name?: string | null;
}

interface PhoneCustomerSearchProps {
  selectedCustomer: Customer | null;
  onCustomerSelect: (customer: Customer | null) => void;
  onCreateNewCustomer: (phone: string) => void;
  isRequired?: boolean;
  paymentMethod?: string;
}

export default function PhoneCustomerSearch({
  selectedCustomer,
  onCustomerSelect,
  onCreateNewCustomer,
  isRequired = false,
  paymentMethod = 'cash',
}: PhoneCustomerSearchProps) {
  const [phoneInput, setPhoneInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<Customer | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Format phone for display (remove +966 prefix for input)
  const formatPhoneForInput = (phone: string | null): string => {
    if (!phone) return '';
    if (phone.startsWith('+966')) {
      return phone.substring(4);
    }
    if (phone.startsWith('966')) {
      return phone.substring(3);
    }
    if (phone.startsWith('0')) {
      return phone.substring(1);
    }
    return phone;
  };

  // Format phone for storage/search (add +966 prefix)
  const formatPhoneForStorage = (input: string): string => {
    const digits = input.replace(/\D/g, '');
    if (digits.length === 9 && digits.startsWith('5')) {
      return `+966${digits}`;
    }
    return input;
  };

  // Validate phone number
  const validatePhone = (input: string): { valid: boolean; error: string | null } => {
    const digits = input.replace(/\D/g, '');
    
    if (digits.length === 0) {
      return { valid: true, error: null }; // Empty is valid (optional field)
    }
    
    if (digits.length !== 9) {
      return { valid: false, error: 'يجب أن يتكون الرقم من 9 أرقام' };
    }
    
    if (!digits.startsWith('5')) {
      return { valid: false, error: 'يجب أن يبدأ الرقم بـ 5' };
    }
    
    return { valid: true, error: null };
  };

  // Debounced search
  const searchCustomerByPhone = useCallback(async (phone: string) => {
    const formattedPhone = formatPhoneForStorage(phone);
    const validation = validatePhone(phone);
    
    if (!validation.valid) {
      setError(validation.error);
      setSearchResult(null);
      setHasSearched(false);
      return;
    }
    
    setError(null);
    
    if (phone.replace(/\D/g, '').length < 9) {
      setSearchResult(null);
      setHasSearched(false);
      return;
    }
    
    setIsSearching(true);
    setHasSearched(true);
    
    try {
      const digits = phone.replace(/\D/g, '');
      const { data, error } = await dataGateway.queryTable<any>('customers', {
        select: 'id, customer_code, full_name, phone, loyalty_points, vat_number, address, customer_type, company_name',
        filters: [{ type: 'or', value: `phone.eq.${formattedPhone},phone.eq.0${digits},phone.eq.${digits}` }],
        limit: 1,
        maybeSingle: true,
      });
      
      if (error) throw error;
      
      if (data) {
        setSearchResult(data as Customer);
        // Auto-select the customer
        onCustomerSelect(data as Customer);
      } else {
        setSearchResult(null);
      }
    } catch (err) {
      console.error('Error searching customer:', err);
      setSearchResult(null);
    } finally {
      setIsSearching(false);
    }
  }, [onCustomerSelect]);

  // Debounce effect
  useEffect(() => {
    const digits = phoneInput.replace(/\D/g, '');
    
    if (digits.length === 9) {
      const timer = setTimeout(() => {
        searchCustomerByPhone(phoneInput);
      }, 400);
      
      return () => clearTimeout(timer);
    } else {
      setSearchResult(null);
      setHasSearched(false);
      
      // Validate on change
      const validation = validatePhone(phoneInput);
      if (phoneInput.length > 0 && !validation.valid) {
        setError(validation.error);
      } else {
        setError(null);
      }
    }
  }, [phoneInput, searchCustomerByPhone]);

  // Handle input change - only allow digits and limit to 9
  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 9);
    setPhoneInput(digits);
    
    // Clear selected customer when phone changes
    if (selectedCustomer && formatPhoneForInput(selectedCustomer.phone) !== digits) {
      onCustomerSelect(null);
    }
  };

  // Handle create new customer
  const handleCreateNew = () => {
    const formattedPhone = formatPhoneForStorage(phoneInput);
    onCreateNewCustomer(formattedPhone);
  };

  // Handle clear/walk-in
  const handleClearCustomer = () => {
    setPhoneInput('');
    setSearchResult(null);
    setHasSearched(false);
    setError(null);
    onCustomerSelect(null);
  };

  // Phone is required only for credit sales
  const isPhoneRequired = isRequired;

  return (
    <Card>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Phone Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Phone className="w-4 h-4 text-primary" />
              رقم جوال العميل
              {isPhoneRequired && <span className="text-destructive">*</span>}
            </Label>
            {selectedCustomer && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearCustomer}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              >
                <X className="w-3 h-3 ml-1" />
                تغيير العميل
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {/* Fixed Prefix */}
            <div className="flex items-center justify-center h-10 px-3 bg-muted border border-l-0 rounded-r-md text-sm font-mono text-muted-foreground select-none">
              +966
            </div>
            
            {/* Phone Input */}
            <div className="relative flex-1">
              <Input
                type="tel"
                inputMode="numeric"
                value={phoneInput}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="5XXXXXXXX"
                className={`rounded-r-none font-mono text-left h-10 ${
                  error ? 'border-destructive focus-visible:ring-destructive' : 
                  selectedCustomer ? 'border-green-500 focus-visible:ring-green-500' : ''
                }`}
                dir="ltr"
                maxLength={9}
              />
              {isSearching && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </div>
          
          {/* Error Message */}
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <X className="w-3 h-3" />
              {error}
            </p>
          )}
          
          {/* Required/Optional Message */}
          {!selectedCustomer && !error && phoneInput.length === 0 && isPhoneRequired && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠️ يرجى إدخال رقم جوال العميل لإتمام البيع (آجل)
            </p>
          )}
          {!selectedCustomer && !error && phoneInput.length === 0 && !isPhoneRequired && (
            <p className="text-xs text-muted-foreground">
              💡 البيع سيتم كعميل نقدي (Walk-in) - أدخل الجوال للبحث اختيارياً
            </p>
          )}
        </div>

        {/* Customer Found */}
        {selectedCustomer && (
          <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
              <User className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm truncate">{selectedCustomer.full_name}</p>
                <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {selectedCustomer.customer_code}
                {selectedCustomer.vat_number && ` • ض: ${selectedCustomer.vat_number}`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearCustomer}
              className="h-8 w-8 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Customer Not Found - Show Create Button */}
        {hasSearched && !isSearching && !searchResult && !selectedCustomer && phoneInput.length === 9 && !error && (
          <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center flex-shrink-0">
              <UserPlus className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">لم يتم العثور على عميل</p>
              <p className="text-xs text-muted-foreground">
                الرقم: +966{phoneInput}
              </p>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={handleCreateNew}
              className="flex-shrink-0 gap-1"
            >
              <Plus className="w-4 h-4" />
              إنشاء عميل
            </Button>
          </div>
        )}

        {/* Walk-in Customer Info */}
        {!selectedCustomer && !hasSearched && phoneInput.length === 0 && (
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              البيع كعميل نقدي (Walk-in) - أدخل رقم الجوال للبحث عن عميل
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
