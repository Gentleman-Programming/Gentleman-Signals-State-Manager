/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { getDebugNode, RendererFactory2, ɵgetDeferBlocks as getDeferBlocks } from '@angular/core';
import { DeferBlockFixture } from './defer';
/**
 * Fixture for debugging and testing a component.
 *
 * @publicApi
 */
export class ComponentFixture {
    /** @nodoc */
    constructor(componentRef, ngZone, effectRunner, _autoDetect) {
        this.componentRef = componentRef;
        this.ngZone = ngZone;
        this.effectRunner = effectRunner;
        this._autoDetect = _autoDetect;
        this._isStable = true;
        this._isDestroyed = false;
        this._resolve = null;
        this._promise = null;
        this._onUnstableSubscription = null;
        this._onStableSubscription = null;
        this._onMicrotaskEmptySubscription = null;
        this._onErrorSubscription = null;
        this.changeDetectorRef = componentRef.changeDetectorRef;
        this.elementRef = componentRef.location;
        this.debugElement = getDebugNode(this.elementRef.nativeElement);
        this.componentInstance = componentRef.instance;
        this.nativeElement = this.elementRef.nativeElement;
        this.componentRef = componentRef;
        this.ngZone = ngZone;
        if (ngZone) {
            // Create subscriptions outside the NgZone so that the callbacks run oustide
            // of NgZone.
            ngZone.runOutsideAngular(() => {
                this._onUnstableSubscription = ngZone.onUnstable.subscribe({
                    next: () => {
                        this._isStable = false;
                    }
                });
                this._onMicrotaskEmptySubscription = ngZone.onMicrotaskEmpty.subscribe({
                    next: () => {
                        if (this._autoDetect) {
                            // Do a change detection run with checkNoChanges set to true to check
                            // there are no changes on the second run.
                            this.detectChanges(true);
                        }
                    }
                });
                this._onStableSubscription = ngZone.onStable.subscribe({
                    next: () => {
                        this._isStable = true;
                        // Check whether there is a pending whenStable() completer to resolve.
                        if (this._promise !== null) {
                            // If so check whether there are no pending macrotasks before resolving.
                            // Do this check in the next tick so that ngZone gets a chance to update the state of
                            // pending macrotasks.
                            queueMicrotask(() => {
                                if (!ngZone.hasPendingMacrotasks) {
                                    if (this._promise !== null) {
                                        this._resolve(true);
                                        this._resolve = null;
                                        this._promise = null;
                                    }
                                }
                            });
                        }
                    }
                });
                this._onErrorSubscription = ngZone.onError.subscribe({
                    next: (error) => {
                        throw error;
                    }
                });
            });
        }
    }
    _tick(checkNoChanges) {
        this.changeDetectorRef.detectChanges();
        if (checkNoChanges) {
            this.checkNoChanges();
        }
    }
    /**
     * Trigger a change detection cycle for the component.
     */
    detectChanges(checkNoChanges = true) {
        this.effectRunner?.flush();
        if (this.ngZone != null) {
            // Run the change detection inside the NgZone so that any async tasks as part of the change
            // detection are captured by the zone and can be waited for in isStable.
            this.ngZone.run(() => {
                this._tick(checkNoChanges);
            });
        }
        else {
            // Running without zone. Just do the change detection.
            this._tick(checkNoChanges);
        }
        // Run any effects that were created/dirtied during change detection. Such effects might become
        // dirty in response to input signals changing.
        this.effectRunner?.flush();
    }
    /**
     * Do a change detection run to make sure there were no changes.
     */
    checkNoChanges() {
        this.changeDetectorRef.checkNoChanges();
    }
    /**
     * Set whether the fixture should autodetect changes.
     *
     * Also runs detectChanges once so that any existing change is detected.
     */
    autoDetectChanges(autoDetect = true) {
        if (this.ngZone == null) {
            throw new Error('Cannot call autoDetectChanges when ComponentFixtureNoNgZone is set');
        }
        this._autoDetect = autoDetect;
        this.detectChanges();
    }
    /**
     * Return whether the fixture is currently stable or has async tasks that have not been completed
     * yet.
     */
    isStable() {
        return this._isStable && !this.ngZone.hasPendingMacrotasks;
    }
    /**
     * Get a promise that resolves when the fixture is stable.
     *
     * This can be used to resume testing after events have triggered asynchronous activity or
     * asynchronous change detection.
     */
    whenStable() {
        if (this.isStable()) {
            return Promise.resolve(false);
        }
        else if (this._promise !== null) {
            return this._promise;
        }
        else {
            this._promise = new Promise(res => {
                this._resolve = res;
            });
            return this._promise;
        }
    }
    /**
     * Retrieves all defer block fixtures in the component fixture.
     *
     * @developerPreview
     */
    getDeferBlocks() {
        const deferBlocks = [];
        const lView = this.componentRef.hostView['_lView'];
        getDeferBlocks(lView, deferBlocks);
        const deferBlockFixtures = [];
        for (const block of deferBlocks) {
            deferBlockFixtures.push(new DeferBlockFixture(block, this));
        }
        return Promise.resolve(deferBlockFixtures);
    }
    _getRenderer() {
        if (this._renderer === undefined) {
            this._renderer = this.componentRef.injector.get(RendererFactory2, null);
        }
        return this._renderer;
    }
    /**
     * Get a promise that resolves when the ui state is stable following animations.
     */
    whenRenderingDone() {
        const renderer = this._getRenderer();
        if (renderer && renderer.whenRenderingDone) {
            return renderer.whenRenderingDone();
        }
        return this.whenStable();
    }
    /**
     * Trigger component destruction.
     */
    destroy() {
        if (!this._isDestroyed) {
            this.componentRef.destroy();
            if (this._onUnstableSubscription != null) {
                this._onUnstableSubscription.unsubscribe();
                this._onUnstableSubscription = null;
            }
            if (this._onStableSubscription != null) {
                this._onStableSubscription.unsubscribe();
                this._onStableSubscription = null;
            }
            if (this._onMicrotaskEmptySubscription != null) {
                this._onMicrotaskEmptySubscription.unsubscribe();
                this._onMicrotaskEmptySubscription = null;
            }
            if (this._onErrorSubscription != null) {
                this._onErrorSubscription.unsubscribe();
                this._onErrorSubscription = null;
            }
            this._isDestroyed = true;
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcG9uZW50X2ZpeHR1cmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9jb3JlL3Rlc3Rpbmcvc3JjL2NvbXBvbmVudF9maXh0dXJlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBNEQsWUFBWSxFQUFVLGdCQUFnQixFQUE0RixlQUFlLElBQUksY0FBYyxFQUFDLE1BQU0sZUFBZSxDQUFDO0FBRzdQLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLFNBQVMsQ0FBQztBQUcxQzs7OztHQUlHO0FBQ0gsTUFBTSxPQUFPLGdCQUFnQjtJQW9DM0IsYUFBYTtJQUNiLFlBQ1csWUFBNkIsRUFBUyxNQUFtQixFQUN4RCxZQUF3QyxFQUFVLFdBQW9CO1FBRHZFLGlCQUFZLEdBQVosWUFBWSxDQUFpQjtRQUFTLFdBQU0sR0FBTixNQUFNLENBQWE7UUFDeEQsaUJBQVksR0FBWixZQUFZLENBQTRCO1FBQVUsZ0JBQVcsR0FBWCxXQUFXLENBQVM7UUFaMUUsY0FBUyxHQUFZLElBQUksQ0FBQztRQUMxQixpQkFBWSxHQUFZLEtBQUssQ0FBQztRQUM5QixhQUFRLEdBQXFDLElBQUksQ0FBQztRQUNsRCxhQUFRLEdBQTBCLElBQUksQ0FBQztRQUN2Qyw0QkFBdUIsR0FBc0IsSUFBSSxDQUFDO1FBQ2xELDBCQUFxQixHQUFzQixJQUFJLENBQUM7UUFDaEQsa0NBQTZCLEdBQXNCLElBQUksQ0FBQztRQUN4RCx5QkFBb0IsR0FBc0IsSUFBSSxDQUFDO1FBTXJELElBQUksQ0FBQyxpQkFBaUIsR0FBRyxZQUFZLENBQUMsaUJBQWlCLENBQUM7UUFDeEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxZQUFZLENBQUMsUUFBUSxDQUFDO1FBQ3hDLElBQUksQ0FBQyxZQUFZLEdBQWlCLFlBQVksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQzlFLElB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LElBQUksRUFBRTtnQkFDdEMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFdBQVcsRUFBRSxDQUFDO2dCQUN6QyxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxDQUFDO2FBQ25DO1lBQ0QsSUFBSSxJQUFJLENBQUMsNkJBQTZCLElBQUksSUFBSSxFQUFFO2dCQUM5QyxJQUFJLENBQUMsNkJBQTZCLENBQUMsV0FBVyxFQUFFLENBQUM7Z0JBQ2pELElBQUksQ0FBQyw2QkFBNkIsR0FBRyxJQUFJLENBQUM7YUFDM0M7WUFDRCxJQUFJLElBQUksQ0FBQyxvQkFBb0IsSUFBSSxJQUFJLEVBQUU7Z0JBQ3JDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxXQUFXLEVBQUUsQ0FBQztnQkFDeEMsSUFBSSxDQUFDLG9CQUFvQixHQUFHLElBQUksQ0FBQzthQUNsQztZQUNELElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDO1NBQzFCO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB7Q2hhbmdlRGV0ZWN0b3JSZWYsIENvbXBvbmVudFJlZiwgRGVidWdFbGVtZW50LCBFbGVtZW50UmVmLCBnZXREZWJ1Z05vZGUsIE5nWm9uZSwgUmVuZGVyZXJGYWN0b3J5MiwgybVEZWZlckJsb2NrRGV0YWlscyBhcyBEZWZlckJsb2NrRGV0YWlscywgybVGbHVzaGFibGVFZmZlY3RSdW5uZXIgYXMgRmx1c2hhYmxlRWZmZWN0UnVubmVyLCDJtWdldERlZmVyQmxvY2tzIGFzIGdldERlZmVyQmxvY2tzfSBmcm9tICdAYW5ndWxhci9jb3JlJztcbmltcG9ydCB7U3Vic2NyaXB0aW9ufSBmcm9tICdyeGpzJztcblxuaW1wb3J0IHtEZWZlckJsb2NrRml4dHVyZX0gZnJvbSAnLi9kZWZlcic7XG5cblxuLyoqXG4gKiBGaXh0dXJlIGZvciBkZWJ1Z2dpbmcgYW5kIHRlc3RpbmcgYSBjb21wb25lbnQuXG4gKlxuICogQHB1YmxpY0FwaVxuICovXG5leHBvcnQgY2xhc3MgQ29tcG9uZW50Rml4dHVyZTxUPiB7XG4gIC8qKlxuICAgKiBUaGUgRGVidWdFbGVtZW50IGFzc29jaWF0ZWQgd2l0aCB0aGUgcm9vdCBlbGVtZW50IG9mIHRoaXMgY29tcG9uZW50LlxuICAgKi9cbiAgZGVidWdFbGVtZW50OiBEZWJ1Z0VsZW1lbnQ7XG5cbiAgLyoqXG4gICAqIFRoZSBpbnN0YW5jZSBvZiB0aGUgcm9vdCBjb21wb25lbnQgY2xhc3MuXG4gICAqL1xuICBjb21wb25lbnRJbnN0YW5jZTogVDtcblxuICAvKipcbiAgICogVGhlIG5hdGl2ZSBlbGVtZW50IGF0IHRoZSByb290IG9mIHRoZSBjb21wb25lbnQuXG4gICAqL1xuICBuYXRpdmVFbGVtZW50OiBhbnk7XG5cbiAgLyoqXG4gICAqIFRoZSBFbGVtZW50UmVmIGZvciB0aGUgZWxlbWVudCBhdCB0aGUgcm9vdCBvZiB0aGUgY29tcG9uZW50LlxuICAgKi9cbiAgZWxlbWVudFJlZjogRWxlbWVudFJlZjtcblxuICAvKipcbiAgICogVGhlIENoYW5nZURldGVjdG9yUmVmIGZvciB0aGUgY29tcG9uZW50XG4gICAqL1xuICBjaGFuZ2VEZXRlY3RvclJlZjogQ2hhbmdlRGV0ZWN0b3JSZWY7XG5cbiAgcHJpdmF0ZSBfcmVuZGVyZXI6IFJlbmRlcmVyRmFjdG9yeTJ8bnVsbHx1bmRlZmluZWQ7XG4gIHByaXZhdGUgX2lzU3RhYmxlOiBib29sZWFuID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfaXNEZXN0cm95ZWQ6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBfcmVzb2x2ZTogKChyZXN1bHQ6IGJvb2xlYW4pID0+IHZvaWQpfG51bGwgPSBudWxsO1xuICBwcml2YXRlIF9wcm9taXNlOiBQcm9taXNlPGJvb2xlYW4+fG51bGwgPSBudWxsO1xuICBwcml2YXRlIF9vblVuc3RhYmxlU3Vic2NyaXB0aW9uOiBTdWJzY3JpcHRpb258bnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uU3RhYmxlU3Vic2NyaXB0aW9uOiBTdWJzY3JpcHRpb258bnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uTWljcm90YXNrRW1wdHlTdWJzY3JpcHRpb246IFN1YnNjcmlwdGlvbnxudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfb25FcnJvclN1YnNjcmlwdGlvbjogU3Vic2NyaXB0aW9ufG51bGwgPSBudWxsO1xuXG4gIC8qKiBAbm9kb2MgKi9cbiAgY29uc3RydWN0b3IoXG4gICAgICBwdWJsaWMgY29tcG9uZW50UmVmOiBDb21wb25lbnRSZWY8VD4sIHB1YmxpYyBuZ1pvbmU6IE5nWm9uZXxudWxsLFxuICAgICAgcHJpdmF0ZSBlZmZlY3RSdW5uZXI6IEZsdXNoYWJsZUVmZmVjdFJ1bm5lcnxudWxsLCBwcml2YXRlIF9hdXRvRGV0ZWN0OiBib29sZWFuKSB7XG4gICAgdGhpcy5jaGFuZ2VEZXRlY3RvclJlZiA9IGNvbXBvbmVudFJlZi5jaGFuZ2VEZXRlY3RvclJlZjtcbiAgICB0aGlzLmVsZW1lbnRSZWYgPSBjb21wb25lbnRSZWYubG9jYXRpb247XG4gICAgdGhpcy5kZWJ1Z0VsZW1lbnQgPSA8RGVidWdFbGVtZW50PmdldERlYnVnTm9kZSh0aGlzLmVsZW1lbnRSZWYubmF0aXZlRWxlbWVudCk7XG4gICAgdGhpcy5jb21wb25lbnRJbnN0YW5jZSA9IGNvbXBvbmVudFJlZi5pbnN0YW5jZTtcbiAgICB0aGlzLm5hdGl2ZUVsZW1lbnQgPSB0aGlzLmVsZW1lbnRSZWYubmF0aXZlRWxlbWVudDtcbiAgICB0aGlzLmNvbXBvbmVudFJlZiA9IGNvbXBvbmVudFJlZjtcbiAgICB0aGlzLm5nWm9uZSA9IG5nWm9uZTtcblxuICAgIGlmIChuZ1pvbmUpIHtcbiAgICAgIC8vIENyZWF0ZSBzdWJzY3JpcHRpb25zIG91dHNpZGUgdGhlIE5nWm9uZSBzbyB0aGF0IHRoZSBjYWxsYmFja3MgcnVuIG91c3RpZGVcbiAgICAgIC8vIG9mIE5nWm9uZS5cbiAgICAgIG5nWm9uZS5ydW5PdXRzaWRlQW5ndWxhcigoKSA9PiB7XG4gICAgICAgIHRoaXMuX29uVW5zdGFibGVTdWJzY3JpcHRpb24gPSBuZ1pvbmUub25VbnN0YWJsZS5zdWJzY3JpYmUoe1xuICAgICAgICAgIG5leHQ6ICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuX2lzU3RhYmxlID0gZmFsc2U7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5fb25NaWNyb3Rhc2tFbXB0eVN1YnNjcmlwdGlvbiA9IG5nWm9uZS5vbk1pY3JvdGFza0VtcHR5LnN1YnNjcmliZSh7XG4gICAgICAgICAgbmV4dDogKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMuX2F1dG9EZXRlY3QpIHtcbiAgICAgICAgICAgICAgLy8gRG8gYSBjaGFuZ2UgZGV0ZWN0aW9uIHJ1biB3aXRoIGNoZWNrTm9DaGFuZ2VzIHNldCB0byB0cnVlIHRvIGNoZWNrXG4gICAgICAgICAgICAgIC8vIHRoZXJlIGFyZSBubyBjaGFuZ2VzIG9uIHRoZSBzZWNvbmQgcnVuLlxuICAgICAgICAgICAgICB0aGlzLmRldGVjdENoYW5nZXModHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5fb25TdGFibGVTdWJzY3JpcHRpb24gPSBuZ1pvbmUub25TdGFibGUuc3Vic2NyaWJlKHtcbiAgICAgICAgICBuZXh0OiAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLl9pc1N0YWJsZSA9IHRydWU7XG4gICAgICAgICAgICAvLyBDaGVjayB3aGV0aGVyIHRoZXJlIGlzIGEgcGVuZGluZyB3aGVuU3RhYmxlKCkgY29tcGxldGVyIHRvIHJlc29sdmUuXG4gICAgICAgICAgICBpZiAodGhpcy5fcHJvbWlzZSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAvLyBJZiBzbyBjaGVjayB3aGV0aGVyIHRoZXJlIGFyZSBubyBwZW5kaW5nIG1hY3JvdGFza3MgYmVmb3JlIHJlc29sdmluZy5cbiAgICAgICAgICAgICAgLy8gRG8gdGhpcyBjaGVjayBpbiB0aGUgbmV4dCB0aWNrIHNvIHRoYXQgbmdab25lIGdldHMgYSBjaGFuY2UgdG8gdXBkYXRlIHRoZSBzdGF0ZSBvZlxuICAgICAgICAgICAgICAvLyBwZW5kaW5nIG1hY3JvdGFza3MuXG4gICAgICAgICAgICAgIHF1ZXVlTWljcm90YXNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIW5nWm9uZS5oYXNQZW5kaW5nTWFjcm90YXNrcykge1xuICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuX3Byb21pc2UgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fcmVzb2x2ZSEodHJ1ZSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3Jlc29sdmUgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9wcm9taXNlID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5fb25FcnJvclN1YnNjcmlwdGlvbiA9IG5nWm9uZS5vbkVycm9yLnN1YnNjcmliZSh7XG4gICAgICAgICAgbmV4dDogKGVycm9yOiBhbnkpID0+IHtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF90aWNrKGNoZWNrTm9DaGFuZ2VzOiBib29sZWFuKSB7XG4gICAgdGhpcy5jaGFuZ2VEZXRlY3RvclJlZi5kZXRlY3RDaGFuZ2VzKCk7XG4gICAgaWYgKGNoZWNrTm9DaGFuZ2VzKSB7XG4gICAgICB0aGlzLmNoZWNrTm9DaGFuZ2VzKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRyaWdnZXIgYSBjaGFuZ2UgZGV0ZWN0aW9uIGN5Y2xlIGZvciB0aGUgY29tcG9uZW50LlxuICAgKi9cbiAgZGV0ZWN0Q2hhbmdlcyhjaGVja05vQ2hhbmdlczogYm9vbGVhbiA9IHRydWUpOiB2b2lkIHtcbiAgICB0aGlzLmVmZmVjdFJ1bm5lcj8uZmx1c2goKTtcbiAgICBpZiAodGhpcy5uZ1pvbmUgIT0gbnVsbCkge1xuICAgICAgLy8gUnVuIHRoZSBjaGFuZ2UgZGV0ZWN0aW9uIGluc2lkZSB0aGUgTmdab25lIHNvIHRoYXQgYW55IGFzeW5jIHRhc2tzIGFzIHBhcnQgb2YgdGhlIGNoYW5nZVxuICAgICAgLy8gZGV0ZWN0aW9uIGFyZSBjYXB0dXJlZCBieSB0aGUgem9uZSBhbmQgY2FuIGJlIHdhaXRlZCBmb3IgaW4gaXNTdGFibGUuXG4gICAgICB0aGlzLm5nWm9uZS5ydW4oKCkgPT4ge1xuICAgICAgICB0aGlzLl90aWNrKGNoZWNrTm9DaGFuZ2VzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSdW5uaW5nIHdpdGhvdXQgem9uZS4gSnVzdCBkbyB0aGUgY2hhbmdlIGRldGVjdGlvbi5cbiAgICAgIHRoaXMuX3RpY2soY2hlY2tOb0NoYW5nZXMpO1xuICAgIH1cbiAgICAvLyBSdW4gYW55IGVmZmVjdHMgdGhhdCB3ZXJlIGNyZWF0ZWQvZGlydGllZCBkdXJpbmcgY2hhbmdlIGRldGVjdGlvbi4gU3VjaCBlZmZlY3RzIG1pZ2h0IGJlY29tZVxuICAgIC8vIGRpcnR5IGluIHJlc3BvbnNlIHRvIGlucHV0IHNpZ25hbHMgY2hhbmdpbmcuXG4gICAgdGhpcy5lZmZlY3RSdW5uZXI/LmZsdXNoKCk7XG4gIH1cblxuICAvKipcbiAgICogRG8gYSBjaGFuZ2UgZGV0ZWN0aW9uIHJ1biB0byBtYWtlIHN1cmUgdGhlcmUgd2VyZSBubyBjaGFuZ2VzLlxuICAgKi9cbiAgY2hlY2tOb0NoYW5nZXMoKTogdm9pZCB7XG4gICAgdGhpcy5jaGFuZ2VEZXRlY3RvclJlZi5jaGVja05vQ2hhbmdlcygpO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCB3aGV0aGVyIHRoZSBmaXh0dXJlIHNob3VsZCBhdXRvZGV0ZWN0IGNoYW5nZXMuXG4gICAqXG4gICAqIEFsc28gcnVucyBkZXRlY3RDaGFuZ2VzIG9uY2Ugc28gdGhhdCBhbnkgZXhpc3RpbmcgY2hhbmdlIGlzIGRldGVjdGVkLlxuICAgKi9cbiAgYXV0b0RldGVjdENoYW5nZXMoYXV0b0RldGVjdDogYm9vbGVhbiA9IHRydWUpIHtcbiAgICBpZiAodGhpcy5uZ1pvbmUgPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgY2FsbCBhdXRvRGV0ZWN0Q2hhbmdlcyB3aGVuIENvbXBvbmVudEZpeHR1cmVOb05nWm9uZSBpcyBzZXQnKTtcbiAgICB9XG4gICAgdGhpcy5fYXV0b0RldGVjdCA9IGF1dG9EZXRlY3Q7XG4gICAgdGhpcy5kZXRlY3RDaGFuZ2VzKCk7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHdoZXRoZXIgdGhlIGZpeHR1cmUgaXMgY3VycmVudGx5IHN0YWJsZSBvciBoYXMgYXN5bmMgdGFza3MgdGhhdCBoYXZlIG5vdCBiZWVuIGNvbXBsZXRlZFxuICAgKiB5ZXQuXG4gICAqL1xuICBpc1N0YWJsZSgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5faXNTdGFibGUgJiYgIXRoaXMubmdab25lIS5oYXNQZW5kaW5nTWFjcm90YXNrcztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgZml4dHVyZSBpcyBzdGFibGUuXG4gICAqXG4gICAqIFRoaXMgY2FuIGJlIHVzZWQgdG8gcmVzdW1lIHRlc3RpbmcgYWZ0ZXIgZXZlbnRzIGhhdmUgdHJpZ2dlcmVkIGFzeW5jaHJvbm91cyBhY3Rpdml0eSBvclxuICAgKiBhc3luY2hyb25vdXMgY2hhbmdlIGRldGVjdGlvbi5cbiAgICovXG4gIHdoZW5TdGFibGUoKTogUHJvbWlzZTxhbnk+IHtcbiAgICBpZiAodGhpcy5pc1N0YWJsZSgpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGZhbHNlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX3Byb21pc2UgIT09IG51bGwpIHtcbiAgICAgIHJldHVybiB0aGlzLl9wcm9taXNlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9wcm9taXNlID0gbmV3IFByb21pc2UocmVzID0+IHtcbiAgICAgICAgdGhpcy5fcmVzb2x2ZSA9IHJlcztcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRoaXMuX3Byb21pc2U7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyBhbGwgZGVmZXIgYmxvY2sgZml4dHVyZXMgaW4gdGhlIGNvbXBvbmVudCBmaXh0dXJlLlxuICAgKlxuICAgKiBAZGV2ZWxvcGVyUHJldmlld1xuICAgKi9cbiAgZ2V0RGVmZXJCbG9ja3MoKTogUHJvbWlzZTxEZWZlckJsb2NrRml4dHVyZVtdPiB7XG4gICAgY29uc3QgZGVmZXJCbG9ja3M6IERlZmVyQmxvY2tEZXRhaWxzW10gPSBbXTtcbiAgICBjb25zdCBsVmlldyA9ICh0aGlzLmNvbXBvbmVudFJlZi5ob3N0VmlldyBhcyBhbnkpWydfbFZpZXcnXTtcbiAgICBnZXREZWZlckJsb2NrcyhsVmlldywgZGVmZXJCbG9ja3MpO1xuXG4gICAgY29uc3QgZGVmZXJCbG9ja0ZpeHR1cmVzID0gW107XG4gICAgZm9yIChjb25zdCBibG9jayBvZiBkZWZlckJsb2Nrcykge1xuICAgICAgZGVmZXJCbG9ja0ZpeHR1cmVzLnB1c2gobmV3IERlZmVyQmxvY2tGaXh0dXJlKGJsb2NrLCB0aGlzKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShkZWZlckJsb2NrRml4dHVyZXMpO1xuICB9XG5cblxuICBwcml2YXRlIF9nZXRSZW5kZXJlcigpIHtcbiAgICBpZiAodGhpcy5fcmVuZGVyZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fcmVuZGVyZXIgPSB0aGlzLmNvbXBvbmVudFJlZi5pbmplY3Rvci5nZXQoUmVuZGVyZXJGYWN0b3J5MiwgbnVsbCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9yZW5kZXJlciBhcyBSZW5kZXJlckZhY3RvcnkyIHwgbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgdWkgc3RhdGUgaXMgc3RhYmxlIGZvbGxvd2luZyBhbmltYXRpb25zLlxuICAgKi9cbiAgd2hlblJlbmRlcmluZ0RvbmUoKTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCByZW5kZXJlciA9IHRoaXMuX2dldFJlbmRlcmVyKCk7XG4gICAgaWYgKHJlbmRlcmVyICYmIHJlbmRlcmVyLndoZW5SZW5kZXJpbmdEb25lKSB7XG4gICAgICByZXR1cm4gcmVuZGVyZXIud2hlblJlbmRlcmluZ0RvbmUoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMud2hlblN0YWJsZSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRyaWdnZXIgY29tcG9uZW50IGRlc3RydWN0aW9uLlxuICAgKi9cbiAgZGVzdHJveSgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuX2lzRGVzdHJveWVkKSB7XG4gICAgICB0aGlzLmNvbXBvbmVudFJlZi5kZXN0cm95KCk7XG4gICAgICBpZiAodGhpcy5fb25VbnN0YWJsZVN1YnNjcmlwdGlvbiAhPSBudWxsKSB7XG4gICAgICAgIHRoaXMuX29uVW5zdGFibGVTdWJzY3JpcHRpb24udW5zdWJzY3JpYmUoKTtcbiAgICAgICAgdGhpcy5fb25VbnN0YWJsZVN1YnNjcmlwdGlvbiA9IG51bGw7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5fb25TdGFibGVTdWJzY3JpcHRpb24gIT0gbnVsbCkge1xuICAgICAgICB0aGlzLl9vblN0YWJsZVN1YnNjcmlwdGlvbi51bnN1YnNjcmliZSgpO1xuICAgICAgICB0aGlzLl9vblN0YWJsZVN1YnNjcmlwdGlvbiA9IG51bGw7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5fb25NaWNyb3Rhc2tFbXB0eVN1YnNjcmlwdGlvbiAhPSBudWxsKSB7XG4gICAgICAgIHRoaXMuX29uTWljcm90YXNrRW1wdHlTdWJzY3JpcHRpb24udW5zdWJzY3JpYmUoKTtcbiAgICAgICAgdGhpcy5fb25NaWNyb3Rhc2tFbXB0eVN1YnNjcmlwdGlvbiA9IG51bGw7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5fb25FcnJvclN1YnNjcmlwdGlvbiAhPSBudWxsKSB7XG4gICAgICAgIHRoaXMuX29uRXJyb3JTdWJzY3JpcHRpb24udW5zdWJzY3JpYmUoKTtcbiAgICAgICAgdGhpcy5fb25FcnJvclN1YnNjcmlwdGlvbiA9IG51bGw7XG4gICAgICB9XG4gICAgICB0aGlzLl9pc0Rlc3Ryb3llZCA9IHRydWU7XG4gICAgfVxuICB9XG59XG4iXX0=