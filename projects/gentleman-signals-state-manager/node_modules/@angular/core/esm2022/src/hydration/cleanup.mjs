/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { CONTAINER_HEADER_OFFSET, DEHYDRATED_VIEWS } from '../render3/interfaces/container';
import { isLContainer, isLView } from '../render3/interfaces/type_checks';
import { HEADER_OFFSET, HOST, PARENT, RENDERER, TVIEW } from '../render3/interfaces/view';
import { nativeRemoveNode } from '../render3/node_manipulation';
import { EMPTY_ARRAY } from '../util/empty';
import { validateSiblingNodeExists } from './error_handling';
import { NUM_ROOT_NODES } from './interfaces';
import { getLNodeForHydration } from './utils';
/**
 * Removes all dehydrated views from a given LContainer:
 * both in internal data structure, as well as removing
 * corresponding DOM nodes that belong to that dehydrated view.
 */
export function removeDehydratedViews(lContainer) {
    const views = lContainer[DEHYDRATED_VIEWS] ?? [];
    const parentLView = lContainer[PARENT];
    const renderer = parentLView[RENDERER];
    for (const view of views) {
        removeDehydratedView(view, renderer);
        ngDevMode && ngDevMode.dehydratedViewsRemoved++;
    }
    // Reset the value to an empty array to indicate that no
    // further processing of dehydrated views is needed for
    // this view container (i.e. do not trigger the lookup process
    // once again in case a `ViewContainerRef` is created later).
    lContainer[DEHYDRATED_VIEWS] = EMPTY_ARRAY;
}
/**
 * Helper function to remove all nodes from a dehydrated view.
 */
function removeDehydratedView(dehydratedView, renderer) {
    let nodesRemoved = 0;
    let currentRNode = dehydratedView.firstChild;
    if (currentRNode) {
        const numNodes = dehydratedView.data[NUM_ROOT_NODES];
        while (nodesRemoved < numNodes) {
            ngDevMode && validateSiblingNodeExists(currentRNode);
            const nextSibling = currentRNode.nextSibling;
            nativeRemoveNode(renderer, currentRNode, false);
            currentRNode = nextSibling;
            nodesRemoved++;
        }
    }
}
/**
 * Walks over all views within this LContainer invokes dehydrated views
 * cleanup function for each one.
 */
function cleanupLContainer(lContainer) {
    removeDehydratedViews(lContainer);
    for (let i = CONTAINER_HEADER_OFFSET; i < lContainer.length; i++) {
        cleanupLView(lContainer[i]);
    }
}
/**
 * Walks over `LContainer`s and components registered within
 * this LView and invokes dehydrated views cleanup function for each one.
 */
function cleanupLView(lView) {
    const tView = lView[TVIEW];
    for (let i = HEADER_OFFSET; i < tView.bindingStartIndex; i++) {
        if (isLContainer(lView[i])) {
            const lContainer = lView[i];
            cleanupLContainer(lContainer);
        }
        else if (isLView(lView[i])) {
            // This is a component, enter the `cleanupLView` recursively.
            cleanupLView(lView[i]);
        }
    }
}
/**
 * Walks over all views registered within the ApplicationRef and removes
 * all dehydrated views from all `LContainer`s along the way.
 */
