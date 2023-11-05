/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { consumerAfterComputation, consumerBeforeComputation, consumerPollProducersForChange } from '@angular/core/primitives/signals';
import { RuntimeError } from '../../errors';
import { assertDefined, assertEqual } from '../../util/assert';
import { assertLContainer } from '../assert';
import { getComponentViewByInstance } from '../context_discovery';
import { executeCheckHooks, executeInitAndCheckHooks, incrementInitPhaseFlags } from '../hooks';
import { CONTAINER_HEADER_OFFSET, HAS_CHILD_VIEWS_TO_REFRESH, HAS_TRANSPLANTED_VIEWS, MOVED_VIEWS } from '../interfaces/container';
import { CONTEXT, EFFECTS_TO_SCHEDULE, ENVIRONMENT, FLAGS, PARENT, REACTIVE_TEMPLATE_CONSUMER, TVIEW } from '../interfaces/view';
import { getOrBorrowReactiveLViewConsumer, maybeReturnReactiveLViewConsumer } from '../reactive_lview_consumer';
import { enterView, isInCheckNoChangesMode, leaveView, setBindingIndex, setIsInCheckNoChangesMode } from '../state';
import { getFirstLContainer, getNextLContainer } from '../util/view_traversal_utils';
import { getComponentLViewByIndex, isCreationMode, markAncestorsForTraversal, markViewForRefresh, resetPreOrderHookFlags, viewAttachedToChangeDetector } from '../util/view_utils';
import { RUN_IN_CHECK_NO_CHANGES_ANYWAY } from './change_detection_flags';
import { executeTemplate, executeViewQueryFn, handleError, processHostBindingOpCodes, refreshContentQueries } from './shared';
/**
 * The maximum number of times the change detection traversal will rerun before throwing an error.
 */
const MAXIMUM_REFRESH_RERUNS = 100;
export function detectChangesInternal(tView, lView, context, notifyErrorHandler = true) {
    const environment = lView[ENVIRONMENT];
    const rendererFactory = environment.rendererFactory;
    const afterRenderEventManager = environment.afterRenderEventManager;
    // Check no changes mode is a dev only mode used to verify that bindings have not changed
    // since they were assigned. We do not want to invoke renderer factory functions in that mode
    // to avoid any possible side-effects.
    const checkNoChangesMode = !!ngDevMode && isInCheckNoChangesMode();
    if (!checkNoChangesMode) {
        rendererFactory.begin?.();
        afterRenderEventManager?.begin();
    }
    try {
        refreshView(tView, lView, tView.template, context);
        let retries = 0;
        // If after running change detection, this view still needs to be refreshed or there are
        // descendants views that need to be refreshed due to re-dirtying during the change detection
        // run, detect changes on the view again. We run change detection in `Targeted` mode to only
        // refresh views with the `RefreshView` flag.
        while (lView[FLAGS] & (1024 /* LViewFlags.RefreshView */ | 8192 /* LViewFlags.HasChildViewsToRefresh */) ||
            lView[REACTIVE_TEMPLATE_CONSUMER]?.dirty) {
            if (retries === MAXIMUM_REFRESH_RERUNS) {
                throw new RuntimeError(103 /* RuntimeErrorCode.INFINITE_CHANGE_DETECTION */, ngDevMode &&
                    'Infinite change detection while trying to refresh views. ' +
                        'There may be components which each cause the other to require a refresh, ' +
                        'causing an infinite loop.');
            }
            retries++;
            // Even if this view is detached, we still detect changes in targeted mode because this was
            // the root of the change detection run.
            detectChangesInView(lView, 1 /* ChangeDetectionMode.Targeted */);
        }
    }
    catch (error) {
        if (notifyErrorHandler) {
            handleError(lView, error);
        }
        throw error;
    }
    finally {
        if (!checkNoChangesMode) {
            rendererFactory.end?.();
            // One final flush of the effects queue to catch any effects created in `ngAfterViewInit` or
            // other post-order hooks.
            environment.inlineEffectRunner?.flush();
            // Invoke all callbacks registered via `after*Render`, if needed.
            afterRenderEventManager?.end();
        }
    }
}
export function checkNoChangesInternal(tView, lView, context, notifyErrorHandler = true) {
    setIsInCheckNoChangesMode(true);
    try {
        detectChangesInternal(tView, lView, context, notifyErrorHandler);
    }
    finally {
        setIsInCheckNoChangesMode(false);
    }
}
/**
 * Synchronously perform change detection on a component (and possibly its sub-components).
 *
 * This function triggers change detection in a synchronous way on a component.
 *
 * @param component The component which the change detection should be performed on.
 */
export function detectChanges(component) {
    const view = getComponentViewByInstance(component);
    detectChangesInternal(view[TVIEW], view, component);
}
/**
 * Processes a view in update mode. This includes a number of steps in a specific order:
 * - executing a template function in update mode;
 * - executing hooks;
 * - refreshing queries;
 * - setting host bindings;
 * - refreshing child (embedded and component) views.
 */
export function refreshView(tView, lView, templateFn, context) {
    ngDevMode && assertEqual(isCreationMode(lView), false, 'Should be run in update mode');
    const flags = lView[FLAGS];
    if ((flags & 256 /* LViewFlags.Destroyed */) === 256 /* LViewFlags.Destroyed */)
        return;
    // Check no changes mode is a dev only mode used to verify that bindings have not changed
    // since they were assigned. We do not want to execute lifecycle hooks in that mode.
    const isInCheckNoChangesPass = ngDevMode && isInCheckNoChangesMode();
    !isInCheckNoChangesPass && lView[ENVIRONMENT].inlineEffectRunner?.flush();
    // Start component reactive context
    // - We might already be in a reactive context if this is an embedded view of the host.
    // - We might be descending into a view that needs a consumer.
    enterView(lView);
    let prevConsumer = null;
    let currentConsumer = null;
    if (!isInCheckNoChangesPass && viewShouldHaveReactiveConsumer(tView)) {
        currentConsumer = getOrBorrowReactiveLViewConsumer(lView);
        prevConsumer = consumerBeforeComputation(currentConsumer);
    }
    try {
        resetPreOrderHookFlags(lView);
        setBindingIndex(tView.bindingStartIndex);
        if (templateFn !== null) {
            executeTemplate(tView, lView, templateFn, 2 /* RenderFlags.Update */, context);
        }
        const hooksInitPhaseCompleted = (flags & 3 /* LViewFlags.InitPhaseStateMask */) === 3 /* InitPhaseState.InitPhaseCompleted */;
        // execute pre-order hooks (OnInit, OnChanges, DoCheck)
        // PERF WARNING: do NOT extract this to a separate function without running benchmarks
        if (!isInCheckNoChangesPass) {
            if (hooksInitPhaseCompleted) {
                const preOrderCheckHooks = tView.preOrderCheckHooks;
                if (preOrderCheckHooks !== null) {
                    executeCheckHooks(lView, preOrderCheckHooks, null);
                }
            }
            else {
                const preOrderHooks = tView.preOrderHooks;
                if (preOrderHooks !== null) {
                    executeInitAndCheckHooks(lView, preOrderHooks, 0 /* InitPhaseState.OnInitHooksToBeRun */, null);
                }
                incrementInitPhaseFlags(lView, 0 /* InitPhaseState.OnInitHooksToBeRun */);
            }
        }
        // First mark transplanted views that are declared in this lView as needing a refresh at their
        // insertion points. This is needed to avoid the situation where the template is defined in this
        // `LView` but its declaration appears after the insertion component.
        markTransplantedViewsForRefresh(lView);
        detectChangesInEmbeddedViews(lView, 0 /* ChangeDetectionMode.Global */);
        // Content query results must be refreshed before content hooks are called.
        if (tView.contentQueries !== null) {
            refreshContentQueries(tView, lView);
        }
        // execute content hooks (AfterContentInit, AfterContentChecked)
        // PERF WARNING: do NOT extract this to a separate function without running benchmarks
        if (!isInCheckNoChangesPass) {
            if (hooksInitPhaseCompleted) {
                const contentCheckHooks = tView.contentCheckHooks;
                if (contentCheckHooks !== null) {
                    executeCheckHooks(lView, contentCheckHooks);
                }
            }
            else {
                const contentHooks = tView.contentHooks;
                if (contentHooks !== null) {
                    executeInitAndCheckHooks(lView, contentHooks, 1 /* InitPhaseState.AfterContentInitHooksToBeRun */);
                }
                incrementInitPhaseFlags(lView, 1 /* InitPhaseState.AfterContentInitHooksToBeRun */);
            }
        }
        processHostBindingOpCodes(tView, lView);
        // Refresh child component views.
        const components = tView.components;
        if (components !== null) {
            detectChangesInChildComponents(lView, components, 0 /* ChangeDetectionMode.Global */);
        }
        // View queries must execute after refreshing child components because a template in this view
        // could be inserted in a child component. If the view query executes before child component
        // refresh, the template might not yet be inserted.
        const viewQuery = tView.viewQuery;
        if (viewQuery !== null) {
            executeViewQueryFn(2 /* RenderFlags.Update */, viewQuery, context);
        }
        // execute view hooks (AfterViewInit, AfterViewChecked)
        // PERF WARNING: do NOT extract this to a separate function without running benchmarks
        if (!isInCheckNoChangesPass) {
            if (hooksInitPhaseCompleted) {
                const viewCheckHooks = tView.viewCheckHooks;
                if (viewCheckHooks !== null) {
                    executeCheckHooks(lView, viewCheckHooks);
                }
            }
            else {
                const viewHooks = tView.viewHooks;
                if (viewHooks !== null) {
                    executeInitAndCheckHooks(lView, viewHooks, 2 /* InitPhaseState.AfterViewInitHooksToBeRun */);
                }
                incrementInitPhaseFlags(lView, 2 /* InitPhaseState.AfterViewInitHooksToBeRun */);
            }
        }
        if (tView.firstUpdatePass === true) {
            // We need to make sure that we only flip the flag on successful `refreshView` only
            // Don't do this in `finally` block.
            // If we did this in `finally` block then an exception could block the execution of styling
            // instructions which in turn would be unable to insert themselves into the styling linked
            // list. The result of this would be that if the exception would not be throw on subsequent CD
            // the styling would be unable to process it data and reflect to the DOM.
            tView.firstUpdatePass = false;
        }
        // Schedule any effects that are waiting on the update pass of this view.
        if (lView[EFFECTS_TO_SCHEDULE]) {
            for (const notifyEffect of lView[EFFECTS_TO_SCHEDULE]) {
                notifyEffect();
            }
            // Once they've been run, we can drop the array.
            lView[EFFECTS_TO_SCHEDULE] = null;
        }
        // Do not reset the dirty state when running in check no changes mode. We don't want components
        // to behave differently depending on whether check no changes is enabled or not. For example:
        // Marking an OnPush component as dirty from within the `ngAfterViewInit` hook in order to
        // refresh a `NgClass` binding should work. If we would reset the dirty state in the check
        // no changes cycle, the component would be not be dirty for the next update pass. This would
        // be different in production mode where the component dirty state is not reset.
        if (!isInCheckNoChangesPass) {
            lView[FLAGS] &= ~(64 /* LViewFlags.Dirty */ | 8 /* LViewFlags.FirstLViewPass */);
        }
    }
    catch (e) {
        // If refreshing a view causes an error, we need to remark the ancestors as needing traversal
        // because the error might have caused a situation where views below the current location are
        // dirty but will be unreachable because the "has dirty children" flag in the ancestors has been
        // cleared during change detection and we failed to run to completion.
        markAncestorsForTraversal(lView);
        throw e;
    }
    finally {
        if (currentConsumer !== null) {
            consumerAfterComputation(currentConsumer, prevConsumer);
            maybeReturnReactiveLViewConsumer(currentConsumer);
        }
        leaveView();
    }
}
/**
 * Indicates if the view should get its own reactive consumer node.
 *
 * In the current design, all embedded views share a consumer with the component view. This allows
 * us to refresh at the component level rather than at a per-view level. In addition, root views get
 * their own reactive node because root component will have a host view that executes the
 * component's host bindings. This needs to be tracked in a consumer as well.
 *
 * To get a more granular change detection than per-component, all we would just need to update the
 * condition here so that a given view gets a reactive consumer which can become dirty independently
 * from its parent component. For example embedded views for signal components could be created with
 * a new type "SignalEmbeddedView" and the condition here wouldn't even need updating in order to
 * get granular per-view change detection for signal components.
 */
