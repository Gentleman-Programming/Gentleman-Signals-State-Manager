/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { ɵɵdefineInjectable } from '../di';
import { INJECTOR } from '../render3/interfaces/view';
import { arrayInsert2, arraySplice } from '../util/array_utils';
/**
 * Returns a function that captures a provided delay.
 * Invoking the returned function schedules a trigger.
 */
export function onTimer(delay) {
    return (callback, lView) => scheduleTimerTrigger(delay, callback, lView);
}
/**
 * Schedules a callback to be invoked after a given timeout.
 *
 * @param delay A number of ms to wait until firing a callback.
 * @param callback A function to be invoked after a timeout.
 * @param lView LView that hosts an instance of a defer block.
 */
export function scheduleTimerTrigger(delay, callback, lView) {
    const injector = lView[INJECTOR];
    const scheduler = injector.get(TimerScheduler);
    const cleanupFn = () => scheduler.remove(callback);
    scheduler.add(delay, callback);
    return cleanupFn;
}
/**
 * Helper service to schedule `setTimeout`s for batches of defer blocks,
 * to avoid calling `setTimeout` for each defer block (e.g. if defer blocks
 * are created inside a for loop).
 */
export class TimerScheduler {
    constructor() {
        // Indicates whether current callbacks are being invoked.
        this.executingCallbacks = false;
        // Currently scheduled `setTimeout` id.
        this.timeoutId = null;
        // When currently scheduled timer would fire.
        this.invokeTimerAt = null;
        // List of callbacks to be invoked.
        // For each callback we also store a timestamp on when the callback
        // should be invoked. We store timestamps and callback functions
        // in a flat array to avoid creating new objects for each entry.
        // [timestamp1, callback1, timestamp2, callback2, ...]
        this.current = [];
        // List of callbacks collected while invoking current set of callbacks.
        // Those callbacks are added to the "current" queue at the end of
        // the current callback invocation. The shape of this list is the same
        // as the shape of the `current` list.
        this.deferred = [];
    }
    add(delay, callback) {
        const target = this.executingCallbacks ? this.deferred : this.current;
        this.addToQueue(target, Date.now() + delay, callback);
        this.scheduleTimer();
    }
    remove(callback) {
        const { current, deferred } = this;
        const callbackIndex = this.removeFromQueue(current, callback);
        if (callbackIndex === -1) {
            // Try cleaning up deferred queue only in case
            // we didn't find a callback in the "current" queue.
            this.removeFromQueue(deferred, callback);
        }
        // If the last callback was removed and there is a pending timeout - cancel it.
        if (current.length === 0 && deferred.length === 0) {
            this.clearTimeout();
        }
    }
    addToQueue(target, invokeAt, callback) {
        let insertAtIndex = target.length;
        for (let i = 0; i < target.length; i += 2) {
            const invokeQueuedCallbackAt = target[i];
            if (invokeQueuedCallbackAt > invokeAt) {
                // We've reached a first timer that is scheduled
                // for a later time than what we are trying to insert.
                // This is the location at which we need to insert,
                // no need to iterate further.
                insertAtIndex = i;
                break;
            }
        }
        arrayInsert2(target, insertAtIndex, invokeAt, callback);
    }
    removeFromQueue(target, callback) {
        let index = -1;
        for (let i = 0; i < target.length; i += 2) {
            const queuedCallback = target[i + 1];
            if (queuedCallback === callback) {
                index = i;
                break;
            }
        }
        if (index > -1) {
            // Remove 2 elements: a timestamp slot and
            // the following slot with a callback function.
            arraySplice(target, index, 2);
        }
        return index;
    }
    scheduleTimer() {
        const callback = () => {
            this.clearTimeout();
            this.executingCallbacks = true;
            // Clone the current state of the queue, since it might be altered
            // as we invoke callbacks.
            const current = [...this.current];
            // Invoke callbacks that were scheduled to run before the current time.
            const now = Date.now();
            for (let i = 0; i < current.length; i += 2) {
                const invokeAt = current[i];
                const callback = current[i + 1];
                if (invokeAt <= now) {
                    callback();
                }
                else {
                    // We've reached a timer that should not be invoked yet.
                    break;
                }
            }
            // The state of the queue might've changed after callbacks invocation,
            // run the cleanup logic based on the *current* state of the queue.
            let lastCallbackIndex = -1;
            for (let i = 0; i < this.current.length; i += 2) {
                const invokeAt = this.current[i];
                if (invokeAt <= now) {
                    // Add +1 to account for a callback function that
                    // goes after the timestamp in events array.
                    lastCallbackIndex = i + 1;
                }
                else {
                    // We've reached a timer that should not be invoked yet.
                    break;
                }
            }
            if (lastCallbackIndex >= 0) {
                arraySplice(this.current, 0, lastCallbackIndex + 1);
            }
            this.executingCallbacks = false;
            // If there are any callbacks added during an invocation
            // of the current ones - move them over to the "current"
            // queue.
            if (this.deferred.length > 0) {
                for (let i = 0; i < this.deferred.length; i += 2) {
                    const invokeAt = this.deferred[i];
                    const callback = this.deferred[i + 1];
                    this.addToQueue(this.current, invokeAt, callback);
                }
                this.deferred.length = 0;
            }
            this.scheduleTimer();
        };
        // Avoid running timer callbacks more than once per
        // average frame duration. This is needed for better
        // batching and to avoid kicking off excessive change
        // detection cycles.
        const FRAME_DURATION_MS = 16; // 1000ms / 60fps
        if (this.current.length > 0) {
            const now = Date.now();
            // First element in the queue points at the timestamp
            // of the first (earliest) event.
            const invokeAt = this.current[0];
            if (this.timeoutId === null ||
                // Reschedule a timer in case a queue contains an item with
                // an earlier timestamp and the delta is more than an average
                // frame duration.
                (this.invokeTimerAt && (this.invokeTimerAt - invokeAt > FRAME_DURATION_MS))) {
                // There was a timeout already, but an earlier event was added
                // into the queue. In this case we drop an old timer and setup
                // a new one with an updated (smaller) timeout.
                this.clearTimeout();
                const timeout = Math.max(invokeAt - now, FRAME_DURATION_MS);
                this.invokeTimerAt = invokeAt;
                this.timeoutId = setTimeout(callback, timeout);
            }
        }
    }
    clearTimeout() {
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }
    ngOnDestroy() {
        this.clearTimeout();
        this.current.length = 0;
        this.deferred.length = 0;
    }
    /** @nocollapse */
    static { this.ɵprov = ɵɵdefineInjectable({
        token: TimerScheduler,
        providedIn: 'root',
        factory: () => new TimerScheduler(),
    }); }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGltZXJfc2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvY29yZS9zcmMvZGVmZXIvdGltZXJfc2NoZWR1bGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBQyxrQkFBa0IsRUFBQyxNQUFNLE9BQU8sQ0FBQztBQUN6QyxPQUFPLEVBQUMsUUFBUSxFQUFRLE1BQU0sNEJBQTRCLENBQUM7QUFDM0QsT0FBTyxFQUFDLFlBQVksRUFBRSxXQUFXLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQztBQUU5RDs7O0dBR0c7QUFDSCxNQUFNLFVBQVUsT0FBTyxDQUFDLEtBQWE7SUFDbkMsT0FBTyxDQUFDLFFBQXNCLEVBQUUsS0FBWSxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsUUFBUSxFQUFFLEtBQUssQ0FBQyxDQUFDO0FBQ2hHLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxNQUFNLFVBQVUsb0JBQW9CLENBQUMsS0FBYSxFQUFFLFFBQXNCLEVBQUUsS0FBWTtJQUN0RixNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFFLENBQUM7SUFDbEMsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUMvQyxNQUFNLFNBQVMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ25ELFNBQVMsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQy9CLE9BQU8sU0FBUyxDQUFDO0FBQ25CLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxPQUFPLGNBQWM7SUFBM0I7UUFDRSx5REFBeUQ7UUFDekQsdUJBQWtCLEdBQUcsS0FBSyxDQUFDO1FBRTNCLHVDQUF1QztRQUN2QyxjQUFTLEdBQWdCLElBQUksQ0FB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aWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQge8m1ybVkZWZpbmVJbmplY3RhYmxlfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQge0lOSkVDVE9SLCBMVmlld30gZnJvbSAnLi4vcmVuZGVyMy9pbnRlcmZhY2VzL3ZpZXcnO1xuaW1wb3J0IHthcnJheUluc2VydDIsIGFycmF5U3BsaWNlfSBmcm9tICcuLi91dGlsL2FycmF5X3V0aWxzJztcblxuLyoqXG4gKiBSZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCBjYXB0dXJlcyBhIHByb3ZpZGVkIGRlbGF5LlxuICogSW52b2tpbmcgdGhlIHJldHVybmVkIGZ1bmN0aW9uIHNjaGVkdWxlcyBhIHRyaWdnZXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvblRpbWVyKGRlbGF5OiBudW1iZXIpIHtcbiAgcmV0dXJuIChjYWxsYmFjazogVm9pZEZ1bmN0aW9uLCBsVmlldzogTFZpZXcpID0+IHNjaGVkdWxlVGltZXJUcmlnZ2VyKGRlbGF5LCBjYWxsYmFjaywgbFZpZXcpO1xufVxuXG4vKipcbiAqIFNjaGVkdWxlcyBhIGNhbGxiYWNrIHRvIGJlIGludm9rZWQgYWZ0ZXIgYSBnaXZlbiB0aW1lb3V0LlxuICpcbiAqIEBwYXJhbSBkZWxheSBBIG51bWJlciBvZiBtcyB0byB3YWl0IHVudGlsIGZpcmluZyBhIGNhbGxiYWNrLlxuICogQHBhcmFtIGNhbGxiYWNrIEEgZnVuY3Rpb24gdG8gYmUgaW52b2tlZCBhZnRlciBhIHRpbWVvdXQuXG4gKiBAcGFyYW0gbFZpZXcgTFZpZXcgdGhhdCBob3N0cyBhbiBpbnN0YW5jZSBvZiBhIGRlZmVyIGJsb2NrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2NoZWR1bGVUaW1lclRyaWdnZXIoZGVsYXk6IG51bWJlciwgY2FsbGJhY2s6IFZvaWRGdW5jdGlvbiwgbFZpZXc6IExWaWV3KSB7XG4gIGNvbnN0IGluamVjdG9yID0gbFZpZXdbSU5KRUNUT1JdITtcbiAgY29uc3Qgc2NoZWR1bGVyID0gaW5qZWN0b3IuZ2V0KFRpbWVyU2NoZWR1bGVyKTtcbiAgY29uc3QgY2xlYW51cEZuID0gKCkgPT4gc2NoZWR1bGVyLnJlbW92ZShjYWxsYmFjayk7XG4gIHNjaGVkdWxlci5hZGQoZGVsYXksIGNhbGxiYWNrKTtcbiAgcmV0dXJuIGNsZWFudXBGbjtcbn1cblxuLyoqXG4gKiBIZWxwZXIgc2VydmljZSB0byBzY2hlZHVsZSBgc2V0VGltZW91dGBzIGZvciBiYXRjaGVzIG9mIGRlZmVyIGJsb2NrcyxcbiAqIHRvIGF2b2lkIGNhbGxpbmcgYHNldFRpbWVvdXRgIGZvciBlYWNoIGRlZmVyIGJsb2NrIChlLmcuIGlmIGRlZmVyIGJsb2Nrc1xuICogYXJlIGNyZWF0ZWQgaW5zaWRlIGEgZm9yIGxvb3ApLlxuICovXG5leHBvcnQgY2xhc3MgVGltZXJTY2hlZHVsZXIge1xuICAvLyBJbmRpY2F0ZXMgd2hldGhlciBjdXJyZW50IGNhbGxiYWNrcyBhcmUgYmVpbmcgaW52b2tlZC5cbiAgZXhlY3V0aW5nQ2FsbGJhY2tzID0gZmFsc2U7XG5cbiAgLy8gQ3VycmVudGx5IHNjaGVkdWxlZCBgc2V0VGltZW91dGAgaWQuXG4gIHRpbWVvdXRJZDogbnVtYmVyfG51bGwgPSBudWxsO1xuXG4gIC8vIFdoZW4gY3VycmVudGx5IHNjaGVkdWxlZCB0aW1lciB3b3VsZCBmaXJlLlxuICBpbnZva2VUaW1lckF0OiBudW1iZXJ8bnVsbCA9IG51bGw7XG5cbiAgLy8gTGlzdCBvZiBjYWxsYmFja3MgdG8gYmUgaW52b2tlZC5cbiAgLy8gRm9yIGVhY2ggY2FsbGJhY2sgd2UgYWxzbyBzdG9yZSBhIHRpbWVzdGFtcCBvbiB3aGVuIHRoZSBjYWxsYmFja1xuICAvLyBzaG91bGQgYmUgaW52b2tlZC4gV2Ugc3RvcmUgdGltZXN0YW1wcyBhbmQgY2FsbGJhY2sgZnVuY3Rpb25zXG4gIC8vIGluIGEgZmxhdCBhcnJheSB0byBhdm9pZCBjcmVhdGluZyBuZXcgb2JqZWN0cyBmb3IgZWFjaCBlbnRyeS5cbiAgLy8gW3RpbWVzdGFtcDEsIGNhbGxiYWNrMSwgdGltZXN0YW1wMiwgY2FsbGJhY2syLCAuLi5dXG4gIGN1cnJlbnQ6IEFycmF5PG51bWJlcnxWb2lkRnVuY3Rpb24+ID0gW107XG5cbiAgLy8gTGlzdCBvZiBjYWxsYmFja3MgY29sbGVjdGVkIHdoaWxlIGludm9raW5nIGN1cnJlbnQgc2V0IG9mIGNhbGxiYWNrcy5cbiAgLy8gVGhvc2UgY2FsbGJhY2tzIGFyZSBhZGRlZCB0byB0aGUgXCJjdXJyZW50XCIgcXVldWUgYXQgdGhlIGVuZCBvZlxuICAvLyB0aGUgY3VycmVudCBjYWxsYmFjayBpbnZvY2F0aW9uLiBUaGUgc2hhcGUgb2YgdGhpcyBsaXN0IGlzIHRoZSBzYW1lXG4gIC8vIGFzIHRoZSBzaGFwZSBvZiB0aGUgYGN1cnJlbnRgIGxpc3QuXG4gIGRlZmVycmVkOiBBcnJheTxudW1iZXJ8Vm9pZEZ1bmN0aW9uPiA9IFtdO1xuXG4gIGFkZChkZWxheTogbnVtYmVyLCBjYWxsYmFjazogVm9pZEZ1bmN0aW9uKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy5leGVjdXRpbmdDYWxsYmFja3MgPyB0aGlzLmRlZmVycmVkIDogdGhpcy5jdXJyZW50O1xuICAgIHRoaXMuYWRkVG9RdWV1ZSh0YXJnZXQsIERhdGUubm93KCkgKyBkZWxheSwgY2FsbGJhY2spO1xuICAgIHRoaXMuc2NoZWR1bGVUaW1lcigpO1xuICB9XG5cbiAgcmVtb3ZlKGNhbGxiYWNrOiBWb2lkRnVuY3Rpb24pIHtcbiAgICBjb25zdCB7Y3VycmVudCwgZGVmZXJyZWR9ID0gdGhpcztcbiAgICBjb25zdCBjYWxsYmFja0luZGV4ID0gdGhpcy5yZW1vdmVGcm9tUXVldWUoY3VycmVudCwgY2FsbGJhY2spO1xuICAgIGlmIChjYWxsYmFja0luZGV4ID09PSAtMSkge1xuICAgICAgLy8gVHJ5IGNsZWFuaW5nIHVwIGRlZmVycmVkIHF1ZXVlIG9ubHkgaW4gY2FzZVxuICAgICAgLy8gd2UgZGlkbid0IGZpbmQgYSBjYWxsYmFjayBpbiB0aGUgXCJjdXJyZW50XCIgcXVldWUuXG4gICAgICB0aGlzLnJlbW92ZUZyb21RdWV1ZShkZWZlcnJlZCwgY2FsbGJhY2spO1xuICAgIH1cbiAgICAvLyBJZiB0aGUgbGFzdCBjYWxsYmFjayB3YXMgcmVtb3ZlZCBhbmQgdGhlcmUgaXMgYSBwZW5kaW5nIHRpbWVvdXQgLSBjYW5jZWwgaXQuXG4gICAgaWYgKGN1cnJlbnQubGVuZ3RoID09PSAwICYmIGRlZmVycmVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5jbGVhclRpbWVvdXQoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFkZFRvUXVldWUodGFyZ2V0OiBBcnJheTxudW1iZXJ8Vm9pZEZ1bmN0aW9uPiwgaW52b2tlQXQ6IG51bWJlciwgY2FsbGJhY2s6IFZvaWRGdW5jdGlvbikge1xuICAgIGxldCBpbnNlcnRBdEluZGV4ID0gdGFyZ2V0Lmxlbmd0aDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRhcmdldC5sZW5ndGg7IGkgKz0gMikge1xuICAgICAgY29uc3QgaW52b2tlUXVldWVkQ2FsbGJhY2tBdCA9IHRhcmdldFtpXSBhcyBudW1iZXI7XG4gICAgICBpZiAoaW52b2tlUXVldWVkQ2FsbGJhY2tBdCA+IGludm9rZUF0KSB7XG4gICAgICAgIC8vIFdlJ3ZlIHJlYWNoZWQgYSBmaXJzdCB0aW1lciB0aGF0IGlzIHNjaGVkdWxlZFxuICAgICAgICAvLyBmb3IgYSBsYXRlciB0aW1lIHRoYW4gd2hhdCB3ZSBhcmUgdHJ5aW5nIHRvIGluc2VydC5cbiAgICAgICAgLy8gVGhpcyBpcyB0aGUgbG9jYXRpb24gYXQgd2hpY2ggd2UgbmVlZCB0byBpbnNlcnQsXG4gICAgICAgIC8vIG5vIG5lZWQgdG8gaXRlcmF0ZSBmdXJ0aGVyLlxuICAgICAgICBpbnNlcnRBdEluZGV4ID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGFycmF5SW5zZXJ0Mih0YXJnZXQsIGluc2VydEF0SW5kZXgsIGludm9rZUF0LCBjYWxsYmFjayk7XG4gIH1cblxuICBwcml2YXRlIHJlbW92ZUZyb21RdWV1ZSh0YXJnZXQ6IEFycmF5PG51bWJlcnxWb2lkRnVuY3Rpb24+LCBjYWxsYmFjazogVm9pZEZ1bmN0aW9uKSB7XG4gICAgbGV0IGluZGV4ID0gLTE7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0YXJnZXQubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgIGNvbnN0IHF1ZXVlZENhbGxiYWNrID0gdGFyZ2V0W2kgKyAxXTtcbiAgICAgIGlmIChxdWV1ZWRDYWxsYmFjayA9PT0gY2FsbGJhY2spIHtcbiAgICAgICAgaW5kZXggPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgIC8vIFJlbW92ZSAyIGVsZW1lbnRzOiBhIHRpbWVzdGFtcCBzbG90IGFuZFxuICAgICAgLy8gdGhlIGZvbGxvd2luZyBzbG90IHdpdGggYSBjYWxsYmFjayBmdW5jdGlvbi5cbiAgICAgIGFycmF5U3BsaWNlKHRhcmdldCwgaW5kZXgsIDIpO1xuICAgIH1cbiAgICByZXR1cm4gaW5kZXg7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlVGltZXIoKSB7XG4gICAgY29uc3QgY2FsbGJhY2sgPSAoKSA9PiB7XG4gICAgICB0aGlzLmNsZWFyVGltZW91dCgpO1xuXG4gICAgICB0aGlzLmV4ZWN1dGluZ0NhbGxiYWNrcyA9IHRydWU7XG5cbiAgICAgIC8vIENsb25lIHRoZSBjdXJyZW50IHN0YXRlIG9mIHRoZSBxdWV1ZSwgc2luY2UgaXQgbWlnaHQgYmUgYWx0ZXJlZFxuICAgICAgLy8gYXMgd2UgaW52b2tlIGNhbGxiYWNrcy5cbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBbLi4udGhpcy5jdXJyZW50XTtcblxuICAgICAgLy8gSW52b2tlIGNhbGxiYWNrcyB0aGF0IHdlcmUgc2NoZWR1bGVkIHRvIHJ1biBiZWZvcmUgdGhlIGN1cnJlbnQgdGltZS5cbiAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGN1cnJlbnQubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgY29uc3QgaW52b2tlQXQgPSBjdXJyZW50W2ldIGFzIG51bWJlcjtcbiAgICAgICAgY29uc3QgY2FsbGJhY2sgPSBjdXJyZW50W2kgKyAxXSBhcyBWb2lkRnVuY3Rpb247XG4gICAgICAgIGlmIChpbnZva2VBdCA8PSBub3cpIHtcbiAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFdlJ3ZlIHJlYWNoZWQgYSB0aW1lciB0aGF0IHNob3VsZCBub3QgYmUgaW52b2tlZCB5ZXQuXG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFRoZSBzdGF0ZSBvZiB0aGUgcXVldWUgbWlnaHQndmUgY2hhbmdlZCBhZnRlciBjYWxsYmFja3MgaW52b2NhdGlvbixcbiAgICAgIC8vIHJ1biB0aGUgY2xlYW51cCBsb2dpYyBiYXNlZCBvbiB0aGUgKmN1cnJlbnQqIHN0YXRlIG9mIHRoZSBxdWV1ZS5cbiAgICAgIGxldCBsYXN0Q2FsbGJhY2tJbmRleCA9IC0xO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLmN1cnJlbnQubGVuZ3RoOyBpICs9IDIpIHtcbiAgICAgICAgY29uc3QgaW52b2tlQXQgPSB0aGlzLmN1cnJlbnRbaV0gYXMgbnVtYmVyO1xuICAgICAgICBpZiAoaW52b2tlQXQgPD0gbm93KSB7XG4gICAgICAgICAgLy8gQWRkICsxIHRvIGFjY291bnQgZm9yIGEgY2FsbGJhY2sgZnVuY3Rpb24gdGhhdFxuICAgICAgICAgIC8vIGdvZXMgYWZ0ZXIgdGhlIHRpbWVzdGFtcCBpbiBldmVudHMgYXJyYXkuXG4gICAgICAgICAgbGFzdENhbGxiYWNrSW5kZXggPSBpICsgMTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBXZSd2ZSByZWFjaGVkIGEgdGltZXIgdGhhdCBzaG91bGQgbm90IGJlIGludm9rZWQgeWV0LlxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAobGFzdENhbGxiYWNrSW5kZXggPj0gMCkge1xuICAgICAgICBhcnJheVNwbGljZSh0aGlzLmN1cnJlbnQsIDAsIGxhc3RDYWxsYmFja0luZGV4ICsgMSk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuZXhlY3V0aW5nQ2FsbGJhY2tzID0gZmFsc2U7XG5cbiAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgY2FsbGJhY2tzIGFkZGVkIGR1cmluZyBhbiBpbnZvY2F0aW9uXG4gICAgICAvLyBvZiB0aGUgY3VycmVudCBvbmVzIC0gbW92ZSB0aGVtIG92ZXIgdG8gdGhlIFwiY3VycmVudFwiXG4gICAgICAvLyBxdWV1ZS5cbiAgICAgIGlmICh0aGlzLmRlZmVycmVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLmRlZmVycmVkLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgICAgICAgY29uc3QgaW52b2tlQXQgPSB0aGlzLmRlZmVycmVkW2ldIGFzIG51bWJlcjtcbiAgICAgICAgICBjb25zdCBjYWxsYmFjayA9IHRoaXMuZGVmZXJyZWRbaSArIDFdIGFzIFZvaWRGdW5jdGlvbjtcbiAgICAgICAgICB0aGlzLmFkZFRvUXVldWUodGhpcy5jdXJyZW50LCBpbnZva2VBdCwgY2FsbGJhY2spO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZGVmZXJyZWQubGVuZ3RoID0gMDtcbiAgICAgIH1cbiAgICAgIHRoaXMuc2NoZWR1bGVUaW1lcigpO1xuICAgIH07XG5cbiAgICAvLyBBdm9pZCBydW5uaW5nIHRpbWVyIGNhbGxiYWNrcyBtb3JlIHRoYW4gb25jZSBwZXJcbiAgICAvLyBhdmVyYWdlIGZyYW1lIGR1cmF0aW9uLiBUaGlzIGlzIG5lZWRlZCBmb3IgYmV0dGVyXG4gICAgLy8gYmF0Y2hpbmcgYW5kIHRvIGF2b2lkIGtpY2tpbmcgb2ZmIGV4Y2Vzc2l2ZSBjaGFuZ2VcbiAgICAvLyBkZXRlY3Rpb24gY3ljbGVzLlxuICAgIGNvbnN0IEZSQU1FX0RVUkFUSU9OX01TID0gMTY7ICAvLyAxMDAwbXMgLyA2MGZwc1xuXG4gICAgaWYgKHRoaXMuY3VycmVudC5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgLy8gRmlyc3QgZWxlbWVudCBpbiB0aGUgcXVldWUgcG9pbnRzIGF0IHRoZSB0aW1lc3RhbXBcbiAgICAgIC8vIG9mIHRoZSBmaXJzdCAoZWFybGllc3QpIGV2ZW50LlxuICAgICAgY29uc3QgaW52b2tlQXQgPSB0aGlzLmN1cnJlbnRbMF0gYXMgbnVtYmVyO1xuICAgICAgaWYgKHRoaXMudGltZW91dElkID09PSBudWxsIHx8XG4gICAgICAgICAgLy8gUmVzY2hlZHVsZSBhIHRpbWVyIGluIGNhc2UgYSBxdWV1ZSBjb250YWlucyBhbiBpdGVtIHdpdGhcbiAgICAgICAgICAvLyBhbiBlYXJsaWVyIHRpbWVzdGFtcCBhbmQgdGhlIGRlbHRhIGlzIG1vcmUgdGhhbiBhbiBhdmVyYWdlXG4gICAgICAgICAgLy8gZnJhbWUgZHVyYXRpb24uXG4gICAgICAgICAgKHRoaXMuaW52b2tlVGltZXJBdCAmJiAodGhpcy5pbnZva2VUaW1lckF0IC0gaW52b2tlQXQgPiBGUkFNRV9EVVJBVElPTl9NUykpKSB7XG4gICAgICAgIC8vIFRoZXJlIHdhcyBhIHRpbWVvdXQgYWxyZWFkeSwgYnV0IGFuIGVhcmxpZXIgZXZlbnQgd2FzIGFkZGVkXG4gICAgICAgIC8vIGludG8gdGhlIHF1ZXVlLiBJbiB0aGlzIGNhc2Ugd2UgZHJvcCBhbiBvbGQgdGltZXIgYW5kIHNldHVwXG4gICAgICAgIC8vIGEgbmV3IG9uZSB3aXRoIGFuIHVwZGF0ZWQgKHNtYWxsZXIpIHRpbWVvdXQuXG4gICAgICAgIHRoaXMuY2xlYXJUaW1lb3V0KCk7XG5cbiAgICAgICAgY29uc3QgdGltZW91dCA9IE1hdGgubWF4KGludm9rZUF0IC0gbm93LCBGUkFNRV9EVVJBVElPTl9NUyk7XG4gICAgICAgIHRoaXMuaW52b2tlVGltZXJBdCA9IGludm9rZUF0O1xuICAgICAgICB0aGlzLnRpbWVvdXRJZCA9IHNldFRpbWVvdXQoY2FsbGJhY2ssIHRpbWVvdXQpIGFzIHVua25vd24gYXMgbnVtYmVyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY2xlYXJUaW1lb3V0KCkge1xuICAgIGlmICh0aGlzLnRpbWVvdXRJZCAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMudGltZW91dElkKTtcbiAgICAgIHRoaXMudGltZW91dElkID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBuZ09uRGVzdHJveSgpIHtcbiAgICB0aGlzLmNsZWFyVGltZW91dCgpO1xuICAgIHRoaXMuY3VycmVudC5sZW5ndGggPSAwO1xuICAgIHRoaXMuZGVmZXJyZWQubGVuZ3RoID0gMDtcbiAgfVxuXG4gIC8qKiBAbm9jb2xsYXBzZSAqL1xuICBzdGF0aWMgybVwcm92ID0gLyoqIEBwdXJlT3JCcmVha015Q29kZSAqLyDJtcm1ZGVmaW5lSW5qZWN0YWJsZSh7XG4gICAgdG9rZW46IFRpbWVyU2NoZWR1bGVyLFxuICAgIHByb3ZpZGVkSW46ICdyb290JyxcbiAgICBmYWN0b3J5OiAoKSA9PiBuZXcgVGltZXJTY2hlZHVsZXIoKSxcbiAgfSk7XG59XG4iXX0=