/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { EventEmitter } from '../event_emitter';
import { arrayEquals, flatten } from '../util/array_utils';
function symbolIterator() {
    // @ts-expect-error accessing a private member
    return this._results[Symbol.iterator]();
}
/**
 * An unmodifiable list of items that Angular keeps up to date when the state
 * of the application changes.
 *
 * The type of object that {@link ViewChildren}, {@link ContentChildren}, and {@link QueryList}
 * provide.
 *
 * Implements an iterable interface, therefore it can be used in both ES6
 * javascript `for (var i of items)` loops as well as in Angular templates with
 * `*ngFor="let i of myList"`.
 *
 * Changes can be observed by subscribing to the changes `Observable`.
 *
 * NOTE: In the future this class will implement an `Observable` interface.
 *
 * @usageNotes
 * ### Example
 * ```typescript
 * @Component({...})
 * class Container {
 *   @ViewChildren(Item) items:QueryList<Item>;
 * }
 * ```
 *
 * @publicApi
 */
export class QueryList {
    static { Symbol.iterator; }
    /**
     * Returns `Observable` of `QueryList` notifying the subscriber of changes.
     */
    get changes() {
        return this._changes || (this._changes = new EventEmitter());
    }
    /**
     * @param emitDistinctChangesOnly Whether `QueryList.changes` should fire only when actual change
     *     has occurred. Or if it should fire when query is recomputed. (recomputing could resolve in
     *     the same result)
     */
    constructor(_emitDistinctChangesOnly = false) {
        this._emitDistinctChangesOnly = _emitDistinctChangesOnly;
        this.dirty = true;
        this._results = [];
        this._changesDetected = false;
        this._changes = null;
        this.length = 0;
        this.first = undefined;
        this.last = undefined;
        // This function should be declared on the prototype, but doing so there will cause the class
        // declaration to have side-effects and become not tree-shakable. For this reason we do it in
        // the constructor.
        // [Symbol.iterator](): Iterator<T> { ... }
        const proto = QueryList.prototype;
        if (!proto[Symbol.iterator])
            proto[Symbol.iterator] = symbolIterator;
    }
    /**
     * Returns the QueryList entry at `index`.
     */
    get(index) {
        return this._results[index];
    }
    /**
     * See
     * [Array.map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map)
     */
    map(fn) {
        return this._results.map(fn);
    }
    filter(fn) {
        return this._results.filter(fn);
    }
    /**
     * See
     * [Array.find](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find)
     */
    find(fn) {
        return this._results.find(fn);
    }
    /**
     * See
     * [Array.reduce](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce)
     */
    reduce(fn, init) {
        return this._results.reduce(fn, init);
    }
    /**
     * See
     * [Array.forEach](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach)
     */
    forEach(fn) {
        this._results.forEach(fn);
    }
    /**
     * See
     * [Array.some](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/some)
     */
    some(fn) {
        return this._results.some(fn);
    }
    /**
     * Returns a copy of the internal results list as an Array.
     */
    toArray() {
        return this._results.slice();
    }
    toString() {
        return this._results.toString();
    }
    /**
     * Updates the stored data of the query list, and resets the `dirty` flag to `false`, so that
     * on change detection, it will not notify of changes to the queries, unless a new change
     * occurs.
     *
     * @param resultsTree The query results to store
     * @param identityAccessor Optional function for extracting stable object identity from a value
     *    in the array. This function is executed for each element of the query result list while
     *    comparing current query list with the new one (provided as a first argument of the `reset`
     *    function) to detect if the lists are different. If the function is not provided, elements
     *    are compared as is (without any pre-processing).
     */
    reset(resultsTree, identityAccessor) {
        this.dirty = false;
        const newResultFlat = flatten(resultsTree);
        if (this._changesDetected = !arrayEquals(this._results, newResultFlat, identityAccessor)) {
            this._results = newResultFlat;
            this.length = newResultFlat.length;
            this.last = newResultFlat[this.length - 1];
            this.first = newResultFlat[0];
        }
    }
    /**
     * Triggers a change event by emitting on the `changes` {@link EventEmitter}.
     */
    notifyOnChanges() {
        if (this._changes && (this._changesDetected || !this._emitDistinctChangesOnly))
            this._changes.emit(this);
    }
    /** internal */
    setDirty() {
        this.dirty = true;
    }
    /** internal */
    destroy() {
        this.changes.complete();
        this.changes.unsubscribe();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnlfbGlzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2NvcmUvc3JjL2xpbmtlci9xdWVyeV9saXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUlILE9BQU8sRUFBQyxZQUFZLEVBQUMsTUFBTSxrQkFBa0IsQ0FBQztBQUU5QyxPQUFPLEVBQUMsV0FBVyxFQUFFLE9BQU8sRUFBQyxNQUFNLHFCQUFxQixDQUFDO0FBRXpELFNBQVMsY0FBYztJQUNyQiw4Q0FBOEM7SUFDOUMsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO0FBQzFDLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXlCRztBQUNILE1BQU0sT0FBTyxTQUFTO2FBa0puQixNQUFNLENBQUMsUUFBUTtJQXhJaEI7O09BRUc7SUFDSCxJQUFJLE9BQU87UUFDVCxPQUFPLElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksWUFBWSxFQUFFLENBQUMsQ0FBQztJQUMvRCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFlBQW9CLDJCQUFvQyxLQUFLO1FBQXpDLDZCQUF3QixHQUF4Qix3QkFBd0IsQ0FBaUI7UUFyQjdDLFVBQUssR0FBRyxJQUFJLENBQUM7UUFDckIsYUFBUSxHQUFhLEVBQUUsQ0FBQztRQUN4QixxQkFBZ0IsR0FBWSxLQUFLLENBQUM7UUFDbEMsYUFBUSxHQUFvQyxJQUFJLENBQUM7UUFFaEQsV0FBTSxHQUFXLENBQUMsQ0FBQztRQUNuQixVQUFLLEdBQU0sU0FBVSxDQUFDO1FBQ3RCLFNBQUksR0FBTSxTQUFVLENBQUM7UUFlNUIsNkZBQTZGO1FBQzdGLDZGQUE2RjtRQUM3RixtQkFBbUI7UUFDbkIsMkNBQTJDO1FBQzNDLE1BQU0sS0FBSyxHQUFHLFNBQVMsQ0FBQyxTQUFTLENB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IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB7T2JzZXJ2YWJsZX0gZnJvbSAncnhqcyc7XG5cbmltcG9ydCB7RXZlbnRFbWl0dGVyfSBmcm9tICcuLi9ldmVudF9lbWl0dGVyJztcbmltcG9ydCB7V3JpdGFibGV9IGZyb20gJy4uL2ludGVyZmFjZS90eXBlJztcbmltcG9ydCB7YXJyYXlFcXVhbHMsIGZsYXR0ZW59IGZyb20gJy4uL3V0aWwvYXJyYXlfdXRpbHMnO1xuXG5mdW5jdGlvbiBzeW1ib2xJdGVyYXRvcjxUPih0aGlzOiBRdWVyeUxpc3Q8VD4pOiBJdGVyYXRvcjxUPiB7XG4gIC8vIEB0cy1leHBlY3QtZXJyb3IgYWNjZXNzaW5nIGEgcHJpdmF0ZSBtZW1iZXJcbiAgcmV0dXJuIHRoaXMuX3Jlc3VsdHNbU3ltYm9sLml0ZXJhdG9yXSgpO1xufVxuXG4vKipcbiAqIEFuIHVubW9kaWZpYWJsZSBsaXN0IG9mIGl0ZW1zIHRoYXQgQW5ndWxhciBrZWVwcyB1cCB0byBkYXRlIHdoZW4gdGhlIHN0YXRlXG4gKiBvZiB0aGUgYXBwbGljYXRpb24gY2hhbmdlcy5cbiAqXG4gKiBUaGUgdHlwZSBvZiBvYmplY3QgdGhhdCB7QGxpbmsgVmlld0NoaWxkcmVufSwge0BsaW5rIENvbnRlbnRDaGlsZHJlbn0sIGFuZCB7QGxpbmsgUXVlcnlMaXN0fVxuICogcHJvdmlkZS5cbiAqXG4gKiBJbXBsZW1lbnRzIGFuIGl0ZXJhYmxlIGludGVyZmFjZSwgdGhlcmVmb3JlIGl0IGNhbiBiZSB1c2VkIGluIGJvdGggRVM2XG4gKiBqYXZhc2NyaXB0IGBmb3IgKHZhciBpIG9mIGl0ZW1zKWAgbG9vcHMgYXMgd2VsbCBhcyBpbiBBbmd1bGFyIHRlbXBsYXRlcyB3aXRoXG4gKiBgKm5nRm9yPVwibGV0IGkgb2YgbXlMaXN0XCJgLlxuICpcbiAqIENoYW5nZXMgY2FuIGJlIG9ic2VydmVkIGJ5IHN1YnNjcmliaW5nIHRvIHRoZSBjaGFuZ2VzIGBPYnNlcnZhYmxlYC5cbiAqXG4gKiBOT1RFOiBJbiB0aGUgZnV0dXJlIHRoaXMgY2xhc3Mgd2lsbCBpbXBsZW1lbnQgYW4gYE9ic2VydmFibGVgIGludGVyZmFjZS5cbiAqXG4gKiBAdXNhZ2VOb3Rlc1xuICogIyMjIEV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIEBDb21wb25lbnQoey4uLn0pXG4gKiBjbGFzcyBDb250YWluZXIge1xuICogICBAVmlld0NoaWxkcmVuKEl0ZW0pIGl0ZW1zOlF1ZXJ5TGlzdDxJdGVtPjtcbiAqIH1cbiAqIGBgYFxuICpcbiAqIEBwdWJsaWNBcGlcbiAqL1xuZXhwb3J0IGNsYXNzIFF1ZXJ5TGlzdDxUPiBpbXBsZW1lbnRzIEl0ZXJhYmxlPFQ+IHtcbiAgcHVibGljIHJlYWRvbmx5IGRpcnR5ID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfcmVzdWx0czogQXJyYXk8VD4gPSBbXTtcbiAgcHJpdmF0ZSBfY2hhbmdlc0RldGVjdGVkOiBib29sZWFuID0gZmFsc2U7XG4gIHByaXZhdGUgX2NoYW5nZXM6IEV2ZW50RW1pdHRlcjxRdWVyeUxpc3Q8VD4+fG51bGwgPSBudWxsO1xuXG4gIHJlYWRvbmx5IGxlbmd0aDogbnVtYmVyID0gMDtcbiAgcmVhZG9ubHkgZmlyc3Q6IFQgPSB1bmRlZmluZWQhO1xuICByZWFkb25seSBsYXN0OiBUID0gdW5kZWZpbmVkITtcblxuICAvKipcbiAgICogUmV0dXJucyBgT2JzZXJ2YWJsZWAgb2YgYFF1ZXJ5TGlzdGAgbm90aWZ5aW5nIHRoZSBzdWJzY3JpYmVyIG9mIGNoYW5nZXMuXG4gICAqL1xuICBnZXQgY2hhbmdlcygpOiBPYnNlcnZhYmxlPGFueT4ge1xuICAgIHJldHVybiB0aGlzLl9jaGFuZ2VzIHx8ICh0aGlzLl9jaGFuZ2VzID0gbmV3IEV2ZW50RW1pdHRlcigpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAcGFyYW0gZW1pdERpc3RpbmN0Q2hhbmdlc09ubHkgV2hldGhlciBgUXVlcnlMaXN0LmNoYW5nZXNgIHNob3VsZCBmaXJlIG9ubHkgd2hlbiBhY3R1YWwgY2hhbmdlXG4gICAqICAgICBoYXMgb2NjdXJyZWQuIE9yIGlmIGl0IHNob3VsZCBmaXJlIHdoZW4gcXVlcnkgaXMgcmVjb21wdXRlZC4gKHJlY29tcHV0aW5nIGNvdWxkIHJlc29sdmUgaW5cbiAgICogICAgIHRoZSBzYW1lIHJlc3VsdClcbiAgICovXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgX2VtaXREaXN0aW5jdENoYW5nZXNPbmx5OiBib29sZWFuID0gZmFsc2UpIHtcbiAgICAvLyBUaGlzIGZ1bmN0aW9uIHNob3VsZCBiZSBkZWNsYXJlZCBvbiB0aGUgcHJvdG90eXBlLCBidXQgZG9pbmcgc28gdGhlcmUgd2lsbCBjYXVzZSB0aGUgY2xhc3NcbiAgICAvLyBkZWNsYXJhdGlvbiB0byBoYXZlIHNpZGUtZWZmZWN0cyBhbmQgYmVjb21lIG5vdCB0cmVlLXNoYWthYmxlLiBGb3IgdGhpcyByZWFzb24gd2UgZG8gaXQgaW5cbiAgICAvLyB0aGUgY29uc3RydWN0b3IuXG4gICAgLy8gW1N5bWJvbC5pdGVyYXRvcl0oKTogSXRlcmF0b3I8VD4geyAuLi4gfVxuICAgIGNvbnN0IHByb3RvID0gUXVlcnlMaXN0LnByb3RvdHlwZTtcbiAgICBpZiAoIXByb3RvW1N5bWJvbC5pdGVyYXRvcl0pIHByb3RvW1N5bWJvbC5pdGVyYXRvcl0gPSBzeW1ib2xJdGVyYXRvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBRdWVyeUxpc3QgZW50cnkgYXQgYGluZGV4YC5cbiAgICovXG4gIGdldChpbmRleDogbnVtYmVyKTogVHx1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLl9yZXN1bHRzW2luZGV4XTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWVcbiAgICogW0FycmF5Lm1hcF0oaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvQXJyYXkvbWFwKVxuICAgKi9cbiAgbWFwPFU+KGZuOiAoaXRlbTogVCwgaW5kZXg6IG51bWJlciwgYXJyYXk6IFRbXSkgPT4gVSk6IFVbXSB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc3VsdHMubWFwKGZuKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWVcbiAgICogW0FycmF5LmZpbHRlcl0oaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvQXJyYXkvZmlsdGVyKVxuICAgKi9cbiAgZmlsdGVyPFMgZXh0ZW5kcyBUPihwcmVkaWNhdGU6ICh2YWx1ZTogVCwgaW5kZXg6IG51bWJlciwgYXJyYXk6IHJlYWRvbmx5IFRbXSkgPT4gdmFsdWUgaXMgUyk6IFNbXTtcbiAgZmlsdGVyKHByZWRpY2F0ZTogKHZhbHVlOiBULCBpbmRleDogbnVtYmVyLCBhcnJheTogcmVhZG9ubHkgVFtdKSA9PiB1bmtub3duKTogVFtdO1xuICBmaWx0ZXIoZm46IChpdGVtOiBULCBpbmRleDogbnVtYmVyLCBhcnJheTogVFtdKSA9PiBib29sZWFuKTogVFtdIHtcbiAgICByZXR1cm4gdGhpcy5fcmVzdWx0cy5maWx0ZXIoZm4pO1xuICB9XG5cbiAgLyoqXG4gICAqIFNlZVxuICAgKiBbQXJyYXkuZmluZF0oaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvQXJyYXkvZmluZClcbiAgICovXG4gIGZpbmQoZm46IChpdGVtOiBULCBpbmRleDogbnVtYmVyLCBhcnJheTogVFtdKSA9PiBib29sZWFuKTogVHx1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLl9yZXN1bHRzLmZpbmQoZm4pO1xuICB9XG5cbiAgLyoqXG4gICAqIFNlZVxuICAgKiBbQXJyYXkucmVkdWNlXShodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9BcnJheS9yZWR1Y2UpXG4gICAqL1xuICByZWR1Y2U8VT4oZm46IChwcmV2VmFsdWU6IFUsIGN1clZhbHVlOiBULCBjdXJJbmRleDogbnVtYmVyLCBhcnJheTogVFtdKSA9PiBVLCBpbml0OiBVKTogVSB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc3VsdHMucmVkdWNlKGZuLCBpbml0KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWVcbiAgICogW0FycmF5LmZvckVhY2hdKGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL0FycmF5L2ZvckVhY2gpXG4gICAqL1xuICBmb3JFYWNoKGZuOiAoaXRlbTogVCwgaW5kZXg6IG51bWJlciwgYXJyYXk6IFRbXSkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuX3Jlc3VsdHMuZm9yRWFjaChmbik7XG4gIH1cblxuICAvKipcbiAgICogU2VlXG4gICAqIFtBcnJheS5zb21lXShodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9BcnJheS9zb21lKVxuICAgKi9cbiAgc29tZShmbjogKHZhbHVlOiBULCBpbmRleDogbnVtYmVyLCBhcnJheTogVFtdKSA9PiBib29sZWFuKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc3VsdHMuc29tZShmbik7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGNvcHkgb2YgdGhlIGludGVybmFsIHJlc3VsdHMgbGlzdCBhcyBhbiBBcnJheS5cbiAgICovXG4gIHRvQXJyYXkoKTogVFtdIHtcbiAgICByZXR1cm4gdGhpcy5fcmVzdWx0cy5zbGljZSgpO1xuICB9XG5cbiAgdG9TdHJpbmcoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5fcmVzdWx0cy50b1N0cmluZygpO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZXMgdGhlIHN0b3JlZCBkYXRhIG9mIHRoZSBxdWVyeSBsaXN0LCBhbmQgcmVzZXRzIHRoZSBgZGlydHlgIGZsYWcgdG8gYGZhbHNlYCwgc28gdGhhdFxuICAgKiBvbiBjaGFuZ2UgZGV0ZWN0aW9uLCBpdCB3aWxsIG5vdCBub3RpZnkgb2YgY2hhbmdlcyB0byB0aGUgcXVlcmllcywgdW5sZXNzIGEgbmV3IGNoYW5nZVxuICAgKiBvY2N1cnMuXG4gICAqXG4gICAqIEBwYXJhbSByZXN1bHRzVHJlZSBUaGUgcXVlcnkgcmVzdWx0cyB0byBzdG9yZVxuICAgKiBAcGFyYW0gaWRlbnRpdHlBY2Nlc3NvciBPcHRpb25hbCBmdW5jdGlvbiBmb3IgZXh0cmFjdGluZyBzdGFibGUgb2JqZWN0IGlkZW50aXR5IGZyb20gYSB2YWx1ZVxuICAgKiAgICBpbiB0aGUgYXJyYXkuIFRoaXMgZnVuY3Rpb24gaXMgZXhlY3V0ZWQgZm9yIGVhY2ggZWxlbWVudCBvZiB0aGUgcXVlcnkgcmVzdWx0IGxpc3Qgd2hpbGVcbiAgICogICAgY29tcGFyaW5nIGN1cnJlbnQgcXVlcnkgbGlzdCB3aXRoIHRoZSBuZXcgb25lIChwcm92aWRlZCBhcyBhIGZpcnN0IGFyZ3VtZW50IG9mIHRoZSBgcmVzZXRgXG4gICAqICAgIGZ1bmN0aW9uKSB0byBkZXRlY3QgaWYgdGhlIGxpc3RzIGFyZSBkaWZmZXJlbnQuIElmIHRoZSBmdW5jdGlvbiBpcyBub3QgcHJvdmlkZWQsIGVsZW1lbnRzXG4gICAqICAgIGFyZSBjb21wYXJlZCBhcyBpcyAod2l0aG91dCBhbnkgcHJlLXByb2Nlc3NpbmcpLlxuICAgKi9cbiAgcmVzZXQocmVzdWx0c1RyZWU6IEFycmF5PFR8YW55W10+LCBpZGVudGl0eUFjY2Vzc29yPzogKHZhbHVlOiBUKSA9PiB1bmtub3duKTogdm9pZCB7XG4gICAgKHRoaXMgYXMge2RpcnR5OiBib29sZWFufSkuZGlydHkgPSBmYWxzZTtcbiAgICBjb25zdCBuZXdSZXN1bHRGbGF0ID0gZmxhdHRlbihyZXN1bHRzVHJlZSk7XG4gICAgaWYgKHRoaXMuX2NoYW5nZXNEZXRlY3RlZCA9ICFhcnJheUVxdWFscyh0aGlzLl9yZXN1bHRzLCBuZXdSZXN1bHRGbGF0LCBpZGVudGl0eUFjY2Vzc29yKSkge1xuICAgICAgdGhpcy5fcmVzdWx0cyA9IG5ld1Jlc3VsdEZsYXQ7XG4gICAgICAodGhpcyBhcyBXcml0YWJsZTx0aGlzPikubGVuZ3RoID0gbmV3UmVzdWx0RmxhdC5sZW5ndGg7XG4gICAgICAodGhpcyBhcyBXcml0YWJsZTx0aGlzPikubGFzdCA9IG5ld1Jlc3VsdEZsYXRbdGhpcy5sZW5ndGggLSAxXTtcbiAgICAgICh0aGlzIGFzIFdyaXRhYmxlPHRoaXM+KS5maXJzdCA9IG5ld1Jlc3VsdEZsYXRbMF07XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRyaWdnZXJzIGEgY2hhbmdlIGV2ZW50IGJ5IGVtaXR0aW5nIG9uIHRoZSBgY2hhbmdlc2Age0BsaW5rIEV2ZW50RW1pdHRlcn0uXG4gICAqL1xuICBub3RpZnlPbkNoYW5nZXMoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuX2NoYW5nZXMgJiYgKHRoaXMuX2NoYW5nZXNEZXRlY3RlZCB8fCAhdGhpcy5fZW1pdERpc3RpbmN0Q2hhbmdlc09ubHkpKVxuICAgICAgdGhpcy5fY2hhbmdlcy5lbWl0KHRoaXMpO1xuICB9XG5cbiAgLyoqIGludGVybmFsICovXG4gIHNldERpcnR5KCkge1xuICAgICh0aGlzIGFzIHtkaXJ0eTogYm9vbGVhbn0pLmRpcnR5ID0gdHJ1ZTtcbiAgfVxuXG4gIC8qKiBpbnRlcm5hbCAqL1xuICBkZXN0cm95KCk6IHZvaWQge1xuICAgICh0aGlzLmNoYW5nZXMgYXMgRXZlbnRFbWl0dGVyPGFueT4pLmNvbXBsZXRlKCk7XG4gICAgKHRoaXMuY2hhbmdlcyBhcyBFdmVudEVtaXR0ZXI8YW55PikudW5zdWJzY3JpYmUoKTtcbiAgfVxuXG4gIC8vIFRoZSBpbXBsZW1lbnRhdGlvbiBvZiBgU3ltYm9sLml0ZXJhdG9yYCBzaG91bGQgYmUgZGVjbGFyZWQgaGVyZSwgYnV0IHRoaXMgd291bGQgY2F1c2VcbiAgLy8gdHJlZS1zaGFraW5nIGlzc3VlcyB3aXRoIGBRdWVyeUxpc3QuIFNvIGluc3RlYWQsIGl0J3MgYWRkZWQgaW4gdGhlIGNvbnN0cnVjdG9yIChzZWUgY29tbWVudHNcbiAgLy8gdGhlcmUpIGFuZCB0aGlzIGRlY2xhcmF0aW9uIGlzIGxlZnQgaGVyZSB0byBlbnN1cmUgdGhhdCBUeXBlU2NyaXB0IGNvbnNpZGVycyBRdWVyeUxpc3QgdG9cbiAgLy8gaW1wbGVtZW50IHRoZSBJdGVyYWJsZSBpbnRlcmZhY2UuIFRoaXMgaXMgcmVxdWlyZWQgZm9yIHRlbXBsYXRlIHR5cGUtY2hlY2tpbmcgb2YgTmdGb3IgbG9vcHNcbiAgLy8gb3ZlciBRdWVyeUxpc3RzIHRvIHdvcmsgY29ycmVjdGx5LCBzaW5jZSBRdWVyeUxpc3QgbXVzdCBiZSBhc3NpZ25hYmxlIHRvIE5nSXRlcmFibGUuXG4gIFtTeW1ib2wuaXRlcmF0b3JdITogKCkgPT4gSXRlcmF0b3I8VD47XG59XG4iXX0=