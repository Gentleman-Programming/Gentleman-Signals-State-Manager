/*!
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { internalAfterNextRender } from '../render3/after_render_hooks';
import { assertLContainer, assertLView } from '../render3/assert';
import { CONTAINER_HEADER_OFFSET } from '../render3/interfaces/container';
import { isDestroyed } from '../render3/interfaces/type_checks';
import { HEADER_OFFSET, INJECTOR } from '../render3/interfaces/view';
import { getNativeByIndex, removeLViewOnDestroy, storeLViewOnDestroy, walkUpViews } from '../render3/util/view_utils';
import { assertElement, assertEqual } from '../util/assert';
import { NgZone } from '../zone';
import { storeTriggerCleanupFn } from './cleanup';
import { DEFER_BLOCK_STATE, DeferBlockInternalState, DeferBlockState } from './interfaces';
import { getLDeferBlockDetails } from './utils';
/** Configuration object used to register passive and capturing events. */
const eventListenerOptions = {
    passive: true,
    capture: true
};
/** Keeps track of the currently-registered `on hover` triggers. */
const hoverTriggers = new WeakMap();
/** Keeps track of the currently-registered `on interaction` triggers. */
const interactionTriggers = new WeakMap();
/** Currently-registered `viewport` triggers. */
const viewportTriggers = new WeakMap();
/** Names of the events considered as interaction events. */
const interactionEventNames = ['click', 'keydown'];
/** Names of the events considered as hover events. */
const hoverEventNames = ['mouseenter', 'focusin'];
/** `IntersectionObserver` used to observe `viewport` triggers. */
let intersectionObserver = null;
/** Number of elements currently observed with `viewport` triggers. */
let observedViewportElements = 0;
/** Object keeping track of registered callbacks for a deferred block trigger. */
class DeferEventEntry {
    constructor() {
        this.callbacks = new Set();
        this.listener = () => {
            for (const callback of this.callbacks) {
                callback();
            }
        };
    }
}
/**
 * Registers an interaction trigger.
 * @param trigger Element that is the trigger.
 * @param callback Callback to be invoked when the trigger is interacted with.
 */
export function onInteraction(trigger, callback) {
    let entry = interactionTriggers.get(trigger);
    // If this is the first entry for this element, add the listeners.
    if (!entry) {
        // Note that managing events centrally like this lends itself well to using global
        // event delegation. It currently does delegation at the element level, rather than the
        // document level, because:
        // 1. Global delegation is the most effective when there are a lot of events being registered
        // at the same time. Deferred blocks are unlikely to be used in such a way.
        // 2. Matching events to their target isn't free. For each `click` and `keydown` event we
        // would have look through all the triggers and check if the target either is the element
        // itself or it's contained within the element. Given that `click` and `keydown` are some
        // of the most common events, this may end up introducing a lot of runtime overhead.
        // 3. We're still registering only two events per element, no matter how many deferred blocks
        // are referencing it.
        entry = new DeferEventEntry();
        interactionTriggers.set(trigger, entry);
        // Ensure that the handler runs in the NgZone
        ngDevMode && NgZone.assertInAngularZone();
        for (const name of interactionEventNames) {
            trigger.addEventListener(name, entry.listener, eventListenerOptions);
        }
    }
    entry.callbacks.add(callback);
    return () => {
        const { callbacks, listener } = entry;
        callbacks.delete(callback);
        if (callbacks.size === 0) {
            interactionTriggers.delete(trigger);
            for (const name of interactionEventNames) {
                trigger.removeEventListener(name, listener, eventListenerOptions);
            }
        }
    };
}
/**
 * Registers a hover trigger.
 * @param trigger Element that is the trigger.
 * @param callback Callback to be invoked when the trigger is hovered over.
 */
export function onHover(trigger, callback) {
    let entry = hoverTriggers.get(trigger);
    // If this is the first entry for this element, add the listener.
    if (!entry) {
        entry = new DeferEventEntry();
        hoverTriggers.set(trigger, entry);
        // Ensure that the handler runs in the NgZone
        ngDevMode && NgZone.assertInAngularZone();
        for (const name of hoverEventNames) {
            trigger.addEventListener(name, entry.listener, eventListenerOptions);
        }
    }
    entry.callbacks.add(callback);
    return () => {
        const { callbacks, listener } = entry;
        callbacks.delete(callback);
        if (callbacks.size === 0) {
            for (const name of hoverEventNames) {
                trigger.removeEventListener(name, listener, eventListenerOptions);
            }
            hoverTriggers.delete(trigger);
        }
    };
}
/**
 * Registers a viewport trigger.
 * @param trigger Element that is the trigger.
 * @param callback Callback to be invoked when the trigger comes into the viewport.
 * @param injector Injector that can be used by the trigger to resolve DI tokens.
 */
export function onViewport(trigger, callback, injector) {
    const ngZone = injector.get(NgZone);
    let entry = viewportTriggers.get(trigger);
    intersectionObserver = intersectionObserver || ngZone.runOutsideAngular(() => {
        return new IntersectionObserver(entries => {
            for (const current of entries) {
                // Only invoke the callbacks if the specific element is intersecting.
                if (current.isIntersecting && viewportTriggers.has(current.target)) {
                    ngZone.run(viewportTriggers.get(current.target).listener);
                }
            }
        });
    });
    if (!entry) {
        entry = new DeferEventEntry();
        ngZone.runOutsideAngular(() => intersectionObserver.observe(trigger));
        viewportTriggers.set(trigger, entry);
        observedViewportElements++;
    }
    entry.callbacks.add(callback);
    return () => {
        // It's possible that a different cleanup callback fully removed this element already.
        if (!viewportTriggers.has(trigger)) {
            return;
        }
        entry.callbacks.delete(callback);
        if (entry.callbacks.size === 0) {
            intersectionObserver?.unobserve(trigger);
            viewportTriggers.delete(trigger);
            observedViewportElements--;
        }
        if (observedViewportElements === 0) {
            intersectionObserver?.disconnect();
            intersectionObserver = null;
        }
    };
}
/**
 * Helper function to get the LView in which a deferred block's trigger is rendered.
 * @param deferredHostLView LView in which the deferred block is defined.
 * @param deferredTNode TNode defining the deferred block.
 * @param walkUpTimes Number of times to go up in the view hierarchy to find the trigger's view.
 *   A negative value means that the trigger is inside the block's placeholder, while an undefined
 *   value means that the trigger is in the same LView as the deferred block.
 */
