import { useState } from 'react';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Upload, 
  FileText, 
  Trash2, 
  Download, 
  Loader2,
  File,
  Calendar
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { documentTypeLabels } from '@/types/supplier.types';

interface SupplierDocumentsProps {
  supplierId: string;
  supplierName: string;
}

export function SupplierDocuments({ supplierId, supplierName }: SupplierDocumentsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadData, setUploadData] = useState({
    document_type: 'other' as string,
    document_name: '',
    expiry_date: '',
    notes: '',
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Fetch documents
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['supplier-documents', supplierId],
    queryFn: async () => {
      const res = await fetch(`/api/supplier-documents/${supplierId}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch supplier documents');
      return (await res.json()) || [];
    },
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('يرجى اختيار ملف');
      forbidDirectWrite('insert', 'SupplierDocuments.tsx:uploadMutation');
    },
    onSuccess: () => {
      toast.success('تم رفع المستند بنجاح');
      queryClient.invalidateQueries({ queryKey: ['supplier-documents', supplierId] });
      setShowUploadDialog(false);
      setSelectedFile(null);
      setUploadData({
        document_type: 'other',
        document_name: '',
        expiry_date: '',
        notes: '',
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'فشل في رفع المستند');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      forbidDirectWrite('delete', 'SupplierDocuments.tsx:deleteMutation');
    },
    onSuccess: () => {
      toast.success('تم حذف المستند');
      queryClient.invalidateQueries({ queryKey: ['supplier-documents', supplierId] });
    },
    onError: () => {
      toast.error('فشل في حذف المستند');
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      if (!uploadData.document_name) {
        setUploadData(prev => ({ ...prev, document_name: e.target.files![0].name }));
      }
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getDocTypeColor = (type: string) => {
    switch (type) {
      case 'commercial_register':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'tax_certificate':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'identity':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
      case 'contract':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400';
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4" />
          مستندات المورد
        </CardTitle>
        <Button size="sm" onClick={() => setShowUploadDialog(true)}>
          <Upload className="w-4 h-4 ml-2" />
          رفع مستند
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="p-4 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : documents.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <File className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>لا توجد مستندات مرفقة</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>اسم المستند</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الحجم</TableHead>
                <TableHead>تاريخ الانتهاء</TableHead>
                <TableHead>تاريخ الرفع</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc: any) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">{doc.document_name}</TableCell>
                  <TableCell>
                    <Badge className={getDocTypeColor(doc.document_type)}>
                      {documentTypeLabels[doc.document_type] || doc.document_type}
                    </Badge>
                  </TableCell>
                  <TableCell>{doc.file_size ? formatFileSize(doc.file_size) : '-'}</TableCell>
                  <TableCell>
                    {doc.expiry_date ? (
                      <span className={new Date(doc.expiry_date) < new Date() ? 'text-red-600' : ''}>
                        {format(new Date(doc.expiry_date), 'dd/MM/yyyy')}
                      </span>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    {format(new Date(doc.created_at), 'dd/MM/yyyy', { locale: ar })}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(doc.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفع مستند جديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>نوع المستند</Label>
              <Select 
                value={uploadData.document_type} 
                onValueChange={(v) => setUploadData(prev => ({ ...prev, document_type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(documentTypeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>الملف *</Label>
              <Input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  {selectedFile.name} ({formatFileSize(selectedFile.size)})
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>اسم المستند</Label>
              <Input
                value={uploadData.document_name}
                onChange={(e) => setUploadData(prev => ({ ...prev, document_name: e.target.value }))}
                placeholder="اسم المستند (اختياري)"
              />
            </div>

            <div className="space-y-2">
              <Label>تاريخ الانتهاء</Label>
              <Input
                type="date"
                value={uploadData.expiry_date}
                onChange={(e) => setUploadData(prev => ({ ...prev, expiry_date: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Textarea
                value={uploadData.notes}
                onChange={(e) => setUploadData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="ملاحظات..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)}>
              إلغاء
            </Button>
            <Button 
              onClick={() => uploadMutation.mutate()} 
              disabled={!selectedFile || uploadMutation.isPending}
            >
              {uploadMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              رفع المستند
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
