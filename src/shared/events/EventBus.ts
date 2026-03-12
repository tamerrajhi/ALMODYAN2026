type EventCallback<T = unknown> = (data: T) => void | Promise<void>;

interface EventSubscription {
  id: string;
  callback: EventCallback;
  once: boolean;
}

class EventBus {
  private static instance: EventBus;
  private events: Map<string, EventSubscription[]> = new Map();
  private eventHistory: Array<{ event: string; data: unknown; timestamp: Date }> = [];
  private maxHistorySize: number = 100;

  private constructor() {}

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  // إنشاء معرف فريد
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // الاشتراك في حدث
  subscribe<T = unknown>(event: string, callback: EventCallback<T>): string {
    const subscription: EventSubscription = {
      id: this.generateId(),
      callback: callback as EventCallback,
      once: false
    };

    const subscriptions = this.events.get(event) || [];
    subscriptions.push(subscription);
    this.events.set(event, subscriptions);

    return subscription.id;
  }

  // الاشتراك لمرة واحدة
  once<T = unknown>(event: string, callback: EventCallback<T>): string {
    const subscription: EventSubscription = {
      id: this.generateId(),
      callback: callback as EventCallback,
      once: true
    };

    const subscriptions = this.events.get(event) || [];
    subscriptions.push(subscription);
    this.events.set(event, subscriptions);

    return subscription.id;
  }

  // إلغاء الاشتراك
  unsubscribe(subscriptionId: string): boolean {
    for (const [event, subscriptions] of this.events.entries()) {
      const index = subscriptions.findIndex(sub => sub.id === subscriptionId);
      if (index !== -1) {
        subscriptions.splice(index, 1);
        if (subscriptions.length === 0) {
          this.events.delete(event);
        }
        return true;
      }
    }
    return false;
  }

  // إلغاء جميع الاشتراكات لحدث معين
  unsubscribeAll(event: string): void {
    this.events.delete(event);
  }

  // نشر حدث
  async publish<T = unknown>(event: string, data: T): Promise<void> {
    // حفظ في التاريخ
    this.addToHistory(event, data);

    const subscriptions = this.events.get(event);
    if (!subscriptions || subscriptions.length === 0) {
      return;
    }

    const toRemove: string[] = [];

    for (const subscription of subscriptions) {
      try {
        await subscription.callback(data);
        
        if (subscription.once) {
          toRemove.push(subscription.id);
        }
      } catch (error) {
        console.error(`Error in event handler for "${event}":`, error);
      }
    }

    // إزالة الاشتراكات لمرة واحدة
    toRemove.forEach(id => this.unsubscribe(id));
  }

  // نشر حدث بشكل متزامن (للعمليات غير الحساسة)
  publishSync<T = unknown>(event: string, data: T): void {
    this.publish(event, data).catch(error => {
      console.error(`Error publishing event "${event}":`, error);
    });
  }

  // إضافة إلى التاريخ
  private addToHistory(event: string, data: unknown): void {
    this.eventHistory.push({
      event,
      data,
      timestamp: new Date()
    });

    // الحفاظ على الحجم الأقصى
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  // الحصول على تاريخ الأحداث
  getHistory(event?: string): Array<{ event: string; data: unknown; timestamp: Date }> {
    if (event) {
      return this.eventHistory.filter(h => h.event === event);
    }
    return [...this.eventHistory];
  }

  // مسح التاريخ
  clearHistory(): void {
    this.eventHistory = [];
  }

  // الحصول على قائمة الأحداث المسجلة
  getRegisteredEvents(): string[] {
    return Array.from(this.events.keys());
  }

  // الحصول على عدد المشتركين لحدث معين
  getSubscriberCount(event: string): number {
    return this.events.get(event)?.length ?? 0;
  }
}

// تصدير instance واحد
export const eventBus = EventBus.getInstance();

// أسماء الأحداث المعيارية (للتوثيق والـ autocomplete)
export const EventNames = {
  // أحداث المبيعات
  SALE_COMPLETED: 'sales.completed',
  SALE_CANCELLED: 'sales.cancelled',
  RETURN_CREATED: 'sales.return.created',
  
  // أحداث المخزون
  ITEM_CREATED: 'inventory.item.created',
  ITEM_UPDATED: 'inventory.item.updated',
  ITEM_TRANSFERRED: 'inventory.item.transferred',
  ITEM_SOLD: 'inventory.item.sold',
  
  // أحداث المشتريات
  PO_CREATED: 'purchases.po.created',
  PO_RECEIVED: 'purchases.po.received',
  
  // أحداث المحاسبة
  JOURNAL_ENTRY_CREATED: 'accounting.journal.created',
  PAYMENT_RECEIVED: 'accounting.payment.received',
  PAYMENT_SENT: 'accounting.payment.sent',
  
  // أحداث الخزائن
  VAULT_TRANSACTION: 'vaults.transaction',
  
  // أحداث الإنتاج
  WORK_ORDER_CREATED: 'production.workorder.created',
  WORK_ORDER_COMPLETED: 'production.workorder.completed',
  
  // أحداث النظام
  MODULE_ENABLED: 'system.module.enabled',
  MODULE_DISABLED: 'system.module.disabled',
  USER_LOGGED_IN: 'system.user.login',
  USER_LOGGED_OUT: 'system.user.logout',
} as const;

export default eventBus;
