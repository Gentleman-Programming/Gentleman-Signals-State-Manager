/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
/**
 * A type representing the live collection to be reconciled with any new (incoming) collection. This
 * is an adapter class that makes it possible to work with different internal data structures,
 * regardless of the actual values of the incoming collection.
 */
export class LiveCollection {
    destroy(item) {
        // noop by default
    }
    updateValue(index, value) {
        // noop by default
    }
    // operations below could be implemented on top of the operations defined so far, but having
    // them explicitly allow clear expression of intent and potentially more performant
    // implementations
    swap(index1, index2) {
        const startIdx = Math.min(index1, index2);
        const endIdx = Math.max(index1, index2);
        const endItem = this.detach(endIdx);
        if (endIdx - startIdx > 1) {
            const startItem = this.detach(startIdx);
            this.attach(startIdx, endItem);
            this.attach(endIdx, startItem);
        }
        else {
            this.attach(startIdx, endItem);
        }
    }
    move(prevIndex, newIdx) {
        this.attach(newIdx, this.detach(prevIndex));
    }
}
function valuesMatching(liveIdx, liveValue, newIdx, newValue, trackBy) {
    if (liveIdx === newIdx && Object.is(liveValue, newValue)) {
        // matching and no value identity to update
        return 1;
    }
    else if (Object.is(trackBy(liveIdx, liveValue), trackBy(newIdx, newValue))) {
        // matching but requires value identity update
        return -1;
    }
    return 0;
}
/**
 * The live collection reconciliation algorithm that perform various in-place operations, so it
 * reflects the content of the new (incoming) collection.
 *
 * The reconciliation algorithm has 2 code paths:
 * - "fast" path that don't require any memory allocation;
 * - "slow" path that requires additional memory allocation for intermediate data structures used to
 * collect additional information about the live collection.
 * It might happen that the algorithm switches between the two modes in question in a single
 * reconciliation path - generally it tries to stay on the "fast" path as much as possible.
 *
 * The overall complexity of the algorithm is O(n + m) for speed and O(n) for memory (where n is the
 * length of the live collection and m is the length of the incoming collection). Given the problem
 * at hand the complexity / performance constraints makes it impossible to perform the absolute
 * minimum of operation to reconcile the 2 collections. The algorithm makes different tradeoffs to
 * stay within reasonable performance bounds and may apply sub-optimal number of operations in
 * certain situations.
 *
 * @param liveCollection the current, live collection;
 * @param newCollection the new, incoming collection;
 * @param trackByFn key generation function that determines equality between items in the life and
 *     incoming collection;
 */
