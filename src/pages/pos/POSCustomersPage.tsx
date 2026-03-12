import { useState, useCallback } from 'react';
import POSLayout from '@/components/pos/POSLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Users, Search, Plus, Phone, Mail, Loader2, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  customer_code: string | null;
  tax_number: string | null;
  is_active: boolean;
}

export default function POSCustomersPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newTaxNumber, setNewTaxNumber] = useState('');

  const fetchCustomers = useCallback(async (searchTerm?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      const res = await fetch(`/api/pos/customers?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setCustomers(json.data || []);
      }
    } catch {
      toast({ title: 'خطأ', description: 'تعذر تحميل بيانات العملاء', variant: 'destructive' });
    }
    setLoading(false);
    setSearched(true);
  }, [toast]);

  const handleSearch = () => {
    fetchCustomers(search);
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast({ title: 'خطأ', description: 'اسم العميل مطلوب', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/pos/customers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          phone: newPhone.trim() || null,
          email: newEmail.trim() || null,
          tax_number: newTaxNumber.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: 'خطأ', description: json.error || 'تعذر إنشاء العميل', variant: 'destructive' });
        return;
      }
      toast({ title: 'تم', description: `تم إنشاء العميل "${json.data.name}" بنجاح` });
      setShowCreateDialog(false);
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setNewTaxNumber('');
      fetchCustomers(search);
    } catch {
      toast({ title: 'خطأ', description: 'تعذر الاتصال بالخادم', variant: 'destructive' });
    }
    setCreating(false);
  };

  return (
    <POSLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="page-header-rtl">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <Users className="w-6 h-6 text-primary" />
              عملاء نقطة البيع
            </h1>
            <p className="page-description">البحث عن العملاء وإضافة عملاء جدد</p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-add-customer">
            <Plus className="w-4 h-4 ml-2" />
            عميل جديد
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">بحث عن عميل</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Input
                  placeholder="ابحث بالاسم أو رقم الهاتف أو كود العميل..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  data-testid="input-customer-search"
                />
              </div>
              <Button onClick={handleSearch} disabled={loading} data-testid="button-search-customers">
                {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Search className="w-4 h-4 ml-2" />}
                بحث
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : customers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Users className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm">
                  {searched ? 'لا يوجد عملاء مطابقين' : 'ابحث عن عميل أو أضف عميل جديد'}
                </p>
              </div>
            ) : (
              <div className="responsive-table-wrapper">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الكود</TableHead>
                      <TableHead>الاسم</TableHead>
                      <TableHead>الهاتف</TableHead>
                      <TableHead>البريد</TableHead>
                      <TableHead>الرقم الضريبي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map(c => (
                      <TableRow key={c.id} data-testid={`row-customer-${c.id}`}>
                        <TableCell>
                          <Badge variant="secondary">{c.customer_code || '-'}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>
                          {c.phone ? (
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3 text-muted-foreground" />
                              {c.phone}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          {c.email ? (
                            <span className="flex items-center gap-1">
                              <Mail className="w-3 h-3 text-muted-foreground" />
                              {c.email}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell>{c.tax_number || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              إضافة عميل جديد
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>اسم العميل *</Label>
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="أدخل اسم العميل"
                data-testid="input-new-customer-name"
              />
            </div>
            <div className="space-y-2">
              <Label>رقم الهاتف</Label>
              <Input
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder="05XXXXXXXX"
                data-testid="input-new-customer-phone"
              />
            </div>
            <div className="space-y-2">
              <Label>البريد الإلكتروني</Label>
              <Input
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="email@example.com"
                data-testid="input-new-customer-email"
              />
            </div>
            <div className="space-y-2">
              <Label>الرقم الضريبي</Label>
              <Input
                value={newTaxNumber}
                onChange={e => setNewTaxNumber(e.target.value)}
                placeholder="الرقم الضريبي (اختياري)"
                data-testid="input-new-customer-tax"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-create-customer">
              إلغاء
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()} data-testid="button-confirm-create-customer">
              {creating ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Plus className="w-4 h-4 ml-2" />}
              إضافة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </POSLayout>
  );
}
