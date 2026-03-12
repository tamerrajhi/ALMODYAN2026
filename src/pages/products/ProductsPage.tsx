import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import * as dataGateway from '@/lib/dataGateway';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Package, Gem, Wrench, Box, Plus, Search, Edit, Trash2, DollarSign, Building2, TrendingDown, Settings } from 'lucide-react';
import { toast } from 'sonner';
import ProductFormDialog from '@/components/products/ProductFormDialog';
import CostEntryFormDialog from '@/components/products/CostEntryFormDialog';

interface Product {
  id: string;
  product_code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  product_type: string;
  product_sub_type: string | null;
  category: string | null;
  unit: string;
  barcode: string | null;
  sku: string | null;
  karat: string | null;
  metal: string | null;
  weight_grams: number | null;
  cost_price: number;
  selling_price: number;
  min_price: number | null;
  is_service: boolean;
  service_duration_minutes: number | null;
  tax_rate: number;
  is_tax_inclusive: boolean;
  is_active: boolean;
  inventory_account_id: string | null;
  expense_account_id: string | null;
  default_warehouse_id: string | null;
  created_at: string;
}

interface CostEntry {
  id: string;
  cost_code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  cost_type: string;
  gl_account_id: string;
  cost_center_id: string | null;
  tax_rate: number;
  is_active: boolean;
  created_at: string;
  chart_of_accounts?: {
    account_code: string;
    account_name: string;
  };
}

