/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { InjectionToken } from './di/injection_token';
import { getDocument } from './render3/interfaces/document';
/**
 * A [DI token](guide/glossary#di-token "DI token definition") representing a string ID, used
 * primarily for prefixing application attributes and CSS styles when
 * {@link ViewEncapsulation#Emulated} is being used.
 *
 * The token is needed in cases when multiple applications are bootstrapped on a page
 * (for example, using `bootstrapApplication` calls). In this case, ensure that those applications
 * have different `APP_ID` value setup. For example:
 *
 * ```
 * bootstrapApplication(ComponentA, {
 *   providers: [
 *     { provide: APP_ID, useValue: 'app-a' },
 *     // ... other providers ...
 *   ]
 * });
 *
 * bootstrapApplication(ComponentB, {
 *   providers: [
 *     { provide: APP_ID, useValue: 'app-b' },
 *     // ... other providers ...
 *   ]
 * });
 * ```
 *
 * By default, when there is only one application bootstrapped, you don't need to provide the
 * `APP_ID` token (the `ng` will be used as an app ID).
 *
 * @publicApi
 */
export const APP_ID = new InjectionToken('AppId', {
    providedIn: 'root',
    factory: () => DEFAULT_APP_ID,
});
/** Default value of the `APP_ID` token. */
const DEFAULT_APP_ID = 'ng';
/**
 * A function that is executed when a platform is initialized.
 * @publicApi
 */
export const PLATFORM_INITIALIZER = new InjectionToken('Platform Initializer');
/**
 * A token that indicates an opaque platform ID.
 * @publicApi
 */
export const PLATFORM_ID = new InjectionToken('Platform ID', {
    providedIn: 'platform',
    factory: () => 'unknown', // set a default platform name, when none set explicitly
});
/**
 * A [DI token](guide/glossary#di-token "DI token definition") that indicates the root directory of
 * the application
 * @publicApi
 * @deprecated
 */
export const PACKAGE_ROOT_URL = new InjectionToken('Application Packages Root URL');
// We keep this token here, rather than the animations package, so that modules that only care
// about which animations module is loaded (e.g. the CDK) can retrieve it without having to
// include extra dependencies. See #44970 for more context.
/**
 * A [DI token](guide/glossary#di-token "DI token definition") that indicates which animations
 * module has been loaded.
 * @publicApi
 */
export const ANIMATION_MODULE_TYPE = new InjectionToken('AnimationModuleType');
// TODO(crisbeto): link to CSP guide here.
/**
 * Token used to configure the [Content Security Policy](https://web.dev/strict-csp/) nonce that
 * Angular will apply when inserting inline styles. If not provided, Angular will look up its value
 * from the `ngCspNonce` attribute of the application root node.
 *
 * @publicApi
 */
