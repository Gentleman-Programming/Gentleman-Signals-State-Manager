/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { assertGreaterThan } from '../../util/assert';
import { assertIndexInDeclRange } from '../assert';
import { executeCheckHooks, executeInitAndCheckHooks } from '../hooks';
import { FLAGS, TVIEW } from '../interfaces/view';
import { getLView, getSelectedIndex, getTView, isInCheckNoChangesMode, setSelectedIndex } from '../state';
/**
 * Advances to an element for later binding instructions.
 *
 * Used in conjunction with instructions like {@link property} to act on elements with specified
 * indices, for example those created with {@link element} or {@link elementStart}.
 *
 * ```ts
 * (rf: RenderFlags, ctx: any) => {
 *   if (rf & 1) {
 *     text(0, 'Hello');
 *     text(1, 'Goodbye')
 *     element(2, 'div');
 *   }
 *   if (rf & 2) {
 *     advance(2); // Advance twice to the <div>.
 *     property('title', 'test');
 *   }
 *  }
 * ```
 * @param delta Number of elements to advance forwards by.
 *
 * @codeGenApi
 */
export function ɵɵadvance(delta) {
    ngDevMode && assertGreaterThan(delta, 0, 'Can only advance forward');
    selectIndexInternal(getTView(), getLView(), getSelectedIndex() + delta, !!ngDevMode && isInCheckNoChangesMode());
}
export function selectIndexInternal(tView, lView, index, checkNoChangesMode) {
    ngDevMode && assertIndexInDeclRange(lView[TVIEW], index);
    // Flush the initial hooks for elements in the view that have been added up to this point.
    // PERF WARNING: do NOT extract this to a separate function without running benchmarks
    if (!checkNoChangesMode) {
        const hooksInitPhaseCompleted = (lView[FLAGS] & 3 /* LViewFlags.InitPhaseStateMask */) === 3 /* InitPhaseState.InitPhaseCompleted */;
        if (hooksInitPhaseCompleted) {
            const preOrderCheckHooks = tView.preOrderCheckHooks;
            if (preOrderCheckHooks !== null) {
                executeCheckHooks(lView, preOrderCheckHooks, index);
            }
        }
        else {
            const preOrderHooks = tView.preOrderHooks;
            if (preOrderHooks !== null) {
                executeInitAndCheckHooks(lView, preOrderHooks, 0 /* InitPhaseState.OnInitHooksToBeRun */, index);
            }
        }
    }
    // We must set the selected index *after* running the hooks, because hooks may have side-effects
    // that cause other template functions to run, thus updating the selected index, which is global
    // state. If we run `setSelectedIndex` *before* we run the hooks, in some cases the selected index
    // will be altered by the time we leave the `ɵɵadvance` instruction.
    setSelectedIndex(index);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWR2YW5jZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2NvcmUvc3JjL3JlbmRlcjMvaW5zdHJ1Y3Rpb25zL2FkdmFuY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7OztHQU1HO0FBQ0gsT0FBTyxFQUFDLGlCQUFpQixFQUFDLE1BQU0sbUJBQW1CLENBQUM7QUFDcEQsT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sV0FBVyxDQUFDO0FBQ2pELE9BQU8sRUFBQyxpQkFBaUIsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLFVBQVUsQ0FBQztBQUNyRSxPQUFPLEVBQUMsS0FBSyxFQUFxQyxLQUFLLEVBQVEsTUFBTSxvQkFBb0IsQ0FBQztBQUMxRixPQUFPLEVBQUMsUUFBUSxFQUFFLGdCQUFnQixFQUFFLFFBQVEsRUFBRSxzQkFBc0IsRUFBRSxnQkFBZ0IsRUFBQyxNQUFNLFVBQVUsQ0FBQztBQUd4Rzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXNCRztBQUNILE1BQU0sVUFBVSxTQUFTLENBQUMsS0FBYTtJQUNyQyxTQUFTLElBQUksaUJBQWlCLENBQUMsS0FBSyxFQUFFLENBQUMsRUFBRSwwQkFBMEIsQ0FBQyxDQUFDO0lBQ3JFLG1CQUFtQixDQUNmLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRSxFQUFFLGdCQUFnQixFQUFFLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQyxTQUFTLElBQUksc0JBQXNCLEVBQUUsQ0FBQyxDQUFDO0FBQ25HLENBQUM7QUFFRCxNQUFNLFVBQVUsbUJBQW1CLENBQy9CLEtBQVksRUFBRSxLQUFZLEVBQUUsS0FBYSxFQUFFLGtCQUEyQjtJQUN4RSxTQUFTLElBQUksc0JBQXNCLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBRXpELDBGQUEwRjtJQUMxRixzRkFBc0Y7SUFDdEYsSUFBSSxDQUFDLGtCQUFrQixFQUFFO1FBQ3ZCLE1BQU0sdUJBQXVCLEdBQ3pCLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyx3Q0FBZ0MsQ0FBQyw4Q0FBc0MsQ0FBQztRQUN6RixJQUFJLHVCQUF1QixFQUFFO1lBQzNCLE1BQU0sa0JBQWtCLEdBQUcsS0FBSyxDQUFDLGtCQUFrQixDQUFDO1lBQ3BELElBQUksa0JBQWtCLEtBQUssSUFBSSxFQUFFO2dCQUMvQixpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsa0JBQWtCLEVBQUUsS0FBSyxDQUFDLENBQUM7YUFDckQ7U0FDRjthQUFNO1lBQ0wsTUFBTSxhQUFhLEdBQUcsS0FBSyxDQUFDLGFBQWEsQ0FBQztZQUMxQyxJQUFJLGFBQWEsS0FBSyxJQUFJLEVBQUU7Z0JBQzFCLHdCQUF3QixDQUFDLEtBQUssRUFBRSxhQUFhLDZDQUFxQyxLQUFLLENBQUMsQ0FBQzthQUMxRjtTQUNGO0tBQ0Y7SUFFRCxnR0FBZ0c7SUFDaEcsZ0dBQWdHO0lBQ2hHLGtHQUFrRztJQUNsRyxvRUFBb0U7SUFDcEUsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDMUIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuaW1wb3J0IHthc3NlcnRHcmVhdGVyVGhhbn0gZnJvbSAnLi4vLi4vdXRpbC9hc3NlcnQnO1xuaW1wb3J0IHthc3NlcnRJbmRleEluRGVjbFJhbmdlfSBmcm9tICcuLi9hc3NlcnQnO1xuaW1wb3J0IHtleGVjdXRlQ2hlY2tIb29rcywgZXhlY3V0ZUluaXRBbmRDaGVja0hvb2tzfSBmcm9tICcuLi9ob29rcyc7XG5pbXBvcnQge0ZMQUdTLCBJbml0UGhhc2VTdGF0ZSwgTFZpZXcsIExWaWV3RmxhZ3MsIFRWSUVXLCBUVmlld30gZnJvbSAnLi4vaW50ZXJmYWNlcy92aWV3JztcbmltcG9ydCB7Z2V0TFZpZXcsIGdldFNlbGVjdGVkSW5kZXgsIGdldFRWaWV3LCBpc0luQ2hlY2tOb0NoYW5nZXNNb2RlLCBzZXRTZWxlY3RlZEluZGV4fSBmcm9tICcuLi9zdGF0ZSc7XG5cblxuLyoqXG4gKiBBZHZhbmNlcyB0byBhbiBlbGVtZW50IGZvciBsYXRlciBiaW5kaW5nIGluc3RydWN0aW9ucy5cbiAqXG4gKiBVc2VkIGluIGNvbmp1bmN0aW9uIHdpdGggaW5zdHJ1Y3Rpb25zIGxpa2Uge0BsaW5rIHByb3BlcnR5fSB0byBhY3Qgb24gZWxlbWVudHMgd2l0aCBzcGVjaWZpZWRcbiAqIGluZGljZXMsIGZvciBleGFtcGxlIHRob3NlIGNyZWF0ZWQgd2l0aCB7QGxpbmsgZWxlbWVudH0gb3Ige0BsaW5rIGVsZW1lbnRTdGFydH0uXG4gKlxuICogYGBgdHNcbiAqIChyZjogUmVuZGVyRmxhZ3MsIGN0eDogYW55KSA9PiB7XG4gKiAgIGlmIChyZiAmIDEpIHtcbiAqICAgICB0ZXh0KDAsICdIZWxsbycpO1xuICogICAgIHRleHQoMSwgJ0dvb2RieWUnKVxuICogICAgIGVsZW1lbnQoMiwgJ2RpdicpO1xuICogICB9XG4gKiAgIGlmIChyZiAmIDIpIHtcbiAqICAgICBhZHZhbmNlKDIpOyAvLyBBZHZhbmNlIHR3aWNlIHRvIHRoZSA8ZGl2Pi5cbiAqICAgICBwcm9wZXJ0eSgndGl0bGUnLCAndGVzdCcpO1xuICogICB9XG4gKiAgfVxuICogYGBgXG4gKiBAcGFyYW0gZGVsdGEgTnVtYmVyIG9mIGVsZW1lbnRzIHRvIGFkdmFuY2UgZm9yd2FyZHMgYnkuXG4gKlxuICogQGNvZGVHZW5BcGlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIMm1ybVhZHZhbmNlKGRlbHRhOiBudW1iZXIpOiB2b2lkIHtcbiAgbmdEZXZNb2RlICYmIGFzc2VydEdyZWF0ZXJUaGFuKGRlbHRhLCAwLCAnQ2FuIG9ubHkgYWR2YW5jZSBmb3J3YXJkJyk7XG4gIHNlbGVjdEluZGV4SW50ZXJuYWwoXG4gICAgICBnZXRUVmlldygpLCBnZXRMVmlldygpLCBnZXRTZWxlY3RlZEluZGV4KCkgKyBkZWx0YSwgISFuZ0Rldk1vZGUgJiYgaXNJbkNoZWNrTm9DaGFuZ2VzTW9kZSgpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbGVjdEluZGV4SW50ZXJuYWwoXG4gICAgdFZpZXc6IFRWaWV3LCBsVmlldzogTFZpZXcsIGluZGV4OiBudW1iZXIsIGNoZWNrTm9DaGFuZ2VzTW9kZTogYm9vbGVhbikge1xuICBuZ0Rldk1vZGUgJiYgYXNzZXJ0SW5kZXhJbkRlY2xSYW5nZShsVmlld1tUVklFV10sIGluZGV4KTtcblxuICAvLyBGbHVzaCB0aGUgaW5pdGlhbCBob29rcyBmb3IgZWxlbWVudHMgaW4gdGhlIHZpZXcgdGhhdCBoYXZlIGJlZW4gYWRkZWQgdXAgdG8gdGhpcyBwb2ludC5cbiAgLy8gUEVSRiBXQVJOSU5HOiBkbyBOT1QgZXh0cmFjdCB0aGlzIHRvIGEgc2VwYXJhdGUgZnVuY3Rpb24gd2l0aG91dCBydW5uaW5nIGJlbmNobWFya3NcbiAgaWYgKCFjaGVja05vQ2hhbmdlc01vZGUpIHtcbiAgICBjb25zdCBob29rc0luaXRQaGFzZUNvbXBsZXRlZCA9XG4gICAgICAgIChsVmlld1tGTEFHU10gJiBMVmlld0ZsYWdzLkluaXRQaGFzZVN0YXRlTWFzaykgPT09IEluaXRQaGFzZVN0YXRlLkluaXRQaGFzZUNvbXBsZXRlZDtcbiAgICBpZiAoaG9va3NJbml0UGhhc2VDb21wbGV0ZWQpIHtcbiAgICAgIGNvbnN0IHByZU9yZGVyQ2hlY2tIb29rcyA9IHRWaWV3LnByZU9yZGVyQ2hlY2tIb29rcztcbiAgICAgIGlmIChwcmVPcmRlckNoZWNrSG9va3MgIT09IG51bGwpIHtcbiAgICAgICAgZXhlY3V0ZUNoZWNrSG9va3MobFZpZXcsIHByZU9yZGVyQ2hlY2tIb29rcywgaW5kZXgpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBwcmVPcmRlckhvb2tzID0gdFZpZXcucHJlT3JkZXJIb29rcztcbiAgICAgIGlmIChwcmVPcmRlckhvb2tzICE9PSBudWxsKSB7XG4gICAgICAgIGV4ZWN1dGVJbml0QW5kQ2hlY2tIb29rcyhsVmlldywgcHJlT3JkZXJIb29rcywgSW5pdFBoYXNlU3RhdGUuT25Jbml0SG9va3NUb0JlUnVuLCBpbmRleCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gV2UgbXVzdCBzZXQgdGhlIHNlbGVjdGVkIGluZGV4ICphZnRlciogcnVubmluZyB0aGUgaG9va3MsIGJlY2F1c2UgaG9va3MgbWF5IGhhdmUgc2lkZS1lZmZlY3RzXG4gIC8vIHRoYXQgY2F1c2Ugb3RoZXIgdGVtcGxhdGUgZnVuY3Rpb25zIHRvIHJ1biwgdGh1cyB1cGRhdGluZyB0aGUgc2VsZWN0ZWQgaW5kZXgsIHdoaWNoIGlzIGdsb2JhbFxuICAvLyBzdGF0ZS4gSWYgd2UgcnVuIGBzZXRTZWxlY3RlZEluZGV4YCAqYmVmb3JlKiB3ZSBydW4gdGhlIGhvb2tzLCBpbiBzb21lIGNhc2VzIHRoZSBzZWxlY3RlZCBpbmRleFxuICAvLyB3aWxsIGJlIGFsdGVyZWQgYnkgdGhlIHRpbWUgd2UgbGVhdmUgdGhlIGDJtcm1YWR2YW5jZWAgaW5zdHJ1Y3Rpb24uXG4gIHNldFNlbGVjdGVkSW5kZXgoaW5kZXgpO1xufVxuIl19