export function reconcile(liveCollection, newCollection, trackByFn) {
    let detachedItems = undefined;
    let liveKeysInTheFuture = undefined;
    let liveStartIdx = 0;
    let liveEndIdx = liveCollection.length - 1;
    if (Array.isArray(newCollection)) {
        let newEndIdx = newCollection.length - 1;
        while (liveStartIdx <= liveEndIdx && liveStartIdx <= newEndIdx) {
            // compare from the beginning
            const liveStartValue = liveCollection.at(liveStartIdx);
            const newStartValue = newCollection[liveStartIdx];
            const isStartMatching = valuesMatching(liveStartIdx, liveStartValue, liveStartIdx, newStartValue, trackByFn);
            if (isStartMatching !== 0) {
                if (isStartMatching < 0) {
                    liveCollection.updateValue(liveStartIdx, newStartValue);
                }
                liveStartIdx++;
                continue;
            }
            // compare from the end
            // TODO(perf): do _all_ the matching from the end
            const liveEndValue = liveCollection.at(liveEndIdx);
            const newEndValue = newCollection[newEndIdx];
            const isEndMatching = valuesMatching(liveEndIdx, liveEndValue, newEndIdx, newEndValue, trackByFn);
            if (isEndMatching !== 0) {
                if (isEndMatching < 0) {
                    liveCollection.updateValue(liveEndIdx, newEndValue);
                }
                liveEndIdx--;
                newEndIdx--;
                continue;
            }
            // Detect swap and moves:
            const liveStartKey = trackByFn(liveStartIdx, liveStartValue);
            const liveEndKey = trackByFn(liveEndIdx, liveEndValue);
            const newStartKey = trackByFn(liveStartIdx, newStartValue);
            if (Object.is(newStartKey, liveEndKey)) {
                const newEndKey = trackByFn(newEndIdx, newEndValue);
                // detect swap on both ends;
                if (Object.is(newEndKey, liveStartKey)) {
                    liveCollection.swap(liveStartIdx, liveEndIdx);
                    liveCollection.updateValue(liveEndIdx, newEndValue);
                    newEndIdx--;
                    liveEndIdx--;
                }
                else {
                    // the new item is the same as the live item with the end pointer - this is a move forward
                    // to an earlier index;
                    liveCollection.move(liveEndIdx, liveStartIdx);
                }
                liveCollection.updateValue(liveStartIdx, newStartValue);
                liveStartIdx++;
                continue;
            }
            // Fallback to the slow path: we need to learn more about the content of the live and new
            // collections.
            detachedItems ??= new MultiMap();
            liveKeysInTheFuture ??=
                initLiveItemsInTheFuture(liveCollection, liveStartIdx, liveEndIdx, trackByFn);
            // Check if I'm inserting a previously detached item: if so, attach it here
            if (attachPreviouslyDetached(liveCollection, detachedItems, liveStartIdx, newStartKey)) {
                liveCollection.updateValue(liveStartIdx, newStartValue);
                liveStartIdx++;
                liveEndIdx++;
            }
            else if (!liveKeysInTheFuture.has(newStartKey)) {
                // Check if we seen a new item that doesn't exist in the old collection and must be INSERTED
                const newItem = liveCollection.create(liveStartIdx, newCollection[liveStartIdx]);
                liveCollection.attach(liveStartIdx, newItem);
                liveStartIdx++;
                liveEndIdx++;
            }
            else {
                // We know that the new item exists later on in old collection but we don't know its index
                // and as the consequence can't move it (don't know where to find it). Detach the old item,
                // hoping that it unlocks the fast path again.
                detachedItems.set(liveStartKey, liveCollection.detach(liveStartIdx));
                liveEndIdx--;
            }
        }
        // Final cleanup steps:
        // - more items in the new collection => insert
        while (liveStartIdx <= newEndIdx) {
            createOrAttach(liveCollection, detachedItems, trackByFn, liveStartIdx, newCollection[liveStartIdx]);
            liveStartIdx++;
        }
    }
    else if (newCollection != null) {
        // iterable - immediately fallback to the slow path
        const newCollectionIterator = newCollection[Symbol.iterator]();
        let newIterationResult = newCollectionIterator.next();
        while (!newIterationResult.done && liveStartIdx <= liveEndIdx) {
            const liveValue = liveCollection.at(liveStartIdx);
            const newValue = newIterationResult.value;
            const isStartMatching = valuesMatching(liveStartIdx, liveValue, liveStartIdx, newValue, trackByFn);
            if (isStartMatching !== 0) {
                // found a match - move on, but update value
                if (isStartMatching < 0) {
                    liveCollection.updateValue(liveStartIdx, newValue);
                }
                liveStartIdx++;
                newIterationResult = newCollectionIterator.next();
            }
            else {
                detachedItems ??= new MultiMap();
                liveKeysInTheFuture ??=
                    initLiveItemsInTheFuture(liveCollection, liveStartIdx, liveEndIdx, trackByFn);
                // Check if I'm inserting a previously detached item: if so, attach it here
                const newKey = trackByFn(liveStartIdx, newValue);
                if (attachPreviouslyDetached(liveCollection, detachedItems, liveStartIdx, newKey)) {
                    liveCollection.updateValue(liveStartIdx, newValue);
                    liveStartIdx++;
                    liveEndIdx++;
                    newIterationResult = newCollectionIterator.next();
                }
                else if (!liveKeysInTheFuture.has(newKey)) {
                    liveCollection.attach(liveStartIdx, liveCollection.create(liveStartIdx, newValue));
                    liveStartIdx++;
                    liveEndIdx++;
                    newIterationResult = newCollectionIterator.next();
                }
                else {
                    // it is a move forward - detach the current item without advancing in collections
                    const liveKey = trackByFn(liveStartIdx, liveValue);
                    detachedItems.set(liveKey, liveCollection.detach(liveStartIdx));
                    liveEndIdx--;
                }
            }
        }
        // this is a new item as we run out of the items in the old collection - create or attach a
        // previously detached one
        while (!newIterationResult.done) {
            createOrAttach(liveCollection, detachedItems, trackByFn, liveCollection.length, newIterationResult.value);
            newIterationResult = newCollectionIterator.next();
        }
    }
    // Cleanups common to the array and iterable:
    // - more items in the live collection => delete starting from the end;
    while (liveStartIdx <= liveEndIdx) {
        liveCollection.destroy(liveCollection.detach(liveEndIdx--));
    }
    // - destroy items that were detached but never attached again.
    detachedItems?.forEach(item => liveCollection.destroy(item));
}
function attachPreviouslyDetached(prevCollection, detachedItems, index, key) {
    if (detachedItems !== undefined && detachedItems.has(key)) {
        prevCollection.attach(index, detachedItems.get(key));
        detachedItems.delete(key);
        return true;
    }
    return false;
}
function createOrAttach(liveCollection, detachedItems, trackByFn, index, value) {
    if (!attachPreviouslyDetached(liveCollection, detachedItems, index, trackByFn(index, value))) {
        const newItem = liveCollection.create(index, value);
        liveCollection.attach(index, newItem);
    }
    else {
        liveCollection.updateValue(index, value);
    }
}
function initLiveItemsInTheFuture(liveCollection, start, end, trackByFn) {
    const keys = new Set();
    for (let i = start; i <= end; i++) {
        keys.add(trackByFn(i, liveCollection.at(i)));
    }
    return keys;
}
class MultiMap {
    constructor() {
        this.map = new Map();
    }
    has(key) {
        const listOfKeys = this.map.get(key);
        return listOfKeys !== undefined && listOfKeys.length > 0;
    }
    delete(key) {
        const listOfKeys = this.map.get(key);
        if (listOfKeys !== undefined) {
            // THINK: pop from the end or shift from the front? "Correct" vs. "slow".
            listOfKeys.pop();
            return true;
        }
        return false;
    }
    get(key) {
        const listOfKeys = this.map.get(key);
        return listOfKeys !== undefined && listOfKeys.length > 0 ? listOfKeys[0] : undefined;
    }
    set(key, value) {
        // if value is array, they we always store it as [value].
        if (!this.map.has(key)) {
            this.map.set(key, [value]);
            return;
        }
        // THINK: this allows duplicate values, but I guess this is fine?
        // Is the existing key an array or not?
        this.map.get(key)?.push(value);
    }
    forEach(cb) {
        for (const [key, values] of this.map) {
            for (const value of values) {
                cb(value, key);
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGlzdF9yZWNvbmNpbGlhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2NvcmUvc3JjL3JlbmRlcjMvbGlzdF9yZWNvbmNpbGlhdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7O0dBTUc7QUFJSDs7OztHQUlHO0FBQ0gsTUFBTSxPQUFnQixjQUFjO0lBTWxDLE9BQU8sQ0FBQyxJQUFPO1FBQ2Isa0JBQWtCO0lBQ3BCLENBQUM7SUFDRCxXQUFXLENBQUMsS0FBYSxFQUFFLEtBQVE7UUFDakMsa0JBQWtCO0lBQ3BCLENBQUM7SUFFRCw0RkFBNEY7SUFDNUYsbUZBQW1GO0lBQ25GLGtCQUFrQjtJQUNsQixJQUFJLENBQUMsTUFBYyxFQUFFLE1BQWM7UUFDakMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDMUMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDeEMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUNwQyxJQUFJLE1BQU0sR0FBRyxRQUFRLEdBQUcsQ0FBQyxFQUFFO1lBQ3pCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDeEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDL0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLENBQUM7U0FDaEM7YUFBTTtZQUNMLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1NBQ2hDO0lBQ0gsQ0FBQztJQUNELElBQUksQ0FBQyxTQUFpQixFQUFFLE1BQWM7UUFDcEMsSUFBSSxDQUFDLE1BQU0s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c2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQge1RyYWNrQnlGdW5jdGlvbn0gZnJvbSAnLi4vY2hhbmdlX2RldGVjdGlvbic7XG5cbi8qKlxuICogQSB0eXBlIHJlcHJlc2VudGluZyB0aGUgbGl2ZSBjb2xsZWN0aW9uIHRvIGJlIHJlY29uY2lsZWQgd2l0aCBhbnkgbmV3IChpbmNvbWluZykgY29sbGVjdGlvbi4gVGhpc1xuICogaXMgYW4gYWRhcHRlciBjbGFzcyB0aGF0IG1ha2VzIGl0IHBvc3NpYmxlIHRvIHdvcmsgd2l0aCBkaWZmZXJlbnQgaW50ZXJuYWwgZGF0YSBzdHJ1Y3R1cmVzLFxuICogcmVnYXJkbGVzcyBvZiB0aGUgYWN0dWFsIHZhbHVlcyBvZiB0aGUgaW5jb21pbmcgY29sbGVjdGlvbi5cbiAqL1xuZXhwb3J0IGFic3RyYWN0IGNsYXNzIExpdmVDb2xsZWN0aW9uPFQsIFY+IHtcbiAgYWJzdHJhY3QgZ2V0IGxlbmd0aCgpOiBudW1iZXI7XG4gIGFic3RyYWN0IGF0KGluZGV4OiBudW1iZXIpOiBWO1xuICBhYnN0cmFjdCBhdHRhY2goaW5kZXg6IG51bWJlciwgaXRlbTogVCk6IHZvaWQ7XG4gIGFic3RyYWN0IGRldGFjaChpbmRleDogbnVtYmVyKTogVDtcbiAgYWJzdHJhY3QgY3JlYXRlKGluZGV4OiBudW1iZXIsIHZhbHVlOiBWKTogVDtcbiAgZGVzdHJveShpdGVtOiBUKTogdm9pZCB7XG4gICAgLy8gbm9vcCBieSBkZWZhdWx0XG4gIH1cbiAgdXBkYXRlVmFsdWUoaW5kZXg6IG51bWJlciwgdmFsdWU6IFYpOiB2b2lkIHtcbiAgICAvLyBub29wIGJ5IGRlZmF1bHRcbiAgfVxuXG4gIC8vIG9wZXJhdGlvbnMgYmVsb3cgY291bGQgYmUgaW1wbGVtZW50ZWQgb24gdG9wIG9mIHRoZSBvcGVyYXRpb25zIGRlZmluZWQgc28gZmFyLCBidXQgaGF2aW5nXG4gIC8vIHRoZW0gZXhwbGljaXRseSBhbGxvdyBjbGVhciBleHByZXNzaW9uIG9mIGludGVudCBhbmQgcG90ZW50aWFsbHkgbW9yZSBwZXJmb3JtYW50XG4gIC8vIGltcGxlbWVudGF0aW9uc1xuICBzd2FwKGluZGV4MTogbnVtYmVyLCBpbmRleDI6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IHN0YXJ0SWR4ID0gTWF0aC5taW4oaW5kZXgxLCBpbmRleDIpO1xuICAgIGNvbnN0IGVuZElkeCA9IE1hdGgubWF4KGluZGV4MSwgaW5kZXgyKTtcbiAgICBjb25zdCBlbmRJdGVtID0gdGhpcy5kZXRhY2goZW5kSWR4KTtcbiAgICBpZiAoZW5kSWR4IC0gc3RhcnRJZHggPiAxKSB7XG4gICAgICBjb25zdCBzdGFydEl0ZW0gPSB0aGlzLmRldGFjaChzdGFydElkeCk7XG4gICAgICB0aGlzLmF0dGFjaChzdGFydElkeCwgZW5kSXRlbSk7XG4gICAgICB0aGlzLmF0dGFjaChlbmRJZHgsIHN0YXJ0SXRlbSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYXR0YWNoKHN0YXJ0SWR4LCBlbmRJdGVtKTtcbiAgICB9XG4gIH1cbiAgbW92ZShwcmV2SW5kZXg6IG51bWJlciwgbmV3SWR4OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmF0dGFjaChuZXdJZHgsIHRoaXMuZGV0YWNoKHByZXZJbmRleCkpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHZhbHVlc01hdGNoaW5nPFY+KFxuICAgIGxpdmVJZHg6IG51bWJlciwgbGl2ZVZhbHVlOiBWLCBuZXdJZHg6IG51bWJlciwgbmV3VmFsdWU6IFYsXG4gICAgdHJhY2tCeTogVHJhY2tCeUZ1bmN0aW9uPFY+KTogbnVtYmVyIHtcbiAgaWYgKGxpdmVJZHggPT09IG5ld0lkeCAmJiBPYmplY3QuaXMobGl2ZVZhbHVlLCBuZXdWYWx1ZSkpIHtcbiAgICAvLyBtYXRjaGluZyBhbmQgbm8gdmFsdWUgaWRlbnRpdHkgdG8gdXBkYXRlXG4gICAgcmV0dXJuIDE7XG4gIH0gZWxzZSBpZiAoT2JqZWN0LmlzKHRyYWNrQnkobGl2ZUlkeCwgbGl2ZVZhbHVlKSwgdHJhY2tCeShuZXdJZHgsIG5ld1ZhbHVlKSkpIHtcbiAgICAvLyBtYXRjaGluZyBidXQgcmVxdWlyZXMgdmFsdWUgaWRlbnRpdHkgdXBkYXRlXG4gICAgcmV0dXJuIC0xO1xuICB9XG5cbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIGxpdmUgY29sbGVjdGlvbiByZWNvbmNpbGlhdGlvbiBhbGdvcml0aG0gdGhhdCBwZXJmb3JtIHZhcmlvdXMgaW4tcGxhY2Ugb3BlcmF0aW9ucywgc28gaXRcbiAqIHJlZmxlY3RzIHRoZSBjb250ZW50IG9mIHRoZSBuZXcgKGluY29taW5nKSBjb2xsZWN0aW9uLlxuICpcbiAqIFRoZSByZWNvbmNpbGlhdGlvbiBhbGdvcml0aG0gaGFzIDIgY29kZSBwYXRoczpcbiAqIC0gXCJmYXN0XCIgcGF0aCB0aGF0IGRvbid0IHJlcXVpcmUgYW55IG1lbW9yeSBhbGxvY2F0aW9uO1xuICogLSBcInNsb3dcIiBwYXRoIHRoYXQgcmVxdWlyZXMgYWRkaXRpb25hbCBtZW1vcnkgYWxsb2NhdGlvbiBmb3IgaW50ZXJtZWRpYXRlIGRhdGEgc3RydWN0dXJlcyB1c2VkIHRvXG4gKiBjb2xsZWN0IGFkZGl0aW9uYWwgaW5mb3JtYXRpb24gYWJvdXQgdGhlIGxpdmUgY29sbGVjdGlvbi5cbiAqIEl0IG1pZ2h0IGhhcHBlbiB0aGF0IHRoZSBhbGdvcml0aG0gc3dpdGNoZXMgYmV0d2VlbiB0aGUgdHdvIG1vZGVzIGluIHF1ZXN0aW9uIGluIGEgc2luZ2xlXG4gKiByZWNvbmNpbGlhdGlvbiBwYXRoIC0gZ2VuZXJhbGx5IGl0IHRyaWVzIHRvIHN0YXkgb24gdGhlIFwiZmFzdFwiIHBhdGggYXMgbXVjaCBhcyBwb3NzaWJsZS5cbiAqXG4gKiBUaGUgb3ZlcmFsbCBjb21wbGV4aXR5IG9mIHRoZSBhbGdvcml0aG0gaXMgTyhuICsgbSkgZm9yIHNwZWVkIGFuZCBPKG4pIGZvciBtZW1vcnkgKHdoZXJlIG4gaXMgdGhlXG4gKiBsZW5ndGggb2YgdGhlIGxpdmUgY29sbGVjdGlvbiBhbmQgbSBpcyB0aGUgbGVuZ3RoIG9mIHRoZSBpbmNvbWluZyBjb2xsZWN0aW9uKS4gR2l2ZW4gdGhlIHByb2JsZW1cbiAqIGF0IGhhbmQgdGhlIGNvbXBsZXhpdHkgLyBwZXJmb3JtYW5jZSBjb25zdHJhaW50cyBtYWtlcyBpdCBpbXBvc3NpYmxlIHRvIHBlcmZvcm0gdGhlIGFic29sdXRlXG4gKiBtaW5pbXVtIG9mIG9wZXJhdGlvbiB0byByZWNvbmNpbGUgdGhlIDIgY29sbGVjdGlvbnMuIFRoZSBhbGdvcml0aG0gbWFrZXMgZGlmZmVyZW50IHRyYWRlb2ZmcyB0b1xuICogc3RheSB3aXRoaW4gcmVhc29uYWJsZSBwZXJmb3JtYW5jZSBib3VuZHMgYW5kIG1heSBhcHBseSBzdWItb3B0aW1hbCBudW1iZXIgb2Ygb3BlcmF0aW9ucyBpblxuICogY2VydGFpbiBzaXR1YXRpb25zLlxuICpcbiAqIEBwYXJhbSBsaXZlQ29sbGVjdGlvbiB0aGUgY3VycmVudCwgbGl2ZSBjb2xsZWN0aW9uO1xuICogQHBhcmFtIG5ld0NvbGxlY3Rpb24gdGhlIG5ldywgaW5jb21pbmcgY29sbGVjdGlvbjtcbiAqIEBwYXJhbSB0cmFja0J5Rm4ga2V5IGdlbmVyYXRpb24gZnVuY3Rpb24gdGhhdCBkZXRlcm1pbmVzIGVxdWFsaXR5IGJldHdlZW4gaXRlbXMgaW4gdGhlIGxpZmUgYW5kXG4gKiAgICAgaW5jb21pbmcgY29sbGVjdGlvbjtcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29uY2lsZTxULCBWPihcbiAgICBsaXZlQ29sbGVjdGlvbjogTGl2ZUNvbGxlY3Rpb248VCwgVj4sIG5ld0NvbGxlY3Rpb246IEl0ZXJhYmxlPFY+fHVuZGVmaW5lZHxudWxsLFxuICAgIHRyYWNrQnlGbjogVHJhY2tCeUZ1bmN0aW9uPFY+KTogdm9pZCB7XG4gIGxldCBkZXRhY2hlZEl0ZW1zOiBNdWx0aU1hcDx1bmtub3duLCBUPnx1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gIGxldCBsaXZlS2V5c0luVGhlRnV0dXJlOiBTZXQ8dW5rbm93bj58dW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuXG4gIGxldCBsaXZlU3RhcnRJZHggPSAwO1xuICBsZXQgbGl2ZUVuZElkeCA9IGxpdmVDb2xsZWN0aW9uLmxlbmd0aCAtIDE7XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkobmV3Q29sbGVjdGlvbikpIHtcbiAgICBsZXQgbmV3RW5kSWR4ID0gbmV3Q29sbGVjdGlvbi5sZW5ndGggLSAxO1xuXG4gICAgd2hpbGUgKGxpdmVTdGFydElkeCA8PSBsaXZlRW5kSWR4ICYmIGxpdmVTdGFydElkeCA8PSBuZXdFbmRJZHgpIHtcbiAgICAgIC8vIGNvbXBhcmUgZnJvbSB0aGUgYmVnaW5uaW5nXG4gICAgICBjb25zdCBsaXZlU3RhcnRWYWx1ZSA9IGxpdmVDb2xsZWN0aW9uLmF0KGxpdmVTdGFydElkeCk7XG4gICAgICBjb25zdCBuZXdTdGFydFZhbHVlID0gbmV3Q29sbGVjdGlvbltsaXZlU3RhcnRJZHhdO1xuICAgICAgY29uc3QgaXNTdGFydE1hdGNoaW5nID1cbiAgICAgICAgICB2YWx1ZXNNYXRjaGluZyhsaXZlU3RhcnRJZHgsIGxpdmVTdGFydFZhbHVlLCBsaXZlU3RhcnRJZHgsIG5ld1N0YXJ0VmFsdWUsIHRyYWNrQnlGbik7XG4gICAgICBpZiAoaXNTdGFydE1hdGNoaW5nICE9PSAwKSB7XG4gICAgICAgIGlmIChpc1N0YXJ0TWF0Y2hpbmcgPCAwKSB7XG4gICAgICAgICAgbGl2ZUNvbGxlY3Rpb24udXBkYXRlVmFsdWUobGl2ZVN0YXJ0SWR4LCBuZXdTdGFydFZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgICBsaXZlU3RhcnRJZHgrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIGNvbXBhcmUgZnJvbSB0aGUgZW5kXG4gICAgICAvLyBUT0RPKHBlcmYpOiBkbyBfYWxsXyB0aGUgbWF0Y2hpbmcgZnJvbSB0aGUgZW5kXG4gICAgICBjb25zdCBsaXZlRW5kVmFsdWUgPSBsaXZlQ29sbGVjdGlvbi5hdChsaXZlRW5kSWR4KTtcbiAgICAgIGNvbnN0IG5ld0VuZFZhbHVlID0gbmV3Q29sbGVjdGlvbltuZXdFbmRJZHhdO1xuICAgICAgY29uc3QgaXNFbmRNYXRjaGluZyA9XG4gICAgICAgICAgdmFsdWVzTWF0Y2hpbmcobGl2ZUVuZElkeCwgbGl2ZUVuZFZhbHVlLCBuZXdFbmRJZHgsIG5ld0VuZFZhbHVlLCB0cmFja0J5Rm4pO1xuICAgICAgaWYgKGlzRW5kTWF0Y2hpbmcgIT09IDApIHtcbiAgICAgICAgaWYgKGlzRW5kTWF0Y2hpbmcgPCAwKSB7XG4gICAgICAgICAgbGl2ZUNvbGxlY3Rpb24udXBkYXRlVmFsdWUobGl2ZUVuZElkeCwgbmV3RW5kVmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIGxpdmVFbmRJZHgtLTtcbiAgICAgICAgbmV3RW5kSWR4LS07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBEZXRlY3Qgc3dhcCBhbmQgbW92ZXM6XG4gICAgICBjb25zdCBsaXZlU3RhcnRLZXkgPSB0cmFja0J5Rm4obGl2ZVN0YXJ0SWR4LCBsaXZlU3RhcnRWYWx1ZSk7XG4gICAgICBjb25zdCBsaXZlRW5kS2V5ID0gdHJhY2tCeUZuKGxpdmVFbmRJZHgsIGxpdmVFbmRWYWx1ZSk7XG4gICAgICBjb25zdCBuZXdTdGFydEtleSA9IHRyYWNrQnlGbihsaXZlU3RhcnRJZHgsIG5ld1N0YXJ0VmFsdWUpO1xuICAgICAgaWYgKE9iamVjdC5pcyhuZXdTdGFydEtleSwgbGl2ZUVuZEtleSkpIHtcbiAgICAgICAgY29uc3QgbmV3RW5kS2V5ID0gdHJhY2tCeUZuKG5ld0VuZElkeCwgbmV3RW5kVmFsdWUpO1xuICAgICAgICAvLyBkZXRlY3Qgc3dhcCBvbiBib3RoIGVuZHM7XG4gICAgICAgIGlmIChPYmplY3QuaXMobmV3RW5kS2V5LCBsaXZlU3RhcnRLZXkpKSB7XG4gICAgICAgICAgbGl2ZUNvbGxlY3Rpb24uc3dhcChsaXZlU3RhcnRJZHgsIGxpdmVFbmRJZHgpO1xuICAgICAgICAgIGxpdmVDb2xsZWN0aW9uLnVwZGF0ZVZhbHVlKGxpdmVFbmRJZHgsIG5ld0VuZFZhbHVlKTtcbiAgICAgICAgICBuZXdFbmRJZHgtLTtcbiAgICAgICAgICBsaXZlRW5kSWR4LS07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdGhlIG5ldyBpdGVtIGlzIHRoZSBzYW1lIGFzIHRoZSBsaXZlIGl0ZW0gd2l0aCB0aGUgZW5kIHBvaW50ZXIgLSB0aGlzIGlzIGEgbW92ZSBmb3J3YXJkXG4gICAgICAgICAgLy8gdG8gYW4gZWFybGllciBpbmRleDtcbiAgICAgICAgICBsaXZlQ29sbGVjdGlvbi5tb3ZlKGxpdmVFbmRJZHgsIGxpdmVTdGFydElkeCk7XG4gICAgICAgIH1cbiAgICAgICAgbGl2ZUNvbGxlY3Rpb24udXBkYXRlVmFsdWUobGl2ZVN0YXJ0SWR4LCBuZXdTdGFydFZhbHVlKTtcbiAgICAgICAgbGl2ZVN0YXJ0SWR4Kys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBGYWxsYmFjayB0byB0aGUgc2xvdyBwYXRoOiB3ZSBuZWVkIHRvIGxlYXJuIG1vcmUgYWJvdXQgdGhlIGNvbnRlbnQgb2YgdGhlIGxpdmUgYW5kIG5ld1xuICAgICAgLy8gY29sbGVjdGlvbnMuXG4gICAgICBkZXRhY2hlZEl0ZW1zID8/PSBuZXcgTXVsdGlNYXAoKTtcbiAgICAgIGxpdmVLZXlzSW5UaGVGdXR1cmUgPz89XG4gICAgICAgICAgaW5pdExpdmVJdGVtc0luVGhlRnV0dXJlKGxpdmVDb2xsZWN0aW9uLCBsaXZlU3RhcnRJZHgsIGxpdmVFbmRJZHgsIHRyYWNrQnlGbik7XG5cbiAgICAgIC8vIENoZWNrIGlmIEknbSBpbnNlcnRpbmcgYSBwcmV2aW91c2x5IGRldGFjaGVkIGl0ZW06IGlmIHNvLCBhdHRhY2ggaXQgaGVyZVxuICAgICAgaWYgKGF0dGFjaFByZXZpb3VzbHlEZXRhY2hlZChsaXZlQ29sbGVjdGlvbiwgZGV0YWNoZWRJdGVtcywgbGl2ZVN0YXJ0SWR4LCBuZXdTdGFydEtleSkpIHtcbiAgICAgICAgbGl2ZUNvbGxlY3Rpb24udXBkYXRlVmFsdWUobGl2ZVN0YXJ0SWR4LCBuZXdTdGFydFZhbHVlKTtcbiAgICAgICAgbGl2ZVN0YXJ0SWR4Kys7XG4gICAgICAgIGxpdmVFbmRJZHgrKztcbiAgICAgIH0gZWxzZSBpZiAoIWxpdmVLZXlzSW5UaGVGdXR1cmUuaGFzKG5ld1N0YXJ0S2V5KSkge1xuICAgICAgICAvLyBDaGVjayBpZiB3ZSBzZWVuIGEgbmV3IGl0ZW0gdGhhdCBkb2Vzbid0IGV4aXN0IGluIHRoZSBvbGQgY29sbGVjdGlvbiBhbmQgbXVzdCBiZSBJTlNFUlRFRFxuICAgICAgICBjb25zdCBuZXdJdGVtID0gbGl2ZUNvbGxlY3Rpb24uY3JlYXRlKGxpdmVTdGFydElkeCwgbmV3Q29sbGVjdGlvbltsaXZlU3RhcnRJZHhdKTtcbiAgICAgICAgbGl2ZUNvbGxlY3Rpb24uYXR0YWNoKGxpdmVTdGFydElkeCwgbmV3SXRlbSk7XG4gICAgICAgIGxpdmVTdGFydElkeCsrO1xuICAgICAgICBsaXZlRW5kSWR4Kys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBXZSBrbm93IHRoYXQgdGhlIG5ldyBpdGVtIGV4aXN0cyBsYXRlciBvbiBpbiBvbGQgY29sbGVjdGlvbiBidXQgd2UgZG9uJ3Qga25vdyBpdHMgaW5kZXhcbiAgICAgICAgLy8gYW5kIGFzIHRoZSBjb25zZXF1ZW5jZSBjYW4ndCBtb3ZlIGl0IChkb24ndCBrbm93IHdoZXJlIHRvIGZpbmQgaXQpLiBEZXRhY2ggdGhlIG9sZCBpdGVtLFxuICAgICAgICAvLyBob3BpbmcgdGhhdCBpdCB1bmxvY2tzIHRoZSBmYXN0IHBhdGggYWdhaW4uXG4gICAgICAgIGRldGFjaGVkSXRlbXMuc2V0KGxpdmVTdGFydEtleSwgbGl2ZUNvbGxlY3Rpb24uZGV0YWNoKGxpdmVTdGFydElkeCkpO1xuICAgICAgICBsaXZlRW5kSWR4LS07XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRmluYWwgY2xlYW51cCBzdGVwczpcbiAgICAvLyAtIG1vcmUgaXRlbXMgaW4gdGhlIG5ldyBjb2xsZWN0aW9uID0+IGluc2VydFxuICAgIHdoaWxlIChsaXZlU3RhcnRJZHggPD0gbmV3RW5kSWR4KSB7XG4gICAgICBjcmVhdGVPckF0dGFjaChcbiAgICAgICAgICBsaXZlQ29sbGVjdGlvbiwgZGV0YWNoZWRJdGVtcywgdHJhY2tCeUZuLCBsaXZlU3RhcnRJZHgsIG5ld0NvbGxlY3Rpb25bbGl2ZVN0YXJ0SWR4XSk7XG4gICAgICBsaXZlU3RhcnRJZHgrKztcbiAgICB9XG5cbiAgfSBlbHNlIGlmIChuZXdDb2xsZWN0aW9uICE9IG51bGwpIHtcbiAgICAvLyBpdGVyYWJsZSAtIGltbWVkaWF0ZWx5IGZhbGxiYWNrIHRvIHRoZSBzbG93IHBhdGhcbiAgICBjb25zdCBuZXdDb2xsZWN0aW9uSXRlcmF0b3IgPSBuZXdDb2xsZWN0aW9uW1N5bWJvbC5pdGVyYXRvcl0oKTtcbiAgICBsZXQgbmV3SXRlcmF0aW9uUmVzdWx0ID0gbmV3Q29sbGVjdGlvbkl0ZXJhdG9yLm5leHQoKTtcbiAgICB3aGlsZSAoIW5ld0l0ZXJhdGlvblJlc3VsdC5kb25lICYmIGxpdmVTdGFydElkeCA8PSBsaXZlRW5kSWR4KSB7XG4gICAgICBjb25zdCBsaXZlVmFsdWUgPSBsaXZlQ29sbGVjdGlvbi5hdChsaXZlU3RhcnRJZHgpO1xuICAgICAgY29uc3QgbmV3VmFsdWUgPSBuZXdJdGVyYXRpb25SZXN1bHQudmFsdWU7XG4gICAgICBjb25zdCBpc1N0YXJ0TWF0Y2hpbmcgPVxuICAgICAgICAgIHZhbHVlc01hdGNoaW5nKGxpdmVTdGFydElkeCwgbGl2ZVZhbHVlLCBsaXZlU3RhcnRJZHgsIG5ld1ZhbHVlLCB0cmFja0J5Rm4pO1xuICAgICAgaWYgKGlzU3RhcnRNYXRjaGluZyAhPT0gMCkge1xuICAgICAgICAvLyBmb3VuZCBhIG1hdGNoIC0gbW92ZSBvbiwgYnV0IHVwZGF0ZSB2YWx1ZVxuICAgICAgICBpZiAoaXNTdGFydE1hdGNoaW5nIDwgMCkge1xuICAgICAgICAgIGxpdmVDb2xsZWN0aW9uLnVwZGF0ZVZhbHVlKGxpdmVTdGFydElkeCwgbmV3VmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIGxpdmVTdGFydElkeCsrO1xuICAgICAgICBuZXdJdGVyYXRpb25SZXN1bHQgPSBuZXdDb2xsZWN0aW9uSXRlcmF0b3IubmV4dCgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGV0YWNoZWRJdGVtcyA/Pz0gbmV3IE11bHRpTWFwKCk7XG4gICAgICAgIGxpdmVLZXlzSW5UaGVGdXR1cmUgPz89XG4gICAgICAgICAgICBpbml0TGl2ZUl0ZW1zSW5UaGVGdXR1cmUobGl2ZUNvbGxlY3Rpb24sIGxpdmVTdGFydElkeCwgbGl2ZUVuZElkeCwgdHJhY2tCeUZuKTtcblxuICAgICAgICAvLyBDaGVjayBpZiBJJ20gaW5zZXJ0aW5nIGEgcHJldmlvdXNseSBkZXRhY2hlZCBpdGVtOiBpZiBzbywgYXR0YWNoIGl0IGhlcmVcbiAgICAgICAgY29uc3QgbmV3S2V5ID0gdHJhY2tCeUZuKGxpdmVTdGFydElkeCwgbmV3VmFsdWUpO1xuICAgICAgICBpZiAoYXR0YWNoUHJldmlvdXNseURldGFjaGVkKGxpdmVDb2xsZWN0aW9uLCBkZXRhY2hlZEl0ZW1zLCBsaXZlU3RhcnRJZHgsIG5ld0tleSkpIHtcbiAgICAgICAgICBsaXZlQ29sbGVjdGlvbi51cGRhdGVWYWx1ZShsaXZlU3RhcnRJZHgsIG5ld1ZhbHVlKTtcbiAgICAgICAgICBsaXZlU3RhcnRJZHgrKztcbiAgICAgICAgICBsaXZlRW5kSWR4Kys7XG4gICAgICAgICAgbmV3SXRlcmF0aW9uUmVzdWx0ID0gbmV3Q29sbGVjdGlvbkl0ZXJhdG9yLm5leHQoKTtcbiAgICAgICAgfSBlbHNlIGlmICghbGl2ZUtleXNJblRoZUZ1dHVyZS5oYXMobmV3S2V5KSkge1xuICAgICAgICAgIGxpdmVDb2xsZWN0aW9uLmF0dGFjaChsaXZlU3RhcnRJZHgsIGxpdmVDb2xsZWN0aW9uLmNyZWF0ZShsaXZlU3RhcnRJZHgsIG5ld1ZhbHVlKSk7XG4gICAgICAgICAgbGl2ZVN0YXJ0SWR4Kys7XG4gICAgICAgICAgbGl2ZUVuZElkeCsrO1xuICAgICAgICAgIG5ld0l0ZXJhdGlvblJlc3VsdCA9IG5ld0NvbGxlY3Rpb25JdGVyYXRvci5uZXh0KCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gaXQgaXMgYSBtb3ZlIGZvcndhcmQgLSBkZXRhY2ggdGhlIGN1cnJlbnQgaXRlbSB3aXRob3V0IGFkdmFuY2luZyBpbiBjb2xsZWN0aW9uc1xuICAgICAgICAgIGNvbnN0IGxpdmVLZXkgPSB0cmFja0J5Rm4obGl2ZVN0YXJ0SWR4LCBsaXZlVmFsdWUpO1xuICAgICAgICAgIGRldGFjaGVkSXRlbXMuc2V0KGxpdmVLZXksIGxpdmVDb2xsZWN0aW9uLmRldGFjaChsaXZlU3RhcnRJZHgpKTtcbiAgICAgICAgICBsaXZlRW5kSWR4LS07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyB0aGlzIGlzIGEgbmV3IGl0ZW0gYXMgd2UgcnVuIG91dCBvZiB0aGUgaXRlbXMgaW4gdGhlIG9sZCBjb2xsZWN0aW9uIC0gY3JlYXRlIG9yIGF0dGFjaCBhXG4gICAgLy8gcHJldmlvdXNseSBkZXRhY2hlZCBvbmVcbiAgICB3aGlsZSAoIW5ld0l0ZXJhdGlvblJlc3VsdC5kb25lKSB7XG4gICAgICBjcmVhdGVPckF0dGFjaChcbiAgICAgICAgICBsaXZlQ29sbGVjdGlvbiwgZGV0YWNoZWRJdGVtcywgdHJhY2tCeUZuLCBsaXZlQ29sbGVjdGlvbi5sZW5ndGgsXG4gICAgICAgICAgbmV3SXRlcmF0aW9uUmVzdWx0LnZhbHVlKTtcbiAgICAgIG5ld0l0ZXJhdGlvblJlc3VsdCA9IG5ld0NvbGxlY3Rpb25JdGVyYXRvci5uZXh0KCk7XG4gICAgfVxuICB9XG5cbiAgLy8gQ2xlYW51cHMgY29tbW9uIHRvIHRoZSBhcnJheSBhbmQgaXRlcmFibGU6XG4gIC8vIC0gbW9yZSBpdGVtcyBpbiB0aGUgbGl2ZSBjb2xsZWN0aW9uID0+IGRlbGV0ZSBzdGFydGluZyBmcm9tIHRoZSBlbmQ7XG4gIHdoaWxlIChsaXZlU3RhcnRJZHggPD0gbGl2ZUVuZElkeCkge1xuICAgIGxpdmVDb2xsZWN0aW9uLmRlc3Ryb3kobGl2ZUNvbGxlY3Rpb24uZGV0YWNoKGxpdmVFbmRJZHgtLSkpO1xuICB9XG5cbiAgLy8gLSBkZXN0cm95IGl0ZW1zIHRoYXQgd2VyZSBkZXRhY2hlZCBidXQgbmV2ZXIgYXR0YWNoZWQgYWdhaW4uXG4gIGRldGFjaGVkSXRlbXM/LmZvckVhY2goaXRlbSA9PiBsaXZlQ29sbGVjdGlvbi5kZXN0cm95KGl0ZW0pKTtcbn1cblxuZnVuY3Rpb24gYXR0YWNoUHJldmlvdXNseURldGFjaGVkPFQsIFY+KFxuICAgIHByZXZDb2xsZWN0aW9uOiBMaXZlQ29sbGVjdGlvbjxULCBWPiwgZGV0YWNoZWRJdGVtczogTXVsdGlNYXA8dW5rbm93biwgVD58dW5kZWZpbmVkLFxuICAgIGluZGV4OiBudW1iZXIsIGtleTogdW5rbm93bik6IGJvb2xlYW4ge1xuICBpZiAoZGV0YWNoZWRJdGVtcyAhPT0gdW5kZWZpbmVkICYmIGRldGFjaGVkSXRlbXMuaGFzKGtleSkpIHtcbiAgICBwcmV2Q29sbGVjdGlvbi5hdHRhY2goaW5kZXgsIGRldGFjaGVkSXRlbXMuZ2V0KGtleSkhKTtcbiAgICBkZXRhY2hlZEl0ZW1zLmRlbGV0ZShrZXkpO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlT3JBdHRhY2g8VCwgVj4oXG4gICAgbGl2ZUNvbGxlY3Rpb246IExpdmVDb2xsZWN0aW9uPFQsIFY+LCBkZXRhY2hlZEl0ZW1zOiBNdWx0aU1hcDx1bmtub3duLCBUPnx1bmRlZmluZWQsXG4gICAgdHJhY2tCeUZuOiBUcmFja0J5RnVuY3Rpb248dW5rbm93bj4sIGluZGV4OiBudW1iZXIsIHZhbHVlOiBWKSB7XG4gIGlmICghYXR0YWNoUHJldmlvdXNseURldGFjaGVkKGxpdmVDb2xsZWN0aW9uLCBkZXRhY2hlZEl0ZW1zLCBpbmRleCwgdHJhY2tCeUZuKGluZGV4LCB2YWx1ZSkpKSB7XG4gICAgY29uc3QgbmV3SXRlbSA9IGxpdmVDb2xsZWN0aW9uLmNyZWF0ZShpbmRleCwgdmFsdWUpO1xuICAgIGxpdmVDb2xsZWN0aW9uLmF0dGFjaChpbmRleCwgbmV3SXRlbSk7XG4gIH0gZWxzZSB7XG4gICAgbGl2ZUNvbGxlY3Rpb24udXBkYXRlVmFsdWUoaW5kZXgsIHZhbHVlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpbml0TGl2ZUl0ZW1zSW5UaGVGdXR1cmU8VD4oXG4gICAgbGl2ZUNvbGxlY3Rpb246IExpdmVDb2xsZWN0aW9uPHVua25vd24sIHVua25vd24+LCBzdGFydDogbnVtYmVyLCBlbmQ6IG51bWJlcixcbiAgICB0cmFja0J5Rm46IFRyYWNrQnlGdW5jdGlvbjx1bmtub3duPik6IFNldDx1bmtub3duPiB7XG4gIGNvbnN0IGtleXMgPSBuZXcgU2V0KCk7XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8PSBlbmQ7IGkrKykge1xuICAgIGtleXMuYWRkKHRyYWNrQnlGbihpLCBsaXZlQ29sbGVjdGlvbi5hdChpKSkpO1xuICB9XG4gIHJldHVybiBrZXlzO1xufVxuXG5jbGFzcyBNdWx0aU1hcDxLLCBWPiB7XG4gIHByaXZhdGUgbWFwID0gbmV3IE1hcDxLLCBBcnJheTxWPj4oKTtcblxuICBoYXMoa2V5OiBLKTogYm9vbGVhbiB7XG4gICAgY29uc3QgbGlzdE9mS2V5cyA9IHRoaXMubWFwLmdldChrZXkpO1xuICAgIHJldHVybiBsaXN0T2ZLZXlzICE9PSB1bmRlZmluZWQgJiYgbGlzdE9mS2V5cy5sZW5ndGggPiAwO1xuICB9XG5cbiAgZGVsZXRlKGtleTogSyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGxpc3RPZktleXMgPSB0aGlzLm1hcC5nZXQoa2V5KTtcbiAgICBpZiAobGlzdE9mS2V5cyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBUSElOSzogcG9wIGZyb20gdGhlIGVuZCBvciBzaGlmdCBmcm9tIHRoZSBmcm9udD8gXCJDb3JyZWN0XCIgdnMuIFwic2xvd1wiLlxuICAgICAgbGlzdE9mS2V5cy5wb3AoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBnZXQoa2V5OiBLKTogVnx1bmRlZmluZWQge1xuICAgIGNvbnN0IGxpc3RPZktleXMgPSB0aGlzLm1hcC5nZXQoa2V5KTtcbiAgICByZXR1cm4gbGlzdE9mS2V5cyAhPT0gdW5kZWZpbmVkICYmIGxpc3RPZktleXMubGVuZ3RoID4gMCA/IGxpc3RPZktleXNbMF0gOiB1bmRlZmluZWQ7XG4gIH1cblxuICBzZXQoa2V5OiBLLCB2YWx1ZTogVik6IHZvaWQge1xuICAgIC8vIGlmIHZhbHVlIGlzIGFycmF5LCB0aGV5IHdlIGFsd2F5cyBzdG9yZSBpdCBhcyBbdmFsdWVdLlxuICAgIGlmICghdGhpcy5tYXAuaGFzKGtleSkpIHtcbiAgICAgIHRoaXMubWFwLnNldChrZXksIFt2YWx1ZV0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBUSElOSzogdGhpcyBhbGxvd3MgZHVwbGljYXRlIHZhbHVlcywgYnV0IEkgZ3Vlc3MgdGhpcyBpcyBmaW5lP1xuICAgIC8vIElzIHRoZSBleGlzdGluZyBrZXkgYW4gYXJyYXkgb3Igbm90P1xuICAgIHRoaXMubWFwLmdldChrZXkpPy5wdXNoKHZhbHVlKTtcbiAgfVxuXG4gIGZvckVhY2goY2I6ICh2OiBWLCBrOiBLKSA9PiB2b2lkKSB7XG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZXNdIG9mIHRoaXMubWFwKSB7XG4gICAgICBmb3IgKGNvbnN0IHZhbHVlIG9mIHZhbHVlcykge1xuICAgICAgICBjYih2YWx1ZSwga2V5KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==