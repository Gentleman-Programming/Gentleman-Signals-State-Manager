/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { HttpContext } from './context';
import { HttpHeaders } from './headers';
import { HttpParams } from './params';
/**
 * Determine whether the given HTTP method may include a body.
 */
function mightHaveBody(method) {
    switch (method) {
        case 'DELETE':
        case 'GET':
        case 'HEAD':
        case 'OPTIONS':
        case 'JSONP':
            return false;
        default:
            return true;
    }
}
/**
 * Safely assert whether the given value is an ArrayBuffer.
 *
 * In some execution environments ArrayBuffer is not defined.
 */
function isArrayBuffer(value) {
    return typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer;
}
/**
 * Safely assert whether the given value is a Blob.
 *
 * In some execution environments Blob is not defined.
 */
function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}
/**
 * Safely assert whether the given value is a FormData instance.
 *
 * In some execution environments FormData is not defined.
 */
function isFormData(value) {
    return typeof FormData !== 'undefined' && value instanceof FormData;
}
/**
 * Safely assert whether the given value is a URLSearchParams instance.
 *
 * In some execution environments URLSearchParams is not defined.
 */
function isUrlSearchParams(value) {
    return typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams;
}
/**
 * An outgoing HTTP request with an optional typed body.
 *
 * `HttpRequest` represents an outgoing request, including URL, method,
 * headers, body, and other request configuration options. Instances should be
 * assumed to be immutable. To modify a `HttpRequest`, the `clone`
 * method should be used.
 *
 * @publicApi
 */
