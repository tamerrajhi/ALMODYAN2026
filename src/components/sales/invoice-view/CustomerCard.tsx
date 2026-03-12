import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { User, Phone, Mail, MapPin, Building2, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CustomerCardProps {
  customer?: {
    id: string;
    full_name: string;
    customer_code: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    vat_number?: string | null;
    company_name?: string | null;
    total_purchases?: number | null;
  };
  isView?: boolean;
}

export default function CustomerCard({ customer, isView = true }: CustomerCardProps) {
  const navigate = useNavigate();

  if (!customer) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" />
            بيانات العميل
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            عميل عام (غير محدد)
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" />
            بيانات العميل
          </CardTitle>
          {isView && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => navigate(`/customers?id=${customer.id}`)}
              className="h-7 text-xs"
            >
              <ExternalLink className="w-3 h-3 ml-1" />
              فتح الملف
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Customer Name - Prominent */}
        <div className="pb-2">
          <p className="font-semibold text-lg">{customer.full_name}</p>
          <p className="text-xs text-muted-foreground font-mono">
            {customer.customer_code}
          </p>
        </div>

        <Separator />

        {/* Company Name */}
        {customer.company_name && (
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <span>{customer.company_name}</span>
          </div>
        )}

        {/* Phone */}
        {customer.phone && (
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-muted-foreground" />
            <a href={`tel:${customer.phone}`} className="hover:underline" dir="ltr">
              {customer.phone}
            </a>
          </div>
        )}

        {/* Email */}
        {customer.email && (
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <a href={`mailto:${customer.email}`} className="hover:underline text-xs">
              {customer.email}
            </a>
          </div>
        )}

        {/* Address */}
        {customer.address && (
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
            <span className="text-xs">{customer.address}</span>
          </div>
        )}

        {/* VAT Number */}
        {customer.vat_number && (
          <>
            <Separator />
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">الرقم الضريبي:</span>
              <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                {customer.vat_number}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
