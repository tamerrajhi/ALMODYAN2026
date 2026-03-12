
# خطة إصلاح فشل عملية البيع

## ملخص المشكلة

عملية البيع تفشل بسبب **عدم تطابق في قيمة `movement_type`** بين:
- **الدالة**: تستخدم `'SALE'` (أحرف كبيرة)
- **CHECK Constraint**: يسمح فقط بـ `'sale'` (أحرف صغيرة)

### رسالة الخطأ:
```
SALE_MOVEMENTS_INCOMPLETE: expected 1 movements, found 0 for sale_id=...
```

---

## التعديلات المطلوبة

### التعديل 1: تحديث CHECK Constraint

إضافة `'SALE'` للقيم المسموحة (أو توحيد جميع القيم):

```text
Current Values:  'import', 'purchase_return', 'purchase_return_void', 'transfer', 'sale', 'sale_return', 'adjustment', 'void', 'receive', 'issue'

Add Values:      'SALE', 'SALE_RETURN' (للتوافق مع الكود الحالي)
```

### التعديل 2: أو تعديل الدالة لاستخدام أحرف صغيرة

تغيير في `complete_pos_sale_atomic`:
```sql
-- سطر 450: تغيير من 'SALE' إلى 'sale'
'sale',  -- بدلاً من 'SALE'
```

وتغيير في ON CONFLICT:
```sql
WHERE (movement_type = 'sale' AND reference_type = 'sale')
```

---

## الحل المقترح

الأفضل هو **توسيع CHECK Constraint** ليشمل القيم بأحرف كبيرة، لأن:
1. الفهرس الفريد موجود بالفعل بـ `'SALE'`
2. تعديل الدالة قد يؤثر على منطق آخر

### SQL Migration:

```sql
-- 1. Drop existing constraint
ALTER TABLE public.item_movements 
DROP CONSTRAINT check_movement_type_values;

-- 2. Add updated constraint with uppercase values
ALTER TABLE public.item_movements
ADD CONSTRAINT check_movement_type_values 
CHECK ((movement_type = ANY (ARRAY[
  'import'::text, 
  'purchase_return'::text, 
  'purchase_return_void'::text, 
  'transfer'::text, 
  'sale'::text, 
  'SALE'::text,
  'sale_return'::text, 
  'SALE_RETURN'::text,
  'adjustment'::text, 
  'void'::text, 
  'receive'::text, 
  'issue'::text
])));
```

---

## الخطأ الثانوي: Function Overloading

### المشكلة:
```
PGRST203: Could not choose the best candidate function between:
- pos_begin_request(p_client_request_id => uuid, p_workflow_type => text, p_payload => jsonb)
- pos_begin_request(p_client_request_id => text, p_workflow_type => text, p_payload => text)
```

### السبب:
توجد نسختان من الدالة بأنواع مختلفة لنفس المعاملات.

### الحل:
حذف النسخة القديمة:
```sql
DROP FUNCTION IF EXISTS public.pos_begin_request(text, text, text);
```

---

## ملخص التعديلات

| المشكلة | الحل |
|---------|------|
| CHECK Constraint يرفض 'SALE' | إضافة 'SALE' و 'SALE_RETURN' للقيم المسموحة |
| Function overloading | حذف النسخة القديمة من pos_begin_request |

---

## نتيجة الإصلاح

بعد التعديل:
1. عملية البيع ستنجح
2. سيتم إنشاء item_movement بشكل صحيح
3. لن تظهر رسالة `SALE_MOVEMENTS_INCOMPLETE`
