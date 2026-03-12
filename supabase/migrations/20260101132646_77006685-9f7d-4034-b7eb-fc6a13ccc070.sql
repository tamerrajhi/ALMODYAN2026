-- حذف القيد القديم
ALTER TABLE purchase_requisitions 
DROP CONSTRAINT IF EXISTS valid_status;

-- إنشاء القيد الجديد مع جميع الحالات المطلوبة لنظام الموافقات متعدد المستويات
ALTER TABLE purchase_requisitions 
ADD CONSTRAINT valid_status CHECK (
  status = ANY (ARRAY[
    'draft',                  -- مسودة
    'pending',                -- في انتظار الموافقة (عام)
    'pending_dept_approval',  -- انتظار موافقة مدير القسم
    'pending_procurement',    -- انتظار موافقة المشتريات
    'pending_management',     -- انتظار موافقة الإدارة
    'approved',               -- موافق عليه
    'rejected',               -- مرفوض
    'on_hold',                -- معلق
    'converted',              -- تم تحويله لأمر شراء
    'partially_converted',    -- محوّل جزئياً
    'fully_converted',        -- محوّل بالكامل
    'closed',                 -- مغلق
    'cancelled'               -- ملغي
  ])
);