function viewShouldHaveReactiveConsumer(tView) {
    return tView.type !== 2 /* TViewType.Embedded */;
}
/**
 * Goes over embedded views (ones created through ViewContainerRef APIs) and refreshes
 * them by executing an associated template function.
 */
function detectChangesInEmbeddedViews(lView, mode) {
    for (let lContainer = getFirstLContainer(lView); lContainer !== null; lContainer = getNextLContainer(lContainer)) {
        lContainer[HAS_CHILD_VIEWS_TO_REFRESH] = false;
        for (let i = CONTAINER_HEADER_OFFSET; i < lContainer.length; i++) {
            const embeddedLView = lContainer[i];
            detectChangesInViewIfAttached(embeddedLView, mode);
        }
    }
}
/**
 * Mark transplanted views as needing to be refreshed at their insertion points.
 *
 * @param lView The `LView` that may have transplanted views.
 */
function markTransplantedViewsForRefresh(lView) {
    for (let lContainer = getFirstLContainer(lView); lContainer !== null; lContainer = getNextLContainer(lContainer)) {
        if (!lContainer[HAS_TRANSPLANTED_VIEWS])
            continue;
        const movedViews = lContainer[MOVED_VIEWS];
        ngDevMode && assertDefined(movedViews, 'Transplanted View flags set but missing MOVED_VIEWS');
        for (let i = 0; i < movedViews.length; i++) {
            const movedLView = movedViews[i];
            const insertionLContainer = movedLView[PARENT];
            ngDevMode && assertLContainer(insertionLContainer);
            markViewForRefresh(movedLView);
        }
    }
}
/**
 * Detects changes in a component by entering the component view and processing its bindings,
 * queries, etc. if it is CheckAlways, OnPush and Dirty, etc.
 *
 * @param componentHostIdx  Element index in LView[] (adjusted for HEADER_OFFSET)
 */
function detectChangesInComponent(hostLView, componentHostIdx, mode) {
    ngDevMode && assertEqual(isCreationMode(hostLView), false, 'Should be run in update mode');
    const componentView = getComponentLViewByIndex(componentHostIdx, hostLView);
    detectChangesInViewIfAttached(componentView, mode);
}
/**
 * Visits a view as part of change detection traversal.
 *
 * If the view is detached, no additional traversal happens.
 */
function detectChangesInViewIfAttached(lView, mode) {
    if (!viewAttachedToChangeDetector(lView)) {
        return;
    }
    detectChangesInView(lView, mode);
}
/**
 * Visits a view as part of change detection traversal.
 *
 * The view is refreshed if:
 * - If the view is CheckAlways or Dirty and ChangeDetectionMode is `Global`
 * - If the view has the `RefreshTransplantedView` flag
 *
 * The view is not refreshed, but descendants are traversed in `ChangeDetectionMode.Targeted` if the
 * view HasChildViewsToRefresh flag is set.
 */
