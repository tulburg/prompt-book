interface EventDataMap {
  "settings:open": void;
  "sidebar:toggle": void;
  "mermaid:open": void;
}

type EventName = keyof EventDataMap;
type EventCallback = (data: unknown) => void;

const store: Record<string, EventCallback[]> = {};

const Bus = {
  on: <T extends EventName>(event: T, fn: (data: EventDataMap[T]) => void) => {
    store[event] = store[event] || [];
    store[event].push(fn as EventCallback);
  },

  off: <T extends EventName>(event: T, fn: (data: EventDataMap[T]) => void) => {
    if (!store[event]) return;
    const index = store[event].indexOf(fn as EventCallback);
    if (index > -1) {
      store[event].splice(index, 1);
    }
  },

  emit: <T extends EventName>(event: T, data: EventDataMap[T]) => {
    store[event] = store[event] || [];
    store[event].forEach((fn) => fn(data));
  },
};

export default Bus;