export function getTriggerLView(deferredHostLView, deferredTNode, walkUpTimes) {
    // The trigger is in the same view, we don't need to traverse.
    if (walkUpTimes == null) {
        return deferredHostLView;
    }
    // A positive value or zero means that the trigger is in a parent view.
    if (walkUpTimes >= 0) {
        return walkUpViews(walkUpTimes, deferredHostLView);
    }
    // If the value is negative, it means that the trigger is inside the placeholder.
    const deferredContainer = deferredHostLView[deferredTNode.index];
    ngDevMode && assertLContainer(deferredContainer);
    const triggerLView = deferredContainer[CONTAINER_HEADER_OFFSET] ?? null;
    // We need to null check, because the placeholder might not have been rendered yet.
    if (ngDevMode && triggerLView !== null) {
        const lDetails = getLDeferBlockDetails(deferredHostLView, deferredTNode);
        const renderedState = lDetails[DEFER_BLOCK_STATE];
        assertEqual(renderedState, DeferBlockState.Placeholder, 'Expected a placeholder to be rendered in this defer block.');
        assertLView(triggerLView);
    }
    return triggerLView;
}
/**
 * Gets the element that a deferred block's trigger is pointing to.
 * @param triggerLView LView in which the trigger is defined.
 * @param triggerIndex Index at which the trigger element should've been rendered.
 */
export function getTriggerElement(triggerLView, triggerIndex) {
    const element = getNativeByIndex(HEADER_OFFSET + triggerIndex, triggerLView);
    ngDevMode && assertElement(element);
    return element;
}
/**
 * Registers a DOM-node based trigger.
 * @param initialLView LView in which the defer block is rendered.
 * @param tNode TNode representing the defer block.
 * @param triggerIndex Index at which to find the trigger element.
 * @param walkUpTimes Number of times to go up/down in the view hierarchy to find the trigger.
 * @param registerFn Function that will register the DOM events.
 * @param callback Callback to be invoked when the trigger receives the event that should render
 *     the deferred block.
 * @param type Trigger type to distinguish between regular and prefetch triggers.
 */