const COST_TYPE_CONFIG = {
  service: { icon: Wrench, labelAr: 'خدمة', labelEn: 'Service', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  fixed_asset: { icon: Building2, labelAr: 'أصل ثابت', labelEn: 'Fixed Asset', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  direct_expense: { icon: TrendingDown, labelAr: 'مصروف مباشر', labelEn: 'Direct Expense', color: 'bg-red-100 text-red-700 border-red-200' },
  indirect_overhead: { icon: Settings, labelAr: 'مصروف عمومي', labelEn: 'Indirect/Overhead', color: 'bg-purple-100 text-purple-700 border-purple-200' },
};

const ProductsPage = () => {
  const { t, language } = useLanguage();
  const location = useLocation();
  
  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  
  // Cost entries state
  const [costEntries, setCostEntries] = useState<CostEntry[]>([]);
  const [loadingCosts, setLoadingCosts] = useState(true);
  const [costSearchTerm, setCostSearchTerm] = useState('');
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const [selectedCostEntry, setSelectedCostEntry] = useState<CostEntry | null>(null);
  
  // Main section tab - determine from URL
  const getMainSectionFromPath = () => {
    if (location.pathname.includes('/costs')) return 'costs';
    return 'products';
  };
  const [mainSection, setMainSection] = useState<'products' | 'costs'>(getMainSectionFromPath());
  
  // Product type tab
  const getActiveTabFromPath = () => {
    if (location.pathname.includes('/jewelry')) return 'jewelry';
    if (location.pathname.includes('/services')) return 'service';
    if (location.pathname.includes('/general')) return 'general';
    return 'all';
  };
  
  const [activeProductTab, setActiveProductTab] = useState(getActiveTabFromPath());
  const [activeCostTab, setActiveCostTab] = useState('all');

  useEffect(() => {
    setActiveProductTab(getActiveTabFromPath());
    setMainSection(getMainSectionFromPath());
  }, [location.pathname]);

  useEffect(() => {
    fetchProducts();
    fetchCostEntries();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoadingProducts(true);
      const response = await fetch('/api/products');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      toast.error(language === 'ar' ? 'خطأ في جلب المنتجات' : 'Error fetching products');
    } finally {
      setLoadingProducts(false);
    }
  };

  const fetchCostEntries = async () => {
    try {
      setLoadingCosts(true);
      const response = await fetch('/api/cost-entries');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCostEntries(data || []);
    } catch (error) {
      console.error('Error fetching cost entries:', error);
      toast.error(language === 'ar' ? 'خطأ في جلب التكاليف' : 'Error fetching costs');
    } finally {
      setLoadingCosts(false);
    }
  };

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const matchesSearch = 
        product.product_code.toLowerCase().includes(productSearchTerm.toLowerCase()) ||
        product.name_ar.toLowerCase().includes(productSearchTerm.toLowerCase()) ||
        (product.name_en?.toLowerCase().includes(productSearchTerm.toLowerCase())) ||
        (product.description?.toLowerCase().includes(productSearchTerm.toLowerCase()));

      if (activeProductTab === 'all') return matchesSearch;
      if (activeProductTab === 'service') return matchesSearch && product.is_service;
      return matchesSearch && product.product_type === activeProductTab && !product.is_service;
    });
  }, [products, productSearchTerm, activeProductTab]);

  const filteredCosts = useMemo(() => {
    return costEntries.filter(cost => {
      const matchesSearch = 
        cost.cost_code.toLowerCase().includes(costSearchTerm.toLowerCase()) ||
        cost.name_ar.toLowerCase().includes(costSearchTerm.toLowerCase()) ||
        (cost.name_en?.toLowerCase().includes(costSearchTerm.toLowerCase()));

      if (activeCostTab === 'all') return matchesSearch;
      return matchesSearch && cost.cost_type === activeCostTab;
    });
  }, [costEntries, costSearchTerm, activeCostTab]);

  const handleEditProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductDialogOpen(true);
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm(language === 'ar' ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete?')) {
      return;
    }

    try {
      const clientRequestId = crypto.randomUUID();
      const { data: result, error } = await dataGateway.rpc('product_archive_atomic', {
        p_client_request_id: clientRequestId,
        p_product_id: id,
      });

      if (error) throw error;
      if (!result?.success) {
        throw new Error(result?.error || 'فشل أرشفة المنتج');
      }

      toast.success(language === 'ar' ? 'تم أرشفة المنتج بنجاح' : 'Product archived successfully');
      fetchProducts();
    } catch (error) {
      console.error('Error archiving product:', error);
      toast.error(language === 'ar' ? 'حدث خطأ' : 'An error occurred');
    }
  };

  const handleEditCost = (cost: CostEntry) => {
    setSelectedCostEntry(cost);
    setCostDialogOpen(true);
  };

  const handleDeleteCost = async (id: string) => {
    if (!confirm(language === 'ar' ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete?')) {
      return;
    }

    try {
      const clientRequestId = crypto.randomUUID();
      const { data: result, error } = await dataGateway.rpc('cost_entry_archive_atomic', {
        p_client_request_id: clientRequestId,
        p_cost_entry_id: id,
      });

      if (error) throw error;
      if (!result?.success) {
        throw new Error(result?.error || 'فشل أرشفة المصروف');
      }

      toast.success(language === 'ar' ? 'تم أرشفة المصروف بنجاح' : 'Cost entry archived successfully');
      fetchCostEntries();
    } catch (error) {
      console.error('Error archiving cost entry:', error);
      toast.error(language === 'ar' ? 'حدث خطأ' : 'An error occurred');
    }
  };

  const handleProductDialogClose = () => {
    setProductDialogOpen(false);
    setSelectedProduct(null);
  };

  const handleCostDialogClose = () => {
    setCostDialogOpen(false);
    setSelectedCostEntry(null);
  };

  const handleProductSaved = () => {
    fetchProducts();
    handleProductDialogClose();
  };

  const handleCostSaved = () => {
    fetchCostEntries();
    handleCostDialogClose();
  };

  const getProductTypeIcon = (product: Product) => {
    if (product.is_service) return <Wrench className="w-4 h-4 text-orange-500" />;
    if (product.product_type === 'jewelry') return <Gem className="w-4 h-4 text-purple-500" />;
    return <Box className="w-4 h-4 text-blue-500" />;
  };

  const getProductTypeBadge = (product: Product) => {
    if (product.is_service) {
      return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
        {language === 'ar' ? 'خدمة' : 'Service'}
      </Badge>;
    }
    if (product.product_type === 'jewelry') {
      return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
        {language === 'ar' ? 'مجوهرات' : 'Jewelry'}
      </Badge>;
    }
    return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
      {language === 'ar' ? 'عام' : 'General'}
    </Badge>;
  };

  const getCostTypeBadge = (costType: string) => {
    const config = COST_TYPE_CONFIG[costType as keyof typeof COST_TYPE_CONFIG];
    if (!config) return null;
    const Icon = config.icon;
    return (
      <Badge variant="outline" className={config.color}>
        <Icon className="w-3 h-3 mr-1" />
        {language === 'ar' ? config.labelAr : config.labelEn}
      </Badge>
    );
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    }).format(price);
  };

  const productStats = {
    total: products.length,
    jewelry: products.filter(p => p.product_type === 'jewelry' && !p.is_service).length,
    services: products.filter(p => p.is_service).length,
    general: products.filter(p => p.product_type === 'general' && !p.is_service).length,
  };

  const costStats = {
    total: costEntries.length,
    service: costEntries.filter(c => c.cost_type === 'service').length,
    fixed_asset: costEntries.filter(c => c.cost_type === 'fixed_asset').length,
    direct_expense: costEntries.filter(c => c.cost_type === 'direct_expense').length,
    indirect_overhead: costEntries.filter(c => c.cost_type === 'indirect_overhead').length,
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Package className="w-7 h-7 text-primary" />
              {language === 'ar' ? 'المنتجات والتكاليف' : 'Products & Costs'}
            </h1>
            <p className="text-muted-foreground mt-1">
              {language === 'ar' ? 'إدارة المنتجات المخزنية والتكاليف والمصروفات' : 'Manage inventory products and cost entries'}
            </p>
          </div>
        </div>

        {/* Main Action Card - Show only relevant card based on section */}
        {mainSection === 'costs' && (
          <Card className="transition-all hover:shadow-lg border-primary/30 ring-2 ring-primary/20">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-green-100 rounded-xl">
                  <DollarSign className="w-8 h-8 text-green-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold mb-1">
                    {language === 'ar' ? 'إضافة تكاليف جديدة' : 'Add New Cost Entry'}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    {language === 'ar' 
                      ? 'خدمات، أصول ثابتة، مصروفات مباشرة وعمومية'
                      : 'Services, Fixed Assets, Direct & Indirect Expenses'}
                  </p>
                  <Button 
                    size="sm" 
                    onClick={() => setCostDialogOpen(true)}
                    className="gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    {language === 'ar' ? 'إضافة' : 'Add'}
                  </Button>
                </div>
                <Badge variant="secondary" className="text-lg px-3">
                  {costStats.total}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {mainSection === 'products' && (
          <Card className="transition-all hover:shadow-lg border-primary/30 ring-2 ring-primary/20">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-100 rounded-xl">
                  <Package className="w-8 h-8 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold mb-1">
                    {language === 'ar' ? 'إضافة منتج جديد' : 'Add New Product'}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    {language === 'ar' 
                      ? 'مجوهرات، مستلزمات، مواد خام'
                      : 'Jewelry, Consumables, Raw Materials'}
                  </p>
                  <Button 
                    size="sm" 
                    onClick={() => setProductDialogOpen(true)}
                    className="gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    {language === 'ar' ? 'إضافة' : 'Add'}
                  </Button>
                </div>
                <Badge variant="secondary" className="text-lg px-3">
                  {productStats.total}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Content - Show based on section */}

          {/* Costs Content */}
          {mainSection === 'costs' && (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <CardTitle>{language === 'ar' ? 'قائمة التكاليف' : 'Cost Entries List'}</CardTitle>
                    <CardDescription>
                      {language === 'ar' ? 'جميع أنواع التكاليف والمصروفات المسجلة' : 'All registered cost and expense types'}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative w-64">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder={language === 'ar' ? 'بحث...' : 'Search...'}
                        value={costSearchTerm}
                        onChange={(e) => setCostSearchTerm(e.target.value)}
                        className="pr-10"
                      />
                    </div>
                    <Button onClick={() => setCostDialogOpen(true)} className="gap-2">
                      <Plus className="w-4 h-4" />
                      {language === 'ar' ? 'إضافة' : 'Add'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Cost Type Filter Tabs */}
                <Tabs value={activeCostTab} onValueChange={setActiveCostTab} className="mb-4">
                  <TabsList>
                    <TabsTrigger value="all" className="gap-2">
                      {language === 'ar' ? 'الكل' : 'All'}
                    </TabsTrigger>
                    <TabsTrigger value="service" className="gap-2">
                      <Wrench className="w-4 h-4" />
                      {language === 'ar' ? 'خدمات' : 'Services'}
                    </TabsTrigger>
                    <TabsTrigger value="fixed_asset" className="gap-2">
                      <Building2 className="w-4 h-4" />
                      {language === 'ar' ? 'أصول ثابتة' : 'Fixed Assets'}
                    </TabsTrigger>
                    <TabsTrigger value="direct_expense" className="gap-2">
                      <TrendingDown className="w-4 h-4" />
                      {language === 'ar' ? 'مصروفات مباشرة' : 'Direct'}
                    </TabsTrigger>
                    <TabsTrigger value="indirect_overhead" className="gap-2">
                      <Settings className="w-4 h-4" />
                      {language === 'ar' ? 'مصروفات عمومية' : 'Overhead'}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {loadingCosts ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : filteredCosts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>{language === 'ar' ? 'لا توجد تكاليف' : 'No cost entries found'}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>{language === 'ar' ? 'الكود' : 'Code'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الاسم' : 'Name'}</TableHead>
                          <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الحساب المحاسبي' : 'GL Account'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الضريبة' : 'Tax'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                          <TableHead className="text-center">{language === 'ar' ? 'إجراءات' : 'Actions'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCosts.map((cost, index) => (
                          <TableRow key={cost.id}>
                            <TableCell>{index + 1}</TableCell>
                            <TableCell className="font-mono">{cost.cost_code}</TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium">{cost.name_ar}</p>
                                {cost.name_en && (
                                  <p className="text-xs text-muted-foreground">{cost.name_en}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{getCostTypeBadge(cost.cost_type)}</TableCell>
                            <TableCell>
                              {cost.chart_of_accounts ? (
                                <span className="text-sm">
                                  {cost.chart_of_accounts.account_code} - {cost.chart_of_accounts.account_name}
                                </span>
                              ) : '-'}
                            </TableCell>
                            <TableCell>{cost.tax_rate}%</TableCell>
                            <TableCell>
                              <Badge variant={cost.is_active ? 'default' : 'secondary'}>
                                {cost.is_active 
                                  ? (language === 'ar' ? 'نشط' : 'Active')
                                  : (language === 'ar' ? 'غير نشط' : 'Inactive')
                                }
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditCost(cost)}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteCost(cost.id)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Products Content */}
          {mainSection === 'products' && (
            <>
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Package className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{productStats.total}</p>
                      <p className="text-xs text-muted-foreground">{language === 'ar' ? 'إجمالي المنتجات' : 'Total Products'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <Gem className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{productStats.jewelry}</p>
                      <p className="text-xs text-muted-foreground">{language === 'ar' ? 'مجوهرات' : 'Jewelry'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <Wrench className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{productStats.services}</p>
                      <p className="text-xs text-muted-foreground">{language === 'ar' ? 'خدمات' : 'Services'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Box className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{productStats.general}</p>
                      <p className="text-xs text-muted-foreground">{language === 'ar' ? 'منتجات عامة' : 'General'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <CardTitle>{language === 'ar' ? 'قائمة المنتجات' : 'Products List'}</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="relative w-64">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder={language === 'ar' ? 'بحث...' : 'Search...'}
                        value={productSearchTerm}
                        onChange={(e) => setProductSearchTerm(e.target.value)}
                        className="pr-10"
                      />
                    </div>
                    <Button onClick={() => setProductDialogOpen(true)} className="gap-2">
                      <Plus className="w-4 h-4" />
                      {language === 'ar' ? 'إضافة' : 'Add'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={activeProductTab} onValueChange={setActiveProductTab}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="all" className="gap-2">
                      <Package className="w-4 h-4" />
                      {language === 'ar' ? 'الكل' : 'All'}
                    </TabsTrigger>
                    <TabsTrigger value="jewelry" className="gap-2">
                      <Gem className="w-4 h-4" />
                      {language === 'ar' ? 'مجوهرات' : 'Jewelry'}
                    </TabsTrigger>
                    <TabsTrigger value="service" className="gap-2">
                      <Wrench className="w-4 h-4" />
                      {language === 'ar' ? 'خدمات' : 'Services'}
                    </TabsTrigger>
                    <TabsTrigger value="general" className="gap-2">
                      <Box className="w-4 h-4" />
                      {language === 'ar' ? 'عام' : 'General'}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value={activeProductTab} className="mt-0">
                    {loadingProducts ? (
                      <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                      </div>
                    ) : filteredProducts.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>{language === 'ar' ? 'لا توجد منتجات' : 'No products found'}</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">#</TableHead>
                              <TableHead>{language === 'ar' ? 'الكود' : 'Code'}</TableHead>
                              <TableHead>{language === 'ar' ? 'الاسم' : 'Name'}</TableHead>
                              <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                              <TableHead>{language === 'ar' ? 'التكلفة' : 'Cost'}</TableHead>
                              <TableHead>{language === 'ar' ? 'سعر البيع' : 'Selling Price'}</TableHead>
                              <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                              <TableHead className="text-center">{language === 'ar' ? 'إجراءات' : 'Actions'}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredProducts.map((product, index) => (
                              <TableRow key={product.id}>
                                <TableCell>{index + 1}</TableCell>
                                <TableCell className="font-mono">{product.product_code}</TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    {getProductTypeIcon(product)}
                                    <div>
                                      <p className="font-medium">{product.name_ar}</p>
                                      {product.name_en && (
                                        <p className="text-xs text-muted-foreground">{product.name_en}</p>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>{getProductTypeBadge(product)}</TableCell>
                                <TableCell dir="ltr">{formatPrice(product.cost_price)}</TableCell>
                                <TableCell dir="ltr">{formatPrice(product.selling_price)}</TableCell>
                                <TableCell>
                                  <Badge variant={product.is_active ? 'default' : 'secondary'}>
                                    {product.is_active 
                                      ? (language === 'ar' ? 'نشط' : 'Active')
                                      : (language === 'ar' ? 'غير نشط' : 'Inactive')
                                    }
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleEditProduct(product)}
                                    >
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleDeleteProduct(product.id)}
                                      className="text-destructive hover:text-destructive"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            </>
          )}
      </div>

      <ProductFormDialog
        open={productDialogOpen}
        onOpenChange={setProductDialogOpen}
        product={selectedProduct}
        onSuccess={handleProductSaved}
      />

      <CostEntryFormDialog
        open={costDialogOpen}
        onOpenChange={setCostDialogOpen}
        costEntry={selectedCostEntry}
        onSuccess={handleCostSaved}
      />
    </MainLayout>
  );
};

export default ProductsPage;
