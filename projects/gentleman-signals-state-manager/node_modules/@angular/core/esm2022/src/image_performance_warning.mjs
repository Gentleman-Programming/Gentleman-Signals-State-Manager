/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { IMAGE_CONFIG } from './application_tokens';
import { Injectable } from './di';
import { inject } from './di/injector_compatibility';
import { formatRuntimeError } from './errors';
import { getDocument } from './render3/interfaces/document';
import { NgZone } from './zone';
import * as i0 from "./r3_symbols";
// A delay in milliseconds before the scan is run after onLoad, to avoid any
// potential race conditions with other LCP-related functions. This delay
// happens outside of the main JavaScript execution and will only effect the timing
// on when the warning becomes visible in the console.
const SCAN_DELAY = 200;
const OVERSIZED_IMAGE_TOLERANCE = 1200;
export class ImagePerformanceWarning {
    constructor() {
        // Map of full image URLs -> original `ngSrc` values.
        this.window = null;
        this.observer = null;
        this.options = inject(IMAGE_CONFIG);
        this.ngZone = inject(NgZone);
    }
    start() {
        if (typeof PerformanceObserver === 'undefined' ||
            (this.options?.disableImageSizeWarning && this.options?.disableImageLazyLoadWarning)) {
            return;
        }
        this.observer = this.initPerformanceObserver();
        const win = getDocument().defaultView;
        if (typeof win !== 'undefined') {
            this.window = win;
            // Wait to avoid race conditions where LCP image triggers
            // load event before it's recorded by the performance observer
            const waitToScan = () => {
                setTimeout(this.scanImages.bind(this), SCAN_DELAY);
            };
            // Angular doesn't have to run change detection whenever any asynchronous tasks are invoked in
            // the scope of this functionality.
            this.ngZone.runOutsideAngular(() => {
                this.window?.addEventListener('load', waitToScan);
            });
        }
    }
    ngOnDestroy() {
        this.observer?.disconnect();
    }
    initPerformanceObserver() {
        if (typeof PerformanceObserver === 'undefined') {
            return null;
        }
        const observer = new PerformanceObserver((entryList) => {
            const entries = entryList.getEntries();
            if (entries.length === 0)
                return;
            // We use the latest entry produced by the `PerformanceObserver` as the best
            // signal on which element is actually an LCP one. As an example, the first image to load on
            // a page, by virtue of being the only thing on the page so far, is often a LCP candidate
            // and gets reported by PerformanceObserver, but isn't necessarily the LCP element.
            const lcpElement = entries[entries.length - 1];
            // Cast to `any` due to missing `element` on the `LargestContentfulPaint` type of entry.
            // See https://developer.mozilla.org/en-US/docs/Web/API/LargestContentfulPaint
            const imgSrc = lcpElement.element?.src ?? '';
            // Exclude `data:` and `blob:` URLs, since they are fetched resources.
            if (imgSrc.startsWith('data:') || imgSrc.startsWith('blob:'))
                return;
            this.lcpImageUrl = imgSrc;
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
        return observer;
    }
    scanImages() {
        const images = getDocument().querySelectorAll('img');
        let lcpElementFound, lcpElementLoadedCorrectly = false;
        images.forEach(image => {
            if (!this.options?.disableImageSizeWarning) {
                for (const image of images) {
                    // Image elements using the NgOptimizedImage directive are excluded,
                    // as that directive has its own version of this check.
                    if (!image.getAttribute('ng-img') && this.isOversized(image)) {
                        logOversizedImageWarning(image.src);
                    }
                }
            }
            if (!this.options?.disableImageLazyLoadWarning && this.lcpImageUrl) {
                if (image.src === this.lcpImageUrl) {
                    lcpElementFound = true;
                    if (image.loading !== 'lazy' || image.getAttribute('ng-img')) {
                        // This variable is set to true and never goes back to false to account
                        // for the case where multiple images have the same src url, and some
                        // have lazy loading while others don't.
                        // Also ignore NgOptimizedImage because there's a different warning for that.
                        lcpElementLoadedCorrectly = true;
                    }
                }
            }
        });
        if (lcpElementFound && !lcpElementLoadedCorrectly && this.lcpImageUrl &&
            !this.options?.disableImageLazyLoadWarning) {
            logLazyLCPWarning(this.lcpImageUrl);
        }
    }
    isOversized(image) {
        if (!this.window) {
            return false;
        }
        const computedStyle = this.window.getComputedStyle(image);
        let renderedWidth = parseFloat(computedStyle.getPropertyValue('width'));
        let renderedHeight = parseFloat(computedStyle.getPropertyValue('height'));
        const boxSizing = computedStyle.getPropertyValue('box-sizing');
        const objectFit = computedStyle.getPropertyValue('object-fit');
        if (objectFit === `cover`) {
            // Object fit cover may indicate a use case such as a sprite sheet where
            // this warning does not apply.
            return false;
        }
        if (boxSizing === 'border-box') {
            const paddingTop = computedStyle.getPropertyValue('padding-top');
            const paddingRight = computedStyle.getPropertyValue('padding-right');
            const paddingBottom = computedStyle.getPropertyValue('padding-bottom');
            const paddingLeft = computedStyle.getPropertyValue('padding-left');
            renderedWidth -= parseFloat(paddingRight) + parseFloat(paddingLeft);
            renderedHeight -= parseFloat(paddingTop) + parseFloat(paddingBottom);
        }
        const intrinsicWidth = image.naturalWidth;
        const intrinsicHeight = image.naturalHeight;
        const recommendedWidth = this.window.devicePixelRatio * renderedWidth;
        const recommendedHeight = this.window.devicePixelRatio * renderedHeight;
        const oversizedWidth = (intrinsicWidth - recommendedWidth) >= OVERSIZED_IMAGE_TOLERANCE;
        const oversizedHeight = (intrinsicHeight - recommendedHeight) >= OVERSIZED_IMAGE_TOLERANCE;
        return oversizedWidth || oversizedHeight;
    }
    static { this.ɵfac = function ImagePerformanceWarning_Factory(t) { return new (t || ImagePerformanceWarning)(); }; }
    static { this.ɵprov = /*@__PURE__*/ i0.ɵɵdefineInjectable({ token: ImagePerformanceWarning, factory: ImagePerformanceWarning.ɵfac, providedIn: 'root' }); }
}
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.setClassMetadata(ImagePerformanceWarning, [{
        type: Injectable,
        args: [{ providedIn: 'root' }]
    }], null, null); })();