export function cleanupDehydratedViews(appRef) {
    const viewRefs = appRef._views;
    for (const viewRef of viewRefs) {
        const lNode = getLNodeForHydration(viewRef);
        // An `lView` might be `null` if a `ViewRef` represents
        // an embedded view (not a component view).
        if (lNode !== null && lNode[HOST] !== null) {
            if (isLView(lNode)) {
                cleanupLView(lNode);
            }
            else {
                // Cleanup in the root component view
                const componentLView = lNode[HOST];
                cleanupLView(componentLView);
                // Cleanup in all views within this view container
                cleanupLContainer(lNode);
            }
            ngDevMode && ngDevMode.dehydratedViewsCleanupRuns++;
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xlYW51cC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2NvcmUvc3JjL2h5ZHJhdGlvbi9jbGVhbnVwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUdILE9BQU8sRUFBQyx1QkFBdUIsRUFBRSxnQkFBZ0IsRUFBYSxNQUFNLGlDQUFpQyxDQUFDO0FBR3RHLE9BQU8sRUFBQyxZQUFZLEVBQUUsT0FBTyxFQUFDLE1BQU0sbUNBQW1DLENBQUM7QUFDeEUsT0FBTyxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQVMsTUFBTSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUMsTUFBTSw0QkFBNEIsQ0FBQztBQUMvRixPQUFPLEVBQUMsZ0JBQWdCLEVBQUMsTUFBTSw4QkFBOEIsQ0FBQztBQUM5RCxPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sZUFBZSxDQUFDO0FBRTFDLE9BQU8sRUFBQyx5QkFBeUIsRUFBQyxNQUFNLGtCQUFrQixDQUFDO0FBQzNELE9BQU8sRUFBMEIsY0FBYyxFQUFDLE1BQU0sY0FBYyxDQUFDO0FBQ3JFLE9BQU8sRUFBQyxvQkFBb0IsRUFBQyxNQUFNLFNBQVMsQ0FBQztBQUU3Qzs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLHFCQUFxQixDQUFDLFVBQXNCO0lBQzFELE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUNqRCxNQUFNLFdBQVcsR0FBRyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDdkMsTUFBTSxRQUFRLEdBQUcsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3ZDLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFO1FBQ3hCLG9CQUFvQixDQUFDLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztRQUNyQyxTQUFTLElBQUksU0FBUyxDQUFDLHNCQUFzQixFQUFFLENBQUM7S0FDakQ7SUFDRCx3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bCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQge0FwcGxpY2F0aW9uUmVmfSBmcm9tICcuLi9hcHBsaWNhdGlvbl9yZWYnO1xuaW1wb3J0IHtDT05UQUlORVJfSEVBREVSX09GRlNFVCwgREVIWURSQVRFRF9WSUVXUywgTENvbnRhaW5lcn0gZnJvbSAnLi4vcmVuZGVyMy9pbnRlcmZhY2VzL2NvbnRhaW5lcic7XG5pbXBvcnQge1JlbmRlcmVyfSBmcm9tICcuLi9yZW5kZXIzL2ludGVyZmFjZXMvcmVuZGVyZXInO1xuaW1wb3J0IHtSTm9kZX0gZnJvbSAnLi4vcmVuZGVyMy9pbnRlcmZhY2VzL3JlbmRlcmVyX2RvbSc7XG5pbXBvcnQge2lzTENvbnRhaW5lciwgaXNMVmlld30gZnJvbSAnLi4vcmVuZGVyMy9pbnRlcmZhY2VzL3R5cGVfY2hlY2tzJztcbmltcG9ydCB7SEVBREVSX09GRlNFVCwgSE9TVCwgTFZpZXcsIFBBUkVOVCwgUkVOREVSRVIsIFRWSUVXfSBmcm9tICcuLi9yZW5kZXIzL2ludGVyZmFjZXMvdmlldyc7XG5pbXBvcnQge25hdGl2ZVJlbW92ZU5vZGV9IGZyb20gJy4uL3JlbmRlcjMvbm9kZV9tYW5pcHVsYXRpb24nO1xuaW1wb3J0IHtFTVBUWV9BUlJBWX0gZnJvbSAnLi4vdXRpbC9lbXB0eSc7XG5cbmltcG9ydCB7dmFsaWRhdGVTaWJsaW5nTm9kZUV4aXN0c30gZnJvbSAnLi9lcnJvcl9oYW5kbGluZyc7XG5pbXBvcnQge0RlaHlkcmF0ZWRDb250YWluZXJWaWV3LCBOVU1fUk9PVF9OT0RFU30gZnJvbSAnLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7Z2V0TE5vZGVGb3JIeWRyYXRpb259IGZyb20gJy4vdXRpbHMnO1xuXG4vKipcbiAqIFJlbW92ZXMgYWxsIGRlaHlkcmF0ZWQgdmlld3MgZnJvbSBhIGdpdmVuIExDb250YWluZXI6XG4gKiBib3RoIGluIGludGVybmFsIGRhdGEgc3RydWN0dXJlLCBhcyB3ZWxsIGFzIHJlbW92aW5nXG4gKiBjb3JyZXNwb25kaW5nIERPTSBub2RlcyB0aGF0IGJlbG9uZyB0byB0aGF0IGRlaHlkcmF0ZWQgdmlldy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZURlaHlkcmF0ZWRWaWV3cyhsQ29udGFpbmVyOiBMQ29udGFpbmVyKSB7XG4gIGNvbnN0IHZpZXdzID0gbENvbnRhaW5lcltERUhZRFJBVEVEX1ZJRVdTXSA/PyBbXTtcbiAgY29uc3QgcGFyZW50TFZpZXcgPSBsQ29udGFpbmVyW1BBUkVOVF07XG4gIGNvbnN0IHJlbmRlcmVyID0gcGFyZW50TFZpZXdbUkVOREVSRVJdO1xuICBmb3IgKGNvbnN0IHZpZXcgb2Ygdmlld3MpIHtcbiAgICByZW1vdmVEZWh5ZHJhdGVkVmlldyh2aWV3LCByZW5kZXJlcik7XG4gICAgbmdEZXZNb2RlICYmIG5nRGV2TW9kZS5kZWh5ZHJhdGVkVmlld3NSZW1vdmVkKys7XG4gIH1cbiAgLy8gUmVzZXQgdGhlIHZhbHVlIHRvIGFuIGVtcHR5IGFycmF5IHRvIGluZGljYXRlIHRoYXQgbm9cbiAgLy8gZnVydGhlciBwcm9jZXNzaW5nIG9mIGRlaHlkcmF0ZWQgdmlld3MgaXMgbmVlZGVkIGZvclxuICAvLyB0aGlzIHZpZXcgY29udGFpbmVyIChpLmUuIGRvIG5vdCB0cmlnZ2VyIHRoZSBsb29rdXAgcHJvY2Vzc1xuICAvLyBvbmNlIGFnYWluIGluIGNhc2UgYSBgVmlld0NvbnRhaW5lclJlZmAgaXMgY3JlYXRlZCBsYXRlcikuXG4gIGxDb250YWluZXJbREVIWURSQVRFRF9WSUVXU10gPSBFTVBUWV9BUlJBWTtcbn1cblxuLyoqXG4gKiBIZWxwZXIgZnVuY3Rpb24gdG8gcmVtb3ZlIGFsbCBub2RlcyBmcm9tIGEgZGVoeWRyYXRlZCB2aWV3LlxuICovXG5mdW5jdGlvbiByZW1vdmVEZWh5ZHJhdGVkVmlldyhkZWh5ZHJhdGVkVmlldzogRGVoeWRyYXRlZENvbnRhaW5lclZpZXcsIHJlbmRlcmVyOiBSZW5kZXJlcikge1xuICBsZXQgbm9kZXNSZW1vdmVkID0gMDtcbiAgbGV0IGN1cnJlbnRSTm9kZSA9IGRlaHlkcmF0ZWRWaWV3LmZpcnN0Q2hpbGQ7XG4gIGlmIChjdXJyZW50Uk5vZGUpIHtcbiAgICBjb25zdCBudW1Ob2RlcyA9IGRlaHlkcmF0ZWRWaWV3LmRhdGFbTlVNX1JPT1RfTk9ERVNdO1xuICAgIHdoaWxlIChub2Rlc1JlbW92ZWQgPCBudW1Ob2Rlcykge1xuICAgICAgbmdEZXZNb2RlICYmIHZhbGlkYXRlU2libGluZ05vZGVFeGlzdHMoY3VycmVudFJOb2RlKTtcbiAgICAgIGNvbnN0IG5leHRTaWJsaW5nOiBSTm9kZSA9IGN1cnJlbnRSTm9kZS5uZXh0U2libGluZyE7XG4gICAgICBuYXRpdmVSZW1vdmVOb2RlKHJlbmRlcmVyLCBjdXJyZW50Uk5vZGUsIGZhbHNlKTtcbiAgICAgIGN1cnJlbnRSTm9kZSA9IG5leHRTaWJsaW5nO1xuICAgICAgbm9kZXNSZW1vdmVkKys7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogV2Fsa3Mgb3ZlciBhbGwgdmlld3Mgd2l0aGluIHRoaXMgTENvbnRhaW5lciBpbnZva2VzIGRlaHlkcmF0ZWQgdmlld3NcbiAqIGNsZWFudXAgZnVuY3Rpb24gZm9yIGVhY2ggb25lLlxuICovXG5mdW5jdGlvbiBjbGVhbnVwTENvbnRhaW5lcihsQ29udGFpbmVyOiBMQ29udGFpbmVyKSB7XG4gIHJlbW92ZURlaHlkcmF0ZWRWaWV3cyhsQ29udGFpbmVyKTtcbiAgZm9yIChsZXQgaSA9IENPTlRBSU5FUl9IRUFERVJfT0ZGU0VUOyBpIDwgbENvbnRhaW5lci5sZW5ndGg7IGkrKykge1xuICAgIGNsZWFudXBMVmlldyhsQ29udGFpbmVyW2ldIGFzIExWaWV3KTtcbiAgfVxufVxuXG4vKipcbiAqIFdhbGtzIG92ZXIgYExDb250YWluZXJgcyBhbmQgY29tcG9uZW50cyByZWdpc3RlcmVkIHdpdGhpblxuICogdGhpcyBMVmlldyBhbmQgaW52b2tlcyBkZWh5ZHJhdGVkIHZpZXdzIGNsZWFudXAgZnVuY3Rpb24gZm9yIGVhY2ggb25lLlxuICovXG5mdW5jdGlvbiBjbGVhbnVwTFZpZXcobFZpZXc6IExWaWV3KSB7XG4gIGNvbnN0IHRWaWV3ID0gbFZpZXdbVFZJRVddO1xuICBmb3IgKGxldCBpID0gSEVBREVSX09GRlNFVDsgaSA8IHRWaWV3LmJpbmRpbmdTdGFydEluZGV4OyBpKyspIHtcbiAgICBpZiAoaXNMQ29udGFpbmVyKGxWaWV3W2ldKSkge1xuICAgICAgY29uc3QgbENvbnRhaW5lciA9IGxWaWV3W2ldO1xuICAgICAgY2xlYW51cExDb250YWluZXIobENvbnRhaW5lcik7XG4gICAgfSBlbHNlIGlmIChpc0xWaWV3KGxWaWV3W2ldKSkge1xuICAgICAgLy8gVGhpcyBpcyBhIGNvbXBvbmVudCwgZW50ZXIgdGhlIGBjbGVhbnVwTFZpZXdgIHJlY3Vyc2l2ZWx5LlxuICAgICAgY2xlYW51cExWaWV3KGxWaWV3W2ldKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBXYWxrcyBvdmVyIGFsbCB2aWV3cyByZWdpc3RlcmVkIHdpdGhpbiB0aGUgQXBwbGljYXRpb25SZWYgYW5kIHJlbW92ZXNcbiAqIGFsbCBkZWh5ZHJhdGVkIHZpZXdzIGZyb20gYWxsIGBMQ29udGFpbmVyYHMgYWxvbmcgdGhlIHdheS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFudXBEZWh5ZHJhdGVkVmlld3MoYXBwUmVmOiBBcHBsaWNhdGlvblJlZikge1xuICBjb25zdCB2aWV3UmVmcyA9IGFwcFJlZi5fdmlld3M7XG4gIGZvciAoY29uc3Qgdmlld1JlZiBvZiB2aWV3UmVmcykge1xuICAgIGNvbnN0IGxOb2RlID0gZ2V0TE5vZGVGb3JIeWRyYXRpb24odmlld1JlZik7XG4gICAgLy8gQW4gYGxWaWV3YCBtaWdodCBiZSBgbnVsbGAgaWYgYSBgVmlld1JlZmAgcmVwcmVzZW50c1xuICAgIC8vIGFuIGVtYmVkZGVkIHZpZXcgKG5vdCBhIGNvbXBvbmVudCB2aWV3KS5cbiAgICBpZiAobE5vZGUgIT09IG51bGwgJiYgbE5vZGVbSE9TVF0gIT09IG51bGwpIHtcbiAgICAgIGlmIChpc0xWaWV3KGxOb2RlKSkge1xuICAgICAgICBjbGVhbnVwTFZpZXcobE5vZGUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ2xlYW51cCBpbiB0aGUgcm9vdCBjb21wb25lbnQgdmlld1xuICAgICAgICBjb25zdCBjb21wb25lbnRMVmlldyA9IGxOb2RlW0hPU1RdIGFzIExWaWV3PHVua25vd24+O1xuICAgICAgICBjbGVhbnVwTFZpZXcoY29tcG9uZW50TFZpZXcpO1xuXG4gICAgICAgIC8vIENsZWFudXAgaW4gYWxsIHZpZXdzIHdpdGhpbiB0aGlzIHZpZXcgY29udGFpbmVyXG4gICAgICAgIGNsZWFudXBMQ29udGFpbmVyKGxOb2RlKTtcbiAgICAgIH1cbiAgICAgIG5nRGV2TW9kZSAmJiBuZ0Rldk1vZGUuZGVoeWRyYXRlZFZpZXdzQ2xlYW51cFJ1bnMrKztcbiAgICB9XG4gIH1cbn1cbiJdfQ==