import { useEffect, useCallback, useRef } from 'react';
import { eventBus, EventNames } from '@/shared/events/EventBus';

type EventCallback<T = unknown> = (data: T) => void | Promise<void>;

export function useEventBus() {
  const subscriptionsRef = useRef<string[]>([]);

  // تنظيف الاشتراكات عند unmount
  useEffect(() => {
    return () => {
      subscriptionsRef.current.forEach(id => {
        eventBus.unsubscribe(id);
      });
      subscriptionsRef.current = [];
    };
  }, []);

  // الاشتراك في حدث
  const subscribe = useCallback(<T = unknown>(event: string, callback: EventCallback<T>) => {
    const subscriptionId = eventBus.subscribe(event, callback);
    subscriptionsRef.current.push(subscriptionId);
    return subscriptionId;
  }, []);

  // الاشتراك لمرة واحدة
  const once = useCallback(<T = unknown>(event: string, callback: EventCallback<T>) => {
    const subscriptionId = eventBus.once(event, callback);
    subscriptionsRef.current.push(subscriptionId);
    return subscriptionId;
  }, []);

  // إلغاء الاشتراك
  const unsubscribe = useCallback((subscriptionId: string) => {
    const index = subscriptionsRef.current.indexOf(subscriptionId);
    if (index !== -1) {
      subscriptionsRef.current.splice(index, 1);
    }
    return eventBus.unsubscribe(subscriptionId);
  }, []);

  // نشر حدث
  const publish = useCallback(async <T = unknown>(event: string, data: T) => {
    await eventBus.publish(event, data);
  }, []);

  // نشر حدث بشكل متزامن (fire and forget)
  const publishSync = useCallback(<T = unknown>(event: string, data: T) => {
    eventBus.publishSync(event, data);
  }, []);

  return {
    subscribe,
    once,
    unsubscribe,
    publish,
    publishSync,
    EventNames,
  };
}

// Hook للاشتراك في حدث محدد
export function useEventSubscription<T = unknown>(
  event: string,
  callback: EventCallback<T>,
  deps: React.DependencyList = []
) {
  useEffect(() => {
    const subscriptionId = eventBus.subscribe(event, callback);
    return () => {
      eventBus.unsubscribe(subscriptionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}

export default useEventBus;