function detectChangesInView(lView, mode) {
    const isInCheckNoChangesPass = ngDevMode && isInCheckNoChangesMode();
    const tView = lView[TVIEW];
    const flags = lView[FLAGS];
    const consumer = lView[REACTIVE_TEMPLATE_CONSUMER];
    // Refresh CheckAlways views in Global mode.
    let shouldRefreshView = !!(mode === 0 /* ChangeDetectionMode.Global */ && flags & 16 /* LViewFlags.CheckAlways */);
    // Refresh Dirty views in Global mode, as long as we're not in checkNoChanges.
    // CheckNoChanges never worked with `OnPush` components because the `Dirty` flag was
    // cleared before checkNoChanges ran. Because there is now a loop for to check for
    // backwards views, it gives an opportunity for `OnPush` components to be marked `Dirty`
    // before the CheckNoChanges pass. We don't want existing errors that are hidden by the
    // current CheckNoChanges bug to surface when making unrelated changes.
    shouldRefreshView ||=
        !!(flags & 64 /* LViewFlags.Dirty */ && mode === 0 /* ChangeDetectionMode.Global */ &&
            (!isInCheckNoChangesPass || RUN_IN_CHECK_NO_CHANGES_ANYWAY));
    // Always refresh views marked for refresh, regardless of mode.
    shouldRefreshView ||= !!(flags & 1024 /* LViewFlags.RefreshView */);
    // Refresh views when they have a dirty reactive consumer, regardless of mode.
    shouldRefreshView ||= !!(consumer?.dirty && consumerPollProducersForChange(consumer));
    // Mark the Flags and `ReactiveNode` as not dirty before refreshing the component, so that they
    // can be re-dirtied during the refresh process.
    if (consumer) {
        consumer.dirty = false;
    }
    lView[FLAGS] &= ~(8192 /* LViewFlags.HasChildViewsToRefresh */ | 1024 /* LViewFlags.RefreshView */);
    if (shouldRefreshView) {
        refreshView(tView, lView, tView.template, lView[CONTEXT]);
    }
    else if (flags & 8192 /* LViewFlags.HasChildViewsToRefresh */) {
        detectChangesInEmbeddedViews(lView, 1 /* ChangeDetectionMode.Targeted */);
        const components = tView.components;
        if (components !== null) {
            detectChangesInChildComponents(lView, components, 1 /* ChangeDetectionMode.Targeted */);
        }
    }
}
/** Refreshes child components in the current view (update mode). */
function detectChangesInChildComponents(hostLView, components, mode) {
    for (let i = 0; i < components.length; i++) {
        detectChangesInComponent(hostLView, components[i], mode);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hhbmdlX2RldGVjdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2NvcmUvc3JjL3JlbmRlcjMvaW5zdHJ1Y3Rpb25zL2NoYW5nZV9kZXRlY3Rpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7OztHQU1HO0FBRUgsT0FBTyxFQUFDLHdCQUF3QixFQUFFLHlCQUF5QixFQUFFLDhCQUE4QixFQUFlLE1BQU0sa0NBQWtDLENBQUM7QUFFbkosT0FBTyxFQUFDLFlBQVksRUFBbUIsTUFBTSxjQUFjLENBQUM7QUFDNUQsT0FBTyxFQUFDLGFBQWEsRUFBRSxXQUFXLEVBQUMsTUFBTSxtQkFBbUIsQ0FBQztBQUM3RCxPQUFPLEVBQUMsZ0JBQWdCLEVBQUMsTUFBTSxXQUFXLENBQUM7QUFDM0MsT0FBTyxFQUFDLDBCQUEwQixFQUFDLE1BQU0sc0JBQXNCLENBQUM7QUFDaEUsT0FBTyxFQUFDLGlCQUFpQixFQUFFLHdCQUF3QixFQUFFLHVCQUF1QixFQUFDLE1BQU0sVUFBVSxDQUFDO0FBQzlGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSwwQkFBMEIsRUFBRSxzQkFBc0IsRUFBYyxXQUFXLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQztBQUU3SSxPQUFPLEVBQUMsT0FBTyxFQUFFLG1CQUFtQixFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQXFDLE1BQU0sRUFBRSwwQkFBMEIsRUFBRSxLQUFLLEVBQW1CLE1BQU0sb0JBQW9CLENBQUM7QUFDcEwsT0FBTyxFQUFDLGdDQUFnQyxFQUFFLGdDQUFnQyxFQUF3QixNQUFNLDRCQUE0QixDQUFDO0FBQ3JJLE9BQU8sRUFBQyxTQUFTLEVBQUUsc0JBQXNCLEVBQUUsU0FBUyxFQUFFLGVBQWUsRUFBRSx5QkFBeUIsRUFBQyxNQUFNLFVBQVUsQ0FBQztBQUNsSCxPQUFPLEVBQUMsa0JBQWtCLEVBQUUsaUJBQWlCLEVBQUMsTUFBTSw4QkFBOEIsQ0FBQztB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QUMsRUFBRSxDQUFDLEdBQUcsVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtRQUMxQyx3QkFBd0IsQ0FBQyxTQUFTLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDO0tBQzFEO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQge2NvbnN1bWVyQWZ0ZXJDb21wdXRhdGlvbiwgY29uc3VtZXJCZWZvcmVDb21wdXRhdGlvbiwgY29uc3VtZXJQb2xsUHJvZHVjZXJzRm9yQ2hhbmdlLCBSZWFjdGl2ZU5vZGV9IGZyb20gJ0Bhbmd1bGFyL2NvcmUvcHJpbWl0aXZlcy9zaWduYWxzJztcblxuaW1wb3J0IHtSdW50aW1lRXJyb3IsIFJ1bnRpbWVFcnJvckNvZGV9IGZyb20gJy4uLy4uL2Vycm9ycyc7XG5pbXBvcnQge2Fzc2VydERlZmluZWQsIGFzc2VydEVxdWFsfSBmcm9tICcuLi8uLi91dGlsL2Fzc2VydCc7XG5pbXBvcnQge2Fzc2VydExDb250YWluZXJ9IGZyb20gJy4uL2Fzc2VydCc7XG5pbXBvcnQge2dldENvbXBvbmVudFZpZXdCeUluc3RhbmNlfSBmcm9tICcuLi9jb250ZXh0X2Rpc2NvdmVyeSc7XG5pbXBvcnQge2V4ZWN1dGVDaGVja0hvb2tzLCBleGVjdXRlSW5pdEFuZENoZWNrSG9va3MsIGluY3JlbWVudEluaXRQaGFzZUZsYWdzfSBmcm9tICcuLi9ob29rcyc7XG5pbXBvcnQge0NPTlRBSU5FUl9IRUFERVJfT0ZGU0VULCBIQVNfQ0hJTERfVklFV1NfVE9fUkVGUkVTSCwgSEFTX1RSQU5TUExBTlRFRF9WSUVXUywgTENvbnRhaW5lciwgTU9WRURfVklFV1N9IGZyb20gJy4uL2ludGVyZmFjZXMvY29udGFpbmVyJztcbmltcG9ydCB7Q29tcG9uZW50VGVtcGxhdGUsIFJlbmRlckZsYWdzfSBmcm9tICcuLi9pbnRlcmZhY2VzL2RlZmluaXRpb24nO1xuaW1wb3J0IHtDT05URVhULCBFRkZFQ1RTX1RPX1NDSEVEVUxFLCBFTlZJUk9OTUVOVCwgRkxBR1MsIEluaXRQaGFzZVN0YXRlLCBMVmlldywgTFZpZXdGbGFncywgUEFSRU5ULCBSRUFDVElWRV9URU1QTEFURV9DT05TVU1FUiwgVFZJRVcsIFRWaWV3LCBUVmlld1R5cGV9IGZyb20gJy4uL2ludGVyZmFjZXMvdmlldyc7XG5pbXBvcnQge2dldE9yQm9ycm93UmVhY3RpdmVMVmlld0NvbnN1bWVyLCBtYXliZVJldHVyblJlYWN0aXZlTFZpZXdDb25zdW1lciwgUmVhY3RpdmVMVmlld0NvbnN1bWVyfSBmcm9tICcuLi9yZWFjdGl2ZV9sdmlld19jb25zdW1lcic7XG5pbXBvcnQge2VudGVyVmlldywgaXNJbkNoZWNrTm9DaGFuZ2VzTW9kZSwgbGVhdmVWaWV3LCBzZXRCaW5kaW5nSW5kZXgsIHNldElzSW5DaGVja05vQ2hhbmdlc01vZGV9IGZyb20gJy4uL3N0YXRlJztcbmltcG9ydCB7Z2V0Rmlyc3RMQ29udGFpbmVyLCBnZXROZXh0TENvbnRhaW5lcn0gZnJvbSAnLi4vdXRpbC92aWV3X3RyYXZlcnNhbF91dGlscyc7XG5pbXBvcnQge2dldENvbXBvbmVudExWaWV3QnlJbmRleCwgaXNDcmVhdGlvbk1vZGUsIG1hcmtBbmNlc3RvcnNGb3JUcmF2ZXJzYWwsIG1hcmtWaWV3Rm9yUmVmcmVzaCwgcmVzZXRQcmVPcmRlckhvb2tGbGFncywgdmlld0F0dGFjaGVkVG9DaGFuZ2VEZXRlY3Rvcn0gZnJvbSAnLi4vdXRpbC92aWV3X3V0aWxzJztcblxuaW1wb3J0IHtSVU5fSU5fQ0hFQ0tfTk9fQ0hBTkdFU19BTllXQVl9IGZyb20gJy4vY2hhbmdlX2RldGVjdGlvbl9mbGFncyc7XG5pbXBvcnQge2V4ZWN1dGVUZW1wbGF0ZSwgZXhlY3V0ZVZpZXdRdWVyeUZuLCBoYW5kbGVFcnJvciwgcHJvY2Vzc0hvc3RCaW5kaW5nT3BDb2RlcywgcmVmcmVzaENvbnRlbnRRdWVyaWVzfSBmcm9tICcuL3NoYXJlZCc7XG5cbi8qKlxuICogVGhlIG1heGltdW0gbnVtYmVyIG9mIHRpbWVzIHRoZSBjaGFuZ2UgZGV0ZWN0aW9uIHRyYXZlcnNhbCB3aWxsIHJlcnVuIGJlZm9yZSB0aHJvd2luZyBhbiBlcnJvci5cbiAqL1xuY29uc3QgTUFYSU1VTV9SRUZSRVNIX1JFUlVOUyA9IDEwMDtcblxuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdENoYW5nZXNJbnRlcm5hbDxUPihcbiAgICB0VmlldzogVFZpZXcsIGxWaWV3OiBMVmlldywgY29udGV4dDogVCwgbm90aWZ5RXJyb3JIYW5kbGVyID0gdHJ1ZSkge1xuICBjb25zdCBlbnZpcm9ubWVudCA9IGxWaWV3W0VOVklST05NRU5UXTtcbiAgY29uc3QgcmVuZGVyZXJGYWN0b3J5ID0gZW52aXJvbm1lbnQucmVuZGVyZXJGYWN0b3J5O1xuICBjb25zdCBhZnRlclJlbmRlckV2ZW50TWFuYWdlciA9IGVudmlyb25tZW50LmFmdGVyUmVuZGVyRXZlbnRNYW5hZ2VyO1xuXG4gIC8vIENoZWNrIG5vIGNoYW5nZXMgbW9kZSBpcyBhIGRldiBvbmx5IG1vZGUgdXNlZCB0byB2ZXJpZnkgdGhhdCBiaW5kaW5ncyBoYXZlIG5vdCBjaGFuZ2VkXG4gIC8vIHNpbmNlIHRoZXkgd2VyZSBhc3NpZ25lZC4gV2UgZG8gbm90IHdhbnQgdG8gaW52b2tlIHJlbmRlcmVyIGZhY3RvcnkgZnVuY3Rpb25zIGluIHRoYXQgbW9kZVxuICAvLyB0byBhdm9pZCBhbnkgcG9zc2libGUgc2lkZS1lZmZlY3RzLlxuICBjb25zdCBjaGVja05vQ2hhbmdlc01vZGUgPSAhIW5nRGV2TW9kZSAmJiBpc0luQ2hlY2tOb0NoYW5nZXNNb2RlKCk7XG5cbiAgaWYgKCFjaGVja05vQ2hhbmdlc01vZGUpIHtcbiAgICByZW5kZXJlckZhY3RvcnkuYmVnaW4/LigpO1xuICAgIGFmdGVyUmVuZGVyRXZlbnRNYW5hZ2VyPy5iZWdpbigpO1xuICB9XG5cbiAgdHJ5IHtcbiAgICByZWZyZXNoVmlldyh0VmlldywgbFZpZXcsIHRWaWV3LnRlbXBsYXRlLCBjb250ZXh0KTtcbiAgICBsZXQgcmV0cmllcyA9IDA7XG4gICAgLy8gSWYgYWZ0ZXIgcnVubmluZyBjaGFuZ2UgZGV0ZWN0aW9uLCB0aGlzIHZpZXcgc3RpbGwgbmVlZHMgdG8gYmUgcmVmcmVzaGVkIG9yIHRoZXJlIGFyZVxuICAgIC8vIGRlc2NlbmRhbnRzIHZpZXdzIHRoYXQgbmVlZCB0byBiZSByZWZyZXNoZWQgZHVlIHRvIHJlLWRpcnR5aW5nIGR1cmluZyB0aGUgY2hhbmdlIGRldGVjdGlvblxuICAgIC8vIHJ1biwgZGV0ZWN0IGNoYW5nZXMgb24gdGhlIHZpZXcgYWdhaW4uIFdlIHJ1biBjaGFuZ2UgZGV0ZWN0aW9uIGluIGBUYXJnZXRlZGAgbW9kZSB0byBvbmx5XG4gICAgLy8gcmVmcmVzaCB2aWV3cyB3aXRoIHRoZSBgUmVmcmVzaFZpZXdgIGZsYWcuXG4gICAgd2hpbGUgKGxWaWV3W0ZMQUdTXSAmIChMVmlld0ZsYWdzLlJlZnJlc2hWaWV3IHwgTFZpZXdGbGFncy5IYXNDaGlsZFZpZXdzVG9SZWZyZXNoKSB8fFxuICAgICAgICAgICBsVmlld1tSRUFDVElWRV9URU1QTEFURV9DT05TVU1FUl0/LmRpcnR5KSB7XG4gICAgICBpZiAocmV0cmllcyA9PT0gTUFYSU1VTV9SRUZSRVNIX1JFUlVOUykge1xuICAgICAgICB0aHJvdyBuZXcgUnVudGltZUVycm9yKFxuICAgICAgICAgICAgUnVudGltZUVycm9yQ29kZS5JTkZJTklURV9DSEFOR0VfREVURUNUSU9OLFxuICAgICAgICAgICAgbmdEZXZNb2RlICYmXG4gICAgICAgICAgICAgICAgJ0luZmluaXRlIGNoYW5nZSBkZXRlY3Rpb24gd2hpbGUgdHJ5aW5nIHRvIHJlZnJlc2ggdmlld3MuICcgK1xuICAgICAgICAgICAgICAgICAgICAnVGhlcmUgbWF5IGJlIGNvbXBvbmVudHMgd2hpY2ggZWFjaCBjYXVzZSB0aGUgb3RoZXIgdG8gcmVxdWlyZSBhIHJlZnJlc2gsICcgK1xuICAgICAgICAgICAgICAgICAgICAnY2F1c2luZyBhbiBpbmZpbml0ZSBsb29wLicpO1xuICAgICAgfVxuICAgICAgcmV0cmllcysrO1xuICAgICAgLy8gRXZlbiBpZiB0aGlzIHZpZXcgaXMgZGV0YWNoZWQsIHdlIHN0aWxsIGRldGVjdCBjaGFuZ2VzIGluIHRhcmdldGVkIG1vZGUgYmVjYXVzZSB0aGlzIHdhc1xuICAgICAgLy8gdGhlIHJvb3Qgb2YgdGhlIGNoYW5nZSBkZXRlY3Rpb24gcnVuLlxuICAgICAgZGV0ZWN0Q2hhbmdlc0luVmlldyhsVmlldywgQ2hhbmdlRGV0ZWN0aW9uTW9kZS5UYXJnZXRlZCk7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChub3RpZnlFcnJvckhhbmRsZXIpIHtcbiAgICAgIGhhbmRsZUVycm9yKGxWaWV3LCBlcnJvcik7XG4gICAgfVxuICAgIHRocm93IGVycm9yO1xuICB9IGZpbmFsbHkge1xuICAgIGlmICghY2hlY2tOb0NoYW5nZXNNb2RlKSB7XG4gICAgICByZW5kZXJlckZhY3RvcnkuZW5kPy4oKTtcblxuICAgICAgLy8gT25lIGZpbmFsIGZsdXNoIG9mIHRoZSBlZmZlY3RzIHF1ZXVlIHRvIGNhdGNoIGFueSBlZmZlY3RzIGNyZWF0ZWQgaW4gYG5nQWZ0ZXJWaWV3SW5pdGAgb3JcbiAgICAgIC8vIG90aGVyIHBvc3Qtb3JkZXIgaG9va3MuXG4gICAgICBlbnZpcm9ubWVudC5pbmxpbmVFZmZlY3RSdW5uZXI/LmZsdXNoKCk7XG5cbiAgICAgIC8vIEludm9rZSBhbGwgY2FsbGJhY2tzIHJlZ2lzdGVyZWQgdmlhIGBhZnRlcipSZW5kZXJgLCBpZiBuZWVkZWQuXG4gICAgICBhZnRlclJlbmRlckV2ZW50TWFuYWdlcj8uZW5kKCk7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjaGVja05vQ2hhbmdlc0ludGVybmFsPFQ+KFxuICAgIHRWaWV3OiBUVmlldywgbFZpZXc6IExWaWV3LCBjb250ZXh0OiBULCBub3RpZnlFcnJvckhhbmRsZXIgPSB0cnVlKSB7XG4gIHNldElzSW5DaGVja05vQ2hhbmdlc01vZGUodHJ1ZSk7XG4gIHRyeSB7XG4gICAgZGV0ZWN0Q2hhbmdlc0ludGVybmFsKHRWaWV3LCBsVmlldywgY29udGV4dCwgbm90aWZ5RXJyb3JIYW5kbGVyKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBzZXRJc0luQ2hlY2tOb0NoYW5nZXNNb2RlKGZhbHNlKTtcbiAgfVxufVxuXG4vKipcbiAqIFN5bmNocm9ub3VzbHkgcGVyZm9ybSBjaGFuZ2UgZGV0ZWN0aW9uIG9uIGEgY29tcG9uZW50IChhbmQgcG9zc2libHkgaXRzIHN1Yi1jb21wb25lbnRzKS5cbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIHRyaWdnZXJzIGNoYW5nZSBkZXRlY3Rpb24gaW4gYSBzeW5jaHJvbm91cyB3YXkgb24gYSBjb21wb25lbnQuXG4gKlxuICogQHBhcmFtIGNvbXBvbmVudCBUaGUgY29tcG9uZW50IHdoaWNoIHRoZSBjaGFuZ2UgZGV0ZWN0aW9uIHNob3VsZCBiZSBwZXJmb3JtZWQgb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXRlY3RDaGFuZ2VzKGNvbXBvbmVudDoge30pOiB2b2lkIHtcbiAgY29uc3QgdmlldyA9IGdldENvbXBvbmVudFZpZXdCeUluc3RhbmNlKGNvbXBvbmVudCk7XG4gIGRldGVjdENoYW5nZXNJbnRlcm5hbCh2aWV3W1RWSUVXXSwgdmlldywgY29tcG9uZW50KTtcbn1cblxuLyoqXG4gKiBEaWZmZXJlbnQgbW9kZXMgb2YgdHJhdmVyc2luZyB0aGUgbG9naWNhbCB2aWV3IHRyZWUgZHVyaW5nIGNoYW5nZSBkZXRlY3Rpb24uXG4gKlxuICpcbiAqIFRoZSBjaGFuZ2UgZGV0ZWN0aW9uIHRyYXZlcnNhbCBhbGdvcml0aG0gc3dpdGNoZXMgYmV0d2VlbiB0aGVzZSBtb2RlcyBiYXNlZCBvbiB2YXJpb3VzXG4gKiBjb25kaXRpb25zLlxuICovXG5jb25zdCBlbnVtIENoYW5nZURldGVjdGlvbk1vZGUge1xuICAvKipcbiAgICogSW4gYEdsb2JhbGAgbW9kZSwgYERpcnR5YCBhbmQgYENoZWNrQWx3YXlzYCB2aWV3cyBhcmUgcmVmcmVzaGVkIGFzIHdlbGwgYXMgdmlld3Mgd2l0aCB0aGVcbiAgICogYFJlZnJlc2hUcmFuc3BsYW50ZWRWaWV3YCBmbGFnLlxuICAgKi9cbiAgR2xvYmFsLFxuICAvKipcbiAgICogSW4gYFRhcmdldGVkYCBtb2RlLCBvbmx5IHZpZXdzIHdpdGggdGhlIGBSZWZyZXNoVHJhbnNwbGFudGVkVmlld2BcbiAgICogZmxhZyBhcmUgcmVmcmVzaGVkLlxuICAgKi9cbiAgVGFyZ2V0ZWQsXG59XG5cbi8qKlxuICogUHJvY2Vzc2VzIGEgdmlldyBpbiB1cGRhdGUgbW9kZS4gVGhpcyBpbmNsdWRlcyBhIG51bWJlciBvZiBzdGVwcyBpbiBhIHNwZWNpZmljIG9yZGVyOlxuICogLSBleGVjdXRpbmcgYSB0ZW1wbGF0ZSBmdW5jdGlvbiBpbiB1cGRhdGUgbW9kZTtcbiAqIC0gZXhlY3V0aW5nIGhvb2tzO1xuICogLSByZWZyZXNoaW5nIHF1ZXJpZXM7XG4gKiAtIHNldHRpbmcgaG9zdCBiaW5kaW5ncztcbiAqIC0gcmVmcmVzaGluZyBjaGlsZCAoZW1iZWRkZWQgYW5kIGNvbXBvbmVudCkgdmlld3MuXG4gKi9cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZnJlc2hWaWV3PFQ+KFxuICAgIHRWaWV3OiBUVmlldywgbFZpZXc6IExWaWV3LCB0ZW1wbGF0ZUZuOiBDb21wb25lbnRUZW1wbGF0ZTx7fT58bnVsbCwgY29udGV4dDogVCkge1xuICBuZ0Rldk1vZGUgJiYgYXNzZXJ0RXF1YWwoaXNDcmVhdGlvbk1vZGUobFZpZXcpLCBmYWxzZSwgJ1Nob3VsZCBiZSBydW4gaW4gdXBkYXRlIG1vZGUnKTtcbiAgY29uc3QgZmxhZ3MgPSBsVmlld1tGTEFHU107XG4gIGlmICgoZmxhZ3MgJiBMVmlld0ZsYWdzLkRlc3Ryb3llZCkgPT09IExWaWV3RmxhZ3MuRGVzdHJveWVkKSByZXR1cm47XG5cbiAgLy8gQ2hlY2sgbm8gY2hhbmdlcyBtb2RlIGlzIGEgZGV2IG9ubHkgbW9kZSB1c2VkIHRvIHZlcmlmeSB0aGF0IGJpbmRpbmdzIGhhdmUgbm90IGNoYW5nZWRcbiAgLy8gc2luY2UgdGhleSB3ZXJlIGFzc2lnbmVkLiBXZSBkbyBub3Qgd2FudCB0byBleGVjdXRlIGxpZmVjeWNsZSBob29rcyBpbiB0aGF0IG1vZGUuXG4gIGNvbnN0IGlzSW5DaGVja05vQ2hhbmdlc1Bhc3MgPSBuZ0Rldk1vZGUgJiYgaXNJbkNoZWNrTm9DaGFuZ2VzTW9kZSgpO1xuXG4gICFpc0luQ2hlY2tOb0NoYW5nZXNQYXNzICYmIGxWaWV3W0VOVklST05NRU5UXS5pbmxpbmVFZmZlY3RSdW5uZXI/LmZsdXNoKCk7XG5cblxuICAvLyBTdGFydCBjb21wb25lbnQgcmVhY3RpdmUgY29udGV4dFxuICAvLyAtIFdlIG1pZ2h0IGFscmVhZHkgYmUgaW4gYSByZWFjdGl2ZSBjb250ZXh0IGlmIHRoaXMgaXMgYW4gZW1iZWRkZWQgdmlldyBvZiB0aGUgaG9zdC5cbiAgLy8gLSBXZSBtaWdodCBiZSBkZXNjZW5kaW5nIGludG8gYSB2aWV3IHRoYXQgbmVlZHMgYSBjb25zdW1lci5cbiAgZW50ZXJWaWV3KGxWaWV3KTtcbiAgbGV0IHByZXZDb25zdW1lcjogUmVhY3RpdmVOb2RlfG51bGwgPSBudWxsO1xuICBsZXQgY3VycmVudENvbnN1bWVyOiBSZWFjdGl2ZUxWaWV3Q29uc3VtZXJ8bnVsbCA9IG51bGw7XG4gIGlmICghaXNJbkNoZWNrTm9DaGFuZ2VzUGFzcyAmJiB2aWV3U2hvdWxkSGF2ZVJlYWN0aXZlQ29uc3VtZXIodFZpZXcpKSB7XG4gICAgY3VycmVudENvbnN1bWVyID0gZ2V0T3JCb3Jyb3dSZWFjdGl2ZUxWaWV3Q29uc3VtZXIobFZpZXcpO1xuICAgIHByZXZDb25zdW1lciA9IGNvbnN1bWVyQmVmb3JlQ29tcHV0YXRpb24oY3VycmVudENvbnN1bWVyKTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgcmVzZXRQcmVPcmRlckhvb2tGbGFncyhsVmlldyk7XG5cbiAgICBzZXRCaW5kaW5nSW5kZXgodFZpZXcuYmluZGluZ1N0YXJ0SW5kZXgpO1xuICAgIGlmICh0ZW1wbGF0ZUZuICE9PSBudWxsKSB7XG4gICAgICBleGVjdXRlVGVtcGxhdGUodFZpZXcsIGxWaWV3LCB0ZW1wbGF0ZUZuLCBSZW5kZXJGbGFncy5VcGRhdGUsIGNvbnRleHQpO1xuICAgIH1cblxuICAgIGNvbnN0IGhvb2tzSW5pdFBoYXNlQ29tcGxldGVkID1cbiAgICAgICAgKGZsYWdzICYgTFZpZXdGbGFncy5Jbml0UGhhc2VTdGF0ZU1hc2spID09PSBJbml0UGhhc2VTdGF0ZS5Jbml0UGhhc2VDb21wbGV0ZWQ7XG5cbiAgICAvLyBleGVjdXRlIHByZS1vcmRlciBob29rcyAoT25Jbml0LCBPbkNoYW5nZXMsIERvQ2hlY2spXG4gICAgLy8gUEVSRiBXQVJOSU5HOiBkbyBOT1QgZXh0cmFjdCB0aGlzIHRvIGEgc2VwYXJhdGUgZnVuY3Rpb24gd2l0aG91dCBydW5uaW5nIGJlbmNobWFya3NcbiAgICBpZiAoIWlzSW5DaGVja05vQ2hhbmdlc1Bhc3MpIHtcbiAgICAgIGlmIChob29rc0luaXRQaGFzZUNvbXBsZXRlZCkge1xuICAgICAgICBjb25zdCBwcmVPcmRlckNoZWNrSG9va3MgPSB0Vmlldy5wcmVPcmRlckNoZWNrSG9va3M7XG4gICAgICAgIGlmIChwcmVPcmRlckNoZWNrSG9va3MgIT09IG51bGwpIHtcbiAgICAgICAgICBleGVjdXRlQ2hlY2tIb29rcyhsVmlldywgcHJlT3JkZXJDaGVja0hvb2tzLCBudWxsKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcHJlT3JkZXJIb29rcyA9IHRWaWV3LnByZU9yZGVySG9va3M7XG4gICAgICAgIGlmIChwcmVPcmRlckhvb2tzICE9PSBudWxsKSB7XG4gICAgICAgICAgZXhlY3V0ZUluaXRBbmRDaGVja0hvb2tzKGxWaWV3LCBwcmVPcmRlckhvb2tzLCBJbml0UGhhc2VTdGF0ZS5PbkluaXRIb29rc1RvQmVSdW4sIG51bGwpO1xuICAgICAgICB9XG4gICAgICAgIGluY3JlbWVudEluaXRQaGFzZUZsYWdzKGxWaWV3LCBJbml0UGhhc2VTdGF0ZS5PbkluaXRIb29rc1RvQmVSdW4pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEZpcnN0IG1hcmsgdHJhbnNwbGFudGVkIHZpZXdzIHRoYXQgYXJlIGRlY2xhcmVkIGluIHRoaXMgbFZpZXcgYXMgbmVlZGluZyBhIHJlZnJlc2ggYXQgdGhlaXJcbiAgICAvLyBpbnNlcnRpb24gcG9pbnRzLiBUaGlzIGlzIG5lZWRlZCB0byBhdm9pZCB0aGUgc2l0dWF0aW9uIHdoZXJlIHRoZSB0ZW1wbGF0ZSBpcyBkZWZpbmVkIGluIHRoaXNcbiAgICAvLyBgTFZpZXdgIGJ1dCBpdHMgZGVjbGFyYXRpb24gYXBwZWFycyBhZnRlciB0aGUgaW5zZXJ0aW9uIGNvbXBvbmVudC5cbiAgICBtYXJrVHJhbnNwbGFudGVkVmlld3NGb3JSZWZyZXNoKGxWaWV3KTtcbiAgICBkZXRlY3RDaGFuZ2VzSW5FbWJlZGRlZFZpZXdzKGxWaWV3LCBDaGFuZ2VEZXRlY3Rpb25Nb2RlLkdsb2JhbCk7XG5cbiAgICAvLyBDb250ZW50IHF1ZXJ5IHJlc3VsdHMgbXVzdCBiZSByZWZyZXNoZWQgYmVmb3JlIGNvbnRlbnQgaG9va3MgYXJlIGNhbGxlZC5cbiAgICBpZiAodFZpZXcuY29udGVudFF1ZXJpZXMgIT09IG51bGwpIHtcbiAgICAgIHJlZnJlc2hDb250ZW50UXVlcmllcyh0VmlldywgbFZpZXcpO1xuICAgIH1cblxuICAgIC8vIGV4ZWN1dGUgY29udGVudCBob29rcyAoQWZ0ZXJDb250ZW50SW5pdCwgQWZ0ZXJDb250ZW50Q2hlY2tlZClcbiAgICAvLyBQRVJGIFdBUk5JTkc6IGRvIE5PVCBleHRyYWN0IHRoaXMgdG8gYSBzZXBhcmF0ZSBmdW5jdGlvbiB3aXRob3V0IHJ1bm5pbmcgYmVuY2htYXJrc1xuICAgIGlmICghaXNJbkNoZWNrTm9DaGFuZ2VzUGFzcykge1xuICAgICAgaWYgKGhvb2tzSW5pdFBoYXNlQ29tcGxldGVkKSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRDaGVja0hvb2tzID0gdFZpZXcuY29udGVudENoZWNrSG9va3M7XG4gICAgICAgIGlmIChjb250ZW50Q2hlY2tIb29rcyAhPT0gbnVsbCkge1xuICAgICAgICAgIGV4ZWN1dGVDaGVja0hvb2tzKGxWaWV3LCBjb250ZW50Q2hlY2tIb29rcyk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRIb29rcyA9IHRWaWV3LmNvbnRlbnRIb29rcztcbiAgICAgICAgaWYgKGNvbnRlbnRIb29rcyAhPT0gbnVsbCkge1xuICAgICAgICAgIGV4ZWN1dGVJbml0QW5kQ2hlY2tIb29rcyhcbiAgICAgICAgICAgICAgbFZpZXcsIGNvbnRlbnRIb29rcywgSW5pdFBoYXNlU3RhdGUuQWZ0ZXJDb250ZW50SW5pdEhvb2tzVG9CZVJ1bik7XG4gICAgICAgIH1cbiAgICAgICAgaW5jcmVtZW50SW5pdFBoYXNlRmxhZ3MobFZpZXcsIEluaXRQaGFzZVN0YXRlLkFmdGVyQ29udGVudEluaXRIb29rc1RvQmVSdW4pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHByb2Nlc3NIb3N0QmluZGluZ09wQ29kZXModFZpZXcsIGxWaWV3KTtcblxuICAgIC8vIFJlZnJlc2ggY2hpbGQgY29tcG9uZW50IHZpZXdzLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSB0Vmlldy5jb21wb25lbnRzO1xuICAgIGlmIChjb21wb25lbnRzICE9PSBudWxsKSB7XG4gICAgICBkZXRlY3RDaGFuZ2VzSW5DaGlsZENvbXBvbmVudHMobFZpZXcsIGNvbXBvbmVudHMsIENoYW5nZURldGVjdGlvbk1vZGUuR2xvYmFsKTtcbiAgICB9XG5cbiAgICAvLyBWaWV3IHF1ZXJpZXMgbXVzdCBleGVjdXRlIGFmdGVyIHJlZnJlc2hpbmcgY2hpbGQgY29tcG9uZW50cyBiZWNhdXNlIGEgdGVtcGxhdGUgaW4gdGhpcyB2aWV3XG4gICAgLy8gY291bGQgYmUgaW5zZXJ0ZWQgaW4gYSBjaGlsZCBjb21wb25lbnQuIElmIHRoZSB2aWV3IHF1ZXJ5IGV4ZWN1dGVzIGJlZm9yZSBjaGlsZCBjb21wb25lbnRcbiAgICAvLyByZWZyZXNoLCB0aGUgdGVtcGxhdGUgbWlnaHQgbm90IHlldCBiZSBpbnNlcnRlZC5cbiAgICBjb25zdCB2aWV3UXVlcnkgPSB0Vmlldy52aWV3UXVlcnk7XG4gICAgaWYgKHZpZXdRdWVyeSAhPT0gbnVsbCkge1xuICAgICAgZXhlY3V0ZVZpZXdRdWVyeUZuPFQ+KFJlbmRlckZsYWdzLlVwZGF0ZSwgdmlld1F1ZXJ5LCBjb250ZXh0KTtcbiAgICB9XG5cbiAgICAvLyBleGVjdXRlIHZpZXcgaG9va3MgKEFmdGVyVmlld0luaXQsIEFmdGVyVmlld0NoZWNrZWQpXG4gICAgLy8gUEVSRiBXQVJOSU5HOiBkbyBOT1QgZXh0cmFjdCB0aGlzIHRvIGEgc2VwYXJhdGUgZnVuY3Rpb24gd2l0aG91dCBydW5uaW5nIGJlbmNobWFya3NcbiAgICBpZiAoIWlzSW5DaGVja05vQ2hhbmdlc1Bhc3MpIHtcbiAgICAgIGlmIChob29rc0luaXRQaGFzZUNvbXBsZXRlZCkge1xuICAgICAgICBjb25zdCB2aWV3Q2hlY2tIb29rcyA9IHRWaWV3LnZpZXdDaGVja0hvb2tzO1xuICAgICAgICBpZiAodmlld0NoZWNrSG9va3MgIT09IG51bGwpIHtcbiAgICAgICAgICBleGVjdXRlQ2hlY2tIb29rcyhsVmlldywgdmlld0NoZWNrSG9va3MpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCB2aWV3SG9va3MgPSB0Vmlldy52aWV3SG9va3M7XG4gICAgICAgIGlmICh2aWV3SG9va3MgIT09IG51bGwpIHtcbiAgICAgICAgICBleGVjdXRlSW5pdEFuZENoZWNrSG9va3MobFZpZXcsIHZpZXdIb29rcywgSW5pdFBoYXNlU3RhdGUuQWZ0ZXJWaWV3SW5pdEhvb2tzVG9CZVJ1bik7XG4gICAgICAgIH1cbiAgICAgICAgaW5jcmVtZW50SW5pdFBoYXNlRmxhZ3MobFZpZXcsIEluaXRQaGFzZVN0YXRlLkFmdGVyVmlld0luaXRIb29rc1RvQmVSdW4pO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAodFZpZXcuZmlyc3RVcGRhdGVQYXNzID09PSB0cnVlKSB7XG4gICAgICAvLyBXZSBuZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IHdlIG9ubHkgZmxpcCB0aGUgZmxhZyBvbiBzdWNjZXNzZnVsIGByZWZyZXNoVmlld2Agb25seVxuICAgICAgLy8gRG9uJ3QgZG8gdGhpcyBpbiBgZmluYWxseWAgYmxvY2suXG4gICAgICAvLyBJZiB3ZSBkaWQgdGhpcyBpbiBgZmluYWxseWAgYmxvY2sgdGhlbiBhbiBleGNlcHRpb24gY291bGQgYmxvY2sgdGhlIGV4ZWN1dGlvbiBvZiBzdHlsaW5nXG4gICAgICAvLyBpbnN0cnVjdGlvbnMgd2hpY2ggaW4gdHVybiB3b3VsZCBiZSB1bmFibGUgdG8gaW5zZXJ0IHRoZW1zZWx2ZXMgaW50byB0aGUgc3R5bGluZyBsaW5rZWRcbiAgICAgIC8vIGxpc3QuIFRoZSByZXN1bHQgb2YgdGhpcyB3b3VsZCBiZSB0aGF0IGlmIHRoZSBleGNlcHRpb24gd291bGQgbm90IGJlIHRocm93IG9uIHN1YnNlcXVlbnQgQ0RcbiAgICAgIC8vIHRoZSBzdHlsaW5nIHdvdWxkIGJlIHVuYWJsZSB0byBwcm9jZXNzIGl0IGRhdGEgYW5kIHJlZmxlY3QgdG8gdGhlIERPTS5cbiAgICAgIHRWaWV3LmZpcnN0VXBkYXRlUGFzcyA9IGZhbHNlO1xuICAgIH1cblxuICAgIC8vIFNjaGVkdWxlIGFueSBlZmZlY3RzIHRoYXQgYXJlIHdhaXRpbmcgb24gdGhlIHVwZGF0ZSBwYXNzIG9mIHRoaXMgdmlldy5cbiAgICBpZiAobFZpZXdbRUZGRUNUU19UT19TQ0hFRFVMRV0pIHtcbiAgICAgIGZvciAoY29uc3Qgbm90aWZ5RWZmZWN0IG9mIGxWaWV3W0VGRkVDVFNfVE9fU0NIRURVTEVdKSB7XG4gICAgICAgIG5vdGlmeUVmZmVjdCgpO1xuICAgICAgfVxuXG4gICAgICAvLyBPbmNlIHRoZXkndmUgYmVlbiBydW4sIHdlIGNhbiBkcm9wIHRoZSBhcnJheS5cbiAgICAgIGxWaWV3W0VGRkVDVFNfVE9fU0NIRURVTEVdID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBEbyBub3QgcmVzZXQgdGhlIGRpcnR5IHN0YXRlIHdoZW4gcnVubmluZyBpbiBjaGVjayBubyBjaGFuZ2VzIG1vZGUuIFdlIGRvbid0IHdhbnQgY29tcG9uZW50c1xuICAgIC8vIHRvIGJlaGF2ZSBkaWZmZXJlbnRseSBkZXBlbmRpbmcgb24gd2hldGhlciBjaGVjayBubyBjaGFuZ2VzIGlzIGVuYWJsZWQgb3Igbm90LiBGb3IgZXhhbXBsZTpcbiAgICAvLyBNYXJraW5nIGFuIE9uUHVzaCBjb21wb25lbnQgYXMgZGlydHkgZnJvbSB3aXRoaW4gdGhlIGBuZ0FmdGVyVmlld0luaXRgIGhvb2sgaW4gb3JkZXIgdG9cbiAgICAvLyByZWZyZXNoIGEgYE5nQ2xhc3NgIGJpbmRpbmcgc2hvdWxkIHdvcmsuIElmIHdlIHdvdWxkIHJlc2V0IHRoZSBkaXJ0eSBzdGF0ZSBpbiB0aGUgY2hlY2tcbiAgICAvLyBubyBjaGFuZ2VzIGN5Y2xlLCB0aGUgY29tcG9uZW50IHdvdWxkIGJlIG5vdCBiZSBkaXJ0eSBmb3IgdGhlIG5leHQgdXBkYXRlIHBhc3MuIFRoaXMgd291bGRcbiAgICAvLyBiZSBkaWZmZXJlbnQgaW4gcHJvZHVjdGlvbiBtb2RlIHdoZXJlIHRoZSBjb21wb25lbnQgZGlydHkgc3RhdGUgaXMgbm90IHJlc2V0LlxuICAgIGlmICghaXNJbkNoZWNrTm9DaGFuZ2VzUGFzcykge1xuICAgICAgbFZpZXdbRkxBR1NdICY9IH4oTFZpZXdGbGFncy5EaXJ0eSB8IExWaWV3RmxhZ3MuRmlyc3RMVmlld1Bhc3MpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIC8vIElmIHJlZnJlc2hpbmcgYSB2aWV3IGNhdXNlcyBhbiBlcnJvciwgd2UgbmVlZCB0byByZW1hcmsgdGhlIGFuY2VzdG9ycyBhcyBuZWVkaW5nIHRyYXZlcnNhbFxuICAgIC8vIGJlY2F1c2UgdGhlIGVycm9yIG1pZ2h0IGhhdmUgY2F1c2VkIGEgc2l0dWF0aW9uIHdoZXJlIHZpZXdzIGJlbG93IHRoZSBjdXJyZW50IGxvY2F0aW9uIGFyZVxuICAgIC8vIGRpcnR5IGJ1dCB3aWxsIGJlIHVucmVhY2hhYmxlIGJlY2F1c2UgdGhlIFwiaGFzIGRpcnR5IGNoaWxkcmVuXCIgZmxhZyBpbiB0aGUgYW5jZXN0b3JzIGhhcyBiZWVuXG4gICAgLy8gY2xlYXJlZCBkdXJpbmcgY2hhbmdlIGRldGVjdGlvbiBhbmQgd2UgZmFpbGVkIHRvIHJ1biB0byBjb21wbGV0aW9uLlxuXG4gICAgbWFya0FuY2VzdG9yc0ZvclRyYXZlcnNhbChsVmlldyk7XG4gICAgdGhyb3cgZTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoY3VycmVudENvbnN1bWVyICE9PSBudWxsKSB7XG4gICAgICBjb25zdW1lckFmdGVyQ29tcHV0YXRpb24oY3VycmVudENvbnN1bWVyLCBwcmV2Q29uc3VtZXIpO1xuICAgICAgbWF5YmVSZXR1cm5SZWFjdGl2ZUxWaWV3Q29uc3VtZXIoY3VycmVudENvbnN1bWVyKTtcbiAgICB9XG4gICAgbGVhdmVWaWV3KCk7XG4gIH1cbn1cblxuLyoqXG4gKiBJbmRpY2F0ZXMgaWYgdGhlIHZpZXcgc2hvdWxkIGdldCBpdHMgb3duIHJlYWN0aXZlIGNvbnN1bWVyIG5vZGUuXG4gKlxuICogSW4gdGhlIGN1cnJlbnQgZGVzaWduLCBhbGwgZW1iZWRkZWQgdmlld3Mgc2hhcmUgYSBjb25zdW1lciB3aXRoIHRoZSBjb21wb25lbnQgdmlldy4gVGhpcyBhbGxvd3NcbiAqIHVzIHRvIHJlZnJlc2ggYXQgdGhlIGNvbXBvbmVudCBsZXZlbCByYXRoZXIgdGhhbiBhdCBhIHBlci12aWV3IGxldmVsLiBJbiBhZGRpdGlvbiwgcm9vdCB2aWV3cyBnZXRcbiAqIHRoZWlyIG93biByZWFjdGl2ZSBub2RlIGJlY2F1c2Ugcm9vdCBjb21wb25lbnQgd2lsbCBoYXZlIGEgaG9zdCB2aWV3IHRoYXQgZXhlY3V0ZXMgdGhlXG4gKiBjb21wb25lbnQncyBob3N0IGJpbmRpbmdzLiBUaGlzIG5lZWRzIHRvIGJlIHRyYWNrZWQgaW4gYSBjb25zdW1lciBhcyB3ZWxsLlxuICpcbiAqIFRvIGdldCBhIG1vcmUgZ3JhbnVsYXIgY2hhbmdlIGRldGVjdGlvbiB0aGFuIHBlci1jb21wb25lbnQsIGFsbCB3ZSB3b3VsZCBqdXN0IG5lZWQgdG8gdXBkYXRlIHRoZVxuICogY29uZGl0aW9uIGhlcmUgc28gdGhhdCBhIGdpdmVuIHZpZXcgZ2V0cyBhIHJlYWN0aXZlIGNvbnN1bWVyIHdoaWNoIGNhbiBiZWNvbWUgZGlydHkgaW5kZXBlbmRlbnRseVxuICogZnJvbSBpdHMgcGFyZW50IGNvbXBvbmVudC4gRm9yIGV4YW1wbGUgZW1iZWRkZWQgdmlld3MgZm9yIHNpZ25hbCBjb21wb25lbnRzIGNvdWxkIGJlIGNyZWF0ZWQgd2l0aFxuICogYSBuZXcgdHlwZSBcIlNpZ25hbEVtYmVkZGVkVmlld1wiIGFuZCB0aGUgY29uZGl0aW9uIGhlcmUgd291bGRuJ3QgZXZlbiBuZWVkIHVwZGF0aW5nIGluIG9yZGVyIHRvXG4gKiBnZXQgZ3JhbnVsYXIgcGVyLXZpZXcgY2hhbmdlIGRldGVjdGlvbiBmb3Igc2lnbmFsIGNvbXBvbmVudHMuXG4gKi9cbmZ1bmN0aW9uIHZpZXdTaG91bGRIYXZlUmVhY3RpdmVDb25zdW1lcih0VmlldzogVFZpZXcpIHtcbiAgcmV0dXJuIHRWaWV3LnR5cGUgIT09IFRWaWV3VHlwZS5FbWJlZGRlZDtcbn1cblxuLyoqXG4gKiBHb2VzIG92ZXIgZW1iZWRkZWQgdmlld3MgKG9uZXMgY3JlYXRlZCB0aHJvdWdoIFZpZXdDb250YWluZXJSZWYgQVBJcykgYW5kIHJlZnJlc2hlc1xuICogdGhlbSBieSBleGVjdXRpbmcgYW4gYXNzb2NpYXRlZCB0ZW1wbGF0ZSBmdW5jdGlvbi5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0Q2hhbmdlc0luRW1iZWRkZWRWaWV3cyhsVmlldzogTFZpZXcsIG1vZGU6IENoYW5nZURldGVjdGlvbk1vZGUpIHtcbiAgZm9yIChsZXQgbENvbnRhaW5lciA9IGdldEZpcnN0TENvbnRhaW5lcihsVmlldyk7IGxDb250YWluZXIgIT09IG51bGw7XG4gICAgICAgbENvbnRhaW5lciA9IGdldE5leHRMQ29udGFpbmVyKGxDb250YWluZXIpKSB7XG4gICAgbENvbnRhaW5lcltIQVNfQ0hJTERfVklFV1NfVE9fUkVGUkVTSF0gPSBmYWxzZTtcbiAgICBmb3IgKGxldCBpID0gQ09OVEFJTkVSX0hFQURFUl9PRkZTRVQ7IGkgPCBsQ29udGFpbmVyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBlbWJlZGRlZExWaWV3ID0gbENvbnRhaW5lcltpXTtcbiAgICAgIGRldGVjdENoYW5nZXNJblZpZXdJZkF0dGFjaGVkKGVtYmVkZGVkTFZpZXcsIG1vZGUpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIE1hcmsgdHJhbnNwbGFudGVkIHZpZXdzIGFzIG5lZWRpbmcgdG8gYmUgcmVmcmVzaGVkIGF0IHRoZWlyIGluc2VydGlvbiBwb2ludHMuXG4gKlxuICogQHBhcmFtIGxWaWV3IFRoZSBgTFZpZXdgIHRoYXQgbWF5IGhhdmUgdHJhbnNwbGFudGVkIHZpZXdzLlxuICovXG5mdW5jdGlvbiBtYXJrVHJhbnNwbGFudGVkVmlld3NGb3JSZWZyZXNoKGxWaWV3OiBMVmlldykge1xuICBmb3IgKGxldCBsQ29udGFpbmVyID0gZ2V0Rmlyc3RMQ29udGFpbmVyKGxWaWV3KTsgbENvbnRhaW5lciAhPT0gbnVsbDtcbiAgICAgICBsQ29udGFpbmVyID0gZ2V0TmV4dExDb250YWluZXIobENvbnRhaW5lcikpIHtcbiAgICBpZiAoIWxDb250YWluZXJbSEFTX1RSQU5TUExBTlRFRF9WSUVXU10pIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgbW92ZWRWaWV3cyA9IGxDb250YWluZXJbTU9WRURfVklFV1NdITtcbiAgICBuZ0Rldk1vZGUgJiYgYXNzZXJ0RGVmaW5lZChtb3ZlZFZpZXdzLCAnVHJhbnNwbGFudGVkIFZpZXcgZmxhZ3Mgc2V0IGJ1dCBtaXNzaW5nIE1PVkVEX1ZJRVdTJyk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtb3ZlZFZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBtb3ZlZExWaWV3ID0gbW92ZWRWaWV3c1tpXSE7XG4gICAgICBjb25zdCBpbnNlcnRpb25MQ29udGFpbmVyID0gbW92ZWRMVmlld1tQQVJFTlRdIGFzIExDb250YWluZXI7XG4gICAgICBuZ0Rldk1vZGUgJiYgYXNzZXJ0TENvbnRhaW5lcihpbnNlcnRpb25MQ29udGFpbmVyKTtcbiAgICAgIG1hcmtWaWV3Rm9yUmVmcmVzaChtb3ZlZExWaWV3KTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBEZXRlY3RzIGNoYW5nZXMgaW4gYSBjb21wb25lbnQgYnkgZW50ZXJpbmcgdGhlIGNvbXBvbmVudCB2aWV3IGFuZCBwcm9jZXNzaW5nIGl0cyBiaW5kaW5ncyxcbiAqIHF1ZXJpZXMsIGV0Yy4gaWYgaXQgaXMgQ2hlY2tBbHdheXMsIE9uUHVzaCBhbmQgRGlydHksIGV0Yy5cbiAqXG4gKiBAcGFyYW0gY29tcG9uZW50SG9zdElkeCAgRWxlbWVudCBpbmRleCBpbiBMVmlld1tdIChhZGp1c3RlZCBmb3IgSEVBREVSX09GRlNFVClcbiAqL1xuZnVuY3Rpb24gZGV0ZWN0Q2hhbmdlc0luQ29tcG9uZW50KFxuICAgIGhvc3RMVmlldzogTFZpZXcsIGNvbXBvbmVudEhvc3RJZHg6IG51bWJlciwgbW9kZTogQ2hhbmdlRGV0ZWN0aW9uTW9kZSk6IHZvaWQge1xuICBuZ0Rldk1vZGUgJiYgYXNzZXJ0RXF1YWwoaXNDcmVhdGlvbk1vZGUoaG9zdExWaWV3KSwgZmFsc2UsICdTaG91bGQgYmUgcnVuIGluIHVwZGF0ZSBtb2RlJyk7XG4gIGNvbnN0IGNvbXBvbmVudFZpZXcgPSBnZXRDb21wb25lbnRMVmlld0J5SW5kZXgoY29tcG9uZW50SG9zdElkeCwgaG9zdExWaWV3KTtcbiAgZGV0ZWN0Q2hhbmdlc0luVmlld0lmQXR0YWNoZWQoY29tcG9uZW50VmlldywgbW9kZSk7XG59XG5cbi8qKlxuICogVmlzaXRzIGEgdmlldyBhcyBwYXJ0IG9mIGNoYW5nZSBkZXRlY3Rpb24gdHJhdmVyc2FsLlxuICpcbiAqIElmIHRoZSB2aWV3IGlzIGRldGFjaGVkLCBubyBhZGRpdGlvbmFsIHRyYXZlcnNhbCBoYXBwZW5zLlxuICovXG5mdW5jdGlvbiBkZXRlY3RDaGFuZ2VzSW5WaWV3SWZBdHRhY2hlZChsVmlldzogTFZpZXcsIG1vZGU6IENoYW5nZURldGVjdGlvbk1vZGUpIHtcbiAgaWYgKCF2aWV3QXR0YWNoZWRUb0NoYW5nZURldGVjdG9yKGxWaWV3KSkge1xuICAgIHJldHVybjtcbiAgfVxuICBkZXRlY3RDaGFuZ2VzSW5WaWV3KGxWaWV3LCBtb2RlKTtcbn1cblxuLyoqXG4gKiBWaXNpdHMgYSB2aWV3IGFzIHBhcnQgb2YgY2hhbmdlIGRldGVjdGlvbiB0cmF2ZXJzYWwuXG4gKlxuICogVGhlIHZpZXcgaXMgcmVmcmVzaGVkIGlmOlxuICogLSBJZiB0aGUgdmlldyBpcyBDaGVja0Fsd2F5cyBvciBEaXJ0eSBhbmQgQ2hhbmdlRGV0ZWN0aW9uTW9kZSBpcyBgR2xvYmFsYFxuICogLSBJZiB0aGUgdmlldyBoYXMgdGhlIGBSZWZyZXNoVHJhbnNwbGFudGVkVmlld2AgZmxhZ1xuICpcbiAqIFRoZSB2aWV3IGlzIG5vdCByZWZyZXNoZWQsIGJ1dCBkZXNjZW5kYW50cyBhcmUgdHJhdmVyc2VkIGluIGBDaGFuZ2VEZXRlY3Rpb25Nb2RlLlRhcmdldGVkYCBpZiB0aGVcbiAqIHZpZXcgSGFzQ2hpbGRWaWV3c1RvUmVmcmVzaCBmbGFnIGlzIHNldC5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0Q2hhbmdlc0luVmlldyhsVmlldzogTFZpZXcsIG1vZGU6IENoYW5nZURldGVjdGlvbk1vZGUpIHtcbiAgY29uc3QgaXNJbkNoZWNrTm9DaGFuZ2VzUGFzcyA9IG5nRGV2TW9kZSAmJiBpc0luQ2hlY2tOb0NoYW5nZXNNb2RlKCk7XG4gIGNvbnN0IHRWaWV3ID0gbFZpZXdbVFZJRVddO1xuICBjb25zdCBmbGFncyA9IGxWaWV3W0ZMQUdTXTtcbiAgY29uc3QgY29uc3VtZXIgPSBsVmlld1tSRUFDVElWRV9URU1QTEFURV9DT05TVU1FUl07XG5cbiAgLy8gUmVmcmVzaCBDaGVja0Fsd2F5cyB2aWV3cyBpbiBHbG9iYWwgbW9kZS5cbiAgbGV0IHNob3VsZFJlZnJlc2hWaWV3OiBib29sZWFuID1cbiAgICAgICEhKG1vZGUgPT09IENoYW5nZURldGVjdGlvbk1vZGUuR2xvYmFsICYmIGZsYWdzICYgTFZpZXdGbGFncy5DaGVja0Fsd2F5cyk7XG5cbiAgLy8gUmVmcmVzaCBEaXJ0eSB2aWV3cyBpbiBHbG9iYWwgbW9kZSwgYXMgbG9uZyBhcyB3ZSdyZSBub3QgaW4gY2hlY2tOb0NoYW5nZXMuXG4gIC8vIENoZWNrTm9DaGFuZ2VzIG5ldmVyIHdvcmtlZCB3aXRoIGBPblB1c2hgIGNvbXBvbmVudHMgYmVjYXVzZSB0aGUgYERpcnR5YCBmbGFnIHdhc1xuICAvLyBjbGVhcmVkIGJlZm9yZSBjaGVja05vQ2hhbmdlcyByYW4uIEJlY2F1c2UgdGhlcmUgaXMgbm93IGEgbG9vcCBmb3IgdG8gY2hlY2sgZm9yXG4gIC8vIGJhY2t3YXJkcyB2aWV3cywgaXQgZ2l2ZXMgYW4gb3Bwb3J0dW5pdHkgZm9yIGBPblB1c2hgIGNvbXBvbmVudHMgdG8gYmUgbWFya2VkIGBEaXJ0eWBcbiAgLy8gYmVmb3JlIHRoZSBDaGVja05vQ2hhbmdlcyBwYXNzLiBXZSBkb24ndCB3YW50IGV4aXN0aW5nIGVycm9ycyB0aGF0IGFyZSBoaWRkZW4gYnkgdGhlXG4gIC8vIGN1cnJlbnQgQ2hlY2tOb0NoYW5nZXMgYnVnIHRvIHN1cmZhY2Ugd2hlbiBtYWtpbmcgdW5yZWxhdGVkIGNoYW5nZXMuXG4gIHNob3VsZFJlZnJlc2hWaWV3IHx8PVxuICAgICAgISEoZmxhZ3MgJiBMVmlld0ZsYWdzLkRpcnR5ICYmIG1vZGUgPT09IENoYW5nZURldGVjdGlvbk1vZGUuR2xvYmFsICYmXG4gICAgICAgICAoIWlzSW5DaGVja05vQ2hhbmdlc1Bhc3MgfHwgUlVOX0lOX0NIRUNLX05PX0NIQU5HRVNfQU5ZV0FZKSk7XG5cbiAgLy8gQWx3YXlzIHJlZnJlc2ggdmlld3MgbWFya2VkIGZvciByZWZyZXNoLCByZWdhcmRsZXNzIG9mIG1vZGUuXG4gIHNob3VsZFJlZnJlc2hWaWV3IHx8PSAhIShmbGFncyAmIExWaWV3RmxhZ3MuUmVmcmVzaFZpZXcpO1xuXG4gIC8vIFJlZnJlc2ggdmlld3Mgd2hlbiB0aGV5IGhhdmUgYSBkaXJ0eSByZWFjdGl2ZSBjb25zdW1lciwgcmVnYXJkbGVzcyBvZiBtb2RlLlxuICBzaG91bGRSZWZyZXNoVmlldyB8fD0gISEoY29uc3VtZXI/LmRpcnR5ICYmIGNvbnN1bWVyUG9sbFByb2R1Y2Vyc0ZvckNoYW5nZShjb25zdW1lcikpO1xuXG4gIC8vIE1hcmsgdGhlIEZsYWdzIGFuZCBgUmVhY3RpdmVOb2RlYCBhcyBub3QgZGlydHkgYmVmb3JlIHJlZnJlc2hpbmcgdGhlIGNvbXBvbmVudCwgc28gdGhhdCB0aGV5XG4gIC8vIGNhbiBiZSByZS1kaXJ0aWVkIGR1cmluZyB0aGUgcmVmcmVzaCBwcm9jZXNzLlxuICBpZiAoY29uc3VtZXIpIHtcbiAgICBjb25zdW1lci5kaXJ0eSA9IGZhbHNlO1xuICB9XG4gIGxWaWV3W0ZMQUdTXSAmPSB+KExWaWV3RmxhZ3MuSGFzQ2hpbGRWaWV3c1RvUmVmcmVzaCB8IExWaWV3RmxhZ3MuUmVmcmVzaFZpZXcpO1xuXG4gIGlmIChzaG91bGRSZWZyZXNoVmlldykge1xuICAgIHJlZnJlc2hWaWV3KHRWaWV3LCBsVmlldywgdFZpZXcudGVtcGxhdGUsIGxWaWV3W0NPTlRFWFRdKTtcbiAgfSBlbHNlIGlmIChmbGFncyAmIExWaWV3RmxhZ3MuSGFzQ2hpbGRWaWV3c1RvUmVmcmVzaCkge1xuICAgIGRldGVjdENoYW5nZXNJbkVtYmVkZGVkVmlld3MobFZpZXcsIENoYW5nZURldGVjdGlvbk1vZGUuVGFyZ2V0ZWQpO1xuICAgIGNvbnN0IGNvbXBvbmVudHMgPSB0Vmlldy5jb21wb25lbnRzO1xuICAgIGlmIChjb21wb25lbnRzICE9PSBudWxsKSB7XG4gICAgICBkZXRlY3RDaGFuZ2VzSW5DaGlsZENvbXBvbmVudHMobFZpZXcsIGNvbXBvbmVudHMsIENoYW5nZURldGVjdGlvbk1vZGUuVGFyZ2V0ZWQpO1xuICAgIH1cbiAgfVxufVxuXG4vKiogUmVmcmVzaGVzIGNoaWxkIGNvbXBvbmVudHMgaW4gdGhlIGN1cnJlbnQgdmlldyAodXBkYXRlIG1vZGUpLiAqL1xuZnVuY3Rpb24gZGV0ZWN0Q2hhbmdlc0luQ2hpbGRDb21wb25lbnRzKFxuICAgIGhvc3RMVmlldzogTFZpZXcsIGNvbXBvbmVudHM6IG51bWJlcltdLCBtb2RlOiBDaGFuZ2VEZXRlY3Rpb25Nb2RlKTogdm9pZCB7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgY29tcG9uZW50cy5sZW5ndGg7IGkrKykge1xuICAgIGRldGVjdENoYW5nZXNJbkNvbXBvbmVudChob3N0TFZpZXcsIGNvbXBvbmVudHNbaV0sIG1vZGUpO1xuICB9XG59XG4iXX0=