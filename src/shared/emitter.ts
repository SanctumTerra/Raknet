// NOTE! EventMap name is not allowed
// biome-ignore lint/suspicious/noExplicitAny: EventMapp must allow any type for flexibility
type EventMapp = Record<string | symbol, any>;
type EventKey<T extends EventMapp> = string & keyof T;
type EventReceiver<T> = (params: T) => void;

interface Emitter<T extends EventMapp> {
	on<K extends EventKey<T>>(eventName: K, fn: EventReceiver<T[K]>): void;
	off<K extends EventKey<T>>(eventName: K, fn: EventReceiver<T[K]>): void;
	emit<K extends EventKey<T>>(
		eventName: K,
		...params: T[K] extends void ? [] : [T[K]]
	): void;
	once<K extends EventKey<T>>(eventName: K, fn: EventReceiver<T[K]>): void;
	removeAllListeners<K extends EventKey<T>>(eventName?: K): void;
	listenerCount<K extends EventKey<T>>(eventName: K): number;
	listeners<K extends EventKey<T>>(eventName: K): EventReceiver<T[K]>[];
	hasListener<K extends EventKey<T>>(
		eventName: K,
		fn?: EventReceiver<T[K]>,
	): boolean;
	hasAnyListeners<K extends EventKey<T>>(eventName: K): boolean;
}

class EventEmitter<T extends EventMapp> implements Emitter<T> {
	private events: {
		[K in keyof T]?: Set<EventReceiver<T[K]>>;
	} = {};

	on<K extends EventKey<T>>(eventName: K, fn: EventReceiver<T[K]>): void {
		if (!this.events[eventName]) {
			this.events[eventName] = new Set();
		}
		this.events[eventName]?.add(fn);
	}

	off<K extends EventKey<T>>(eventName: K, fn: EventReceiver<T[K]>): void {
		const eventSet = this.events[eventName];
		if (eventSet) {
			eventSet.delete(fn);
			if (eventSet.size === 0) {
				delete this.events[eventName];
			}
		}
	}

	emit<K extends EventKey<T>>(
		eventName: K,
		...params: T[K] extends void ? [] : [T[K]]
	): void {
		const eventSet = this.events[eventName];
		if (eventSet) {
			for (const fn of eventSet) {
				fn(params[0] as T[K]);
			}
		}
	}

	once<K extends EventKey<T>>(eventName: K, fn: EventReceiver<T[K]>): void {
		const onceWrapper: EventReceiver<T[K]> = (params) => {
			this.off(eventName, onceWrapper);
			fn(params);
		};
		this.on(eventName, onceWrapper);
	}

	removeAllListeners<K extends EventKey<T>>(eventName?: K): void {
		if (eventName) {
			delete this.events[eventName];
		} else {
			this.events = {};
		}
	}

	listenerCount<K extends EventKey<T>>(eventName: K): number {
		const eventSet = this.events[eventName];
		return eventSet ? eventSet.size : 0;
	}

	listeners<K extends EventKey<T>>(eventName: K): EventReceiver<T[K]>[] {
		const eventSet = this.events[eventName];
		return eventSet ? Array.from(eventSet) : [];
	}

	hasListener<K extends EventKey<T>>(
		eventName: K,
		fn?: EventReceiver<T[K]>,
	): boolean {
		const eventSet = this.events[eventName];
		if (!eventSet || eventSet.size === 0) {
			return false;
		}
		if (fn) {
			return eventSet.has(fn);
		}
		return eventSet.size > 0;
	}

	hasAnyListeners<K extends EventKey<T>>(eventName: K): boolean {
		const eventSet = this.events[eventName];
		return eventSet ? eventSet.size > 0 : false;
	}
}

export { EventEmitter };
