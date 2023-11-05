/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { inject, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { HttpBackend, HttpHandler } from './backend';
import { HttpClient } from './client';
import { FetchBackend } from './fetch';
import { HTTP_INTERCEPTOR_FNS, HttpInterceptorHandler, legacyInterceptorFnFactory, PRIMARY_HTTP_BACKEND } from './interceptor';
import { jsonpCallbackContext, JsonpCallbackContext, JsonpClientBackend, jsonpInterceptorFn } from './jsonp';
import { HttpXhrBackend } from './xhr';
import { HttpXsrfCookieExtractor, HttpXsrfTokenExtractor, XSRF_COOKIE_NAME, XSRF_ENABLED, XSRF_HEADER_NAME, xsrfInterceptorFn } from './xsrf';
/**
 * Identifies a particular kind of `HttpFeature`.
 *
 * @publicApi
 */
export var HttpFeatureKind;
(function (HttpFeatureKind) {
    HttpFeatureKind[HttpFeatureKind["Interceptors"] = 0] = "Interceptors";
    HttpFeatureKind[HttpFeatureKind["LegacyInterceptors"] = 1] = "LegacyInterceptors";
    HttpFeatureKind[HttpFeatureKind["CustomXsrfConfiguration"] = 2] = "CustomXsrfConfiguration";
    HttpFeatureKind[HttpFeatureKind["NoXsrfProtection"] = 3] = "NoXsrfProtection";
    HttpFeatureKind[HttpFeatureKind["JsonpSupport"] = 4] = "JsonpSupport";
    HttpFeatureKind[HttpFeatureKind["RequestsMadeViaParent"] = 5] = "RequestsMadeViaParent";
    HttpFeatureKind[HttpFeatureKind["Fetch"] = 6] = "Fetch";
})(HttpFeatureKind || (HttpFeatureKind = {}));
function makeHttpFeature(kind, providers) {
    return {
        ɵkind: kind,
        ɵproviders: providers,
    };
}
/**
 * Configures Angular's `HttpClient` service to be available for injection.
 *
 * By default, `HttpClient` will be configured for injection with its default options for XSRF
 * protection of outgoing requests. Additional configuration options can be provided by passing
 * feature functions to `provideHttpClient`. For example, HTTP interceptors can be added using the
 * `withInterceptors(...)` feature.
 *
 * <div class="alert is-helpful">
 *
 * It's strongly recommended to enable
 * [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) for applications that use
 * Server-Side Rendering for better performance and compatibility. To enable `fetch`, add
 * `withFetch()` feature to the `provideHttpClient()` call at the root of the application:
 *
 * ```
 * provideHttpClient(withFetch());
 * ```
 *
 * </div>
 *
 * @see {@link withInterceptors}
 * @see {@link withInterceptorsFromDi}
 * @see {@link withXsrfConfiguration}
 * @see {@link withNoXsrfProtection}
 * @see {@link withJsonpSupport}
 * @see {@link withRequestsMadeViaParent}
 * @see {@link withFetch}
 */
export function provideHttpClient(...features) {
    if (ngDevMode) {
        const featureKinds = new Set(features.map(f => f.ɵkind));
        if (featureKinds.has(HttpFeatureKind.NoXsrfProtection) &&
            featureKinds.has(HttpFeatureKind.CustomXsrfConfiguration)) {
            throw new Error(ngDevMode ?
                `Configuration error: found both withXsrfConfiguration() and withNoXsrfProtection() in the same call to provideHttpClient(), which is a contradiction.` :
                '');
        }
    }
    const providers = [
        HttpClient,
        HttpXhrBackend,
        HttpInterceptorHandler,
        { provide: HttpHandler, useExisting: HttpInterceptorHandler },
        { provide: HttpBackend, useExisting: HttpXhrBackend },
        {
            provide: HTTP_INTERCEPTOR_FNS,
            useValue: xsrfInterceptorFn,
            multi: true,
        },
        { provide: XSRF_ENABLED, useValue: true },
        { provide: HttpXsrfTokenExtractor, useClass: HttpXsrfCookieExtractor },
    ];
    for (const feature of features) {
        providers.push(...feature.ɵproviders);
    }
    return makeEnvironmentProviders(providers);
}
/**
 * Adds one or more functional-style HTTP interceptors to the configuration of the `HttpClient`
 * instance.
 *
 * @see {@link HttpInterceptorFn}
 * @see {@link provideHttpClient}
 * @publicApi
 */
export function withInterceptors(interceptorFns) {
    return makeHttpFeature(HttpFeatureKind.Interceptors, interceptorFns.map(interceptorFn => {
        return {
            provide: HTTP_INTERCEPTOR_FNS,
            useValue: interceptorFn,
            multi: true,
        };
    }));
}
const LEGACY_INTERCEPTOR_FN = new InjectionToken('LEGACY_INTERCEPTOR_FN');
/**
 * Includes class-based interceptors configured using a multi-provider in the current injector into
 * the configured `HttpClient` instance.
 *
 * Prefer `withInterceptors` and functional interceptors instead, as support for DI-provided
 * interceptors may be phased out in a later release.
 *
 * @see {@link HttpInterceptor}
 * @see {@link HTTP_INTERCEPTORS}
 * @see {@link provideHttpClient}
 */
export function withInterceptorsFromDi() {
    // Note: the legacy interceptor function is provided here via an intermediate token
    // (`LEGACY_INTERCEPTOR_FN`), using a pattern which guarantees that if these providers are
    // included multiple times, all of the multi-provider entries will have the same instance of the
    // interceptor function. That way, the `HttpINterceptorHandler` will dedup them and legacy
    // interceptors will not run multiple times.
    return makeHttpFeature(HttpFeatureKind.LegacyInterceptors, [
        {
            provide: LEGACY_INTERCEPTOR_FN,
            useFactory: legacyInterceptorFnFactory,
        },
        {
            provide: HTTP_INTERCEPTOR_FNS,
            useExisting: LEGACY_INTERCEPTOR_FN,
            multi: true,
        }
    ]);
}
/**
 * Customizes the XSRF protection for the configuration of the current `HttpClient` instance.
 *
 * This feature is incompatible with the `withNoXsrfProtection` feature.
 *
 * @see {@link provideHttpClient}
 */
export function withXsrfConfiguration({ cookieName, headerName }) {
    const providers = [];
    if (cookieName !== undefined) {
        providers.push({ provide: XSRF_COOKIE_NAME, useValue: cookieName });
    }
    if (headerName !== undefined) {
        providers.push({ provide: XSRF_HEADER_NAME, useValue: headerName });
    }
    return makeHttpFeature(HttpFeatureKind.CustomXsrfConfiguration, providers);
}
/**
 * Disables XSRF protection in the configuration of the current `HttpClient` instance.
 *
 * This feature is incompatible with the `withXsrfConfiguration` feature.
 *
 * @see {@link provideHttpClient}
 */
export function withNoXsrfProtection() {
    return makeHttpFeature(HttpFeatureKind.NoXsrfProtection, [
        {
            provide: XSRF_ENABLED,
            useValue: false,
        },
    ]);
}
/**
 * Add JSONP support to the configuration of the current `HttpClient` instance.
 *
 * @see {@link provideHttpClient}
 */
export function withJsonpSupport() {
    return makeHttpFeature(HttpFeatureKind.JsonpSupport, [
        JsonpClientBackend,
        { provide: JsonpCallbackContext, useFactory: jsonpCallbackContext },
        { provide: HTTP_INTERCEPTOR_FNS, useValue: jsonpInterceptorFn, multi: true },
    ]);
}
/**
 * Configures the current `HttpClient` instance to make requests via the parent injector's
 * `HttpClient` instead of directly.
 *
 * By default, `provideHttpClient` configures `HttpClient` in its injector to be an independent
 * instance. For example, even if `HttpClient` is configured in the parent injector with
 * one or more interceptors, they will not intercept requests made via this instance.
 *
 * With this option enabled, once the request has passed through the current injector's
 * interceptors, it will be delegated to the parent injector's `HttpClient` chain instead of
 * dispatched directly, and interceptors in the parent configuration will be applied to the request.
 *
 * If there are several `HttpClient` instances in the injector hierarchy, it's possible for
 * `withRequestsMadeViaParent` to be used at multiple levels, which will cause the request to
 * "bubble up" until either reaching the root level or an `HttpClient` which was not configured with
 * this option.
 *
 * @see {@link provideHttpClient}
 * @developerPreview
 */
export function withRequestsMadeViaParent() {
    return makeHttpFeature(HttpFeatureKind.RequestsMadeViaParent, [
        {
            provide: HttpBackend,
            useFactory: () => {
                const handlerFromParent = inject(HttpHandler, { skipSelf: true, optional: true });
                if (ngDevMode && handlerFromParent === null) {
                    throw new Error('withRequestsMadeViaParent() can only be used when the parent injector also configures HttpClient');
                }
                return handlerFromParent;
            },
        },
    ]);
}
/**
 * Configures the current `HttpClient` instance to make requests using the fetch API.
 *
 * This `FetchBackend` requires the support of the Fetch API which is available on all evergreen
 * browsers and on NodeJS from v18 onward.
 *
 * Note: The Fetch API doesn't support progress report on uploads.
 *
 * @publicApi
 */
export function withFetch() {
    if ((typeof ngDevMode === 'undefined' || ngDevMode) && typeof fetch !== 'function') {
        // TODO: Create a runtime error
        // TODO: Use ENVIRONMENT_INITIALIZER to contextualize the error message (browser or server)
        throw new Error('The `withFetch` feature of HttpClient requires the `fetch` API to be available. ' +
            'If you run the code in a Node environment, make sure you use Node v18.10 or later.');
    }
    return makeHttpFeature(HttpFeatureKind.Fetch, [
        FetchBackend,
        { provide: HttpBackend, useExisting: FetchBackend },
        { provide: PRIMARY_HTTP_BACKEND, useExisting: FetchBackend },
    ]);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvdmlkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9jb21tb24vaHR0cC9zcmMvcHJvdmlkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7OztHQU1HO0FBRUgsT0FBTyxFQUF1QixNQUFNLEVBQUUsY0FBYyxFQUFFLHdCQUF3QixFQUFXLE1BQU0sZUFBZSxDQUFDO0FBRS9HLE9BQU8sRUFBQyxXQUFXLEVBQUUsV0FBVyxFQUFDLE1BQU0sV0FBVyxDQUFDO0FBQ25ELE9BQU8sRUFBQyxVQUFVLEVBQUMsTUFBTSxVQUFVLENBQUM7QUFDcEMsT0FBTyxFQUFDLFlBQVksRUFBQyxNQUFNLFNBQVMsQ0FBQztBQUNyQyxPQUFPLEVBQUMsb0JBQW9CLEVBQXFCLHNCQUFzQixFQUFFLDBCQUEwQixFQUFFLG9CQUFvQixFQUFDLE1BQU0sZUFBZSxDQUFDO0FBQ2hKLE9BQU8sRUFBQyxvQkFBb0IsRUFBRSxvQkFBb0IsRUFBRSxrQkFBa0IsRUFBRSxrQkFBa0IsRUFBQyxNQUFNLFNBQVMsQ0FBQztBQUMzRyxPQUFPLEVBQUMsY0FBYyxFQUFDLE1BQU0sT0FBTyxDQUFDO0FBQ3JDLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSxzQkFBc0IsRUFBRSxnQkFBZ0IsRUFBRSxZQUFZLEVBQUUsZ0JBQWdCLEVBQUUsaUJBQWlCLEVBQUMsTUFBTSxRQUFRLENBQUM7QUFFNUk7Ozs7R0FJRztBQUNILE1BQU0sQ0FBTixJQUFZLGVBUVg7QUFSRCxXQUFZLGVBQWU7SUFDekIscUVBQVksQ0FBQTtJQUNaLGlGQUFrQixDQUFBO0lBQ2xCLDJGQUF1QixDQUFBO0lBQ3ZCLDZFQUFnQixDQUFBO0lBQ2hCLHFFQUFZLENBQUE7SUFDWix1RkFBcUIsQ0FBQTtJQUNyQix1REFBSyxDQUFBO0FBQ1AsQ0FBQyxFQVJXLGVBQWUsS0FBZixlQUFlLFFBUTFCO0FBWUQsU0FBUyxlQUFlLENBQ3BCLElBQVcsRUFBRSxTQUFxQjtJQUNwQyxPQUFPO1FBQ0wsS0FBSyxFQUFFLElBQUk7UUFDWCxVQUFVLEVBQUUsU0FBUztLQUN0QixDQUFDO0FBQ0osQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNEJHO0FBQ0gsTUFBTSxVQUFVLGlCQUFpQixDQUFDLEdBQUcsUUFBd0M7SUFFM0UsSUFBSSxTQUFTLEVBQUU7UUFDYixNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDekQsSUFBSSxZQUFZLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxnQkFBZ0IsQ0FBQztZQUNsRCxZQUFZLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFO1lBQzdELE1BQU0sSUFBSSxLQUFLLENBQ1gsU0FBUyxDQUFDLENBQUM7Z0JBQ1AsdUpBQXVKLENBQUMsQ0FBQztnQkFDekosRUFBRSxDQUFDLENBQUM7U0FDYjtLQUNGO0lBRUQsTUFBTSxTQUFTLEdBQWU7UUFDNUIsVUFBVTtRQUNWLGNBQWM7UUFDZCxzQkFBc0I7UUFDdEIsRUFBQyxPQUFPLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxzQkFBc0IsRUFBQztRQUMzRCxFQUFDLE9BQU8sRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLGNBQWMsRUFBQztRQUNuRDtZQUNFLE9BQU8sRUFBRSxvQkFBb0I7WUFDN0IsUUFBUSxFQUFFLGlCQUFpQjtZQUMzQixLQUFLLEVBQUUsSUFBSTtTQUNaO1FBQ0QsRUFBQyxPQUFPLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUM7UUFDdkMsRUFBQyxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsUUFBUSxFQUFFLHVCQUF1QixFQUFDO0tBQ3JFLENBQUM7SUFFRixLQUFLLE1BQU0sT0FBTyxJQUFJLFFBQVEsRUFBRTtRQUM5QixTQUFTLENBQUMsSUFBSSxDQUFDLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0tBQ3ZDO0lBRUQsT0FBTyx3QkFBd0IsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUM3QyxDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILE1BQU0sVUFBVSxnQkFBZ0IsQ0FBQyxjQUFtQztJQUVsRSxPQUFPLGVBQWUsQ0FBQyxlQUFlLENBQUMsWUFBWSxFQUFFLGNBQWMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEVBQUU7UUFDdEYsT0FBTztZQUNMLE9BQU8sRUFBRSxvQkFBb0I7WUFDN0IsUUFBUSxFQUFFLGFBQWE7WUFDdkIsS0FBSyxFQUFFLElBQUk7U0FDWixDQUFDO0lBQ0osQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUM7QUFFRCxNQUFNLHFCQUFxQixHQUFHLElBQUksY0FBYyxDQUFvQix1QkFBdUIsQ0FBQyxDQUFDO0FBRTdGOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFNLFVBQVUsc0JBQXNCO0lBQ3BDLG1GQUFtRjtJQUNuRiwwRkFBMEY7SUFDMUYsZ0dBQWdHO0lBQ2hHLDBGQUEwRjtJQUMxRiw0Q0FBNEM7SUFDNUMsT0FBTyxlQUFlLENBQUMsZUFBZSxDQUFDLGtCQUFrQixFQUFFO1FBQ3pEO1lBQ0UsT0FBTyxFQUFFLHFCQUFxQjtZQUM5QixVQUFVLEVBQUUsMEJBQTBCO1NBQ3ZDO1FBQ0Q7WUFDRSxPQUFPLEVBQUUsb0JBQW9CO1lBQzdCLFdBQVcsRUFBRSxxQkFBcUI7WUFDbEMsS0FBSyxFQUFFLElBQUk7U0FDWjtLQUNGLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxNQUFNLFVBQVUscUJBQXFCLENBQ2pDLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBNkM7SUFFdEUsTUFBTSxTQUFTLEdBQWUsRUFBRSxDQUFDO0lBQ2pDLElBQUksVUFBVSxLQUFLLFNBQVMsRUFBRTtRQUM1QixTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUMsT0FBTyxFQUFFLGdCQUFnQixFQUFFLFFBQVEsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFDO0tBQ25FO0lBQ0QsSUFBSSxVQUFVLEtBQUssU0FBUyxFQUFFO1FBQzVCLFNBQVMsQ0FBQyxJQUFJLENBQUMsRUFBQyxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUM7S0FDbkU7SUFFRCxPQUFPLGVBQWUsQ0FBQyxlQUFlLENBQUMsdUJBQXVCLEVBQUUsU0FBUyxDQUFDLENBQUM7QUFDN0UsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILE1BQU0sVUFBVSxvQkFBb0I7SUFDbEMsT0FBTyxlQUFlLENBQUMsZUFBZSxDQUFDLGdCQUFnQixFQUFFO1FBQ3ZEO1lBQ0UsT0FBTyxFQUFFLFlBQVk7WUFDckIsUUFBUSxFQUFFLEtBQUs7U0FDaEI7S0FDRixDQUFDLENBQUM7QUFDTCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxnQkFBZ0I7SUFDOUIsT0FBTyxlQUFlLENBQUMsZUFBZSxDQUFDLFlBQVksRUFBRTtRQUNuRCxrQkFBa0I7UUFDbEIsRUFBQyxPQUFPLEVBQUUsb0JBQW9CLEVBQUUsVUFBVSxFQUFFLG9CQUFvQixFQUFDO1FBQ2pFLEVBQUMsT0FBTyxFQUFFLG9CQUFvQixFQUFFLFFBQVEsRUFBRSxrQkFBa0IsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDO0tBQzNFLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQU0sVUFBVSx5QkFBeUI7SUFDdkMsT0FBTyxlQUFlLENBQUMsZUFBZSxDQUFDLHFCQUFxQixFQUFFO1FBQzVEO1lBQ0UsT0FBTyxFQUFFLFdBQVc7WUFDcEIsVUFBVSxFQUFFLEdBQUcsRUFBRTtnQkFDZixNQUFNLGlCQUFpQixHQUFHLE1BQU0sQ0FBQyxXQUFXLEVBQUUsRUFBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFDO2dCQUNoRixJQUFJLFNBQVMsSUFBSSxpQkFBaUIsS0FBSyxJQUFJLEVBQUU7b0JBQzNDLE1BQU0sSUFBSSxLQUFLLENBQ1gsa0dBQWtHLENBQUMsQ0FBQztpQkFDekc7Z0JBQ0QsT0FBTyxpQkFBaUIsQ0FBQztZQUMzQixDQUFDO1NBQ0Y7S0FDRixDQUFDLENBQUM7QUFDTCxDQUFDO0FBR0Q7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxVQUFVLFNBQVM7SUFDdkIsSUFBSSxDQUFDLE9BQU8sU0FBUyxLQUFLLFdBQVcsSUFBSSxTQUFTLENBQUMsSUFBSSxPQUFPLEtBQUssS0FBSyxVQUFVLEVBQUU7UUFDbEYsK0JBQStCO1FBQy9CLDJGQUEyRjtRQUMzRixNQUFNLElBQUksS0FBSyxDQUNYLGtGQUFrRjtZQUNsRixvRkFBb0YsQ0FBQyxDQUFDO0tBQzNGO0lBRUQsT0FBTyxlQUFlLENBQUMsZUFBZSxDQUFDLEtBQUssRUFBRTtRQUM1QyxZQUFZO1FBQ1osRUFBQyxPQUFPLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxZQUFZLEVBQUM7UUFDakQsRUFBQyxPQUFPLEVBQUUsb0JBQW9CLEVBQUUsV0FBVyxFQUFFLFlBQVksRUFBQztLQUMzRCxDQUFDLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB7RW52aXJvbm1lbnRQcm92aWRlcnMsIGluamVjdCwgSW5qZWN0aW9uVG9rZW4sIG1ha2VFbnZpcm9ubWVudFByb3ZpZGVycywgUHJvdmlkZXJ9IGZyb20gJ0Bhbmd1bGFyL2NvcmUnO1xuXG5pbXBvcnQge0h0dHBCYWNrZW5kLCBIdHRwSGFuZGxlcn0gZnJvbSAnLi9iYWNrZW5kJztcbmltcG9ydCB7SHR0cENsaWVudH0gZnJvbSAnLi9jbGllbnQnO1xuaW1wb3J0IHtGZXRjaEJhY2tlbmR9IGZyb20gJy4vZmV0Y2gnO1xuaW1wb3J0IHtIVFRQX0lOVEVSQ0VQVE9SX0ZOUywgSHR0cEludGVyY2VwdG9yRm4sIEh0dHBJbnRlcmNlcHRvckhhbmRsZXIsIGxlZ2FjeUludGVyY2VwdG9yRm5GYWN0b3J5LCBQUklNQVJZX0hUVFBfQkFDS0VORH0gZnJvbSAnLi9pbnRlcmNlcHRvcic7XG5pbXBvcnQge2pzb25wQ2FsbGJhY2tDb250ZXh0LCBKc29ucENhbGxiYWNrQ29udGV4dCwgSnNvbnBDbGllbnRCYWNrZW5kLCBqc29ucEludGVyY2VwdG9yRm59IGZyb20gJy4vanNvbnAnO1xuaW1wb3J0IHtIdHRwWGhyQmFja2VuZH0gZnJvbSAnLi94aHInO1xuaW1wb3J0IHtIdHRwWHNyZkNvb2tpZUV4dHJhY3RvciwgSHR0cFhzcmZUb2tlbkV4dHJhY3RvciwgWFNSRl9DT09LSUVfTkFNRSwgWFNSRl9FTkFCTEVELCBYU1JGX0hFQURFUl9OQU1FLCB4c3JmSW50ZXJjZXB0b3JGbn0gZnJvbSAnLi94c3JmJztcblxuLyoqXG4gKiBJZGVudGlmaWVzIGEgcGFydGljdWxhciBraW5kIG9mIGBIdHRwRmVhdHVyZWAuXG4gKlxuICogQHB1YmxpY0FwaVxuICovXG5leHBvcnQgZW51bSBIdHRwRmVhdHVyZUtpbmQge1xuICBJbnRlcmNlcHRvcnMsXG4gIExlZ2FjeUludGVyY2VwdG9ycyxcbiAgQ3VzdG9tWHNyZkNvbmZpZ3VyYXRpb24sXG4gIE5vWHNyZlByb3RlY3Rpb24sXG4gIEpzb25wU3VwcG9ydCxcbiAgUmVxdWVzdHNNYWRlVmlhUGFyZW50LFxuICBGZXRjaCxcbn1cblxuLyoqXG4gKiBBIGZlYXR1cmUgZm9yIHVzZSB3aGVuIGNvbmZpZ3VyaW5nIGBwcm92aWRlSHR0cENsaWVudGAuXG4gKlxuICogQHB1YmxpY0FwaVxuICovXG5leHBvcnQgaW50ZXJmYWNlIEh0dHBGZWF0dXJlPEtpbmRUIGV4dGVuZHMgSHR0cEZlYXR1cmVLaW5kPiB7XG4gIMm1a2luZDogS2luZFQ7XG4gIMm1cHJvdmlkZXJzOiBQcm92aWRlcltdO1xufVxuXG5mdW5jdGlvbiBtYWtlSHR0cEZlYXR1cmU8S2luZFQgZXh0ZW5kcyBIdHRwRmVhdHVyZUtpbmQ+KFxuICAgIGtpbmQ6IEtpbmRULCBwcm92aWRlcnM6IFByb3ZpZGVyW10pOiBIdHRwRmVhdHVyZTxLaW5kVD4ge1xuICByZXR1cm4ge1xuICAgIMm1a2luZDoga2luZCxcbiAgICDJtXByb3ZpZGVyczogcHJvdmlkZXJzLFxuICB9O1xufVxuXG4vKipcbiAqIENvbmZpZ3VyZXMgQW5ndWxhcidzIGBIdHRwQ2xpZW50YCBzZXJ2aWNlIHRvIGJlIGF2YWlsYWJsZSBmb3IgaW5qZWN0aW9uLlxuICpcbiAqIEJ5IGRlZmF1bHQsIGBIdHRwQ2xpZW50YCB3aWxsIGJlIGNvbmZpZ3VyZWQgZm9yIGluamVjdGlvbiB3aXRoIGl0cyBkZWZhdWx0IG9wdGlvbnMgZm9yIFhTUkZcbiAqIHByb3RlY3Rpb24gb2Ygb3V0Z29pbmcgcmVxdWVzdHMuIEFkZGl0aW9uYWwgY29uZmlndXJhdGlvbiBvcHRpb25zIGNhbiBiZSBwcm92aWRlZCBieSBwYXNzaW5nXG4gKiBmZWF0dXJlIGZ1bmN0aW9ucyB0byBgcHJvdmlkZUh0dHBDbGllbnRgLiBGb3IgZXhhbXBsZSwgSFRUUCBpbnRlcmNlcHRvcnMgY2FuIGJlIGFkZGVkIHVzaW5nIHRoZVxuICogYHdpdGhJbnRlcmNlcHRvcnMoLi4uKWAgZmVhdHVyZS5cbiAqXG4gKiA8ZGl2IGNsYXNzPVwiYWxlcnQgaXMtaGVscGZ1bFwiPlxuICpcbiAqIEl0J3Mgc3Ryb25nbHkgcmVjb21tZW5kZWQgdG8gZW5hYmxlXG4gKiBbYGZldGNoYF0oaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL0ZldGNoX0FQSSkgZm9yIGFwcGxpY2F0aW9ucyB0aGF0IHVzZVxuICogU2VydmVyLVNpZGUgUmVuZGVyaW5nIGZvciBiZXR0ZXIgcGVyZm9ybWFuY2UgYW5kIGNvbXBhdGliaWxpdHkuIFRvIGVuYWJsZSBgZmV0Y2hgLCBhZGRcbiAqIGB3aXRoRmV0Y2goKWAgZmVhdHVyZSB0byB0aGUgYHByb3ZpZGVIdHRwQ2xpZW50KClgIGNhbGwgYXQgdGhlIHJvb3Qgb2YgdGhlIGFwcGxpY2F0aW9uOlxuICpcbiAqIGBgYFxuICogcHJvdmlkZUh0dHBDbGllbnQod2l0aEZldGNoKCkpO1xuICogYGBgXG4gKlxuICogPC9kaXY+XG4gKlxuICogQHNlZSB7QGxpbmsgd2l0aEludGVyY2VwdG9yc31cbiAqIEBzZWUge0BsaW5rIHdpdGhJbnRlcmNlcHRvcnNGcm9tRGl9XG4gKiBAc2VlIHtAbGluayB3aXRoWHNyZkNvbmZpZ3VyYXRpb259XG4gKiBAc2VlIHtAbGluayB3aXRoTm9Yc3JmUHJvdGVjdGlvbn1cbiAqIEBzZWUge0BsaW5rIHdpdGhKc29ucFN1cHBvcnR9XG4gKiBAc2VlIHtAbGluayB3aXRoUmVxdWVzdHNNYWRlVmlhUGFyZW50fVxuICogQHNlZSB7QGxpbmsgd2l0aEZldGNofVxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJvdmlkZUh0dHBDbGllbnQoLi4uZmVhdHVyZXM6IEh0dHBGZWF0dXJlPEh0dHBGZWF0dXJlS2luZD5bXSk6XG4gICAgRW52aXJvbm1lbnRQcm92aWRlcnMge1xuICBpZiAobmdEZXZNb2RlKSB7XG4gICAgY29uc3QgZmVhdHVyZUtpbmRzID0gbmV3IFNldChmZWF0dXJlcy5tYXAoZiA9PiBmLsm1a2luZCkpO1xuICAgIGlmIChmZWF0dXJlS2luZHMuaGFzKEh0dHBGZWF0dXJlS2luZC5Ob1hzcmZQcm90ZWN0aW9uKSAmJlxuICAgICAgICBmZWF0dXJlS2luZHMuaGFzKEh0dHBGZWF0dXJlS2luZC5DdXN0b21Yc3JmQ29uZmlndXJhdGlvbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBuZ0Rldk1vZGUgP1xuICAgICAgICAgICAgICBgQ29uZmlndXJhdGlvbiBlcnJvcjogZm91bmQgYm90aCB3aXRoWHNyZkNvbmZpZ3VyYXRpb24oKSBhbmQgd2l0aE5vWHNyZlByb3RlY3Rpb24oKSBpbiB0aGUgc2FtZSBjYWxsIHRvIHByb3ZpZGVIdHRwQ2xpZW50KCksIHdoaWNoIGlzIGEgY29udHJhZGljdGlvbi5gIDpcbiAgICAgICAgICAgICAgJycpO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHByb3ZpZGVyczogUHJvdmlkZXJbXSA9IFtcbiAgICBIdHRwQ2xpZW50LFxuICAgIEh0dHBYaHJCYWNrZW5kLFxuICAgIEh0dHBJbnRlcmNlcHRvckhhbmRsZXIsXG4gICAge3Byb3ZpZGU6IEh0dHBIYW5kbGVyLCB1c2VFeGlzdGluZzogSHR0cEludGVyY2VwdG9ySGFuZGxlcn0sXG4gICAge3Byb3ZpZGU6IEh0dHBCYWNrZW5kLCB1c2VFeGlzdGluZzogSHR0cFhockJhY2tlbmR9LFxuICAgIHtcbiAgICAgIHByb3ZpZGU6IEhUVFBfSU5URVJDRVBUT1JfRk5TLFxuICAgICAgdXNlVmFsdWU6IHhzcmZJbnRlcmNlcHRvckZuLFxuICAgICAgbXVsdGk6IHRydWUsXG4gICAgfSxcbiAgICB7cHJvdmlkZTogWFNSRl9FTkFCTEVELCB1c2VWYWx1ZTogdHJ1ZX0sXG4gICAge3Byb3ZpZGU6IEh0dHBYc3JmVG9rZW5FeHRyYWN0b3IsIHVzZUNsYXNzOiBIdHRwWHNyZkNvb2tpZUV4dHJhY3Rvcn0sXG4gIF07XG5cbiAgZm9yIChjb25zdCBmZWF0dXJlIG9mIGZlYXR1cmVzKSB7XG4gICAgcHJvdmlkZXJzLnB1c2goLi4uZmVhdHVyZS7JtXByb3ZpZGVycyk7XG4gIH1cblxuICByZXR1cm4gbWFrZUVudmlyb25tZW50UHJvdmlkZXJzKHByb3ZpZGVycyk7XG59XG5cbi8qKlxuICogQWRkcyBvbmUgb3IgbW9yZSBmdW5jdGlvbmFsLXN0eWxlIEhUVFAgaW50ZXJjZXB0b3JzIHRvIHRoZSBjb25maWd1cmF0aW9uIG9mIHRoZSBgSHR0cENsaWVudGBcbiAqIGluc3RhbmNlLlxuICpcbiAqIEBzZWUge0BsaW5rIEh0dHBJbnRlcmNlcHRvckZufVxuICogQHNlZSB7QGxpbmsgcHJvdmlkZUh0dHBDbGllbnR9XG4gKiBAcHVibGljQXBpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3aXRoSW50ZXJjZXB0b3JzKGludGVyY2VwdG9yRm5zOiBIdHRwSW50ZXJjZXB0b3JGbltdKTpcbiAgICBIdHRwRmVhdHVyZTxIdHRwRmVhdHVyZUtpbmQuSW50ZXJjZXB0b3JzPiB7XG4gIHJldHVybiBtYWtlSHR0cEZlYXR1cmUoSHR0cEZlYXR1cmVLaW5kLkludGVyY2VwdG9ycywgaW50ZXJjZXB0b3JGbnMubWFwKGludGVyY2VwdG9yRm4gPT4ge1xuICAgIHJldHVybiB7XG4gICAgICBwcm92aWRlOiBIVFRQX0lOVEVSQ0VQVE9SX0ZOUyxcbiAgICAgIHVzZVZhbHVlOiBpbnRlcmNlcHRvckZuLFxuICAgICAgbXVsdGk6IHRydWUsXG4gICAgfTtcbiAgfSkpO1xufVxuXG5jb25zdCBMRUdBQ1lfSU5URVJDRVBUT1JfRk4gPSBuZXcgSW5qZWN0aW9uVG9rZW48SHR0cEludGVyY2VwdG9yRm4+KCdMRUdBQ1lfSU5URVJDRVBUT1JfRk4nKTtcblxuLyoqXG4gKiBJbmNsdWRlcyBjbGFzcy1iYXNlZCBpbnRlcmNlcHRvcnMgY29uZmlndXJlZCB1c2luZyBhIG11bHRpLXByb3ZpZGVyIGluIHRoZSBjdXJyZW50IGluamVjdG9yIGludG9cbiAqIHRoZSBjb25maWd1cmVkIGBIdHRwQ2xpZW50YCBpbnN0YW5jZS5cbiAqXG4gKiBQcmVmZXIgYHdpdGhJbnRlcmNlcHRvcnNgIGFuZCBmdW5jdGlvbmFsIGludGVyY2VwdG9ycyBpbnN0ZWFkLCBhcyBzdXBwb3J0IGZvciBESS1wcm92aWRlZFxuICogaW50ZXJjZXB0b3JzIG1heSBiZSBwaGFzZWQgb3V0IGluIGEgbGF0ZXIgcmVsZWFzZS5cbiAqXG4gKiBAc2VlIHtAbGluayBIdHRwSW50ZXJjZXB0b3J9XG4gKiBAc2VlIHtAbGluayBIVFRQX0lOVEVSQ0VQVE9SU31cbiAqIEBzZWUge0BsaW5rIHByb3ZpZGVIdHRwQ2xpZW50fVxuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aEludGVyY2VwdG9yc0Zyb21EaSgpOiBIdHRwRmVhdHVyZTxIdHRwRmVhdHVyZUtpbmQuTGVnYWN5SW50ZXJjZXB0b3JzPiB7XG4gIC8vIE5vdGU6IHRoZSBsZWdhY3kgaW50ZXJjZXB0b3IgZnVuY3Rpb24gaXMgcHJvdmlkZWQgaGVyZSB2aWEgYW4gaW50ZXJtZWRpYXRlIHRva2VuXG4gIC8vIChgTEVHQUNZX0lOVEVSQ0VQVE9SX0ZOYCksIHVzaW5nIGEgcGF0dGVybiB3aGljaCBndWFyYW50ZWVzIHRoYXQgaWYgdGhlc2UgcHJvdmlkZXJzIGFyZVxuICAvLyBpbmNsdWRlZCBtdWx0aXBsZSB0aW1lcywgYWxsIG9mIHRoZSBtdWx0aS1wcm92aWRlciBlbnRyaWVzIHdpbGwgaGF2ZSB0aGUgc2FtZSBpbnN0YW5jZSBvZiB0aGVcbiAgLy8gaW50ZXJjZXB0b3IgZnVuY3Rpb24uIFRoYXQgd2F5LCB0aGUgYEh0dHBJTnRlcmNlcHRvckhhbmRsZXJgIHdpbGwgZGVkdXAgdGhlbSBhbmQgbGVnYWN5XG4gIC8vIGludGVyY2VwdG9ycyB3aWxsIG5vdCBydW4gbXVsdGlwbGUgdGltZXMuXG4gIHJldHVybiBtYWtlSHR0cEZlYXR1cmUoSHR0cEZlYXR1cmVLaW5kLkxlZ2FjeUludGVyY2VwdG9ycywgW1xuICAgIHtcbiAgICAgIHByb3ZpZGU6IExFR0FDWV9JTlRFUkNFUFRPUl9GTixcbiAgICAgIHVzZUZhY3Rvcnk6IGxlZ2FjeUludGVyY2VwdG9yRm5GYWN0b3J5LFxuICAgIH0sXG4gICAge1xuICAgICAgcHJvdmlkZTogSFRUUF9JTlRFUkNFUFRPUl9GTlMsXG4gICAgICB1c2VFeGlzdGluZzogTEVHQUNZX0lOVEVSQ0VQVE9SX0ZOLFxuICAgICAgbXVsdGk6IHRydWUsXG4gICAgfVxuICBdKTtcbn1cblxuLyoqXG4gKiBDdXN0b21pemVzIHRoZSBYU1JGIHByb3RlY3Rpb24gZm9yIHRoZSBjb25maWd1cmF0aW9uIG9mIHRoZSBjdXJyZW50IGBIdHRwQ2xpZW50YCBpbnN0YW5jZS5cbiAqXG4gKiBUaGlzIGZlYXR1cmUgaXMgaW5jb21wYXRpYmxlIHdpdGggdGhlIGB3aXRoTm9Yc3JmUHJvdGVjdGlvbmAgZmVhdHVyZS5cbiAqXG4gKiBAc2VlIHtAbGluayBwcm92aWRlSHR0cENsaWVudH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdpdGhYc3JmQ29uZmlndXJhdGlvbihcbiAgICB7Y29va2llTmFtZSwgaGVhZGVyTmFtZX06IHtjb29raWVOYW1lPzogc3RyaW5nLCBoZWFkZXJOYW1lPzogc3RyaW5nfSk6XG4gICAgSHR0cEZlYXR1cmU8SHR0cEZlYXR1cmVLaW5kLkN1c3RvbVhzcmZDb25maWd1cmF0aW9uPiB7XG4gIGNvbnN0IHByb3ZpZGVyczogUHJvdmlkZXJbXSA9IFtdO1xuICBpZiAoY29va2llTmFtZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHJvdmlkZXJzLnB1c2goe3Byb3ZpZGU6IFhTUkZfQ09PS0lFX05BTUUsIHVzZVZhbHVlOiBjb29raWVOYW1lfSk7XG4gIH1cbiAgaWYgKGhlYWRlck5hbWUgIT09IHVuZGVmaW5lZCkge1xuICAgIHByb3ZpZGVycy5wdXNoKHtwcm92aWRlOiBYU1JGX0hFQURFUl9OQU1FLCB1c2VWYWx1ZTogaGVhZGVyTmFtZX0pO1xuICB9XG5cbiAgcmV0dXJuIG1ha2VIdHRwRmVhdHVyZShIdHRwRmVhdHVyZUtpbmQuQ3VzdG9tWHNyZkNvbmZpZ3VyYXRpb24sIHByb3ZpZGVycyk7XG59XG5cbi8qKlxuICogRGlzYWJsZXMgWFNSRiBwcm90ZWN0aW9uIGluIHRoZSBjb25maWd1cmF0aW9uIG9mIHRoZSBjdXJyZW50IGBIdHRwQ2xpZW50YCBpbnN0YW5jZS5cbiAqXG4gKiBUaGlzIGZlYXR1cmUgaXMgaW5jb21wYXRpYmxlIHdpdGggdGhlIGB3aXRoWHNyZkNvbmZpZ3VyYXRpb25gIGZlYXR1cmUuXG4gKlxuICogQHNlZSB7QGxpbmsgcHJvdmlkZUh0dHBDbGllbnR9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3aXRoTm9Yc3JmUHJvdGVjdGlvbigpOiBIdHRwRmVhdHVyZTxIdHRwRmVhdHVyZUtpbmQuTm9Yc3JmUHJvdGVjdGlvbj4ge1xuICByZXR1cm4gbWFrZUh0dHBGZWF0dXJlKEh0dHBGZWF0dXJlS2luZC5Ob1hzcmZQcm90ZWN0aW9uLCBbXG4gICAge1xuICAgICAgcHJvdmlkZTogWFNSRl9FTkFCTEVELFxuICAgICAgdXNlVmFsdWU6IGZhbHNlLFxuICAgIH0sXG4gIF0pO1xufVxuXG4vKipcbiAqIEFkZCBKU09OUCBzdXBwb3J0IHRvIHRoZSBjb25maWd1cmF0aW9uIG9mIHRoZSBjdXJyZW50IGBIdHRwQ2xpZW50YCBpbnN0YW5jZS5cbiAqXG4gKiBAc2VlIHtAbGluayBwcm92aWRlSHR0cENsaWVudH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdpdGhKc29ucFN1cHBvcnQoKTogSHR0cEZlYXR1cmU8SHR0cEZlYXR1cmVLaW5kLkpzb25wU3VwcG9ydD4ge1xuICByZXR1cm4gbWFrZUh0dHBGZWF0dXJlKEh0dHBGZWF0dXJlS2luZC5Kc29ucFN1cHBvcnQsIFtcbiAgICBKc29ucENsaWVudEJhY2tlbmQsXG4gICAge3Byb3ZpZGU6IEpzb25wQ2FsbGJhY2tDb250ZXh0LCB1c2VGYWN0b3J5OiBqc29ucENhbGxiYWNrQ29udGV4dH0sXG4gICAge3Byb3ZpZGU6IEhUVFBfSU5URVJDRVBUT1JfRk5TLCB1c2VWYWx1ZToganNvbnBJbnRlcmNlcHRvckZuLCBtdWx0aTogdHJ1ZX0sXG4gIF0pO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyZXMgdGhlIGN1cnJlbnQgYEh0dHBDbGllbnRgIGluc3RhbmNlIHRvIG1ha2UgcmVxdWVzdHMgdmlhIHRoZSBwYXJlbnQgaW5qZWN0b3Inc1xuICogYEh0dHBDbGllbnRgIGluc3RlYWQgb2YgZGlyZWN0bHkuXG4gKlxuICogQnkgZGVmYXVsdCwgYHByb3ZpZGVIdHRwQ2xpZW50YCBjb25maWd1cmVzIGBIdHRwQ2xpZW50YCBpbiBpdHMgaW5qZWN0b3IgdG8gYmUgYW4gaW5kZXBlbmRlbnRcbiAqIGluc3RhbmNlLiBGb3IgZXhhbXBsZSwgZXZlbiBpZiBgSHR0cENsaWVudGAgaXMgY29uZmlndXJlZCBpbiB0aGUgcGFyZW50IGluamVjdG9yIHdpdGhcbiAqIG9uZSBvciBtb3JlIGludGVyY2VwdG9ycywgdGhleSB3aWxsIG5vdCBpbnRlcmNlcHQgcmVxdWVzdHMgbWFkZSB2aWEgdGhpcyBpbnN0YW5jZS5cbiAqXG4gKiBXaXRoIHRoaXMgb3B0aW9uIGVuYWJsZWQsIG9uY2UgdGhlIHJlcXVlc3QgaGFzIHBhc3NlZCB0aHJvdWdoIHRoZSBjdXJyZW50IGluamVjdG9yJ3NcbiAqIGludGVyY2VwdG9ycywgaXQgd2lsbCBiZSBkZWxlZ2F0ZWQgdG8gdGhlIHBhcmVudCBpbmplY3RvcidzIGBIdHRwQ2xpZW50YCBjaGFpbiBpbnN0ZWFkIG9mXG4gKiBkaXNwYXRjaGVkIGRpcmVjdGx5LCBhbmQgaW50ZXJjZXB0b3JzIGluIHRoZSBwYXJlbnQgY29uZmlndXJhdGlvbiB3aWxsIGJlIGFwcGxpZWQgdG8gdGhlIHJlcXVlc3QuXG4gKlxuICogSWYgdGhlcmUgYXJlIHNldmVyYWwgYEh0dHBDbGllbnRgIGluc3RhbmNlcyBpbiB0aGUgaW5qZWN0b3IgaGllcmFyY2h5LCBpdCdzIHBvc3NpYmxlIGZvclxuICogYHdpdGhSZXF1ZXN0c01hZGVWaWFQYXJlbnRgIHRvIGJlIHVzZWQgYXQgbXVsdGlwbGUgbGV2ZWxzLCB3aGljaCB3aWxsIGNhdXNlIHRoZSByZXF1ZXN0IHRvXG4gKiBcImJ1YmJsZSB1cFwiIHVudGlsIGVpdGhlciByZWFjaGluZyB0aGUgcm9vdCBsZXZlbCBvciBhbiBgSHR0cENsaWVudGAgd2hpY2ggd2FzIG5vdCBjb25maWd1cmVkIHdpdGhcbiAqIHRoaXMgb3B0aW9uLlxuICpcbiAqIEBzZWUge0BsaW5rIHByb3ZpZGVIdHRwQ2xpZW50fVxuICogQGRldmVsb3BlclByZXZpZXdcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdpdGhSZXF1ZXN0c01hZGVWaWFQYXJlbnQoKTogSHR0cEZlYXR1cmU8SHR0cEZlYXR1cmVLaW5kLlJlcXVlc3RzTWFkZVZpYVBhcmVudD4ge1xuICByZXR1cm4gbWFrZUh0dHBGZWF0dXJlKEh0dHBGZWF0dXJlS2luZC5SZXF1ZXN0c01hZGVWaWFQYXJlbnQsIFtcbiAgICB7XG4gICAgICBwcm92aWRlOiBIdHRwQmFja2VuZCxcbiAgICAgIHVzZUZhY3Rvcnk6ICgpID0+IHtcbiAgICAgICAgY29uc3QgaGFuZGxlckZyb21QYXJlbnQgPSBpbmplY3QoSHR0cEhhbmRsZXIsIHtza2lwU2VsZjogdHJ1ZSwgb3B0aW9uYWw6IHRydWV9KTtcbiAgICAgICAgaWYgKG5nRGV2TW9kZSAmJiBoYW5kbGVyRnJvbVBhcmVudCA9PT0gbnVsbCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgJ3dpdGhSZXF1ZXN0c01hZGVWaWFQYXJlbnQoKSBjYW4gb25seSBiZSB1c2VkIHdoZW4gdGhlIHBhcmVudCBpbmplY3RvciBhbHNvIGNvbmZpZ3VyZXMgSHR0cENsaWVudCcpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBoYW5kbGVyRnJvbVBhcmVudDtcbiAgICAgIH0sXG4gICAgfSxcbiAgXSk7XG59XG5cblxuLyoqXG4gKiBDb25maWd1cmVzIHRoZSBjdXJyZW50IGBIdHRwQ2xpZW50YCBpbnN0YW5jZSB0byBtYWtlIHJlcXVlc3RzIHVzaW5nIHRoZSBmZXRjaCBBUEkuXG4gKlxuICogVGhpcyBgRmV0Y2hCYWNrZW5kYCByZXF1aXJlcyB0aGUgc3VwcG9ydCBvZiB0aGUgRmV0Y2ggQVBJIHdoaWNoIGlzIGF2YWlsYWJsZSBvbiBhbGwgZXZlcmdyZWVuXG4gKiBicm93c2VycyBhbmQgb24gTm9kZUpTIGZyb20gdjE4IG9ud2FyZC5cbiAqXG4gKiBOb3RlOiBUaGUgRmV0Y2ggQVBJIGRvZXNuJ3Qgc3VwcG9ydCBwcm9ncmVzcyByZXBvcnQgb24gdXBsb2Fkcy5cbiAqXG4gKiBAcHVibGljQXBpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3aXRoRmV0Y2goKTogSHR0cEZlYXR1cmU8SHR0cEZlYXR1cmVLaW5kLkZldGNoPiB7XG4gIGlmICgodHlwZW9mIG5nRGV2TW9kZSA9PT0gJ3VuZGVmaW5lZCcgfHwgbmdEZXZNb2RlKSAmJiB0eXBlb2YgZmV0Y2ggIT09ICdmdW5jdGlvbicpIHtcbiAgICAvLyBUT0RPOiBDcmVhdGUgYSBydW50aW1lIGVycm9yXG4gICAgLy8gVE9ETzogVXNlIEVOVklST05NRU5UX0lOSVRJQUxJWkVSIHRvIGNvbnRleHR1YWxpemUgdGhlIGVycm9yIG1lc3NhZ2UgKGJyb3dzZXIgb3Igc2VydmVyKVxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ1RoZSBgd2l0aEZldGNoYCBmZWF0dXJlIG9mIEh0dHBDbGllbnQgcmVxdWlyZXMgdGhlIGBmZXRjaGAgQVBJIHRvIGJlIGF2YWlsYWJsZS4gJyArXG4gICAgICAgICdJZiB5b3UgcnVuIHRoZSBjb2RlIGluIGEgTm9kZSBlbnZpcm9ubWVudCwgbWFrZSBzdXJlIHlvdSB1c2UgTm9kZSB2MTguMTAgb3IgbGF0ZXIuJyk7XG4gIH1cblxuICByZXR1cm4gbWFrZUh0dHBGZWF0dXJlKEh0dHBGZWF0dXJlS2luZC5GZXRjaCwgW1xuICAgIEZldGNoQmFja2VuZCxcbiAgICB7cHJvdmlkZTogSHR0cEJhY2tlbmQsIHVzZUV4aXN0aW5nOiBGZXRjaEJhY2tlbmR9LFxuICAgIHtwcm92aWRlOiBQUklNQVJZX0hUVFBfQkFDS0VORCwgdXNlRXhpc3Rpbmc6IEZldGNoQmFja2VuZH0sXG4gIF0pO1xufVxuIl19