function logLazyLCPWarning(src) {
    console.warn(formatRuntimeError(-913 /* RuntimeErrorCode.IMAGE_PERFORMANCE_WARNING */, `An image with src ${src} is the Largest Contentful Paint (LCP) element ` +
        `but was given a "loading" value of "lazy", which can negatively impact` +
        `application loading performance. This warning can be addressed by ` +
        `changing the loading value of the LCP image to "eager", or by using the ` +
        `NgOptimizedImage directive's prioritization utilities. For more ` +
        `information about addressing or disabling this warning, see ` +
        `https://angular.io/errors/NG2965`));
}
function logOversizedImageWarning(src) {
    console.warn(formatRuntimeError(-913 /* RuntimeErrorCode.IMAGE_PERFORMANCE_WARNING */, `An image with src ${src} has intrinsic file dimensions much larger than its ` +
        `rendered size. This can negatively impact application loading performance. ` +
        `For more information about addressing or disabling this warning, see ` +
        `https://angular.io/errors/NG2965`));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2VfcGVyZm9ybWFuY2Vfd2FybmluZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2NvcmUvc3JjL2ltYWdlX3BlcmZvcm1hbmNlX3dhcm5pbmcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7OztHQU1HO0FBRUgsT0FBTyxFQUFDLFlBQVksRUFBYyxNQUFNLHNCQUFzQixDQUFDO0FBQy9ELE9BQU8sRUFBQyxVQUFVLEVBQUMsTUFBTSxNQUFNLENBQUM7QUFDaEMsT0FBTyxFQUFDLE1BQU0sRUFBQyxNQUFNLDZCQUE2QixDQUFDO0FBQ25ELE9BQU8sRUFBQyxrQkFBa0IsRUFBbUIsTUFBTSxVQUFVLENBQUM7QUFFOUQsT0FBTyxFQUFDLFdBQVcsRUFBQyxNQUFNLCtCQUErQixDQUFDO0FBQzFELE9BQU8sRUFBQyxNQUFNLEVBQUMsTUFBTSxRQUFRLENBQUM7O0FBRTlCLDRFQUE0RTtBQUM1RSx5RUFBeUU7QUFDekUsbUZBQW1GO0FBQ25GLHNEQUFzRDtBQUN0RCxNQUFNLFVBQVUsR0FBRyxHQUFHLENBQUM7QUFFdkIsTUFBTSx5QkFBeUIsR0FBRyxJQUFJLENBQUM7QUFJdkMsTUFBTSxPQUFPLHVCQUF1QjtJQURwQztRQUVFLHFEQUFxRDtRQUM3QyxXQUFNLEdBQWdCLElBQUksQ0FBQztRQUMzQixhQUFRLEdBQTZCLElBQUksQ0FBQztRQUMxQyxZQUFPLEdBQWdCLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUM1QyxXQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0tBd0hqQztJQXJIUSxLQUFLO1FBQ1YsSUFBSSxPQUFPLG1CQUFtQixLQUFLLFdBQVc7WUFDMUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLHVCQUF1QixJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsMkJBQTJCLENBQUMsRUFBRTtZQUN4RixPQUFPO1NBQ1I7UUFDRCxJQUFJLENBQUMsUUFBUSxH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QkFBa0Isd0RBRTNCLHFCQUFxQixHQUFHLGlEQUFpRDtRQUNyRSx3RUFBd0U7UUFDeEUsb0VBQW9FO1FBQ3BFLDBFQUEwRTtRQUMxRSxrRUFBa0U7UUFDbEUsOERBQThEO1FBQzlELGtDQUFrQyxDQUFDLENBQUMsQ0FBQztBQUMvQyxDQUFDO0FBRUQsU0FBUyx3QkFBd0IsQ0FBQyxHQUFXO0lBQzNDLE9BQU8sQ0FBQyxJQUFJLENBQUMsa0JBQWtCLHdEQUUzQixxQkFBcUIsR0FBRyxzREFBc0Q7UUFDMUUsNkVBQTZFO1FBQzdFLHVFQUF1RTtRQUN2RSxrQ0FBa0MsQ0FBQyxDQUFDLENBQUM7QUFDL0MsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQge0lNQUdFX0NPTkZJRywgSW1hZ2VDb25maWd9IGZyb20gJy4vYXBwbGljYXRpb25fdG9rZW5zJztcbmltcG9ydCB7SW5qZWN0YWJsZX0gZnJvbSAnLi9kaSc7XG5pbXBvcnQge2luamVjdH0gZnJvbSAnLi9kaS9pbmplY3Rvcl9jb21wYXRpYmlsaXR5JztcbmltcG9ydCB7Zm9ybWF0UnVudGltZUVycm9yLCBSdW50aW1lRXJyb3JDb2RlfSBmcm9tICcuL2Vycm9ycyc7XG5pbXBvcnQge09uRGVzdHJveX0gZnJvbSAnLi9pbnRlcmZhY2UvbGlmZWN5Y2xlX2hvb2tzJztcbmltcG9ydCB7Z2V0RG9jdW1lbnR9IGZyb20gJy4vcmVuZGVyMy9pbnRlcmZhY2VzL2RvY3VtZW50JztcbmltcG9ydCB7Tmdab25lfSBmcm9tICcuL3pvbmUnO1xuXG4vLyBBIGRlbGF5IGluIG1pbGxpc2Vjb25kcyBiZWZvcmUgdGhlIHNjYW4gaXMgcnVuIGFmdGVyIG9uTG9hZCwgdG8gYXZvaWQgYW55XG4vLyBwb3RlbnRpYWwgcmFjZSBjb25kaXRpb25zIHdpdGggb3RoZXIgTENQLXJlbGF0ZWQgZnVuY3Rpb25zLiBUaGlzIGRlbGF5XG4vLyBoYXBwZW5zIG91dHNpZGUgb2YgdGhlIG1haW4gSmF2YVNjcmlwdCBleGVjdXRpb24gYW5kIHdpbGwgb25seSBlZmZlY3QgdGhlIHRpbWluZ1xuLy8gb24gd2hlbiB0aGUgd2FybmluZyBiZWNvbWVzIHZpc2libGUgaW4gdGhlIGNvbnNvbGUuXG5jb25zdCBTQ0FOX0RFTEFZID0gMjAwO1xuXG5jb25zdCBPVkVSU0laRURfSU1BR0VfVE9MRVJBTkNFID0gMTIwMDtcblxuXG5ASW5qZWN0YWJsZSh7cHJvdmlkZWRJbjogJ3Jvb3QnfSlcbmV4cG9ydCBjbGFzcyBJbWFnZVBlcmZvcm1hbmNlV2FybmluZyBpbXBsZW1lbnRzIE9uRGVzdHJveSB7XG4gIC8vIE1hcCBvZiBmdWxsIGltYWdlIFVSTHMgLT4gb3JpZ2luYWwgYG5nU3JjYCB2YWx1ZXMuXG4gIHByaXZhdGUgd2luZG93OiBXaW5kb3d8bnVsbCA9IG51bGw7XG4gIHByaXZhdGUgb2JzZXJ2ZXI6IFBlcmZvcm1hbmNlT2JzZXJ2ZXJ8bnVsbCA9IG51bGw7XG4gIHByaXZhdGUgb3B0aW9uczogSW1hZ2VDb25maWcgPSBpbmplY3QoSU1BR0VfQ09ORklHKTtcbiAgcHJpdmF0ZSBuZ1pvbmUgPSBpbmplY3QoTmdab25lKTtcbiAgcHJpdmF0ZSBsY3BJbWFnZVVybD86IHN0cmluZztcblxuICBwdWJsaWMgc3RhcnQoKSB7XG4gICAgaWYgKHR5cGVvZiBQZXJmb3JtYW5jZU9ic2VydmVyID09PSAndW5kZWZpbmVkJyB8fFxuICAgICAgICAodGhpcy5vcHRpb25zPy5kaXNhYmxlSW1hZ2VTaXplV2FybmluZyAmJiB0aGlzLm9wdGlvbnM/LmRpc2FibGVJbWFnZUxhenlMb2FkV2FybmluZykpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5vYnNlcnZlciA9IHRoaXMuaW5pdFBlcmZvcm1hbmNlT2JzZXJ2ZXIoKTtcbiAgICBjb25zdCB3aW4gPSBnZXREb2N1bWVudCgpLmRlZmF1bHRWaWV3O1xuICAgIGlmICh0eXBlb2Ygd2luICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhpcy53aW5kb3cgPSB3aW47XG4gICAgICAvLyBXYWl0IHRvIGF2b2lkIHJhY2UgY29uZGl0aW9ucyB3aGVyZSBMQ1AgaW1hZ2UgdHJpZ2dlcnNcbiAgICAgIC8vIGxvYWQgZXZlbnQgYmVmb3JlIGl0J3MgcmVjb3JkZWQgYnkgdGhlIHBlcmZvcm1hbmNlIG9ic2VydmVyXG4gICAgICBjb25zdCB3YWl0VG9TY2FuID0gKCkgPT4ge1xuICAgICAgICBzZXRUaW1lb3V0KHRoaXMuc2NhbkltYWdlcy5iaW5kKHRoaXMpLCBTQ0FOX0RFTEFZKTtcbiAgICAgIH07XG4gICAgICAvLyBBbmd1bGFyIGRvZXNuJ3QgaGF2ZSB0byBydW4gY2hhbmdlIGRldGVjdGlvbiB3aGVuZXZlciBhbnkgYXN5bmNocm9ub3VzIHRhc2tzIGFyZSBpbnZva2VkIGluXG4gICAgICAvLyB0aGUgc2NvcGUgb2YgdGhpcyBmdW5jdGlvbmFsaXR5LlxuICAgICAgdGhpcy5uZ1pvbmUucnVuT3V0c2lkZUFuZ3VsYXIoKCkgPT4ge1xuICAgICAgICB0aGlzLndpbmRvdz8uYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIHdhaXRUb1NjYW4pO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgbmdPbkRlc3Ryb3koKSB7XG4gICAgdGhpcy5vYnNlcnZlcj8uZGlzY29ubmVjdCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBpbml0UGVyZm9ybWFuY2VPYnNlcnZlcigpOiBQZXJmb3JtYW5jZU9ic2VydmVyfG51bGwge1xuICAgIGlmICh0eXBlb2YgUGVyZm9ybWFuY2VPYnNlcnZlciA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBjb25zdCBvYnNlcnZlciA9IG5ldyBQZXJmb3JtYW5jZU9ic2VydmVyKChlbnRyeUxpc3QpID0+IHtcbiAgICAgIGNvbnN0IGVudHJpZXMgPSBlbnRyeUxpc3QuZ2V0RW50cmllcygpO1xuICAgICAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgICAvLyBXZSB1c2UgdGhlIGxhdGVzdCBlbnRyeSBwcm9kdWNlZCBieSB0aGUgYFBlcmZvcm1hbmNlT2JzZXJ2ZXJgIGFzIHRoZSBiZXN0XG4gICAgICAvLyBzaWduYWwgb24gd2hpY2ggZWxlbWVudCBpcyBhY3R1YWxseSBhbiBMQ1Agb25lLiBBcyBhbiBleGFtcGxlLCB0aGUgZmlyc3QgaW1hZ2UgdG8gbG9hZCBvblxuICAgICAgLy8gYSBwYWdlLCBieSB2aXJ0dWUgb2YgYmVpbmcgdGhlIG9ubHkgdGhpbmcgb24gdGhlIHBhZ2Ugc28gZmFyLCBpcyBvZnRlbiBhIExDUCBjYW5kaWRhdGVcbiAgICAgIC8vIGFuZCBnZXRzIHJlcG9ydGVkIGJ5IFBlcmZvcm1hbmNlT2JzZXJ2ZXIsIGJ1dCBpc24ndCBuZWNlc3NhcmlseSB0aGUgTENQIGVsZW1lbnQuXG4gICAgICBjb25zdCBsY3BFbGVtZW50ID0gZW50cmllc1tlbnRyaWVzLmxlbmd0aCAtIDFdO1xuXG4gICAgICAvLyBDYXN0IHRvIGBhbnlgIGR1ZSB0byBtaXNzaW5nIGBlbGVtZW50YCBvbiB0aGUgYExhcmdlc3RDb250ZW50ZnVsUGFpbnRgIHR5cGUgb2YgZW50cnkuXG4gICAgICAvLyBTZWUgaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL0xhcmdlc3RDb250ZW50ZnVsUGFpbnRcbiAgICAgIGNvbnN0IGltZ1NyYyA9IChsY3BFbGVtZW50IGFzIGFueSkuZWxlbWVudD8uc3JjID8/ICcnO1xuXG4gICAgICAvLyBFeGNsdWRlIGBkYXRhOmAgYW5kIGBibG9iOmAgVVJMcywgc2luY2UgdGhleSBhcmUgZmV0Y2hlZCByZXNvdXJjZXMuXG4gICAgICBpZiAoaW1nU3JjLnN0YXJ0c1dpdGgoJ2RhdGE6JykgfHwgaW1nU3JjLnN0YXJ0c1dpdGgoJ2Jsb2I6JykpIHJldHVybjtcbiAgICAgIHRoaXMubGNwSW1hZ2VVcmwgPSBpbWdTcmM7XG4gICAgfSk7XG4gICAgb2JzZXJ2ZXIub2JzZXJ2ZSh7dHlwZTogJ2xhcmdlc3QtY29udGVudGZ1bC1wYWludCcsIGJ1ZmZlcmVkOiB0cnVlfSk7XG4gICAgcmV0dXJuIG9ic2VydmVyO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2FuSW1hZ2VzKCk6IHZvaWQge1xuICAgIGNvbnN0IGltYWdlcyA9IGdldERvY3VtZW50KCkucXVlcnlTZWxlY3RvckFsbCgnaW1nJyk7XG4gICAgbGV0IGxjcEVsZW1lbnRGb3VuZCwgbGNwRWxlbWVudExvYWRlZENvcnJlY3RseSA9IGZhbHNlO1xuICAgIGltYWdlcy5mb3JFYWNoKGltYWdlID0+IHtcbiAgICAgIGlmICghdGhpcy5vcHRpb25zPy5kaXNhYmxlSW1hZ2VTaXplV2FybmluZykge1xuICAgICAgICBmb3IgKGNvbnN0IGltYWdlIG9mIGltYWdlcykge1xuICAgICAgICAgIC8vIEltYWdlIGVsZW1lbnRzIHVzaW5nIHRoZSBOZ09wdGltaXplZEltYWdlIGRpcmVjdGl2ZSBhcmUgZXhjbHVkZWQsXG4gICAgICAgICAgLy8gYXMgdGhhdCBkaXJlY3RpdmUgaGFzIGl0cyBvd24gdmVyc2lvbiBvZiB0aGlzIGNoZWNrLlxuICAgICAgICAgIGlmICghaW1hZ2UuZ2V0QXR0cmlidXRlKCduZy1pbWcnKSAmJiB0aGlzLmlzT3ZlcnNpemVkKGltYWdlKSkge1xuICAgICAgICAgICAgbG9nT3ZlcnNpemVkSW1hZ2VXYXJuaW5nKGltYWdlLnNyYyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMub3B0aW9ucz8uZGlzYWJsZUltYWdlTGF6eUxvYWRXYXJuaW5nICYmIHRoaXMubGNwSW1hZ2VVcmwpIHtcbiAgICAgICAgaWYgKGltYWdlLnNyYyA9PT0gdGhpcy5sY3BJbWFnZVVybCkge1xuICAgICAgICAgIGxjcEVsZW1lbnRGb3VuZCA9IHRydWU7XG4gICAgICAgICAgaWYgKGltYWdlLmxvYWRpbmcgIT09ICdsYXp5JyB8fCBpbWFnZS5nZXRBdHRyaWJ1dGUoJ25nLWltZycpKSB7XG4gICAgICAgICAgICAvLyBUaGlzIHZhcmlhYmxlIGlzIHNldCB0byB0cnVlIGFuZCBuZXZlciBnb2VzIGJhY2sgdG8gZmFsc2UgdG8gYWNjb3VudFxuICAgICAgICAgICAgLy8gZm9yIHRoZSBjYXNlIHdoZXJlIG11bHRpcGxlIGltYWdlcyBoYXZlIHRoZSBzYW1lIHNyYyB1cmwsIGFuZCBzb21lXG4gICAgICAgICAgICAvLyBoYXZlIGxhenkgbG9hZGluZyB3aGlsZSBvdGhlcnMgZG9uJ3QuXG4gICAgICAgICAgICAvLyBBbHNvIGlnbm9yZSBOZ09wdGltaXplZEltYWdlIGJlY2F1c2UgdGhlcmUncyBhIGRpZmZlcmVudCB3YXJuaW5nIGZvciB0aGF0LlxuICAgICAgICAgICAgbGNwRWxlbWVudExvYWRlZENvcnJlY3RseSA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKGxjcEVsZW1lbnRGb3VuZCAmJiAhbGNwRWxlbWVudExvYWRlZENvcnJlY3RseSAmJiB0aGlzLmxjcEltYWdlVXJsICYmXG4gICAgICAgICF0aGlzLm9wdGlvbnM/LmRpc2FibGVJbWFnZUxhenlMb2FkV2FybmluZykge1xuICAgICAgbG9nTGF6eUxDUFdhcm5pbmcodGhpcy5sY3BJbWFnZVVybCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc092ZXJzaXplZChpbWFnZTogSFRNTEltYWdlRWxlbWVudCk6IGJvb2xlYW4ge1xuICAgIGlmICghdGhpcy53aW5kb3cpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgY29uc3QgY29tcHV0ZWRTdHlsZSA9IHRoaXMud2luZG93LmdldENvbXB1dGVkU3R5bGUoaW1hZ2UpO1xuICAgIGxldCByZW5kZXJlZFdpZHRoID0gcGFyc2VGbG9hdChjb21wdXRlZFN0eWxlLmdldFByb3BlcnR5VmFsdWUoJ3dpZHRoJykpO1xuICAgIGxldCByZW5kZXJlZEhlaWdodCA9IHBhcnNlRmxvYXQoY29tcHV0ZWRTdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCdoZWlnaHQnKSk7XG4gICAgY29uc3QgYm94U2l6aW5nID0gY29tcHV0ZWRTdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCdib3gtc2l6aW5nJyk7XG4gICAgY29uc3Qgb2JqZWN0Rml0ID0gY29tcHV0ZWRTdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKCdvYmplY3QtZml0Jyk7XG5cbiAgICBpZiAob2JqZWN0Rml0ID09PSBgY292ZXJgKSB7XG4gICAgICAvLyBPYmplY3QgZml0IGNvdmVyIG1heSBpbmRpY2F0ZSBhIHVzZSBjYXNlIHN1Y2ggYXMgYSBzcHJpdGUgc2hlZXQgd2hlcmVcbiAgICAgIC8vIHRoaXMgd2FybmluZyBkb2VzIG5vdCBhcHBseS5cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBpZiAoYm94U2l6aW5nID09PSAnYm9yZGVyLWJveCcpIHtcbiAgICAgIGNvbnN0IHBhZGRpbmdUb3AgPSBjb21wdXRlZFN0eWxlLmdldFByb3BlcnR5VmFsdWUoJ3BhZGRpbmctdG9wJyk7XG4gICAgICBjb25zdCBwYWRkaW5nUmlnaHQgPSBjb21wdXRlZFN0eWxlLmdldFByb3BlcnR5VmFsdWUoJ3BhZGRpbmctcmlnaHQnKTtcbiAgICAgIGNvbnN0IHBhZGRpbmdCb3R0b20gPSBjb21wdXRlZFN0eWxlLmdldFByb3BlcnR5VmFsdWUoJ3BhZGRpbmctYm90dG9tJyk7XG4gICAgICBjb25zdCBwYWRkaW5nTGVmdCA9IGNvbXB1dGVkU3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSgncGFkZGluZy1sZWZ0Jyk7XG4gICAgICByZW5kZXJlZFdpZHRoIC09IHBhcnNlRmxvYXQocGFkZGluZ1JpZ2h0KSArIHBhcnNlRmxvYXQocGFkZGluZ0xlZnQpO1xuICAgICAgcmVuZGVyZWRIZWlnaHQgLT0gcGFyc2VGbG9hdChwYWRkaW5nVG9wKSArIHBhcnNlRmxvYXQocGFkZGluZ0JvdHRvbSk7XG4gICAgfVxuXG4gICAgY29uc3QgaW50cmluc2ljV2lkdGggPSBpbWFnZS5uYXR1cmFsV2lkdGg7XG4gICAgY29uc3QgaW50cmluc2ljSGVpZ2h0ID0gaW1hZ2UubmF0dXJhbEhlaWdodDtcblxuICAgIGNvbnN0IHJlY29tbWVuZGVkV2lkdGggPSB0aGlzLndpbmRvdy5kZXZpY2VQaXhlbFJhdGlvICogcmVuZGVyZWRXaWR0aDtcbiAgICBjb25zdCByZWNvbW1lbmRlZEhlaWdodCA9IHRoaXMud2luZG93LmRldmljZVBpeGVsUmF0aW8gKiByZW5kZXJlZEhlaWdodDtcbiAgICBjb25zdCBvdmVyc2l6ZWRXaWR0aCA9IChpbnRyaW5zaWNXaWR0aCAtIHJlY29tbWVuZGVkV2lkdGgpID49IE9WRVJTSVpFRF9JTUFHRV9UT0xFUkFOQ0U7XG4gICAgY29uc3Qgb3ZlcnNpemVkSGVpZ2h0ID0gKGludHJpbnNpY0hlaWdodCAtIHJlY29tbWVuZGVkSGVpZ2h0KSA+PSBPVkVSU0laRURfSU1BR0VfVE9MRVJBTkNFO1xuICAgIHJldHVybiBvdmVyc2l6ZWRXaWR0aCB8fCBvdmVyc2l6ZWRIZWlnaHQ7XG4gIH1cbn1cblxuZnVuY3Rpb24gbG9nTGF6eUxDUFdhcm5pbmcoc3JjOiBzdHJpbmcpIHtcbiAgY29uc29sZS53YXJuKGZvcm1hdFJ1bnRpbWVFcnJvcihcbiAgICAgIFJ1bnRpbWVFcnJvckNvZGUuSU1BR0VfUEVSRk9STUFOQ0VfV0FSTklORyxcbiAgICAgIGBBbiBpbWFnZSB3aXRoIHNyYyAke3NyY30gaXMgdGhlIExhcmdlc3QgQ29udGVudGZ1bCBQYWludCAoTENQKSBlbGVtZW50IGAgK1xuICAgICAgICAgIGBidXQgd2FzIGdpdmVuIGEgXCJsb2FkaW5nXCIgdmFsdWUgb2YgXCJsYXp5XCIsIHdoaWNoIGNhbiBuZWdhdGl2ZWx5IGltcGFjdGAgK1xuICAgICAgICAgIGBhcHBsaWNhdGlvbiBsb2FkaW5nIHBlcmZvcm1hbmNlLiBUaGlzIHdhcm5pbmcgY2FuIGJlIGFkZHJlc3NlZCBieSBgICtcbiAgICAgICAgICBgY2hhbmdpbmcgdGhlIGxvYWRpbmcgdmFsdWUgb2YgdGhlIExDUCBpbWFnZSB0byBcImVhZ2VyXCIsIG9yIGJ5IHVzaW5nIHRoZSBgICtcbiAgICAgICAgICBgTmdPcHRpbWl6ZWRJbWFnZSBkaXJlY3RpdmUncyBwcmlvcml0aXphdGlvbiB1dGlsaXRpZXMuIEZvciBtb3JlIGAgK1xuICAgICAgICAgIGBpbmZvcm1hdGlvbiBhYm91dCBhZGRyZXNzaW5nIG9yIGRpc2FibGluZyB0aGlzIHdhcm5pbmcsIHNlZSBgICtcbiAgICAgICAgICBgaHR0cHM6Ly9hbmd1bGFyLmlvL2Vycm9ycy9ORzI5NjVgKSk7XG59XG5cbmZ1bmN0aW9uIGxvZ092ZXJzaXplZEltYWdlV2FybmluZyhzcmM6IHN0cmluZykge1xuICBjb25zb2xlLndhcm4oZm9ybWF0UnVudGltZUVycm9yKFxuICAgICAgUnVudGltZUVycm9yQ29kZS5JTUFHRV9QRVJGT1JNQU5DRV9XQVJOSU5HLFxuICAgICAgYEFuIGltYWdlIHdpdGggc3JjICR7c3JjfSBoYXMgaW50cmluc2ljIGZpbGUgZGltZW5zaW9ucyBtdWNoIGxhcmdlciB0aGFuIGl0cyBgICtcbiAgICAgICAgICBgcmVuZGVyZWQgc2l6ZS4gVGhpcyBjYW4gbmVnYXRpdmVseSBpbXBhY3QgYXBwbGljYXRpb24gbG9hZGluZyBwZXJmb3JtYW5jZS4gYCArXG4gICAgICAgICAgYEZvciBtb3JlIGluZm9ybWF0aW9uIGFib3V0IGFkZHJlc3Npbmcgb3IgZGlzYWJsaW5nIHRoaXMgd2FybmluZywgc2VlIGAgK1xuICAgICAgICAgIGBodHRwczovL2FuZ3VsYXIuaW8vZXJyb3JzL05HMjk2NWApKTtcbn1cbiJdfQ==