export function registerDomTrigger(initialLView, tNode, triggerIndex, walkUpTimes, registerFn, callback, type) {
    const injector = initialLView[INJECTOR];
    function pollDomTrigger() {
        // If the initial view was destroyed, we don't need to do anything.
        if (isDestroyed(initialLView)) {
            return;
        }
        const lDetails = getLDeferBlockDetails(initialLView, tNode);
        const renderedState = lDetails[DEFER_BLOCK_STATE];
        // If the block was loaded before the trigger was resolved, we don't need to do anything.
        if (renderedState !== DeferBlockInternalState.Initial &&
            renderedState !== DeferBlockState.Placeholder) {
            return;
        }
        const triggerLView = getTriggerLView(initialLView, tNode, walkUpTimes);
        // Keep polling until we resolve the trigger's LView.
        if (!triggerLView) {
            internalAfterNextRender(pollDomTrigger, { injector });
            return;
        }
        // It's possible that the trigger's view was destroyed before we resolved the trigger element.
        if (isDestroyed(triggerLView)) {
            return;
        }
        const element = getTriggerElement(triggerLView, triggerIndex);
        const cleanup = registerFn(element, () => {
            if (initialLView !== triggerLView) {
                removeLViewOnDestroy(triggerLView, cleanup);
            }
            callback();
        }, injector);
        // The trigger and deferred block might be in different LViews.
        // For the main LView the cleanup would happen as a part of
        // `storeTriggerCleanupFn` logic. For trigger LView we register
        // a cleanup function there to remove event handlers in case an
        // LView gets destroyed before a trigger is invoked.
        if (initialLView !== triggerLView) {
            storeLViewOnDestroy(triggerLView, cleanup);
        }
        storeTriggerCleanupFn(type, lDetails, cleanup);
    }
    // Begin polling for the trigger.
    internalAfterNextRender(pollDomTrigger, { injector });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZG9tX3RyaWdnZXJzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvY29yZS9zcmMvZGVmZXIvZG9tX3RyaWdnZXJzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUdILE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLCtCQUErQixDQUFDO0FBQ3RFLE9BQU8sRUFBQyxnQkFBZ0IsRUFBRSxXQUFXLEVBQUMsTUFBTSxtQkFBbUIsQ0FBQztBQUNoRSxPQUFPLEVBQUMsdUJBQXVCLEVBQUMsTUFBTSxpQ0FBaUMsQ0FBQztBQUV4RSxPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sbUNBQW1DLENBQUM7QUFDOUQsT0FBTyxFQUFDLGFBQWEsRUFBRSxRQUFRLEVBQVEsTUFBTSw0QkFBNEIsQ0FBQztBQUMxRSxPQUFPLEVBQUMsZ0JBQWdCLEVBQUUsb0JBQW9CLEVBQUUsbUJBQW1CLEVBQUUsV0FBVyxFQUFDLE1BQU0sNEJBQTRCLENBQUM7QUFDcEgsT0FBTyxFQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUMsTUFBTSxnQkFBZ0IsQ0FBQztBQUMxRCxPQUFPLEVBQUMsTUFBTSxFQUFDLE1BQU0sU0FBUyxDQUFDO0FBQy9CLE9BQU8sRUFBQyxxQkFBcUIsRUFBQyxNQUFNLFdBQVcsQ0FBQztBQUVoRCxPQUFPLEVBQUMsaUJBQWlCLEVBQUUsdUJBQXVCLEVBQUUsZUFBZSxFQUFjLE1BQU0sY0FBYyxDQUFDO0FBQ3RHLE9BQU8sRUFBQyxxQkFBcUIsRUFBQyxNQUFNLFNBQVMsQ0FBQztBQUU5QywwRUFBMEU7QUFDMUUsTUFBTSxvQkFBb0IsR0FBNEI7SUFDcEQsT0FBTyxFQUFFLElBQUk7SUFDYixPQUFPLEVBQUUsSUFBSTtDQUNkLENBQUM7QUFFRixtRUFBbUU7QUFDbkUsTUFBTSxhQUFhLEdBQUcsSUFBSSxPQUFPLEVBQTRCLENBQUM7QUFFOUQseUVBQXlFO0FBQ3pFLE1BQU0sbUJB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M0QsK0RBQStEO1FBQy9ELCtEQUErRDtRQUMvRCxvREFBb0Q7UUFDcEQsSUFBSSxZQUFZLEtBQUssWUFBWSxFQUFFO1lBQ2pDLG1CQUFtQixDQUFDLFlBQVksRUFBRSxPQUFPLENBQUMsQ0FBQztTQUM1QztRQUVELHFCQUFxQixDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDakQsQ0FBQztJQUVELGlDQUFpQztJQUNqQyx1QkFBdUIsQ0FBQyxjQUFjLEVBQUUsRUFBQyxRQUFRLEVBQUMsQ0FBQyxDQUFDO0FBQ3RELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiFcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IHR5cGUge0luamVjdG9yfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQge2ludGVybmFsQWZ0ZXJOZXh0UmVuZGVyfSBmcm9tICcuLi9yZW5kZXIzL2FmdGVyX3JlbmRlcl9ob29rcyc7XG5pbXBvcnQge2Fzc2VydExDb250YWluZXIsIGFzc2VydExWaWV3fSBmcm9tICcuLi9yZW5kZXIzL2Fzc2VydCc7XG5pbXBvcnQge0NPTlRBSU5FUl9IRUFERVJfT0ZGU0VUfSBmcm9tICcuLi9yZW5kZXIzL2ludGVyZmFjZXMvY29udGFpbmVyJztcbmltcG9ydCB7VE5vZGV9IGZyb20gJy4uL3JlbmRlcjMvaW50ZXJmYWNlcy9ub2RlJztcbmltcG9ydCB7aXNEZXN0cm95ZWR9IGZyb20gJy4uL3JlbmRlcjMvaW50ZXJmYWNlcy90eXBlX2NoZWNrcyc7XG5pbXBvcnQge0hFQURFUl9PRkZTRVQsIElOSkVDVE9SLCBMVmlld30gZnJvbSAnLi4vcmVuZGVyMy9pbnRlcmZhY2VzL3ZpZXcnO1xuaW1wb3J0IHtnZXROYXRpdmVCeUluZGV4LCByZW1vdmVMVmlld09uRGVzdHJveSwgc3RvcmVMVmlld09uRGVzdHJveSwgd2Fsa1VwVmlld3N9IGZyb20gJy4uL3JlbmRlcjMvdXRpbC92aWV3X3V0aWxzJztcbmltcG9ydCB7YXNzZXJ0RWxlbWVudCwgYXNzZXJ0RXF1YWx9IGZyb20gJy4uL3V0aWwvYXNzZXJ0JztcbmltcG9ydCB7Tmdab25lfSBmcm9tICcuLi96b25lJztcbmltcG9ydCB7c3RvcmVUcmlnZ2VyQ2xlYW51cEZufSBmcm9tICcuL2NsZWFudXAnO1xuXG5pbXBvcnQge0RFRkVSX0JMT0NLX1NUQVRFLCBEZWZlckJsb2NrSW50ZXJuYWxTdGF0ZSwgRGVmZXJCbG9ja1N0YXRlLCBUcmlnZ2VyVHlwZX0gZnJvbSAnLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7Z2V0TERlZmVyQmxvY2tEZXRhaWxzfSBmcm9tICcuL3V0aWxzJztcblxuLyoqIENvbmZpZ3VyYXRpb24gb2JqZWN0IHVzZWQgdG8gcmVnaXN0ZXIgcGFzc2l2ZSBhbmQgY2FwdHVyaW5nIGV2ZW50cy4gKi9cbmNvbnN0IGV2ZW50TGlzdGVuZXJPcHRpb25zOiBBZGRFdmVudExpc3RlbmVyT3B0aW9ucyA9IHtcbiAgcGFzc2l2ZTogdHJ1ZSxcbiAgY2FwdHVyZTogdHJ1ZVxufTtcblxuLyoqIEtlZXBzIHRyYWNrIG9mIHRoZSBjdXJyZW50bHktcmVnaXN0ZXJlZCBgb24gaG92ZXJgIHRyaWdnZXJzLiAqL1xuY29uc3QgaG92ZXJUcmlnZ2VycyA9IG5ldyBXZWFrTWFwPEVsZW1lbnQsIERlZmVyRXZlbnRFbnRyeT4oKTtcblxuLyoqIEtlZXBzIHRyYWNrIG9mIHRoZSBjdXJyZW50bHktcmVnaXN0ZXJlZCBgb24gaW50ZXJhY3Rpb25gIHRyaWdnZXJzLiAqL1xuY29uc3QgaW50ZXJhY3Rpb25UcmlnZ2VycyA9IG5ldyBXZWFrTWFwPEVsZW1lbnQsIERlZmVyRXZlbnRFbnRyeT4oKTtcblxuLyoqIEN1cnJlbnRseS1yZWdpc3RlcmVkIGB2aWV3cG9ydGAgdHJpZ2dlcnMuICovXG5jb25zdCB2aWV3cG9ydFRyaWdnZXJzID0gbmV3IFdlYWtNYXA8RWxlbWVudCwgRGVmZXJFdmVudEVudHJ5PigpO1xuXG4vKiogTmFtZXMgb2YgdGhlIGV2ZW50cyBjb25zaWRlcmVkIGFzIGludGVyYWN0aW9uIGV2ZW50cy4gKi9cbmNvbnN0IGludGVyYWN0aW9uRXZlbnROYW1lcyA9IFsnY2xpY2snLCAna2V5ZG93biddIGFzIGNvbnN0O1xuXG4vKiogTmFtZXMgb2YgdGhlIGV2ZW50cyBjb25zaWRlcmVkIGFzIGhvdmVyIGV2ZW50cy4gKi9cbmNvbnN0IGhvdmVyRXZlbnROYW1lcyA9IFsnbW91c2VlbnRlcicsICdmb2N1c2luJ10gYXMgY29uc3Q7XG5cbi8qKiBgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJgIHVzZWQgdG8gb2JzZXJ2ZSBgdmlld3BvcnRgIHRyaWdnZXJzLiAqL1xubGV0IGludGVyc2VjdGlvbk9ic2VydmVyOiBJbnRlcnNlY3Rpb25PYnNlcnZlcnxudWxsID0gbnVsbDtcblxuLyoqIE51bWJlciBvZiBlbGVtZW50cyBjdXJyZW50bHkgb2JzZXJ2ZWQgd2l0aCBgdmlld3BvcnRgIHRyaWdnZXJzLiAqL1xubGV0IG9ic2VydmVkVmlld3BvcnRFbGVtZW50cyA9IDA7XG5cbi8qKiBPYmplY3Qga2VlcGluZyB0cmFjayBvZiByZWdpc3RlcmVkIGNhbGxiYWNrcyBmb3IgYSBkZWZlcnJlZCBibG9jayB0cmlnZ2VyLiAqL1xuY2xhc3MgRGVmZXJFdmVudEVudHJ5IHtcbiAgY2FsbGJhY2tzID0gbmV3IFNldDxWb2lkRnVuY3Rpb24+KCk7XG5cbiAgbGlzdGVuZXIgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBjYWxsYmFjayBvZiB0aGlzLmNhbGxiYWNrcykge1xuICAgICAgY2FsbGJhY2soKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSZWdpc3RlcnMgYW4gaW50ZXJhY3Rpb24gdHJpZ2dlci5cbiAqIEBwYXJhbSB0cmlnZ2VyIEVsZW1lbnQgdGhhdCBpcyB0aGUgdHJpZ2dlci5cbiAqIEBwYXJhbSBjYWxsYmFjayBDYWxsYmFjayB0byBiZSBpbnZva2VkIHdoZW4gdGhlIHRyaWdnZXIgaXMgaW50ZXJhY3RlZCB3aXRoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gb25JbnRlcmFjdGlvbih0cmlnZ2VyOiBFbGVtZW50LCBjYWxsYmFjazogVm9pZEZ1bmN0aW9uKTogVm9pZEZ1bmN0aW9uIHtcbiAgbGV0IGVudHJ5ID0gaW50ZXJhY3Rpb25UcmlnZ2Vycy5nZXQodHJpZ2dlcik7XG5cbiAgLy8gSWYgdGhpcyBpcyB0aGUgZmlyc3QgZW50cnkgZm9yIHRoaXMgZWxlbWVudCwgYWRkIHRoZSBsaXN0ZW5lcnMuXG4gIGlmICghZW50cnkpIHtcbiAgICAvLyBOb3RlIHRoYXQgbWFuYWdpbmcgZXZlbnRzIGNlbnRyYWxseSBsaWtlIHRoaXMgbGVuZHMgaXRzZWxmIHdlbGwgdG8gdXNpbmcgZ2xvYmFsXG4gICAgLy8gZXZlbnQgZGVsZWdhdGlvbi4gSXQgY3VycmVudGx5IGRvZXMgZGVsZWdhdGlvbiBhdCB0aGUgZWxlbWVudCBsZXZlbCwgcmF0aGVyIHRoYW4gdGhlXG4gICAgLy8gZG9jdW1lbnQgbGV2ZWwsIGJlY2F1c2U6XG4gICAgLy8gMS4gR2xvYmFsIGRlbGVnYXRpb24gaXMgdGhlIG1vc3QgZWZmZWN0aXZlIHdoZW4gdGhlcmUgYXJlIGEgbG90IG9mIGV2ZW50cyBiZWluZyByZWdpc3RlcmVkXG4gICAgLy8gYXQgdGhlIHNhbWUgdGltZS4gRGVmZXJyZWQgYmxvY2tzIGFyZSB1bmxpa2VseSB0byBiZSB1c2VkIGluIHN1Y2ggYSB3YXkuXG4gICAgLy8gMi4gTWF0Y2hpbmcgZXZlbnRzIHRvIHRoZWlyIHRhcmdldCBpc24ndCBmcmVlLiBGb3IgZWFjaCBgY2xpY2tgIGFuZCBga2V5ZG93bmAgZXZlbnQgd2VcbiAgICAvLyB3b3VsZCBoYXZlIGxvb2sgdGhyb3VnaCBhbGwgdGhlIHRyaWdnZXJzIGFuZCBjaGVjayBpZiB0aGUgdGFyZ2V0IGVpdGhlciBpcyB0aGUgZWxlbWVudFxuICAgIC8vIGl0c2VsZiBvciBpdCdzIGNvbnRhaW5lZCB3aXRoaW4gdGhlIGVsZW1lbnQuIEdpdmVuIHRoYXQgYGNsaWNrYCBhbmQgYGtleWRvd25gIGFyZSBzb21lXG4gICAgLy8gb2YgdGhlIG1vc3QgY29tbW9uIGV2ZW50cywgdGhpcyBtYXkgZW5kIHVwIGludHJvZHVjaW5nIGEgbG90IG9mIHJ1bnRpbWUgb3ZlcmhlYWQuXG4gICAgLy8gMy4gV2UncmUgc3RpbGwgcmVnaXN0ZXJpbmcgb25seSB0d28gZXZlbnRzIHBlciBlbGVtZW50LCBubyBtYXR0ZXIgaG93IG1hbnkgZGVmZXJyZWQgYmxvY2tzXG4gICAgLy8gYXJlIHJlZmVyZW5jaW5nIGl0LlxuICAgIGVudHJ5ID0gbmV3IERlZmVyRXZlbnRFbnRyeSgpO1xuICAgIGludGVyYWN0aW9uVHJpZ2dlcnMuc2V0KHRyaWdnZXIsIGVudHJ5KTtcblxuICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBoYW5kbGVyIHJ1bnMgaW4gdGhlIE5nWm9uZVxuICAgIG5nRGV2TW9kZSAmJiBOZ1pvbmUuYXNzZXJ0SW5Bbmd1bGFyWm9uZSgpO1xuXG4gICAgZm9yIChjb25zdCBuYW1lIG9mIGludGVyYWN0aW9uRXZlbnROYW1lcykge1xuICAgICAgdHJpZ2dlci5hZGRFdmVudExpc3RlbmVyKG5hbWUsIGVudHJ5IS5saXN0ZW5lciwgZXZlbnRMaXN0ZW5lck9wdGlvbnMpO1xuICAgIH1cbiAgfVxuXG4gIGVudHJ5LmNhbGxiYWNrcy5hZGQoY2FsbGJhY2spO1xuXG4gIHJldHVybiAoKSA9PiB7XG4gICAgY29uc3Qge2NhbGxiYWNrcywgbGlzdGVuZXJ9ID0gZW50cnkhO1xuICAgIGNhbGxiYWNrcy5kZWxldGUoY2FsbGJhY2spO1xuXG4gICAgaWYgKGNhbGxiYWNrcy5zaXplID09PSAwKSB7XG4gICAgICBpbnRlcmFjdGlvblRyaWdnZXJzLmRlbGV0ZSh0cmlnZ2VyKTtcblxuICAgICAgZm9yIChjb25zdCBuYW1lIG9mIGludGVyYWN0aW9uRXZlbnROYW1lcykge1xuICAgICAgICB0cmlnZ2VyLnJlbW92ZUV2ZW50TGlzdGVuZXIobmFtZSwgbGlzdGVuZXIsIGV2ZW50TGlzdGVuZXJPcHRpb25zKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKlxuICogUmVnaXN0ZXJzIGEgaG92ZXIgdHJpZ2dlci5cbiAqIEBwYXJhbSB0cmlnZ2VyIEVsZW1lbnQgdGhhdCBpcyB0aGUgdHJpZ2dlci5cbiAqIEBwYXJhbSBjYWxsYmFjayBDYWxsYmFjayB0byBiZSBpbnZva2VkIHdoZW4gdGhlIHRyaWdnZXIgaXMgaG92ZXJlZCBvdmVyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gb25Ib3Zlcih0cmlnZ2VyOiBFbGVtZW50LCBjYWxsYmFjazogVm9pZEZ1bmN0aW9uKTogVm9pZEZ1bmN0aW9uIHtcbiAgbGV0IGVudHJ5ID0gaG92ZXJUcmlnZ2Vycy5nZXQodHJpZ2dlcik7XG5cbiAgLy8gSWYgdGhpcyBpcyB0aGUgZmlyc3QgZW50cnkgZm9yIHRoaXMgZWxlbWVudCwgYWRkIHRoZSBsaXN0ZW5lci5cbiAgaWYgKCFlbnRyeSkge1xuICAgIGVudHJ5ID0gbmV3IERlZmVyRXZlbnRFbnRyeSgpO1xuICAgIGhvdmVyVHJpZ2dlcnMuc2V0KHRyaWdnZXIsIGVudHJ5KTtcblxuICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBoYW5kbGVyIHJ1bnMgaW4gdGhlIE5nWm9uZVxuICAgIG5nRGV2TW9kZSAmJiBOZ1pvbmUuYXNzZXJ0SW5Bbmd1bGFyWm9uZSgpO1xuXG4gICAgZm9yIChjb25zdCBuYW1lIG9mIGhvdmVyRXZlbnROYW1lcykge1xuICAgICAgdHJpZ2dlci5hZGRFdmVudExpc3RlbmVyKG5hbWUsIGVudHJ5IS5saXN0ZW5lciwgZXZlbnRMaXN0ZW5lck9wdGlvbnMpO1xuICAgIH1cbiAgfVxuXG4gIGVudHJ5LmNhbGxiYWNrcy5hZGQoY2FsbGJhY2spO1xuXG4gIHJldHVybiAoKSA9PiB7XG4gICAgY29uc3Qge2NhbGxiYWNrcywgbGlzdGVuZXJ9ID0gZW50cnkhO1xuICAgIGNhbGxiYWNrcy5kZWxldGUoY2FsbGJhY2spO1xuXG4gICAgaWYgKGNhbGxiYWNrcy5zaXplID09PSAwKSB7XG4gICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgaG92ZXJFdmVudE5hbWVzKSB7XG4gICAgICAgIHRyaWdnZXIucmVtb3ZlRXZlbnRMaXN0ZW5lcihuYW1lLCBsaXN0ZW5lciwgZXZlbnRMaXN0ZW5lck9wdGlvbnMpO1xuICAgICAgfVxuICAgICAgaG92ZXJUcmlnZ2Vycy5kZWxldGUodHJpZ2dlcik7XG4gICAgfVxuICB9O1xufVxuXG4vKipcbiAqIFJlZ2lzdGVycyBhIHZpZXdwb3J0IHRyaWdnZXIuXG4gKiBAcGFyYW0gdHJpZ2dlciBFbGVtZW50IHRoYXQgaXMgdGhlIHRyaWdnZXIuXG4gKiBAcGFyYW0gY2FsbGJhY2sgQ2FsbGJhY2sgdG8gYmUgaW52b2tlZCB3aGVuIHRoZSB0cmlnZ2VyIGNvbWVzIGludG8gdGhlIHZpZXdwb3J0LlxuICogQHBhcmFtIGluamVjdG9yIEluamVjdG9yIHRoYXQgY2FuIGJlIHVzZWQgYnkgdGhlIHRyaWdnZXIgdG8gcmVzb2x2ZSBESSB0b2tlbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvblZpZXdwb3J0KFxuICAgIHRyaWdnZXI6IEVsZW1lbnQsIGNhbGxiYWNrOiBWb2lkRnVuY3Rpb24sIGluamVjdG9yOiBJbmplY3Rvcik6IFZvaWRGdW5jdGlvbiB7XG4gIGNvbnN0IG5nWm9uZSA9IGluamVjdG9yLmdldChOZ1pvbmUpO1xuICBsZXQgZW50cnkgPSB2aWV3cG9ydFRyaWdnZXJzLmdldCh0cmlnZ2VyKTtcblxuICBpbnRlcnNlY3Rpb25PYnNlcnZlciA9IGludGVyc2VjdGlvbk9ic2VydmVyIHx8IG5nWm9uZS5ydW5PdXRzaWRlQW5ndWxhcigoKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBJbnRlcnNlY3Rpb25PYnNlcnZlcihlbnRyaWVzID0+IHtcbiAgICAgIGZvciAoY29uc3QgY3VycmVudCBvZiBlbnRyaWVzKSB7XG4gICAgICAgIC8vIE9ubHkgaW52b2tlIHRoZSBjYWxsYmFja3MgaWYgdGhlIHNwZWNpZmljIGVsZW1lbnQgaXMgaW50ZXJzZWN0aW5nLlxuICAgICAgICBpZiAoY3VycmVudC5pc0ludGVyc2VjdGluZyAmJiB2aWV3cG9ydFRyaWdnZXJzLmhhcyhjdXJyZW50LnRhcmdldCkpIHtcbiAgICAgICAgICBuZ1pvbmUucnVuKHZpZXdwb3J0VHJpZ2dlcnMuZ2V0KGN1cnJlbnQudGFyZ2V0KSEubGlzdGVuZXIpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuXG4gIGlmICghZW50cnkpIHtcbiAgICBlbnRyeSA9IG5ldyBEZWZlckV2ZW50RW50cnkoKTtcbiAgICBuZ1pvbmUucnVuT3V0c2lkZUFuZ3VsYXIoKCkgPT4gaW50ZXJzZWN0aW9uT2JzZXJ2ZXIhLm9ic2VydmUodHJpZ2dlcikpO1xuICAgIHZpZXdwb3J0VHJpZ2dlcnMuc2V0KHRyaWdnZXIsIGVudHJ5KTtcbiAgICBvYnNlcnZlZFZpZXdwb3J0RWxlbWVudHMrKztcbiAgfVxuXG4gIGVudHJ5LmNhbGxiYWNrcy5hZGQoY2FsbGJhY2spO1xuXG4gIHJldHVybiAoKSA9PiB7XG4gICAgLy8gSXQncyBwb3NzaWJsZSB0aGF0IGEgZGlmZmVyZW50IGNsZWFudXAgY2FsbGJhY2sgZnVsbHkgcmVtb3ZlZCB0aGlzIGVsZW1lbnQgYWxyZWFkeS5cbiAgICBpZiAoIXZpZXdwb3J0VHJpZ2dlcnMuaGFzKHRyaWdnZXIpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZW50cnkhLmNhbGxiYWNrcy5kZWxldGUoY2FsbGJhY2spO1xuXG4gICAgaWYgKGVudHJ5IS5jYWxsYmFja3Muc2l6ZSA9PT0gMCkge1xuICAgICAgaW50ZXJzZWN0aW9uT2JzZXJ2ZXI/LnVub2JzZXJ2ZSh0cmlnZ2VyKTtcbiAgICAgIHZpZXdwb3J0VHJpZ2dlcnMuZGVsZXRlKHRyaWdnZXIpO1xuICAgICAgb2JzZXJ2ZWRWaWV3cG9ydEVsZW1lbnRzLS07XG4gICAgfVxuXG4gICAgaWYgKG9ic2VydmVkVmlld3BvcnRFbGVtZW50cyA9PT0gMCkge1xuICAgICAgaW50ZXJzZWN0aW9uT2JzZXJ2ZXI/LmRpc2Nvbm5lY3QoKTtcbiAgICAgIGludGVyc2VjdGlvbk9ic2VydmVyID0gbnVsbDtcbiAgICB9XG4gIH07XG59XG5cbi8qKlxuICogSGVscGVyIGZ1bmN0aW9uIHRvIGdldCB0aGUgTFZpZXcgaW4gd2hpY2ggYSBkZWZlcnJlZCBibG9jaydzIHRyaWdnZXIgaXMgcmVuZGVyZWQuXG4gKiBAcGFyYW0gZGVmZXJyZWRIb3N0TFZpZXcgTFZpZXcgaW4gd2hpY2ggdGhlIGRlZmVycmVkIGJsb2NrIGlzIGRlZmluZWQuXG4gKiBAcGFyYW0gZGVmZXJyZWRUTm9kZSBUTm9kZSBkZWZpbmluZyB0aGUgZGVmZXJyZWQgYmxvY2suXG4gKiBAcGFyYW0gd2Fsa1VwVGltZXMgTnVtYmVyIG9mIHRpbWVzIHRvIGdvIHVwIGluIHRoZSB2aWV3IGhpZXJhcmNoeSB0byBmaW5kIHRoZSB0cmlnZ2VyJ3Mgdmlldy5cbiAqICAgQSBuZWdhdGl2ZSB2YWx1ZSBtZWFucyB0aGF0IHRoZSB0cmlnZ2VyIGlzIGluc2lkZSB0aGUgYmxvY2sncyBwbGFjZWhvbGRlciwgd2hpbGUgYW4gdW5kZWZpbmVkXG4gKiAgIHZhbHVlIG1lYW5zIHRoYXQgdGhlIHRyaWdnZXIgaXMgaW4gdGhlIHNhbWUgTFZpZXcgYXMgdGhlIGRlZmVycmVkIGJsb2NrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0VHJpZ2dlckxWaWV3KFxuICAgIGRlZmVycmVkSG9zdExWaWV3OiBMVmlldywgZGVmZXJyZWRUTm9kZTogVE5vZGUsIHdhbGtVcFRpbWVzOiBudW1iZXJ8dW5kZWZpbmVkKTogTFZpZXd8bnVsbCB7XG4gIC8vIFRoZSB0cmlnZ2VyIGlzIGluIHRoZSBzYW1lIHZpZXcsIHdlIGRvbid0IG5lZWQgdG8gdHJhdmVyc2UuXG4gIGlmICh3YWxrVXBUaW1lcyA9PSBudWxsKSB7XG4gICAgcmV0dXJuIGRlZmVycmVkSG9zdExWaWV3O1xuICB9XG5cbiAgLy8gQSBwb3NpdGl2ZSB2YWx1ZSBvciB6ZXJvIG1lYW5zIHRoYXQgdGhlIHRyaWdnZXIgaXMgaW4gYSBwYXJlbnQgdmlldy5cbiAgaWYgKHdhbGtVcFRpbWVzID49IDApIHtcbiAgICByZXR1cm4gd2Fsa1VwVmlld3Mod2Fsa1VwVGltZXMsIGRlZmVycmVkSG9zdExWaWV3KTtcbiAgfVxuXG4gIC8vIElmIHRoZSB2YWx1ZSBpcyBuZWdhdGl2ZSwgaXQgbWVhbnMgdGhhdCB0aGUgdHJpZ2dlciBpcyBpbnNpZGUgdGhlIHBsYWNlaG9sZGVyLlxuICBjb25zdCBkZWZlcnJlZENvbnRhaW5lciA9IGRlZmVycmVkSG9zdExWaWV3W2RlZmVycmVkVE5vZGUuaW5kZXhdO1xuICBuZ0Rldk1vZGUgJiYgYXNzZXJ0TENvbnRhaW5lcihkZWZlcnJlZENvbnRhaW5lcik7XG4gIGNvbnN0IHRyaWdnZXJMVmlldyA9IGRlZmVycmVkQ29udGFpbmVyW0NPTlRBSU5FUl9IRUFERVJfT0ZGU0VUXSA/PyBudWxsO1xuXG4gIC8vIFdlIG5lZWQgdG8gbnVsbCBjaGVjaywgYmVjYXVzZSB0aGUgcGxhY2Vob2xkZXIgbWlnaHQgbm90IGhhdmUgYmVlbiByZW5kZXJlZCB5ZXQuXG4gIGlmIChuZ0Rldk1vZGUgJiYgdHJpZ2dlckxWaWV3ICE9PSBudWxsKSB7XG4gICAgY29uc3QgbERldGFpbHMgPSBnZXRMRGVmZXJCbG9ja0RldGFpbHMoZGVmZXJyZWRIb3N0TFZpZXcsIGRlZmVycmVkVE5vZGUpO1xuICAgIGNvbnN0IHJlbmRlcmVkU3RhdGUgPSBsRGV0YWlsc1tERUZFUl9CTE9DS19TVEFURV07XG4gICAgYXNzZXJ0RXF1YWwoXG4gICAgICAgIHJlbmRlcmVkU3RhdGUsIERlZmVyQmxvY2tTdGF0ZS5QbGFjZWhvbGRlcixcbiAgICAgICAgJ0V4cGVjdGVkIGEgcGxhY2Vob2xkZXIgdG8gYmUgcmVuZGVyZWQgaW4gdGhpcyBkZWZlciBibG9jay4nKTtcbiAgICBhc3NlcnRMVmlldyh0cmlnZ2VyTFZpZXcpO1xuICB9XG5cbiAgcmV0dXJuIHRyaWdnZXJMVmlldztcbn1cblxuLyoqXG4gKiBHZXRzIHRoZSBlbGVtZW50IHRoYXQgYSBkZWZlcnJlZCBibG9jaydzIHRyaWdnZXIgaXMgcG9pbnRpbmcgdG8uXG4gKiBAcGFyYW0gdHJpZ2dlckxWaWV3IExWaWV3IGluIHdoaWNoIHRoZSB0cmlnZ2VyIGlzIGRlZmluZWQuXG4gKiBAcGFyYW0gdHJpZ2dlckluZGV4IEluZGV4IGF0IHdoaWNoIHRoZSB0cmlnZ2VyIGVsZW1lbnQgc2hvdWxkJ3ZlIGJlZW4gcmVuZGVyZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRUcmlnZ2VyRWxlbWVudCh0cmlnZ2VyTFZpZXc6IExWaWV3LCB0cmlnZ2VySW5kZXg6IG51bWJlcik6IEVsZW1lbnQge1xuICBjb25zdCBlbGVtZW50ID0gZ2V0TmF0aXZlQnlJbmRleChIRUFERVJfT0ZGU0VUICsgdHJpZ2dlckluZGV4LCB0cmlnZ2VyTFZpZXcpO1xuICBuZ0Rldk1vZGUgJiYgYXNzZXJ0RWxlbWVudChlbGVtZW50KTtcbiAgcmV0dXJuIGVsZW1lbnQgYXMgRWxlbWVudDtcbn1cblxuLyoqXG4gKiBSZWdpc3RlcnMgYSBET00tbm9kZSBiYXNlZCB0cmlnZ2VyLlxuICogQHBhcmFtIGluaXRpYWxMVmlldyBMVmlldyBpbiB3aGljaCB0aGUgZGVmZXIgYmxvY2sgaXMgcmVuZGVyZWQuXG4gKiBAcGFyYW0gdE5vZGUgVE5vZGUgcmVwcmVzZW50aW5nIHRoZSBkZWZlciBibG9jay5cbiAqIEBwYXJhbSB0cmlnZ2VySW5kZXggSW5kZXggYXQgd2hpY2ggdG8gZmluZCB0aGUgdHJpZ2dlciBlbGVtZW50LlxuICogQHBhcmFtIHdhbGtVcFRpbWVzIE51bWJlciBvZiB0aW1lcyB0byBnbyB1cC9kb3duIGluIHRoZSB2aWV3IGhpZXJhcmNoeSB0byBmaW5kIHRoZSB0cmlnZ2VyLlxuICogQHBhcmFtIHJlZ2lzdGVyRm4gRnVuY3Rpb24gdGhhdCB3aWxsIHJlZ2lzdGVyIHRoZSBET00gZXZlbnRzLlxuICogQHBhcmFtIGNhbGxiYWNrIENhbGxiYWNrIHRvIGJlIGludm9rZWQgd2hlbiB0aGUgdHJpZ2dlciByZWNlaXZlcyB0aGUgZXZlbnQgdGhhdCBzaG91bGQgcmVuZGVyXG4gKiAgICAgdGhlIGRlZmVycmVkIGJsb2NrLlxuICogQHBhcmFtIHR5cGUgVHJpZ2dlciB0eXBlIHRvIGRpc3Rpbmd1aXNoIGJldHdlZW4gcmVndWxhciBhbmQgcHJlZmV0Y2ggdHJpZ2dlcnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckRvbVRyaWdnZXIoXG4gICAgaW5pdGlhbExWaWV3OiBMVmlldywgdE5vZGU6IFROb2RlLCB0cmlnZ2VySW5kZXg6IG51bWJlciwgd2Fsa1VwVGltZXM6IG51bWJlcnx1bmRlZmluZWQsXG4gICAgcmVnaXN0ZXJGbjogKGVsZW1lbnQ6IEVsZW1lbnQsIGNhbGxiYWNrOiBWb2lkRnVuY3Rpb24sIGluamVjdG9yOiBJbmplY3RvcikgPT4gVm9pZEZ1bmN0aW9uLFxuICAgIGNhbGxiYWNrOiBWb2lkRnVuY3Rpb24sIHR5cGU6IFRyaWdnZXJUeXBlKSB7XG4gIGNvbnN0IGluamVjdG9yID0gaW5pdGlhbExWaWV3W0lOSkVDVE9SXSE7XG4gIGZ1bmN0aW9uIHBvbGxEb21UcmlnZ2VyKCkge1xuICAgIC8vIElmIHRoZSBpbml0aWFsIHZpZXcgd2FzIGRlc3Ryb3llZCwgd2UgZG9uJ3QgbmVlZCB0byBkbyBhbnl0aGluZy5cbiAgICBpZiAoaXNEZXN0cm95ZWQoaW5pdGlhbExWaWV3KSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxEZXRhaWxzID0gZ2V0TERlZmVyQmxvY2tEZXRhaWxzKGluaXRpYWxMVmlldywgdE5vZGUpO1xuICAgIGNvbnN0IHJlbmRlcmVkU3RhdGUgPSBsRGV0YWlsc1tERUZFUl9CTE9DS19TVEFURV07XG5cbiAgICAvLyBJZiB0aGUgYmxvY2sgd2FzIGxvYWRlZCBiZWZvcmUgdGhlIHRyaWdnZXIgd2FzIHJlc29sdmVkLCB3ZSBkb24ndCBuZWVkIHRvIGRvIGFueXRoaW5nLlxuICAgIGlmIChyZW5kZXJlZFN0YXRlICE9PSBEZWZlckJsb2NrSW50ZXJuYWxTdGF0ZS5Jbml0aWFsICYmXG4gICAgICAgIHJlbmRlcmVkU3RhdGUgIT09IERlZmVyQmxvY2tTdGF0ZS5QbGFjZWhvbGRlcikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRyaWdnZXJMVmlldyA9IGdldFRyaWdnZXJMVmlldyhpbml0aWFsTFZpZXcsIHROb2RlLCB3YWxrVXBUaW1lcyk7XG5cbiAgICAvLyBLZWVwIHBvbGxpbmcgdW50aWwgd2UgcmVzb2x2ZSB0aGUgdHJpZ2dlcidzIExWaWV3LlxuICAgIGlmICghdHJpZ2dlckxWaWV3KSB7XG4gICAgICBpbnRlcm5hbEFmdGVyTmV4dFJlbmRlcihwb2xsRG9tVHJpZ2dlciwge2luamVjdG9yfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gSXQncyBwb3NzaWJsZSB0aGF0IHRoZSB0cmlnZ2VyJ3MgdmlldyB3YXMgZGVzdHJveWVkIGJlZm9yZSB3ZSByZXNvbHZlZCB0aGUgdHJpZ2dlciBlbGVtZW50LlxuICAgIGlmIChpc0Rlc3Ryb3llZCh0cmlnZ2VyTFZpZXcpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZWxlbWVudCA9IGdldFRyaWdnZXJFbGVtZW50KHRyaWdnZXJMVmlldywgdHJpZ2dlckluZGV4KTtcbiAgICBjb25zdCBjbGVhbnVwID0gcmVnaXN0ZXJGbihlbGVtZW50LCAoKSA9PiB7XG4gICAgICBpZiAoaW5pdGlhbExWaWV3ICE9PSB0cmlnZ2VyTFZpZXcpIHtcbiAgICAgICAgcmVtb3ZlTFZpZXdPbkRlc3Ryb3kodHJpZ2dlckxWaWV3LCBjbGVhbnVwKTtcbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSwgaW5qZWN0b3IpO1xuXG4gICAgLy8gVGhlIHRyaWdnZXIgYW5kIGRlZmVycmVkIGJsb2NrIG1pZ2h0IGJlIGluIGRpZmZlcmVudCBMVmlld3MuXG4gICAgLy8gRm9yIHRoZSBtYWluIExWaWV3IHRoZSBjbGVhbnVwIHdvdWxkIGhhcHBlbiBhcyBhIHBhcnQgb2ZcbiAgICAvLyBgc3RvcmVUcmlnZ2VyQ2xlYW51cEZuYCBsb2dpYy4gRm9yIHRyaWdnZXIgTFZpZXcgd2UgcmVnaXN0ZXJcbiAgICAvLyBhIGNsZWFudXAgZnVuY3Rpb24gdGhlcmUgdG8gcmVtb3ZlIGV2ZW50IGhhbmRsZXJzIGluIGNhc2UgYW5cbiAgICAvLyBMVmlldyBnZXRzIGRlc3Ryb3llZCBiZWZvcmUgYSB0cmlnZ2VyIGlzIGludm9rZWQuXG4gICAgaWYgKGluaXRpYWxMVmlldyAhPT0gdHJpZ2dlckxWaWV3KSB7XG4gICAgICBzdG9yZUxWaWV3T25EZXN0cm95KHRyaWdnZXJMVmlldywgY2xlYW51cCk7XG4gICAgfVxuXG4gICAgc3RvcmVUcmlnZ2VyQ2xlYW51cEZuKHR5cGUsIGxEZXRhaWxzLCBjbGVhbnVwKTtcbiAgfVxuXG4gIC8vIEJlZ2luIHBvbGxpbmcgZm9yIHRoZSB0cmlnZ2VyLlxuICBpbnRlcm5hbEFmdGVyTmV4dFJlbmRlcihwb2xsRG9tVHJpZ2dlciwge2luamVjdG9yfSk7XG59XG4iXX0=