export const CSP_NONCE = new InjectionToken('CSP nonce', {
    providedIn: 'root',
    factory: () => {
        // Ideally we wouldn't have to use `querySelector` here since we know that the nonce will be on
        // the root node, but because the token value is used in renderers, it has to be available
        // *very* early in the bootstrapping process. This should be a fairly shallow search, because
        // the app won't have been added to the DOM yet. Some approaches that were considered:
        // 1. Find the root node through `ApplicationRef.components[i].location` - normally this would
        // be enough for our purposes, but the token is injected very early so the `components` array
        // isn't populated yet.
        // 2. Find the root `LView` through the current `LView` - renderers are a prerequisite to
        // creating the `LView`. This means that no `LView` will have been entered when this factory is
        // invoked for the root component.
        // 3. Have the token factory return `() => string` which is invoked when a nonce is requested -
        // the slightly later execution does allow us to get an `LView` reference, but the fact that
        // it is a function means that it could be executed at *any* time (including immediately) which
        // may lead to weird bugs.
        // 4. Have the `ComponentFactory` read the attribute and provide it to the injector under the
        // hood - has the same problem as #1 and #2 in that the renderer is used to query for the root
        // node and the nonce value needs to be available when the renderer is created.
        return getDocument().body?.querySelector('[ngCspNonce]')?.getAttribute('ngCspNonce') || null;
    },
});
export const IMAGE_CONFIG_DEFAULTS = {
    breakpoints: [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    disableImageSizeWarning: false,
    disableImageLazyLoadWarning: false,
};
/**
 * Injection token that configures the image optimized image functionality.
 * See {@link ImageConfig} for additional information about parameters that
 * can be used.
 *
 * @see {@link NgOptimizedImage}
 * @see {@link ImageConfig}
 * @publicApi
 */
export const IMAGE_CONFIG = new InjectionToken('ImageConfig', { providedIn: 'root', factory: () => IMAGE_CONFIG_DEFAULTS });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbGljYXRpb25fdG9rZW5zLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvY29yZS9zcmMvYXBwbGljYXRpb25fdG9rZW5zLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBQyxjQUFjLEVBQUMsTUFBTSxzQkFBc0IsQ0FBQztBQUNwRCxPQUFPLEVBQUMsV0FBVyxFQUFDLE1BQU0sK0JBQStCLENBQUM7QUFFMUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkJHO0FBQ0gsTUFBTSxDQUFDLE1BQU0sTUFBTSxHQUFHLElBQUksY0FBYyxDQUFTLE9BQU8sRUFBRTtJQUN4RCxVQUFVLEVBQUUsTUFBTTtJQUNsQixPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsY0FBYztDQUM5QixDQUFDLENBQUM7QUFFSCwyQ0FBMkM7QUFDM0MsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDO0FBRTVCOzs7R0FHRztBQUNILE1BQU0sQ0FBQyxNQUFNLG9CQUFvQixHQUM3QixJQUFJLGNBQWMsQ0FBNEIsc0JBQXNCLENBQUMsQ0FBQztBQUUxRTs7O0dBR0c7QUFDSCxNQUFNLENBQUMsTUFBTSxXQUFXLEdBQUcsSUFBSSxjQUFjLENBQVMsYUFBYSxFQUFFO0lBQ25FLFVBQVUsRUFBRSxVQUFVO0lBQ3RCLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTLEVBQUcsd0RBQXdEO0NBQ3BGLENBQUMsQ0FBQztBQUVIOzs7OztHQUtHO0FBQ0gsTUFBTSxDQUFDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxjQUFjLENBQVMsK0JBQStCLENBQUMsQ0FBQztBQUU1Riw4RkFBOEY7QUFDOUYsMkZBQTJGO0FBQzNGLDJEQUEyRDtBQUUzRDs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE1BQU0scUJBQXFCLEdBQzlCLElBQUksY0FBYyxDQUF1QyxxQkFBcUIsQ0FBQyxDQUFDO0FBRXBGLDBDQUEwQztBQUMxQzs7Ozs7O0dBTUc7QUFDSCxNQUFNLENBQUMsTUFBTSxTQUFTLEdBQUcsSUFBSSxjQUFjLENBQWMsV0FBVyxFQUFFO0lBQ3BFLFVBQVUsRUFBRSxNQUFNO0lBQ2xCLE9BQU8sRUFBRSxHQUFHLEVBQUU7UUFDWiwrRkFBK0Y7UUFDL0YsMEZBQTBGO1FBQzFGLDZGQUE2RjtRQUM3RixzRkFBc0Y7UUFDdEYsOEZBQThGO1FBQzlGLDZGQUE2RjtRQUM3Rix1QkFBdUI7UUFDdkIseUZBQXlGO1FBQ3pGLCtGQUErRjtRQUMvRixrQ0FBa0M7UUFDbEMsK0ZBQStGO1FBQy9GLDRGQUE0RjtRQUM1RiwrRkFBK0Y7UUFDL0YsMEJBQTBCO1FBQzFCLDZGQUE2RjtRQUM3Riw4RkFBOEY7UUFDOUYsK0VBQStFO1FBQy9FLE9BQU8sV0FBVyxFQUFFLENBQUMsSUFBSSxFQUFFLGFBQWEsQ0FBQyxjQUFjLENBQUMsRUFBRSxZQUFZLENBQUMsWUFBWSxDQUFDLElBQUksSUFBSSxDQUFDO0lBQy9GLENBQUM7Q0FDRixDQUFDLENBQUM7QUFxQkgsTUFBTSxDQUFDLE1BQU0scUJBQXFCLEdBQWdCO0lBQ2hELFdBQVcsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQztJQUM3Rix1QkFBdUIsRUFBRSxLQUFLO0lBQzlCLDJCQUEyQixFQUFFLEtBQUs7Q0FDbkMsQ0FBQztBQUVGOzs7Ozs7OztHQVFHO0FBQ0gsTUFBTSxDQUFDLE1BQU0sWUFBWSxHQUFHLElBQUksY0FBYyxDQUMxQyxhQUFhLEVBQUUsRUFBQyxVQUFVLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxxQkFBcUIsRUFBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IHtJbmplY3Rpb25Ub2tlbn0gZnJvbSAnLi9kaS9pbmplY3Rpb25fdG9rZW4nO1xuaW1wb3J0IHtnZXREb2N1bWVudH0gZnJvbSAnLi9yZW5kZXIzL2ludGVyZmFjZXMvZG9jdW1lbnQnO1xuXG4vKipcbiAqIEEgW0RJIHRva2VuXShndWlkZS9nbG9zc2FyeSNkaS10b2tlbiBcIkRJIHRva2VuIGRlZmluaXRpb25cIikgcmVwcmVzZW50aW5nIGEgc3RyaW5nIElELCB1c2VkXG4gKiBwcmltYXJpbHkgZm9yIHByZWZpeGluZyBhcHBsaWNhdGlvbiBhdHRyaWJ1dGVzIGFuZCBDU1Mgc3R5bGVzIHdoZW5cbiAqIHtAbGluayBWaWV3RW5jYXBzdWxhdGlvbiNFbXVsYXRlZH0gaXMgYmVpbmcgdXNlZC5cbiAqXG4gKiBUaGUgdG9rZW4gaXMgbmVlZGVkIGluIGNhc2VzIHdoZW4gbXVsdGlwbGUgYXBwbGljYXRpb25zIGFyZSBib290c3RyYXBwZWQgb24gYSBwYWdlXG4gKiAoZm9yIGV4YW1wbGUsIHVzaW5nIGBib290c3RyYXBBcHBsaWNhdGlvbmAgY2FsbHMpLiBJbiB0aGlzIGNhc2UsIGVuc3VyZSB0aGF0IHRob3NlIGFwcGxpY2F0aW9uc1xuICogaGF2ZSBkaWZmZXJlbnQgYEFQUF9JRGAgdmFsdWUgc2V0dXAuIEZvciBleGFtcGxlOlxuICpcbiAqIGBgYFxuICogYm9vdHN0cmFwQXBwbGljYXRpb24oQ29tcG9uZW50QSwge1xuICogICBwcm92aWRlcnM6IFtcbiAqICAgICB7IHByb3ZpZGU6IEFQUF9JRCwgdXNlVmFsdWU6ICdhcHAtYScgfSxcbiAqICAgICAvLyAuLi4gb3RoZXIgcHJvdmlkZXJzIC4uLlxuICogICBdXG4gKiB9KTtcbiAqXG4gKiBib290c3RyYXBBcHBsaWNhdGlvbihDb21wb25lbnRCLCB7XG4gKiAgIHByb3ZpZGVyczogW1xuICogICAgIHsgcHJvdmlkZTogQVBQX0lELCB1c2VWYWx1ZTogJ2FwcC1iJyB9LFxuICogICAgIC8vIC4uLiBvdGhlciBwcm92aWRlcnMgLi4uXG4gKiAgIF1cbiAqIH0pO1xuICogYGBgXG4gKlxuICogQnkgZGVmYXVsdCwgd2hlbiB0aGVyZSBpcyBvbmx5IG9uZSBhcHBsaWNhdGlvbiBib290c3RyYXBwZWQsIHlvdSBkb24ndCBuZWVkIHRvIHByb3ZpZGUgdGhlXG4gKiBgQVBQX0lEYCB0b2tlbiAodGhlIGBuZ2Agd2lsbCBiZSB1c2VkIGFzIGFuIGFwcCBJRCkuXG4gKlxuICogQHB1YmxpY0FwaVxuICovXG5leHBvcnQgY29uc3QgQVBQX0lEID0gbmV3IEluamVjdGlvblRva2VuPHN0cmluZz4oJ0FwcElkJywge1xuICBwcm92aWRlZEluOiAncm9vdCcsXG4gIGZhY3Rvcnk6ICgpID0+IERFRkFVTFRfQVBQX0lELFxufSk7XG5cbi8qKiBEZWZhdWx0IHZhbHVlIG9mIHRoZSBgQVBQX0lEYCB0b2tlbi4gKi9cbmNvbnN0IERFRkFVTFRfQVBQX0lEID0gJ25nJztcblxuLyoqXG4gKiBBIGZ1bmN0aW9uIHRoYXQgaXMgZXhlY3V0ZWQgd2hlbiBhIHBsYXRmb3JtIGlzIGluaXRpYWxpemVkLlxuICogQHB1YmxpY0FwaVxuICovXG5leHBvcnQgY29uc3QgUExBVEZPUk1fSU5JVElBTElaRVIgPVxuICAgIG5ldyBJbmplY3Rpb25Ub2tlbjxSZWFkb25seUFycmF5PCgpID0+IHZvaWQ+PignUGxhdGZvcm0gSW5pdGlhbGl6ZXInKTtcblxuLyoqXG4gKiBBIHRva2VuIHRoYXQgaW5kaWNhdGVzIGFuIG9wYXF1ZSBwbGF0Zm9ybSBJRC5cbiAqIEBwdWJsaWNBcGlcbiAqL1xuZXhwb3J0IGNvbnN0IFBMQVRGT1JNX0lEID0gbmV3IEluamVjdGlvblRva2VuPE9iamVjdD4oJ1BsYXRmb3JtIElEJywge1xuICBwcm92aWRlZEluOiAncGxhdGZvcm0nLFxuICBmYWN0b3J5OiAoKSA9PiAndW5rbm93bicsICAvLyBzZXQgYSBkZWZhdWx0IHBsYXRmb3JtIG5hbWUsIHdoZW4gbm9uZSBzZXQgZXhwbGljaXRseVxufSk7XG5cbi8qKlxuICogQSBbREkgdG9rZW5dKGd1aWRlL2dsb3NzYXJ5I2RpLXRva2VuIFwiREkgdG9rZW4gZGVmaW5pdGlvblwiKSB0aGF0IGluZGljYXRlcyB0aGUgcm9vdCBkaXJlY3Rvcnkgb2ZcbiAqIHRoZSBhcHBsaWNhdGlvblxuICogQHB1YmxpY0FwaVxuICogQGRlcHJlY2F0ZWRcbiAqL1xuZXhwb3J0IGNvbnN0IFBBQ0tBR0VfUk9PVF9VUkwgPSBuZXcgSW5qZWN0aW9uVG9rZW48c3RyaW5nPignQXBwbGljYXRpb24gUGFja2FnZXMgUm9vdCBVUkwnKTtcblxuLy8gV2Uga2VlcCB0aGlzIHRva2VuIGhlcmUsIHJhdGhlciB0aGFuIHRoZSBhbmltYXRpb25zIHBhY2thZ2UsIHNvIHRoYXQgbW9kdWxlcyB0aGF0IG9ubHkgY2FyZVxuLy8gYWJvdXQgd2hpY2ggYW5pbWF0aW9ucyBtb2R1bGUgaXMgbG9hZGVkIChlLmcuIHRoZSBDREspIGNhbiByZXRyaWV2ZSBpdCB3aXRob3V0IGhhdmluZyB0b1xuLy8gaW5jbHVkZSBleHRyYSBkZXBlbmRlbmNpZXMuIFNlZSAjNDQ5NzAgZm9yIG1vcmUgY29udGV4dC5cblxuLyoqXG4gKiBBIFtESSB0b2tlbl0oZ3VpZGUvZ2xvc3NhcnkjZGktdG9rZW4gXCJESSB0b2tlbiBkZWZpbml0aW9uXCIpIHRoYXQgaW5kaWNhdGVzIHdoaWNoIGFuaW1hdGlvbnNcbiAqIG1vZHVsZSBoYXMgYmVlbiBsb2FkZWQuXG4gKiBAcHVibGljQXBpXG4gKi9cbmV4cG9ydCBjb25zdCBBTklNQVRJT05fTU9EVUxFX1RZUEUgPVxuICAgIG5ldyBJbmplY3Rpb25Ub2tlbjwnTm9vcEFuaW1hdGlvbnMnfCdCcm93c2VyQW5pbWF0aW9ucyc+KCdBbmltYXRpb25Nb2R1bGVUeXBlJyk7XG5cbi8vIFRPRE8oY3Jpc2JldG8pOiBsaW5rIHRvIENTUCBndWlkZSBoZXJlLlxuLyoqXG4gKiBUb2tlbiB1c2VkIHRvIGNvbmZpZ3VyZSB0aGUgW0NvbnRlbnQgU2VjdXJpdHkgUG9saWN5XShodHRwczovL3dlYi5kZXYvc3RyaWN0LWNzcC8pIG5vbmNlIHRoYXRcbiAqIEFuZ3VsYXIgd2lsbCBhcHBseSB3aGVuIGluc2VydGluZyBpbmxpbmUgc3R5bGVzLiBJZiBub3QgcHJvdmlkZWQsIEFuZ3VsYXIgd2lsbCBsb29rIHVwIGl0cyB2YWx1ZVxuICogZnJvbSB0aGUgYG5nQ3NwTm9uY2VgIGF0dHJpYnV0ZSBvZiB0aGUgYXBwbGljYXRpb24gcm9vdCBub2RlLlxuICpcbiAqIEBwdWJsaWNBcGlcbiAqL1xuZXhwb3J0IGNvbnN0IENTUF9OT05DRSA9IG5ldyBJbmplY3Rpb25Ub2tlbjxzdHJpbmd8bnVsbD4oJ0NTUCBub25jZScsIHtcbiAgcHJvdmlkZWRJbjogJ3Jvb3QnLFxuICBmYWN0b3J5OiAoKSA9PiB7XG4gICAgLy8gSWRlYWxseSB3ZSB3b3VsZG4ndCBoYXZlIHRvIHVzZSBgcXVlcnlTZWxlY3RvcmAgaGVyZSBzaW5jZSB3ZSBrbm93IHRoYXQgdGhlIG5vbmNlIHdpbGwgYmUgb25cbiAgICAvLyB0aGUgcm9vdCBub2RlLCBidXQgYmVjYXVzZSB0aGUgdG9rZW4gdmFsdWUgaXMgdXNlZCBpbiByZW5kZXJlcnMsIGl0IGhhcyB0byBiZSBhdmFpbGFibGVcbiAgICAvLyAqdmVyeSogZWFybHkgaW4gdGhlIGJvb3RzdHJhcHBpbmcgcHJvY2Vzcy4gVGhpcyBzaG91bGQgYmUgYSBmYWlybHkgc2hhbGxvdyBzZWFyY2gsIGJlY2F1c2VcbiAgICAvLyB0aGUgYXBwIHdvbid0IGhhdmUgYmVlbiBhZGRlZCB0byB0aGUgRE9NIHlldC4gU29tZSBhcHByb2FjaGVzIHRoYXQgd2VyZSBjb25zaWRlcmVkOlxuICAgIC8vIDEuIEZpbmQgdGhlIHJvb3Qgbm9kZSB0aHJvdWdoIGBBcHBsaWNhdGlvblJlZi5jb21wb25lbnRzW2ldLmxvY2F0aW9uYCAtIG5vcm1hbGx5IHRoaXMgd291bGRcbiAgICAvLyBiZSBlbm91Z2ggZm9yIG91ciBwdXJwb3NlcywgYnV0IHRoZSB0b2tlbiBpcyBpbmplY3RlZCB2ZXJ5IGVhcmx5IHNvIHRoZSBgY29tcG9uZW50c2AgYXJyYXlcbiAgICAvLyBpc24ndCBwb3B1bGF0ZWQgeWV0LlxuICAgIC8vIDIuIEZpbmQgdGhlIHJvb3QgYExWaWV3YCB0aHJvdWdoIHRoZSBjdXJyZW50IGBMVmlld2AgLSByZW5kZXJlcnMgYXJlIGEgcHJlcmVxdWlzaXRlIHRvXG4gICAgLy8gY3JlYXRpbmcgdGhlIGBMVmlld2AuIFRoaXMgbWVhbnMgdGhhdCBubyBgTFZpZXdgIHdpbGwgaGF2ZSBiZWVuIGVudGVyZWQgd2hlbiB0aGlzIGZhY3RvcnkgaXNcbiAgICAvLyBpbnZva2VkIGZvciB0aGUgcm9vdCBjb21wb25lbnQuXG4gICAgLy8gMy4gSGF2ZSB0aGUgdG9rZW4gZmFjdG9yeSByZXR1cm4gYCgpID0+IHN0cmluZ2Agd2hpY2ggaXMgaW52b2tlZCB3aGVuIGEgbm9uY2UgaXMgcmVxdWVzdGVkIC1cbiAgICAvLyB0aGUgc2xpZ2h0bHkgbGF0ZXIgZXhlY3V0aW9uIGRvZXMgYWxsb3cgdXMgdG8gZ2V0IGFuIGBMVmlld2AgcmVmZXJlbmNlLCBidXQgdGhlIGZhY3QgdGhhdFxuICAgIC8vIGl0IGlzIGEgZnVuY3Rpb24gbWVhbnMgdGhhdCBpdCBjb3VsZCBiZSBleGVjdXRlZCBhdCAqYW55KiB0aW1lIChpbmNsdWRpbmcgaW1tZWRpYXRlbHkpIHdoaWNoXG4gICAgLy8gbWF5IGxlYWQgdG8gd2VpcmQgYnVncy5cbiAgICAvLyA0LiBIYXZlIHRoZSBgQ29tcG9uZW50RmFjdG9yeWAgcmVhZCB0aGUgYXR0cmlidXRlIGFuZCBwcm92aWRlIGl0IHRvIHRoZSBpbmplY3RvciB1bmRlciB0aGVcbiAgICAvLyBob29kIC0gaGFzIHRoZSBzYW1lIHByb2JsZW0gYXMgIzEgYW5kICMyIGluIHRoYXQgdGhlIHJlbmRlcmVyIGlzIHVzZWQgdG8gcXVlcnkgZm9yIHRoZSByb290XG4gICAgLy8gbm9kZSBhbmQgdGhlIG5vbmNlIHZhbHVlIG5lZWRzIHRvIGJlIGF2YWlsYWJsZSB3aGVuIHRoZSByZW5kZXJlciBpcyBjcmVhdGVkLlxuICAgIHJldHVybiBnZXREb2N1bWVudCgpLmJvZHk/LnF1ZXJ5U2VsZWN0b3IoJ1tuZ0NzcE5vbmNlXScpPy5nZXRBdHRyaWJ1dGUoJ25nQ3NwTm9uY2UnKSB8fCBudWxsO1xuICB9LFxufSk7XG5cbi8qKlxuICogQSBjb25maWd1cmF0aW9uIG9iamVjdCBmb3IgdGhlIGltYWdlLXJlbGF0ZWQgb3B0aW9ucy4gQ29udGFpbnM6XG4gKiAtIGJyZWFrcG9pbnRzOiBBbiBhcnJheSBvZiBpbnRlZ2VyIGJyZWFrcG9pbnRzIHVzZWQgdG8gZ2VuZXJhdGVcbiAqICAgICAgc3Jjc2V0cyBmb3IgcmVzcG9uc2l2ZSBpbWFnZXMuXG4gKiAtIGRpc2FibGVJbWFnZVNpemVXYXJuaW5nOiBBIGJvb2xlYW4gdmFsdWUuIFNldHRpbmcgdGhpcyB0byB0cnVlIHdpbGxcbiAqICAgICAgZGlzYWJsZSBjb25zb2xlIHdhcm5pbmdzIGFib3V0IG92ZXJzaXplZCBpbWFnZXMuXG4gKiAtIGRpc2FibGVJbWFnZUxhenlMb2FkV2FybmluZzogQSBib29sZWFuIHZhbHVlLiBTZXR0aW5nIHRoaXMgdG8gdHJ1ZSB3aWxsXG4gKiAgICAgIGRpc2FibGUgY29uc29sZSB3YXJuaW5ncyBhYm91dCBMQ1AgaW1hZ2VzIGNvbmZpZ3VyZWQgd2l0aCBgbG9hZGluZz1cImxhenlcImAuXG4gKiBMZWFybiBtb3JlIGFib3V0IHRoZSByZXNwb25zaXZlIGltYWdlIGNvbmZpZ3VyYXRpb24gaW4gW3RoZSBOZ09wdGltaXplZEltYWdlXG4gKiBndWlkZV0oZ3VpZGUvaW1hZ2UtZGlyZWN0aXZlKS5cbiAqIExlYXJuIG1vcmUgYWJvdXQgaW1hZ2Ugd2FybmluZyBvcHRpb25zIGluIFt0aGUgcmVsYXRlZCBlcnJvciBwYWdlXShlcnJvcnMvTkcwOTEzKS5cbiAqIEBwdWJsaWNBcGlcbiAqL1xuZXhwb3J0IHR5cGUgSW1hZ2VDb25maWcgPSB7XG4gIGJyZWFrcG9pbnRzPzogbnVtYmVyW10sXG4gIGRpc2FibGVJbWFnZVNpemVXYXJuaW5nPzogYm9vbGVhbixcbiAgZGlzYWJsZUltYWdlTGF6eUxvYWRXYXJuaW5nPzogYm9vbGVhbixcbn07XG5cbmV4cG9ydCBjb25zdCBJTUFHRV9DT05GSUdfREVGQVVMVFM6IEltYWdlQ29uZmlnID0ge1xuICBicmVha3BvaW50czogWzE2LCAzMiwgNDgsIDY0LCA5NiwgMTI4LCAyNTYsIDM4NCwgNjQwLCA3NTAsIDgyOCwgMTA4MCwgMTIwMCwgMTkyMCwgMjA0OCwgMzg0MF0sXG4gIGRpc2FibGVJbWFnZVNpemVXYXJuaW5nOiBmYWxzZSxcbiAgZGlzYWJsZUltYWdlTGF6eUxvYWRXYXJuaW5nOiBmYWxzZSxcbn07XG5cbi8qKlxuICogSW5qZWN0aW9uIHRva2VuIHRoYXQgY29uZmlndXJlcyB0aGUgaW1hZ2Ugb3B0aW1pemVkIGltYWdlIGZ1bmN0aW9uYWxpdHkuXG4gKiBTZWUge0BsaW5rIEltYWdlQ29uZmlnfSBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiBhYm91dCBwYXJhbWV0ZXJzIHRoYXRcbiAqIGNhbiBiZSB1c2VkLlxuICpcbiAqIEBzZWUge0BsaW5rIE5nT3B0aW1pemVkSW1hZ2V9XG4gKiBAc2VlIHtAbGluayBJbWFnZUNvbmZpZ31cbiAqIEBwdWJsaWNBcGlcbiAqL1xuZXhwb3J0IGNvbnN0IElNQUdFX0NPTkZJRyA9IG5ldyBJbmplY3Rpb25Ub2tlbjxJbWFnZUNvbmZpZz4oXG4gICAgJ0ltYWdlQ29uZmlnJywge3Byb3ZpZGVkSW46ICdyb290JywgZmFjdG9yeTogKCkgPT4gSU1BR0VfQ09ORklHX0RFRkFVTFRTfSk7XG4iXX0=