export class HttpRequest {
    constructor(method, url, third, fourth) {
        this.url = url;
        /**
         * The request body, or `null` if one isn't set.
         *
         * Bodies are not enforced to be immutable, as they can include a reference to any
         * user-defined data type. However, interceptors should take care to preserve
         * idempotence by treating them as such.
         */
        this.body = null;
        /**
         * Whether this request should be made in a way that exposes progress events.
         *
         * Progress events are expensive (change detection runs on each event) and so
         * they should only be requested if the consumer intends to monitor them.
         *
         * Note: The `FetchBackend` doesn't support progress report on uploads.
         */
        this.reportProgress = false;
        /**
         * Whether this request should be sent with outgoing credentials (cookies).
         */
        this.withCredentials = false;
        /**
         * The expected response type of the server.
         *
         * This is used to parse the response appropriately before returning it to
         * the requestee.
         */
        this.responseType = 'json';
        this.method = method.toUpperCase();
        // Next, need to figure out which argument holds the HttpRequestInit
        // options, if any.
        let options;
        // Check whether a body argument is expected. The only valid way to omit
        // the body argument is to use a known no-body method like GET.
        if (mightHaveBody(this.method) || !!fourth) {
            // Body is the third argument, options are the fourth.
            this.body = (third !== undefined) ? third : null;
            options = fourth;
        }
        else {
            // No body required, options are the third argument. The body stays null.
            options = third;
        }
        // If options have been passed, interpret them.
        if (options) {
            // Normalize reportProgress and withCredentials.
            this.reportProgress = !!options.reportProgress;
            this.withCredentials = !!options.withCredentials;
            // Override default response type of 'json' if one is provided.
            if (!!options.responseType) {
                this.responseType = options.responseType;
            }
            // Override headers if they're provided.
            if (!!options.headers) {
                this.headers = options.headers;
            }
            if (!!options.context) {
                this.context = options.context;
            }
            if (!!options.params) {
                this.params = options.params;
            }
            // We do want to assign transferCache even if it's falsy (false is valid value)
            this.transferCache = options.transferCache;
        }
        // If no headers have been passed in, construct a new HttpHeaders instance.
        if (!this.headers) {
            this.headers = new HttpHeaders();
        }
        // If no context have been passed in, construct a new HttpContext instance.
        if (!this.context) {
            this.context = new HttpContext();
        }
        // If no parameters have been passed in, construct a new HttpUrlEncodedParams instance.
        if (!this.params) {
            this.params = new HttpParams();
            this.urlWithParams = url;
        }
        else {
            // Encode the parameters to a string in preparation for inclusion in the URL.
            const params = this.params.toString();
            if (params.length === 0) {
                // No parameters, the visible URL is just the URL given at creation time.
                this.urlWithParams = url;
            }
            else {
                // Does the URL already have query parameters? Look for '?'.
                const qIdx = url.indexOf('?');
                // There are 3 cases to handle:
                // 1) No existing parameters -> append '?' followed by params.
                // 2) '?' exists and is followed by existing query string ->
                //    append '&' followed by params.
                // 3) '?' exists at the end of the url -> append params directly.
                // This basically amounts to determining the character, if any, with
                // which to join the URL and parameters.
                const sep = qIdx === -1 ? '?' : (qIdx < url.length - 1 ? '&' : '');
                this.urlWithParams = url + sep + params;
            }
        }
    }
    /**
     * Transform the free-form body into a serialized format suitable for
     * transmission to the server.
     */
    serializeBody() {
        // If no body is present, no need to serialize it.
        if (this.body === null) {
            return null;
        }
        // Check whether the body is already in a serialized form. If so,
        // it can just be returned directly.
        if (isArrayBuffer(this.body) || isBlob(this.body) || isFormData(this.body) ||
            isUrlSearchParams(this.body) || typeof this.body === 'string') {
            return this.body;
        }
        // Check whether the body is an instance of HttpUrlEncodedParams.
        if (this.body instanceof HttpParams) {
            return this.body.toString();
        }
        // Check whether the body is an object or array, and serialize with JSON if so.
        if (typeof this.body === 'object' || typeof this.body === 'boolean' ||
            Array.isArray(this.body)) {
            return JSON.stringify(this.body);
        }
        // Fall back on toString() for everything else.
        return this.body.toString();
    }
    /**
     * Examine the body and attempt to infer an appropriate MIME type
     * for it.
     *
     * If no such type can be inferred, this method will return `null`.
     */
    detectContentTypeHeader() {
        // An empty body has no content type.
        if (this.body === null) {
            return null;
        }
        // FormData bodies rely on the browser's content type assignment.
        if (isFormData(this.body)) {
            return null;
        }
        // Blobs usually have their own content type. If it doesn't, then
        // no type can be inferred.
        if (isBlob(this.body)) {
            return this.body.type || null;
        }
        // Array buffers have unknown contents and thus no type can be inferred.
        if (isArrayBuffer(this.body)) {
            return null;
        }
        // Technically, strings could be a form of JSON data, but it's safe enough
        // to assume they're plain strings.
        if (typeof this.body === 'string') {
            return 'text/plain';
        }
        // `HttpUrlEncodedParams` has its own content-type.
        if (this.body instanceof HttpParams) {
            return 'application/x-www-form-urlencoded;charset=UTF-8';
        }
        // Arrays, objects, boolean and numbers will be encoded as JSON.
        if (typeof this.body === 'object' || typeof this.body === 'number' ||
            typeof this.body === 'boolean') {
            return 'application/json';
        }
        // No type could be inferred.
        return null;
    }
    clone(update = {}) {
        // For method, url, and responseType, take the current value unless
        // it is overridden in the update hash.
        const method = update.method || this.method;
        const url = update.url || this.url;
        const responseType = update.responseType || this.responseType;
        // The body is somewhat special - a `null` value in update.body means
        // whatever current body is present is being overridden with an empty
        // body, whereas an `undefined` value in update.body implies no
        // override.
        const body = (update.body !== undefined) ? update.body : this.body;
        // Carefully handle the boolean options to differentiate between
        // `false` and `undefined` in the update args.
        const withCredentials = (update.withCredentials !== undefined) ? update.withCredentials : this.withCredentials;
        const reportProgress = (update.reportProgress !== undefined) ? update.reportProgress : this.reportProgress;
        // Headers and params may be appended to if `setHeaders` or
        // `setParams` are used.
        let headers = update.headers || this.headers;
        let params = update.params || this.params;
        // Pass on context if needed
        const context = update.context ?? this.context;
        // Check whether the caller has asked to add headers.
        if (update.setHeaders !== undefined) {
            // Set every requested header.
            headers =
                Object.keys(update.setHeaders)
                    .reduce((headers, name) => headers.set(name, update.setHeaders[name]), headers);
        }
        // Check whether the caller has asked to set params.
        if (update.setParams) {
            // Set every requested param.
            params = Object.keys(update.setParams)
                .reduce((params, param) => params.set(param, update.setParams[param]), params);
        }
        // Finally, construct the new HttpRequest using the pieces from above.
        return new HttpRequest(method, url, body, {
            params,
            headers,
            context,
            reportProgress,
            responseType,
            withCredentials,
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL2NvbW1vbi9odHRwL3NyYy9yZXF1ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxXQUFXLENBQUM7QUFDdEMsT0FBTyxFQUFDLFdBQVcsRUFBQyxNQUFNLFdBQVcsQ0FBQztBQUN0QyxPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sVUFBVSxDQUFDO0FBaUJwQzs7R0FFRztBQUNILFNBQVMsYUFBYSxDQUFDLE1BQWM7SUFDbkMsUUFBUSxNQUFNLEVBQUU7UUFDZCxLQUFLLFFBQVEsQ0FBQztRQUNkLEtBQUssS0FBSyxDQUFDO1FBQ1gsS0FBSyxNQUFNLENBQUM7UUFDWixLQUFLLFNBQVMsQ0FBQztRQUNmLEtBQUssT0FBTztZQUNWLE9BQU8sS0FBSyxDQUFDO1FBQ2Y7WUFDRSxPQUFPLElBQUksQ0FBQztLQUNmO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGFBQWEsQ0FBQyxLQUFVO0lBQy9CLE9BQU8sT0FBTyxXQUFXLEtBQUssV0FBVyxJQUFJLEtBQUssWUFBWSxXQUFXLENBQUM7QUFDNUUsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLE1BQU0sQ0FBQyxLQUFVO0lBQ3hCLE9BQU8sT0FBTyxJQUFJLEtBQUssV0FBVyxJQUFJLEtBQUssWUFBWSxJQUFJLENBQUM7QUFDOUQsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLFVBQVUsQ0FBQyxLQUFVO0lBQzVCLE9BQU8sT0FBTyxRQUFRLEtBQUssV0FBVyxJQUFJLEtBQUssWUFBWSxRQUFRLENBQUM7QUFDdEUsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGlCQUFpQixDQUFDLEtBQVU7SUFDbkMsT0FBTyxPQUFPLGVBQWUsS0FBSyxXQUFXLElBQUksS0FBSyxZQUFZLGVBQWUs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SUFBSSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDO1FBRTFDLDRCQUE0QjtRQUM1QixNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUM7UUFFL0MscURBQXFEO1FBQ3JELElBQUksTUFBTSxDQUFDLFVBQVUsS0FBSyxTQUFTLEVBQUU7WUFDbkMsOEJBQThCO1lBQzlCLE9BQU87Z0JBQ0gsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDO3FCQUN6QixNQUFNLENBQUMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsVUFBVyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsT0FBTyxDQUFDLENBQUM7U0FDMUY7UUFFRCxvREFBb0Q7UUFDcEQsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFO1lBQ3BCLDZCQUE2QjtZQUM3QixNQUFNLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDO2lCQUN4QixNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsU0FBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsTUFBTSxDQUFDLENBQUM7U0FDOUY7UUFFRCxzRUFBc0U7UUFDdEUsT0FBTyxJQUFJLFdBQVcsQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRTtZQUN4QyxNQUFNO1lBQ04sT0FBTztZQUNQLE9BQU87WUFDUCxjQUFjO1lBQ2QsWUFBWTtZQUNaLGVBQWU7U0FDaEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB7SHR0cENvbnRleHR9IGZyb20gJy4vY29udGV4dCc7XG5pbXBvcnQge0h0dHBIZWFkZXJzfSBmcm9tICcuL2hlYWRlcnMnO1xuaW1wb3J0IHtIdHRwUGFyYW1zfSBmcm9tICcuL3BhcmFtcyc7XG5cbi8qKlxuICogQ29uc3RydWN0aW9uIGludGVyZmFjZSBmb3IgYEh0dHBSZXF1ZXN0YHMuXG4gKlxuICogQWxsIHZhbHVlcyBhcmUgb3B0aW9uYWwgYW5kIHdpbGwgb3ZlcnJpZGUgZGVmYXVsdCB2YWx1ZXMgaWYgcHJvdmlkZWQuXG4gKi9cbmludGVyZmFjZSBIdHRwUmVxdWVzdEluaXQge1xuICBoZWFkZXJzPzogSHR0cEhlYWRlcnM7XG4gIGNvbnRleHQ/OiBIdHRwQ29udGV4dDtcbiAgcmVwb3J0UHJvZ3Jlc3M/OiBib29sZWFuO1xuICBwYXJhbXM/OiBIdHRwUGFyYW1zO1xuICByZXNwb25zZVR5cGU/OiAnYXJyYXlidWZmZXInfCdibG9iJ3wnanNvbid8J3RleHQnO1xuICB3aXRoQ3JlZGVudGlhbHM/OiBib29sZWFuO1xuICB0cmFuc2ZlckNhY2hlPzoge2luY2x1ZGVIZWFkZXJzPzogc3RyaW5nW119fGJvb2xlYW47XG59XG5cbi8qKlxuICogRGV0ZXJtaW5lIHdoZXRoZXIgdGhlIGdpdmVuIEhUVFAgbWV0aG9kIG1heSBpbmNsdWRlIGEgYm9keS5cbiAqL1xuZnVuY3Rpb24gbWlnaHRIYXZlQm9keShtZXRob2Q6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKG1ldGhvZCkge1xuICAgIGNhc2UgJ0RFTEVURSc6XG4gICAgY2FzZSAnR0VUJzpcbiAgICBjYXNlICdIRUFEJzpcbiAgICBjYXNlICdPUFRJT05TJzpcbiAgICBjYXNlICdKU09OUCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogU2FmZWx5IGFzc2VydCB3aGV0aGVyIHRoZSBnaXZlbiB2YWx1ZSBpcyBhbiBBcnJheUJ1ZmZlci5cbiAqXG4gKiBJbiBzb21lIGV4ZWN1dGlvbiBlbnZpcm9ubWVudHMgQXJyYXlCdWZmZXIgaXMgbm90IGRlZmluZWQuXG4gKi9cbmZ1bmN0aW9uIGlzQXJyYXlCdWZmZXIodmFsdWU6IGFueSk6IHZhbHVlIGlzIEFycmF5QnVmZmVyIHtcbiAgcmV0dXJuIHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiYgdmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcjtcbn1cblxuLyoqXG4gKiBTYWZlbHkgYXNzZXJ0IHdoZXRoZXIgdGhlIGdpdmVuIHZhbHVlIGlzIGEgQmxvYi5cbiAqXG4gKiBJbiBzb21lIGV4ZWN1dGlvbiBlbnZpcm9ubWVudHMgQmxvYiBpcyBub3QgZGVmaW5lZC5cbiAqL1xuZnVuY3Rpb24gaXNCbG9iKHZhbHVlOiBhbnkpOiB2YWx1ZSBpcyBCbG9iIHtcbiAgcmV0dXJuIHR5cGVvZiBCbG9iICE9PSAndW5kZWZpbmVkJyAmJiB2YWx1ZSBpbnN0YW5jZW9mIEJsb2I7XG59XG5cbi8qKlxuICogU2FmZWx5IGFzc2VydCB3aGV0aGVyIHRoZSBnaXZlbiB2YWx1ZSBpcyBhIEZvcm1EYXRhIGluc3RhbmNlLlxuICpcbiAqIEluIHNvbWUgZXhlY3V0aW9uIGVudmlyb25tZW50cyBGb3JtRGF0YSBpcyBub3QgZGVmaW5lZC5cbiAqL1xuZnVuY3Rpb24gaXNGb3JtRGF0YSh2YWx1ZTogYW55KTogdmFsdWUgaXMgRm9ybURhdGEge1xuICByZXR1cm4gdHlwZW9mIEZvcm1EYXRhICE9PSAndW5kZWZpbmVkJyAmJiB2YWx1ZSBpbnN0YW5jZW9mIEZvcm1EYXRhO1xufVxuXG4vKipcbiAqIFNhZmVseSBhc3NlcnQgd2hldGhlciB0aGUgZ2l2ZW4gdmFsdWUgaXMgYSBVUkxTZWFyY2hQYXJhbXMgaW5zdGFuY2UuXG4gKlxuICogSW4gc29tZSBleGVjdXRpb24gZW52aXJvbm1lbnRzIFVSTFNlYXJjaFBhcmFtcyBpcyBub3QgZGVmaW5lZC5cbiAqL1xuZnVuY3Rpb24gaXNVcmxTZWFyY2hQYXJhbXModmFsdWU6IGFueSk6IHZhbHVlIGlzIFVSTFNlYXJjaFBhcmFtcyB7XG4gIHJldHVybiB0eXBlb2YgVVJMU2VhcmNoUGFyYW1zICE9PSAndW5kZWZpbmVkJyAmJiB2YWx1ZSBpbnN0YW5jZW9mIFVSTFNlYXJjaFBhcmFtcztcbn1cblxuLyoqXG4gKiBBbiBvdXRnb2luZyBIVFRQIHJlcXVlc3Qgd2l0aCBhbiBvcHRpb25hbCB0eXBlZCBib2R5LlxuICpcbiAqIGBIdHRwUmVxdWVzdGAgcmVwcmVzZW50cyBhbiBvdXRnb2luZyByZXF1ZXN0LCBpbmNsdWRpbmcgVVJMLCBtZXRob2QsXG4gKiBoZWFkZXJzLCBib2R5LCBhbmQgb3RoZXIgcmVxdWVzdCBjb25maWd1cmF0aW9uIG9wdGlvbnMuIEluc3RhbmNlcyBzaG91bGQgYmVcbiAqIGFzc3VtZWQgdG8gYmUgaW1tdXRhYmxlLiBUbyBtb2RpZnkgYSBgSHR0cFJlcXVlc3RgLCB0aGUgYGNsb25lYFxuICogbWV0aG9kIHNob3VsZCBiZSB1c2VkLlxuICpcbiAqIEBwdWJsaWNBcGlcbiAqL1xuZXhwb3J0IGNsYXNzIEh0dHBSZXF1ZXN0PFQ+IHtcbiAgLyoqXG4gICAqIFRoZSByZXF1ZXN0IGJvZHksIG9yIGBudWxsYCBpZiBvbmUgaXNuJ3Qgc2V0LlxuICAgKlxuICAgKiBCb2RpZXMgYXJlIG5vdCBlbmZvcmNlZCB0byBiZSBpbW11dGFibGUsIGFzIHRoZXkgY2FuIGluY2x1ZGUgYSByZWZlcmVuY2UgdG8gYW55XG4gICAqIHVzZXItZGVmaW5lZCBkYXRhIHR5cGUuIEhvd2V2ZXIsIGludGVyY2VwdG9ycyBzaG91bGQgdGFrZSBjYXJlIHRvIHByZXNlcnZlXG4gICAqIGlkZW1wb3RlbmNlIGJ5IHRyZWF0aW5nIHRoZW0gYXMgc3VjaC5cbiAgICovXG4gIHJlYWRvbmx5IGJvZHk6IFR8bnVsbCA9IG51bGw7XG5cbiAgLyoqXG4gICAqIE91dGdvaW5nIGhlYWRlcnMgZm9yIHRoaXMgcmVxdWVzdC5cbiAgICovXG4gIC8vIFRPRE8oaXNzdWUvMjQ1NzEpOiByZW1vdmUgJyEnLlxuICByZWFkb25seSBoZWFkZXJzITogSHR0cEhlYWRlcnM7XG5cbiAgLyoqXG4gICAqIFNoYXJlZCBhbmQgbXV0YWJsZSBjb250ZXh0IHRoYXQgY2FuIGJlIHVzZWQgYnkgaW50ZXJjZXB0b3JzXG4gICAqL1xuICByZWFkb25seSBjb250ZXh0ITogSHR0cENvbnRleHQ7XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyByZXF1ZXN0IHNob3VsZCBiZSBtYWRlIGluIGEgd2F5IHRoYXQgZXhwb3NlcyBwcm9ncmVzcyBldmVudHMuXG4gICAqXG4gICAqIFByb2dyZXNzIGV2ZW50cyBhcmUgZXhwZW5zaXZlIChjaGFuZ2UgZGV0ZWN0aW9uIHJ1bnMgb24gZWFjaCBldmVudCkgYW5kIHNvXG4gICAqIHRoZXkgc2hvdWxkIG9ubHkgYmUgcmVxdWVzdGVkIGlmIHRoZSBjb25zdW1lciBpbnRlbmRzIHRvIG1vbml0b3IgdGhlbS5cbiAgICpcbiAgICogTm90ZTogVGhlIGBGZXRjaEJhY2tlbmRgIGRvZXNuJ3Qgc3VwcG9ydCBwcm9ncmVzcyByZXBvcnQgb24gdXBsb2Fkcy5cbiAgICovXG4gIHJlYWRvbmx5IHJlcG9ydFByb2dyZXNzOiBib29sZWFuID0gZmFsc2U7XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyByZXF1ZXN0IHNob3VsZCBiZSBzZW50IHdpdGggb3V0Z29pbmcgY3JlZGVudGlhbHMgKGNvb2tpZXMpLlxuICAgKi9cbiAgcmVhZG9ubHkgd2l0aENyZWRlbnRpYWxzOiBib29sZWFuID0gZmFsc2U7XG5cbiAgLyoqXG4gICAqIFRoZSBleHBlY3RlZCByZXNwb25zZSB0eXBlIG9mIHRoZSBzZXJ2ZXIuXG4gICAqXG4gICAqIFRoaXMgaXMgdXNlZCB0byBwYXJzZSB0aGUgcmVzcG9uc2UgYXBwcm9wcmlhdGVseSBiZWZvcmUgcmV0dXJuaW5nIGl0IHRvXG4gICAqIHRoZSByZXF1ZXN0ZWUuXG4gICAqL1xuICByZWFkb25seSByZXNwb25zZVR5cGU6ICdhcnJheWJ1ZmZlcid8J2Jsb2InfCdqc29uJ3wndGV4dCcgPSAnanNvbic7XG5cbiAgLyoqXG4gICAqIFRoZSBvdXRnb2luZyBIVFRQIHJlcXVlc3QgbWV0aG9kLlxuICAgKi9cbiAgcmVhZG9ubHkgbWV0aG9kOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIE91dGdvaW5nIFVSTCBwYXJhbWV0ZXJzLlxuICAgKlxuICAgKiBUbyBwYXNzIGEgc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIEhUVFAgcGFyYW1ldGVycyBpbiB0aGUgVVJMLXF1ZXJ5LXN0cmluZyBmb3JtYXQsXG4gICAqIHRoZSBgSHR0cFBhcmFtc09wdGlvbnNgJyBgZnJvbVN0cmluZ2AgbWF5IGJlIHVzZWQuIEZvciBleGFtcGxlOlxuICAgKlxuICAgKiBgYGBcbiAgICogbmV3IEh0dHBQYXJhbXMoe2Zyb21TdHJpbmc6ICdhbmd1bGFyPWF3ZXNvbWUnfSlcbiAgICogYGBgXG4gICAqL1xuICAvLyBUT0RPKGlzc3VlLzI0NTcxKTogcmVtb3ZlICchJy5cbiAgcmVhZG9ubHkgcGFyYW1zITogSHR0cFBhcmFtcztcblxuICAvKipcbiAgICogVGhlIG91dGdvaW5nIFVSTCB3aXRoIGFsbCBVUkwgcGFyYW1ldGVycyBzZXQuXG4gICAqL1xuICByZWFkb25seSB1cmxXaXRoUGFyYW1zOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBIdHRwVHJhbnNmZXJDYWNoZSBvcHRpb24gZm9yIHRoZSByZXF1ZXN0XG4gICAqL1xuICByZWFkb25seSB0cmFuc2ZlckNhY2hlPzoge2luY2x1ZGVIZWFkZXJzPzogc3RyaW5nW119fGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3IobWV0aG9kOiAnR0VUJ3wnSEVBRCcsIHVybDogc3RyaW5nLCBpbml0Pzoge1xuICAgIGhlYWRlcnM/OiBIdHRwSGVhZGVycyxcbiAgICBjb250ZXh0PzogSHR0cENvbnRleHQsXG4gICAgcmVwb3J0UHJvZ3Jlc3M/OiBib29sZWFuLFxuICAgIHBhcmFtcz86IEh0dHBQYXJhbXMsXG4gICAgcmVzcG9uc2VUeXBlPzogJ2FycmF5YnVmZmVyJ3wnYmxvYid8J2pzb24nfCd0ZXh0JyxcbiAgICB3aXRoQ3JlZGVudGlhbHM/OiBib29sZWFuLFxuICAgIC8qKlxuICAgICAqIFRoaXMgcHJvcGVydHkgYWNjZXB0cyBlaXRoZXIgYSBib29sZWFuIHRvIGVuYWJsZS9kaXNhYmxlIHRyYW5zZmVycmluZyBjYWNoZSBmb3IgZWxpZ2libGVcbiAgICAgKiByZXF1ZXN0cyBwZXJmb3JtZWQgdXNpbmcgYEh0dHBDbGllbnRgLCBvciBhbiBvYmplY3QsIHdoaWNoIGFsbG93cyB0byBjb25maWd1cmUgY2FjaGVcbiAgICAgKiBwYXJhbWV0ZXJzLCBzdWNoIGFzIHdoaWNoIGhlYWRlcnMgc2hvdWxkIGJlIGluY2x1ZGVkIChubyBoZWFkZXJzIGFyZSBpbmNsdWRlZCBieSBkZWZhdWx0KS5cbiAgICAgKlxuICAgICAqIFNldHRpbmcgdGhpcyBwcm9wZXJ0eSB3aWxsIG92ZXJyaWRlIHRoZSBvcHRpb25zIHBhc3NlZCB0byBgcHJvdmlkZUNsaWVudEh5ZHJhdGlvbigpYCBmb3IgdGhpc1xuICAgICAqIHBhcnRpY3VsYXIgcmVxdWVzdFxuICAgICAqL1xuICAgIHRyYW5zZmVyQ2FjaGU/OiB7aW5jbHVkZUhlYWRlcnM/OiBzdHJpbmdbXX18Ym9vbGVhblxuICB9KTtcbiAgY29uc3RydWN0b3IobWV0aG9kOiAnREVMRVRFJ3wnSlNPTlAnfCdPUFRJT05TJywgdXJsOiBzdHJpbmcsIGluaXQ/OiB7XG4gICAgaGVhZGVycz86IEh0dHBIZWFkZXJzLFxuICAgIGNvbnRleHQ/OiBIdHRwQ29udGV4dCxcbiAgICByZXBvcnRQcm9ncmVzcz86IGJvb2xlYW4sXG4gICAgcGFyYW1zPzogSHR0cFBhcmFtcyxcbiAgICByZXNwb25zZVR5cGU/OiAnYXJyYXlidWZmZXInfCdibG9iJ3wnanNvbid8J3RleHQnLFxuICAgIHdpdGhDcmVkZW50aWFscz86IGJvb2xlYW4sXG4gIH0pO1xuICBjb25zdHJ1Y3RvcihtZXRob2Q6ICdQT1NUJywgdXJsOiBzdHJpbmcsIGJvZHk6IFR8bnVsbCwgaW5pdD86IHtcbiAgICBoZWFkZXJzPzogSHR0cEhlYWRlcnMsXG4gICAgY29udGV4dD86IEh0dHBDb250ZXh0LFxuICAgIHJlcG9ydFByb2dyZXNzPzogYm9vbGVhbixcbiAgICBwYXJhbXM/OiBIdHRwUGFyYW1zLFxuICAgIHJlc3BvbnNlVHlwZT86ICdhcnJheWJ1ZmZlcid8J2Jsb2InfCdqc29uJ3wndGV4dCcsXG4gICAgd2l0aENyZWRlbnRpYWxzPzogYm9vbGVhbixcbiAgICAvKipcbiAgICAgKiBUaGlzIHByb3BlcnR5IGFjY2VwdHMgZWl0aGVyIGEgYm9vbGVhbiB0byBlbmFibGUvZGlzYWJsZSB0cmFuc2ZlcnJpbmcgY2FjaGUgZm9yIGVsaWdpYmxlXG4gICAgICogcmVxdWVzdHMgcGVyZm9ybWVkIHVzaW5nIGBIdHRwQ2xpZW50YCwgb3IgYW4gb2JqZWN0LCB3aGljaCBhbGxvd3MgdG8gY29uZmlndXJlIGNhY2hlXG4gICAgICogcGFyYW1ldGVycywgc3VjaCBhcyB3aGljaCBoZWFkZXJzIHNob3VsZCBiZSBpbmNsdWRlZCAobm8gaGVhZGVycyBhcmUgaW5jbHVkZWQgYnkgZGVmYXVsdCkuXG4gICAgICpcbiAgICAgKiBTZXR0aW5nIHRoaXMgcHJvcGVydHkgd2lsbCBvdmVycmlkZSB0aGUgb3B0aW9ucyBwYXNzZWQgdG8gYHByb3ZpZGVDbGllbnRIeWRyYXRpb24oKWAgZm9yIHRoaXNcbiAgICAgKiBwYXJ0aWN1bGFyIHJlcXVlc3RcbiAgICAgKi9cbiAgICB0cmFuc2ZlckNhY2hlPzoge2luY2x1ZGVIZWFkZXJzPzogc3RyaW5nW119fGJvb2xlYW5cbiAgfSk7XG4gIGNvbnN0cnVjdG9yKG1ldGhvZDogJ1BVVCd8J1BBVENIJywgdXJsOiBzdHJpbmcsIGJvZHk6IFR8bnVsbCwgaW5pdD86IHtcbiAgICBoZWFkZXJzPzogSHR0cEhlYWRlcnMsXG4gICAgY29udGV4dD86IEh0dHBDb250ZXh0LFxuICAgIHJlcG9ydFByb2dyZXNzPzogYm9vbGVhbixcbiAgICBwYXJhbXM/OiBIdHRwUGFyYW1zLFxuICAgIHJlc3BvbnNlVHlwZT86ICdhcnJheWJ1ZmZlcid8J2Jsb2InfCdqc29uJ3wndGV4dCcsXG4gICAgd2l0aENyZWRlbnRpYWxzPzogYm9vbGVhbixcbiAgfSk7XG4gIGNvbnN0cnVjdG9yKG1ldGhvZDogc3RyaW5nLCB1cmw6IHN0cmluZywgYm9keTogVHxudWxsLCBpbml0Pzoge1xuICAgIGhlYWRlcnM/OiBIdHRwSGVhZGVycyxcbiAgICBjb250ZXh0PzogSHR0cENvbnRleHQsXG4gICAgcmVwb3J0UHJvZ3Jlc3M/OiBib29sZWFuLFxuICAgIHBhcmFtcz86IEh0dHBQYXJhbXMsXG4gICAgcmVzcG9uc2VUeXBlPzogJ2FycmF5YnVmZmVyJ3wnYmxvYid8J2pzb24nfCd0ZXh0JyxcbiAgICB3aXRoQ3JlZGVudGlhbHM/OiBib29sZWFuLFxuICAgIC8qKlxuICAgICAqIFRoaXMgcHJvcGVydHkgYWNjZXB0cyBlaXRoZXIgYSBib29sZWFuIHRvIGVuYWJsZS9kaXNhYmxlIHRyYW5zZmVycmluZyBjYWNoZSBmb3IgZWxpZ2libGVcbiAgICAgKiByZXF1ZXN0cyBwZXJmb3JtZWQgdXNpbmcgYEh0dHBDbGllbnRgLCBvciBhbiBvYmplY3QsIHdoaWNoIGFsbG93cyB0byBjb25maWd1cmUgY2FjaGVcbiAgICAgKiBwYXJhbWV0ZXJzLCBzdWNoIGFzIHdoaWNoIGhlYWRlcnMgc2hvdWxkIGJlIGluY2x1ZGVkIChubyBoZWFkZXJzIGFyZSBpbmNsdWRlZCBieSBkZWZhdWx0KS5cbiAgICAgKlxuICAgICAqIFNldHRpbmcgdGhpcyBwcm9wZXJ0eSB3aWxsIG92ZXJyaWRlIHRoZSBvcHRpb25zIHBhc3NlZCB0byBgcHJvdmlkZUNsaWVudEh5ZHJhdGlvbigpYCBmb3IgdGhpc1xuICAgICAqIHBhcnRpY3VsYXIgcmVxdWVzdFxuICAgICAqL1xuICAgIHRyYW5zZmVyQ2FjaGU/OiB7aW5jbHVkZUhlYWRlcnM/OiBzdHJpbmdbXX18Ym9vbGVhblxuICB9KTtcbiAgY29uc3RydWN0b3IoXG4gICAgICBtZXRob2Q6IHN0cmluZywgcmVhZG9ubHkgdXJsOiBzdHJpbmcsIHRoaXJkPzogVHx7XG4gICAgICAgIGhlYWRlcnM/OiBIdHRwSGVhZGVycyxcbiAgICAgICAgY29udGV4dD86IEh0dHBDb250ZXh0LFxuICAgICAgICByZXBvcnRQcm9ncmVzcz86IGJvb2xlYW4sXG4gICAgICAgIHBhcmFtcz86IEh0dHBQYXJhbXMsXG4gICAgICAgIHJlc3BvbnNlVHlwZT86ICdhcnJheWJ1ZmZlcid8J2Jsb2InfCdqc29uJ3wndGV4dCcsXG4gICAgICAgIHdpdGhDcmVkZW50aWFscz86IGJvb2xlYW4sXG4gICAgICAgIHRyYW5zZmVyQ2FjaGU/OiB7aW5jbHVkZUhlYWRlcnM/OiBzdHJpbmdbXX18Ym9vbGVhblxuICAgICAgfXxudWxsLFxuICAgICAgZm91cnRoPzoge1xuICAgICAgICBoZWFkZXJzPzogSHR0cEhlYWRlcnMsXG4gICAgICAgIGNvbnRleHQ/OiBIdHRwQ29udGV4dCxcbiAgICAgICAgcmVwb3J0UHJvZ3Jlc3M/OiBib29sZWFuLFxuICAgICAgICBwYXJhbXM/OiBIdHRwUGFyYW1zLFxuICAgICAgICByZXNwb25zZVR5cGU/OiAnYXJyYXlidWZmZXInfCdibG9iJ3wnanNvbid8J3RleHQnLFxuICAgICAgICB3aXRoQ3JlZGVudGlhbHM/OiBib29sZWFuLFxuICAgICAgICB0cmFuc2ZlckNhY2hlPzoge2luY2x1ZGVIZWFkZXJzPzogc3RyaW5nW119fGJvb2xlYW5cbiAgICAgIH0pIHtcbiAgICB0aGlzLm1ldGhvZCA9IG1ldGhvZC50b1VwcGVyQ2FzZSgpO1xuICAgIC8vIE5leHQsIG5lZWQgdG8gZmlndXJlIG91dCB3aGljaCBhcmd1bWVudCBob2xkcyB0aGUgSHR0cFJlcXVlc3RJbml0XG4gICAgLy8gb3B0aW9ucywgaWYgYW55LlxuICAgIGxldCBvcHRpb25zOiBIdHRwUmVxdWVzdEluaXR8dW5kZWZpbmVkO1xuXG4gICAgLy8gQ2hlY2sgd2hldGhlciBhIGJvZHkgYXJndW1lbnQgaXMgZXhwZWN0ZWQuIFRoZSBvbmx5IHZhbGlkIHdheSB0byBvbWl0XG4gICAgLy8gdGhlIGJvZHkgYXJndW1lbnQgaXMgdG8gdXNlIGEga25vd24gbm8tYm9keSBtZXRob2QgbGlrZSBHRVQuXG4gICAgaWYgKG1pZ2h0SGF2ZUJvZHkodGhpcy5tZXRob2QpIHx8ICEhZm91cnRoKSB7XG4gICAgICAvLyBCb2R5IGlzIHRoZSB0aGlyZCBhcmd1bWVudCwgb3B0aW9ucyBhcmUgdGhlIGZvdXJ0aC5cbiAgICAgIHRoaXMuYm9keSA9ICh0aGlyZCAhPT0gdW5kZWZpbmVkKSA/IHRoaXJkIGFzIFQgOiBudWxsO1xuICAgICAgb3B0aW9ucyA9IGZvdXJ0aDtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTm8gYm9keSByZXF1aXJlZCwgb3B0aW9ucyBhcmUgdGhlIHRoaXJkIGFyZ3VtZW50LiBUaGUgYm9keSBzdGF5cyBudWxsLlxuICAgICAgb3B0aW9ucyA9IHRoaXJkIGFzIEh0dHBSZXF1ZXN0SW5pdDtcbiAgICB9XG5cbiAgICAvLyBJZiBvcHRpb25zIGhhdmUgYmVlbiBwYXNzZWQsIGludGVycHJldCB0aGVtLlxuICAgIGlmIChvcHRpb25zKSB7XG4gICAgICAvLyBOb3JtYWxpemUgcmVwb3J0UHJvZ3Jlc3MgYW5kIHdpdGhDcmVkZW50aWFscy5cbiAgICAgIHRoaXMucmVwb3J0UHJvZ3Jlc3MgPSAhIW9wdGlvbnMucmVwb3J0UHJvZ3Jlc3M7XG4gICAgICB0aGlzLndpdGhDcmVkZW50aWFscyA9ICEhb3B0aW9ucy53aXRoQ3JlZGVudGlhbHM7XG5cbiAgICAgIC8vIE92ZXJyaWRlIGRlZmF1bHQgcmVzcG9uc2UgdHlwZSBvZiAnanNvbicgaWYgb25lIGlzIHByb3ZpZGVkLlxuICAgICAgaWYgKCEhb3B0aW9ucy5yZXNwb25zZVR5cGUpIHtcbiAgICAgICAgdGhpcy5yZXNwb25zZVR5cGUgPSBvcHRpb25zLnJlc3BvbnNlVHlwZTtcbiAgICAgIH1cblxuICAgICAgLy8gT3ZlcnJpZGUgaGVhZGVycyBpZiB0aGV5J3JlIHByb3ZpZGVkLlxuICAgICAgaWYgKCEhb3B0aW9ucy5oZWFkZXJzKSB7XG4gICAgICAgIHRoaXMuaGVhZGVycyA9IG9wdGlvbnMuaGVhZGVycztcbiAgICAgIH1cblxuICAgICAgaWYgKCEhb3B0aW9ucy5jb250ZXh0KSB7XG4gICAgICAgIHRoaXMuY29udGV4dCA9IG9wdGlvbnMuY29udGV4dDtcbiAgICAgIH1cblxuICAgICAgaWYgKCEhb3B0aW9ucy5wYXJhbXMpIHtcbiAgICAgICAgdGhpcy5wYXJhbXMgPSBvcHRpb25zLnBhcmFtcztcbiAgICAgIH1cblxuICAgICAgLy8gV2UgZG8gd2FudCB0byBhc3NpZ24gdHJhbnNmZXJDYWNoZSBldmVuIGlmIGl0J3MgZmFsc3kgKGZhbHNlIGlzIHZhbGlkIHZhbHVlKVxuICAgICAgdGhpcy50cmFuc2ZlckNhY2hlID0gb3B0aW9ucy50cmFuc2ZlckNhY2hlO1xuICAgIH1cblxuICAgIC8vIElmIG5vIGhlYWRlcnMgaGF2ZSBiZWVuIHBhc3NlZCBpbiwgY29uc3RydWN0IGEgbmV3IEh0dHBIZWFkZXJzIGluc3RhbmNlLlxuICAgIGlmICghdGhpcy5oZWFkZXJzKSB7XG4gICAgICB0aGlzLmhlYWRlcnMgPSBuZXcgSHR0cEhlYWRlcnMoKTtcbiAgICB9XG5cbiAgICAvLyBJZiBubyBjb250ZXh0IGhhdmUgYmVlbiBwYXNzZWQgaW4sIGNvbnN0cnVjdCBhIG5ldyBIdHRwQ29udGV4dCBpbnN0YW5jZS5cbiAgICBpZiAoIXRoaXMuY29udGV4dCkge1xuICAgICAgdGhpcy5jb250ZXh0ID0gbmV3IEh0dHBDb250ZXh0KCk7XG4gICAgfVxuXG4gICAgLy8gSWYgbm8gcGFyYW1ldGVycyBoYXZlIGJlZW4gcGFzc2VkIGluLCBjb25zdHJ1Y3QgYSBuZXcgSHR0cFVybEVuY29kZWRQYXJhbXMgaW5zdGFuY2UuXG4gICAgaWYgKCF0aGlzLnBhcmFtcykge1xuICAgICAgdGhpcy5wYXJhbXMgPSBuZXcgSHR0cFBhcmFtcygpO1xuICAgICAgdGhpcy51cmxXaXRoUGFyYW1zID0gdXJsO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBFbmNvZGUgdGhlIHBhcmFtZXRlcnMgdG8gYSBzdHJpbmcgaW4gcHJlcGFyYXRpb24gZm9yIGluY2x1c2lvbiBpbiB0aGUgVVJMLlxuICAgICAgY29uc3QgcGFyYW1zID0gdGhpcy5wYXJhbXMudG9TdHJpbmcoKTtcbiAgICAgIGlmIChwYXJhbXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIE5vIHBhcmFtZXRlcnMsIHRoZSB2aXNpYmxlIFVSTCBpcyBqdXN0IHRoZSBVUkwgZ2l2ZW4gYXQgY3JlYXRpb24gdGltZS5cbiAgICAgICAgdGhpcy51cmxXaXRoUGFyYW1zID0gdXJsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRG9lcyB0aGUgVVJMIGFscmVhZHkgaGF2ZSBxdWVyeSBwYXJhbWV0ZXJzPyBMb29rIGZvciAnPycuXG4gICAgICAgIGNvbnN0IHFJZHggPSB1cmwuaW5kZXhPZignPycpO1xuICAgICAgICAvLyBUaGVyZSBhcmUgMyBjYXNlcyB0byBoYW5kbGU6XG4gICAgICAgIC8vIDEpIE5vIGV4aXN0aW5nIHBhcmFtZXRlcnMgLT4gYXBwZW5kICc/JyBmb2xsb3dlZCBieSBwYXJhbXMuXG4gICAgICAgIC8vIDIpICc/JyBleGlzdHMgYW5kIGlzIGZvbGxvd2VkIGJ5IGV4aXN0aW5nIHF1ZXJ5IHN0cmluZyAtPlxuICAgICAgICAvLyAgICBhcHBlbmQgJyYnIGZvbGxvd2VkIGJ5IHBhcmFtcy5cbiAgICAgICAgLy8gMykgJz8nIGV4aXN0cyBhdCB0aGUgZW5kIG9mIHRoZSB1cmwgLT4gYXBwZW5kIHBhcmFtcyBkaXJlY3RseS5cbiAgICAgICAgLy8gVGhpcyBiYXNpY2FsbHkgYW1vdW50cyB0byBkZXRlcm1pbmluZyB0aGUgY2hhcmFjdGVyLCBpZiBhbnksIHdpdGhcbiAgICAgICAgLy8gd2hpY2ggdG8gam9pbiB0aGUgVVJMIGFuZCBwYXJhbWV0ZXJzLlxuICAgICAgICBjb25zdCBzZXA6IHN0cmluZyA9IHFJZHggPT09IC0xID8gJz8nIDogKHFJZHggPCB1cmwubGVuZ3RoIC0gMSA/ICcmJyA6ICcnKTtcbiAgICAgICAgdGhpcy51cmxXaXRoUGFyYW1zID0gdXJsICsgc2VwICsgcGFyYW1zO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFuc2Zvcm0gdGhlIGZyZWUtZm9ybSBib2R5IGludG8gYSBzZXJpYWxpemVkIGZvcm1hdCBzdWl0YWJsZSBmb3JcbiAgICogdHJhbnNtaXNzaW9uIHRvIHRoZSBzZXJ2ZXIuXG4gICAqL1xuICBzZXJpYWxpemVCb2R5KCk6IEFycmF5QnVmZmVyfEJsb2J8Rm9ybURhdGF8VVJMU2VhcmNoUGFyYW1zfHN0cmluZ3xudWxsIHtcbiAgICAvLyBJZiBubyBib2R5IGlzIHByZXNlbnQsIG5vIG5lZWQgdG8gc2VyaWFsaXplIGl0LlxuICAgIGlmICh0aGlzLmJvZHkgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICAvLyBDaGVjayB3aGV0aGVyIHRoZSBib2R5IGlzIGFscmVhZHkgaW4gYSBzZXJpYWxpemVkIGZvcm0uIElmIHNvLFxuICAgIC8vIGl0IGNhbiBqdXN0IGJlIHJldHVybmVkIGRpcmVjdGx5LlxuICAgIGlmIChpc0FycmF5QnVmZmVyKHRoaXMuYm9keSkgfHwgaXNCbG9iKHRoaXMuYm9keSkgfHwgaXNGb3JtRGF0YSh0aGlzLmJvZHkpIHx8XG4gICAgICAgIGlzVXJsU2VhcmNoUGFyYW1zKHRoaXMuYm9keSkgfHwgdHlwZW9mIHRoaXMuYm9keSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiB0aGlzLmJvZHk7XG4gICAgfVxuICAgIC8vIENoZWNrIHdoZXRoZXIgdGhlIGJvZHkgaXMgYW4gaW5zdGFuY2Ugb2YgSHR0cFVybEVuY29kZWRQYXJhbXMuXG4gICAgaWYgKHRoaXMuYm9keSBpbnN0YW5jZW9mIEh0dHBQYXJhbXMpIHtcbiAgICAgIHJldHVybiB0aGlzLmJvZHkudG9TdHJpbmcoKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgd2hldGhlciB0aGUgYm9keSBpcyBhbiBvYmplY3Qgb3IgYXJyYXksIGFuZCBzZXJpYWxpemUgd2l0aCBKU09OIGlmIHNvLlxuICAgIGlmICh0eXBlb2YgdGhpcy5ib2R5ID09PSAnb2JqZWN0JyB8fCB0eXBlb2YgdGhpcy5ib2R5ID09PSAnYm9vbGVhbicgfHxcbiAgICAgICAgQXJyYXkuaXNBcnJheSh0aGlzLmJvZHkpKSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodGhpcy5ib2R5KTtcbiAgICB9XG4gICAgLy8gRmFsbCBiYWNrIG9uIHRvU3RyaW5nKCkgZm9yIGV2ZXJ5dGhpbmcgZWxzZS5cbiAgICByZXR1cm4gKHRoaXMuYm9keSBhcyBhbnkpLnRvU3RyaW5nKCk7XG4gIH1cblxuICAvKipcbiAgICogRXhhbWluZSB0aGUgYm9keSBhbmQgYXR0ZW1wdCB0byBpbmZlciBhbiBhcHByb3ByaWF0ZSBNSU1FIHR5cGVcbiAgICogZm9yIGl0LlxuICAgKlxuICAgKiBJZiBubyBzdWNoIHR5cGUgY2FuIGJlIGluZmVycmVkLCB0aGlzIG1ldGhvZCB3aWxsIHJldHVybiBgbnVsbGAuXG4gICAqL1xuICBkZXRlY3RDb250ZW50VHlwZUhlYWRlcigpOiBzdHJpbmd8bnVsbCB7XG4gICAgLy8gQW4gZW1wdHkgYm9keSBoYXMgbm8gY29udGVudCB0eXBlLlxuICAgIGlmICh0aGlzLmJvZHkgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICAvLyBGb3JtRGF0YSBib2RpZXMgcmVseSBvbiB0aGUgYnJvd3NlcidzIGNvbnRlbnQgdHlwZSBhc3NpZ25tZW50LlxuICAgIGlmIChpc0Zvcm1EYXRhKHRoaXMuYm9keSkpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICAvLyBCbG9icyB1c3VhbGx5IGhhdmUgdGhlaXIgb3duIGNvbnRlbnQgdHlwZS4gSWYgaXQgZG9lc24ndCwgdGhlblxuICAgIC8vIG5vIHR5cGUgY2FuIGJlIGluZmVycmVkLlxuICAgIGlmIChpc0Jsb2IodGhpcy5ib2R5KSkge1xuICAgICAgcmV0dXJuIHRoaXMuYm9keS50eXBlIHx8IG51bGw7XG4gICAgfVxuICAgIC8vIEFycmF5IGJ1ZmZlcnMgaGF2ZSB1bmtub3duIGNvbnRlbnRzIGFuZCB0aHVzIG5vIHR5cGUgY2FuIGJlIGluZmVycmVkLlxuICAgIGlmIChpc0FycmF5QnVmZmVyKHRoaXMuYm9keSkpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICAvLyBUZWNobmljYWxseSwgc3RyaW5ncyBjb3VsZCBiZSBhIGZvcm0gb2YgSlNPTiBkYXRhLCBidXQgaXQncyBzYWZlIGVub3VnaFxuICAgIC8vIHRvIGFzc3VtZSB0aGV5J3JlIHBsYWluIHN0cmluZ3MuXG4gICAgaWYgKHR5cGVvZiB0aGlzLmJvZHkgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gJ3RleHQvcGxhaW4nO1xuICAgIH1cbiAgICAvLyBgSHR0cFVybEVuY29kZWRQYXJhbXNgIGhhcyBpdHMgb3duIGNvbnRlbnQtdHlwZS5cbiAgICBpZiAodGhpcy5ib2R5IGluc3RhbmNlb2YgSHR0cFBhcmFtcykge1xuICAgICAgcmV0dXJuICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQ7Y2hhcnNldD1VVEYtOCc7XG4gICAgfVxuICAgIC8vIEFycmF5cywgb2JqZWN0cywgYm9vbGVhbiBhbmQgbnVtYmVycyB3aWxsIGJlIGVuY29kZWQgYXMgSlNPTi5cbiAgICBpZiAodHlwZW9mIHRoaXMuYm9keSA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIHRoaXMuYm9keSA9PT0gJ251bWJlcicgfHxcbiAgICAgICAgdHlwZW9mIHRoaXMuYm9keSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICByZXR1cm4gJ2FwcGxpY2F0aW9uL2pzb24nO1xuICAgIH1cbiAgICAvLyBObyB0eXBlIGNvdWxkIGJlIGluZmVycmVkLlxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY2xvbmUoKTogSHR0cFJlcXVlc3Q8VD47XG4gIGNsb25lKHVwZGF0ZToge1xuICAgIGhlYWRlcnM/OiBIdHRwSGVhZGVycyxcbiAgICBjb250ZXh0PzogSHR0cENvbnRleHQsXG4gICAgcmVwb3J0UHJvZ3Jlc3M/OiBib29sZWFuLFxuICAgIHBhcmFtcz86IEh0dHBQYXJhbXMsXG4gICAgcmVzcG9uc2VUeXBlPzogJ2FycmF5YnVmZmVyJ3wnYmxvYid8J2pzb24nfCd0ZXh0JyxcbiAgICB3aXRoQ3JlZGVudGlhbHM/OiBib29sZWFuLFxuICAgIGJvZHk/OiBUfG51bGwsXG4gICAgbWV0aG9kPzogc3RyaW5nLFxuICAgIHVybD86IHN0cmluZyxcbiAgICBzZXRIZWFkZXJzPzoge1tuYW1lOiBzdHJpbmddOiBzdHJpbmd8c3RyaW5nW119LFxuICAgIHNldFBhcmFtcz86IHtbcGFyYW06IHN0cmluZ106IHN0cmluZ30sXG4gIH0pOiBIdHRwUmVxdWVzdDxUPjtcbiAgY2xvbmU8Vj4odXBkYXRlOiB7XG4gICAgaGVhZGVycz86IEh0dHBIZWFkZXJzLFxuICAgIGNvbnRleHQ/OiBIdHRwQ29udGV4dCxcbiAgICByZXBvcnRQcm9ncmVzcz86IGJvb2xlYW4sXG4gICAgcGFyYW1zPzogSHR0cFBhcmFtcyxcbiAgICByZXNwb25zZVR5cGU/OiAnYXJyYXlidWZmZXInfCdibG9iJ3wnanNvbid8J3RleHQnLFxuICAgIHdpdGhDcmVkZW50aWFscz86IGJvb2xlYW4sXG4gICAgYm9keT86IFZ8bnVsbCxcbiAgICBtZXRob2Q/OiBzdHJpbmcsXG4gICAgdXJsPzogc3RyaW5nLFxuICAgIHNldEhlYWRlcnM/OiB7W25hbWU6IHN0cmluZ106IHN0cmluZ3xzdHJpbmdbXX0sXG4gICAgc2V0UGFyYW1zPzoge1twYXJhbTogc3RyaW5nXTogc3RyaW5nfSxcbiAgfSk6IEh0dHBSZXF1ZXN0PFY+O1xuICBjbG9uZSh1cGRhdGU6IHtcbiAgICBoZWFkZXJzPzogSHR0cEhlYWRlcnMsXG4gICAgY29udGV4dD86IEh0dHBDb250ZXh0LFxuICAgIHJlcG9ydFByb2dyZXNzPzogYm9vbGVhbixcbiAgICBwYXJhbXM/OiBIdHRwUGFyYW1zLFxuICAgIHJlc3BvbnNlVHlwZT86ICdhcnJheWJ1ZmZlcid8J2Jsb2InfCdqc29uJ3wndGV4dCcsXG4gICAgd2l0aENyZWRlbnRpYWxzPzogYm9vbGVhbixcbiAgICBib2R5PzogYW55fG51bGwsXG4gICAgbWV0aG9kPzogc3RyaW5nLFxuICAgIHVybD86IHN0cmluZyxcbiAgICBzZXRIZWFkZXJzPzoge1tuYW1lOiBzdHJpbmddOiBzdHJpbmd8c3RyaW5nW119LFxuICAgIHNldFBhcmFtcz86IHtbcGFyYW06IHN0cmluZ106IHN0cmluZ307XG4gIH0gPSB7fSk6IEh0dHBSZXF1ZXN0PGFueT4ge1xuICAgIC8vIEZvciBtZXRob2QsIHVybCwgYW5kIHJlc3BvbnNlVHlwZSwgdGFrZSB0aGUgY3VycmVudCB2YWx1ZSB1bmxlc3NcbiAgICAvLyBpdCBpcyBvdmVycmlkZGVuIGluIHRoZSB1cGRhdGUgaGFzaC5cbiAgICBjb25zdCBtZXRob2QgPSB1cGRhdGUubWV0aG9kIHx8IHRoaXMubWV0aG9kO1xuICAgIGNvbnN0IHVybCA9IHVwZGF0ZS51cmwgfHwgdGhpcy51cmw7XG4gICAgY29uc3QgcmVzcG9uc2VUeXBlID0gdXBkYXRlLnJlc3BvbnNlVHlwZSB8fCB0aGlzLnJlc3BvbnNlVHlwZTtcblxuICAgIC8vIFRoZSBib2R5IGlzIHNvbWV3aGF0IHNwZWNpYWwgLSBhIGBudWxsYCB2YWx1ZSBpbiB1cGRhdGUuYm9keSBtZWFuc1xuICAgIC8vIHdoYXRldmVyIGN1cnJlbnQgYm9keSBpcyBwcmVzZW50IGlzIGJlaW5nIG92ZXJyaWRkZW4gd2l0aCBhbiBlbXB0eVxuICAgIC8vIGJvZHksIHdoZXJlYXMgYW4gYHVuZGVmaW5lZGAgdmFsdWUgaW4gdXBkYXRlLmJvZHkgaW1wbGllcyBub1xuICAgIC8vIG92ZXJyaWRlLlxuICAgIGNvbnN0IGJvZHkgPSAodXBkYXRlLmJvZHkgIT09IHVuZGVmaW5lZCkgPyB1cGRhdGUuYm9keSA6IHRoaXMuYm9keTtcblxuICAgIC8vIENhcmVmdWxseSBoYW5kbGUgdGhlIGJvb2xlYW4gb3B0aW9ucyB0byBkaWZmZXJlbnRpYXRlIGJldHdlZW5cbiAgICAvLyBgZmFsc2VgIGFuZCBgdW5kZWZpbmVkYCBpbiB0aGUgdXBkYXRlIGFyZ3MuXG4gICAgY29uc3Qgd2l0aENyZWRlbnRpYWxzID1cbiAgICAgICAgKHVwZGF0ZS53aXRoQ3JlZGVudGlhbHMgIT09IHVuZGVmaW5lZCkgPyB1cGRhdGUud2l0aENyZWRlbnRpYWxzIDogdGhpcy53aXRoQ3JlZGVudGlhbHM7XG4gICAgY29uc3QgcmVwb3J0UHJvZ3Jlc3MgPVxuICAgICAgICAodXBkYXRlLnJlcG9ydFByb2dyZXNzICE9PSB1bmRlZmluZWQpID8gdXBkYXRlLnJlcG9ydFByb2dyZXNzIDogdGhpcy5yZXBvcnRQcm9ncmVzcztcblxuICAgIC8vIEhlYWRlcnMgYW5kIHBhcmFtcyBtYXkgYmUgYXBwZW5kZWQgdG8gaWYgYHNldEhlYWRlcnNgIG9yXG4gICAgLy8gYHNldFBhcmFtc2AgYXJlIHVzZWQuXG4gICAgbGV0IGhlYWRlcnMgPSB1cGRhdGUuaGVhZGVycyB8fCB0aGlzLmhlYWRlcnM7XG4gICAgbGV0IHBhcmFtcyA9IHVwZGF0ZS5wYXJhbXMgfHwgdGhpcy5wYXJhbXM7XG5cbiAgICAvLyBQYXNzIG9uIGNvbnRleHQgaWYgbmVlZGVkXG4gICAgY29uc3QgY29udGV4dCA9IHVwZGF0ZS5jb250ZXh0ID8/IHRoaXMuY29udGV4dDtcblxuICAgIC8vIENoZWNrIHdoZXRoZXIgdGhlIGNhbGxlciBoYXMgYXNrZWQgdG8gYWRkIGhlYWRlcnMuXG4gICAgaWYgKHVwZGF0ZS5zZXRIZWFkZXJzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIFNldCBldmVyeSByZXF1ZXN0ZWQgaGVhZGVyLlxuICAgICAgaGVhZGVycyA9XG4gICAgICAgICAgT2JqZWN0LmtleXModXBkYXRlLnNldEhlYWRlcnMpXG4gICAgICAgICAgICAgIC5yZWR1Y2UoKGhlYWRlcnMsIG5hbWUpID0+IGhlYWRlcnMuc2V0KG5hbWUsIHVwZGF0ZS5zZXRIZWFkZXJzIVtuYW1lXSksIGhlYWRlcnMpO1xuICAgIH1cblxuICAgIC8vIENoZWNrIHdoZXRoZXIgdGhlIGNhbGxlciBoYXMgYXNrZWQgdG8gc2V0IHBhcmFtcy5cbiAgICBpZiAodXBkYXRlLnNldFBhcmFtcykge1xuICAgICAgLy8gU2V0IGV2ZXJ5IHJlcXVlc3RlZCBwYXJhbS5cbiAgICAgIHBhcmFtcyA9IE9iamVjdC5rZXlzKHVwZGF0ZS5zZXRQYXJhbXMpXG4gICAgICAgICAgICAgICAgICAgLnJlZHVjZSgocGFyYW1zLCBwYXJhbSkgPT4gcGFyYW1zLnNldChwYXJhbSwgdXBkYXRlLnNldFBhcmFtcyFbcGFyYW1dKSwgcGFyYW1zKTtcbiAgICB9XG5cbiAgICAvLyBGaW5hbGx5LCBjb25zdHJ1Y3QgdGhlIG5ldyBIdHRwUmVxdWVzdCB1c2luZyB0aGUgcGllY2VzIGZyb20gYWJvdmUuXG4gICAgcmV0dXJuIG5ldyBIdHRwUmVxdWVzdChtZXRob2QsIHVybCwgYm9keSwge1xuICAgICAgcGFyYW1zLFxuICAgICAgaGVhZGVycyxcbiAgICAgIGNvbnRleHQsXG4gICAgICByZXBvcnRQcm9ncmVzcyxcbiAgICAgIHJlc3BvbnNlVHlwZSxcbiAgICAgIHdpdGhDcmVkZW50aWFscyxcbiAgICB9KTtcbiAgfVxufVxuIl19