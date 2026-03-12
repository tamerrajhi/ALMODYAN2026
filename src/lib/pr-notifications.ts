import { forbidDirectWrite } from '@/lib/atomicWriteGuard';

interface PRNotificationData {
  requisitionId: string;
  requisitionNumber: string;
  action: 'submitted' | 'approved' | 'rejected' | 'on_hold' | 'needs_approval';
  fromUserName?: string;
  targetUserId?: string;
  nextApprovalLevel?: number;
  comments?: string;
}

const getNotificationContent = (data: PRNotificationData) => {
  const { action, requisitionNumber, fromUserName, nextApprovalLevel, comments } = data;
  
  switch (action) {
    case 'submitted':
      return {
        title: 'طلب شراء جديد يحتاج موافقتك',
        message: `تم إرسال طلب الشراء ${requisitionNumber} للموافقة من ${fromUserName || 'مستخدم'}`,
        type: 'info',
      };
    case 'approved':
      return {
        title: 'تمت الموافقة على طلب الشراء',
        message: `تمت الموافقة على طلب الشراء ${requisitionNumber} بواسطة ${fromUserName || 'مستخدم'}`,
        type: 'success',
      };
    case 'rejected':
      return {
        title: 'تم رفض طلب الشراء',
        message: `تم رفض طلب الشراء ${requisitionNumber}${comments ? ` - السبب: ${comments}` : ''}`,
        type: 'error',
      };
    case 'on_hold':
      return {
        title: 'تم تعليق طلب الشراء',
        message: `تم تعليق طلب الشراء ${requisitionNumber}${comments ? ` - السبب: ${comments}` : ''}`,
        type: 'warning',
      };
    case 'needs_approval':
      const levelText = nextApprovalLevel === 1 ? 'المشتريات' : 
                        nextApprovalLevel === 2 ? 'الإدارة العليا' : 'المستوى التالي';
      return {
        title: 'طلب شراء ينتظر موافقتك',
        message: `طلب الشراء ${requisitionNumber} وصل لمرحلة موافقة ${levelText}`,
        type: 'info',
      };
    default:
      return {
        title: 'تحديث على طلب الشراء',
        message: `تحديث جديد على طلب الشراء ${requisitionNumber}`,
        type: 'info',
      };
  }
};

export async function sendPRNotification(data: PRNotificationData): Promise<void> {
  try {
    if (!data.targetUserId) return;
    
    const content = getNotificationContent(data);
    
    forbidDirectWrite('insert', 'pr-notifications.ts:65');
    return;
  } catch (error) {
    console.error('Error sending PR notification:', error);
  }
}

export async function notifyPRCreator(data: PRNotificationData, creatorId: string): Promise<void> {
  await sendPRNotification({
    ...data,
    targetUserId: creatorId,
  });
}

export async function notifyApprovers(
  requisitionId: string,
  requisitionNumber: string,
  approvalLevel: number,
  fromUserName?: string,
  departmentId?: string
): Promise<void> {
  try {
    let approverRoles: string[] = [];
    
    if (approvalLevel === 0) {
      approverRoles = ['مدير قسم', 'Department Manager'];
    } else if (approvalLevel === 1) {
      approverRoles = ['المشتريات', 'Procurement', 'مسؤول المشتريات'];
    } else if (approvalLevel === 2) {
      approverRoles = ['الإدارة العليا', 'Top Management', 'المدير العام', 'General Manager'];
    }
    
    if (approverRoles.length === 0) return;
    
    const res = await fetch('/api/pr-approver-users', { credentials: 'include' });
    const approvers: { user_id: string }[] = (!res.ok && res.status === 501) ? [] : await res.json();
    
    if (!approvers || approvers.length === 0) {
      return;
    }
    
    const uniqueUserIds = [...new Set(approvers.map(a => a.user_id))];
    
    for (const userId of uniqueUserIds) {
      await sendPRNotification({
        requisitionId,
        requisitionNumber,
        action: 'needs_approval',
        fromUserName,
        targetUserId: userId,
        nextApprovalLevel: approvalLevel,
      });
    }
  } catch (error) {
    console.error('Error notifying approvers:', error);
  }
}
