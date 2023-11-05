/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { noSideEffects } from '../util/closure';
/**
 * The name of a field that Angular monkey-patches onto a class
 * to keep track of the Promise that represents dependency loading
 * state.
 */
const ASYNC_COMPONENT_METADATA = '__ngAsyncComponentMetadata__';
/**
 * If a given component has unresolved async metadata - this function returns a reference to
 * a Promise that represents dependency loading. Otherwise - this function returns `null`.
 */
export function getAsyncClassMetadata(type) {
    const componentClass = type; // cast to `any`, so that we can monkey-patch it
    return componentClass[ASYNC_COMPONENT_METADATA] ?? null;
}
/**
 * Handles the process of applying metadata info to a component class in case
 * component template had defer blocks (thus some dependencies became deferrable).
 *
 * @param type Component class where metadata should be added
 * @param dependencyLoaderFn Function that loads dependencies
 * @param metadataSetterFn Function that forms a scope in which the `setClassMetadata` is invoked
 */
export function setClassMetadataAsync(type, dependencyLoaderFn, metadataSetterFn) {
    const componentClass = type; // cast to `any`, so that we can monkey-patch it
    componentClass[ASYNC_COMPONENT_METADATA] =
        Promise.all(dependencyLoaderFn()).then(dependencies => {
            metadataSetterFn(...dependencies);
            // Metadata is now set, reset field value to indicate that this component
            // can by used/compiled synchronously.
            componentClass[ASYNC_COMPONENT_METADATA] = null;
            return dependencies;
        });
    return componentClass[ASYNC_COMPONENT_METADATA];
}
/**
 * Adds decorator, constructor, and property metadata to a given type via static metadata fields
 * on the type.
 *
 * These metadata fields can later be read with Angular's `ReflectionCapabilities` API.
 *
 * Calls to `setClassMetadata` can be guarded by ngDevMode, resulting in the metadata assignments
 * being tree-shaken away during production builds.
 */
export function setClassMetadata(type, decorators, ctorParameters, propDecorators) {
    return noSideEffects(() => {
        const clazz = type;
        if (decorators !== null) {
            if (clazz.hasOwnProperty('decorators') && clazz.decorators !== undefined) {
                clazz.decorators.push(...decorators);
            }
            else {
                clazz.decorators = decorators;
            }
        }
        if (ctorParameters !== null) {
            // Rather than merging, clobber the existing parameters. If other projects exist which
            // use tsickle-style annotations and reflect over them in the same way, this could
            // cause issues, but that is vanishingly unlikely.
            clazz.ctorParameters = ctorParameters;
        }
        if (propDecorators !== null) {
            // The property decorator objects are merged as it is possible different fields have
            // different decorator types. Decorators on individual fields are not merged, as it's
            // also incredibly unlikely that a field will be decorated both with an Angular
            // decorator and a non-Angular decorator that's also been downleveled.
            if (clazz.hasOwnProperty('propDecorators') && clazz.propDecorators !== undefined) {
                clazz.propDecorators = { ...clazz.propDecorators, ...propDecorators };
            }
            else {
                clazz.propDecorators = propDecorators;
            }
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0YWRhdGEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9jb3JlL3NyYy9yZW5kZXIzL21ldGFkYXRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUdILE9BQU8sRUFBQyxhQUFhLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQztBQVE5Qzs7OztHQUlHO0FBQ0gsTUFBTSx3QkFBd0IsR0FBRyw4QkFBOEIsQ0FBQztBQUVoRTs7O0dBR0c7QUFDSCxNQUFNLFVBQVUscUJBQXFCLENBQUMsSUFBbUI7SUFDdkQsTUFBTSxjQUFjLEdBQUcsSUFBVyxDQUFDLENBQUUsZ0RBQWdEO0lBQ3JGLE9BQU8sY0FBYyxDQUFDLHdCQUF3QixDQUFDLElBQUksSUFBSSxDQUFDO0FBQzFELENBQUM7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsTUFBTSxVQUFVLHFCQUFxQixDQUNqQyxJQUFlLEVBQUUsa0JBQXVELEVBQ3hFLGdCQUFxRDtJQUN2RCxNQUFNLGNBQWMsR0FBRyxJQUFXLENBQUMsQ0FBRSxnREFBZ0Q7SUFDckYsY0FBYyxDQUFDLHdCQUF3QixDQUFDO1FBQ3BDLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRTtZQUNwRCxnQkFBZ0IsQ0FBQyxHQUFHLFlBQVksQ0FBQyxDQUFDO1lBQ2xDLHlFQUF5RTtZQUN6RSxzQ0FBc0M7WUFDdEMsY0FBYyxDQUFDLHdCQUF3QixDQUFDLEdBQUcsSUFBSSxDQUFDO1lBRWhELE9BQU8sWUFBWSxDQUFDO1FBQ3RCLENBQUMsQ0FBQyxDQUFDO0lBRVAsT0FBTyxjQUFjLENBQUMsd0JBQXdCLENBQUMsQ0FBQztBQUNsRCxDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLFVBQVUsZ0JBQWdCLENBQzVCLElBQWUsRUFBRSxVQUFzQixFQUFFLGNBQWtDLEVBQzNFLGNBQTJDO0lBQzdDLE9BQU8sYUFBYSxDQUFDLEdBQUcsRUFBRTtRQUNqQixNQUFNLEtBQUssR0FBRyxJQUF3QixDQUFDO1FBRXZDLElBQUksVUFBVSxLQUFLLElBQUksRUFBRTtZQUN2QixJQUFJLEtBQUssQ0FBQyxjQUFjLENBQUMsWUFBWSxDQUFDLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxTQUFTLEVBQUU7Z0JBQ3hFLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsVUFBVSxDQUFDLENBQUM7YUFDdEM7aUJBQU07Z0JBQ0wsS0FBSyxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7YUFDL0I7U0FDRjtRQUNELElBQUksY0FBYyxLQUFLLElBQUksRUFBRTtZQUMzQixzRkFBc0Y7WUFDdEYsa0ZBQWtGO1lBQ2xGLGtEQUFrRDtZQUNsRCxLQUFLLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQztTQUN2QztRQUNELElBQUksY0FBYyxLQUFLLElBQUksRUFBRTtZQUMzQixvRkFBb0Y7WUFDcEYscUZBQXFGO1lBQ3JGLCtFQUErRTtZQUMvRSxzRUFBc0U7WUFDdEUsSUFBSSxLQUFLLENBQUMsY0FBYyxDQUFDLGdCQUFnQixDQUFDLElBQUksS0FBSyxDQUFDLGNBQWMsS0FBSyxTQUFTLEVBQUU7Z0JBQ2hGLEtBQUssQ0FBQyxjQUFjLEdBQUcsRUFBQyxHQUFHLEtBQUssQ0FBQyxjQUFjLEVBQUUsR0FBRyxjQUFjLEVBQUMsQ0FBQzthQUNyRTtpQkFBTTtnQkFDTCxLQUFLLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQzthQUN2QztTQUNGO0lBQ0gsQ0FBQyxDQUFVLENBQUM7QUFDckIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQge1R5cGV9IGZyb20gJy4uL2ludGVyZmFjZS90eXBlJztcbmltcG9ydCB7bm9TaWRlRWZmZWN0c30gZnJvbSAnLi4vdXRpbC9jbG9zdXJlJztcblxuaW50ZXJmYWNlIFR5cGVXaXRoTWV0YWRhdGEgZXh0ZW5kcyBUeXBlPGFueT4ge1xuICBkZWNvcmF0b3JzPzogYW55W107XG4gIGN0b3JQYXJhbWV0ZXJzPzogKCkgPT4gYW55W107XG4gIHByb3BEZWNvcmF0b3JzPzoge1tmaWVsZDogc3RyaW5nXTogYW55fTtcbn1cblxuLyoqXG4gKiBUaGUgbmFtZSBvZiBhIGZpZWxkIHRoYXQgQW5ndWxhciBtb25rZXktcGF0Y2hlcyBvbnRvIGEgY2xhc3NcbiAqIHRvIGtlZXAgdHJhY2sgb2YgdGhlIFByb21pc2UgdGhhdCByZXByZXNlbnRzIGRlcGVuZGVuY3kgbG9hZGluZ1xuICogc3RhdGUuXG4gKi9cbmNvbnN0IEFTWU5DX0NPTVBPTkVOVF9NRVRBREFUQSA9ICdfX25nQXN5bmNDb21wb25lbnRNZXRhZGF0YV9fJztcblxuLyoqXG4gKiBJZiBhIGdpdmVuIGNvbXBvbmVudCBoYXMgdW5yZXNvbHZlZCBhc3luYyBtZXRhZGF0YSAtIHRoaXMgZnVuY3Rpb24gcmV0dXJucyBhIHJlZmVyZW5jZSB0b1xuICogYSBQcm9taXNlIHRoYXQgcmVwcmVzZW50cyBkZXBlbmRlbmN5IGxvYWRpbmcuIE90aGVyd2lzZSAtIHRoaXMgZnVuY3Rpb24gcmV0dXJucyBgbnVsbGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRBc3luY0NsYXNzTWV0YWRhdGEodHlwZTogVHlwZTx1bmtub3duPik6IFByb21pc2U8QXJyYXk8VHlwZTx1bmtub3duPj4+fG51bGwge1xuICBjb25zdCBjb21wb25lbnRDbGFzcyA9IHR5cGUgYXMgYW55OyAgLy8gY2FzdCB0byBgYW55YCwgc28gdGhhdCB3ZSBjYW4gbW9ua2V5LXBhdGNoIGl0XG4gIHJldHVybiBjb21wb25lbnRDbGFzc1tBU1lOQ19DT01QT05FTlRfTUVUQURBVEFdID8/IG51bGw7XG59XG5cbi8qKlxuICogSGFuZGxlcyB0aGUgcHJvY2VzcyBvZiBhcHBseWluZyBtZXRhZGF0YSBpbmZvIHRvIGEgY29tcG9uZW50IGNsYXNzIGluIGNhc2VcbiAqIGNvbXBvbmVudCB0ZW1wbGF0ZSBoYWQgZGVmZXIgYmxvY2tzICh0aHVzIHNvbWUgZGVwZW5kZW5jaWVzIGJlY2FtZSBkZWZlcnJhYmxlKS5cbiAqXG4gKiBAcGFyYW0gdHlwZSBDb21wb25lbnQgY2xhc3Mgd2hlcmUgbWV0YWRhdGEgc2hvdWxkIGJlIGFkZGVkXG4gKiBAcGFyYW0gZGVwZW5kZW5jeUxvYWRlckZuIEZ1bmN0aW9uIHRoYXQgbG9hZHMgZGVwZW5kZW5jaWVzXG4gKiBAcGFyYW0gbWV0YWRhdGFTZXR0ZXJGbiBGdW5jdGlvbiB0aGF0IGZvcm1zIGEgc2NvcGUgaW4gd2hpY2ggdGhlIGBzZXRDbGFzc01ldGFkYXRhYCBpcyBpbnZva2VkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRDbGFzc01ldGFkYXRhQXN5bmMoXG4gICAgdHlwZTogVHlwZTxhbnk+LCBkZXBlbmRlbmN5TG9hZGVyRm46ICgpID0+IEFycmF5PFByb21pc2U8VHlwZTx1bmtub3duPj4+LFxuICAgIG1ldGFkYXRhU2V0dGVyRm46ICguLi50eXBlczogVHlwZTx1bmtub3duPltdKSA9PiB2b2lkKTogUHJvbWlzZTxBcnJheTxUeXBlPHVua25vd24+Pj4ge1xuICBjb25zdCBjb21wb25lbnRDbGFzcyA9IHR5cGUgYXMgYW55OyAgLy8gY2FzdCB0byBgYW55YCwgc28gdGhhdCB3ZSBjYW4gbW9ua2V5LXBhdGNoIGl0XG4gIGNvbXBvbmVudENsYXNzW0FTWU5DX0NPTVBPTkVOVF9NRVRBREFUQV0gPVxuICAgICAgUHJvbWlzZS5hbGwoZGVwZW5kZW5jeUxvYWRlckZuKCkpLnRoZW4oZGVwZW5kZW5jaWVzID0+IHtcbiAgICAgICAgbWV0YWRhdGFTZXR0ZXJGbiguLi5kZXBlbmRlbmNpZXMpO1xuICAgICAgICAvLyBNZXRhZGF0YSBpcyBub3cgc2V0LCByZXNldCBmaWVsZCB2YWx1ZSB0byBpbmRpY2F0ZSB0aGF0IHRoaXMgY29tcG9uZW50XG4gICAgICAgIC8vIGNhbiBieSB1c2VkL2NvbXBpbGVkIHN5bmNocm9ub3VzbHkuXG4gICAgICAgIGNvbXBvbmVudENsYXNzW0FTWU5DX0NPTVBPTkVOVF9NRVRBREFUQV0gPSBudWxsO1xuXG4gICAgICAgIHJldHVybiBkZXBlbmRlbmNpZXM7XG4gICAgICB9KTtcblxuICByZXR1cm4gY29tcG9uZW50Q2xhc3NbQVNZTkNfQ09NUE9ORU5UX01FVEFEQVRBXTtcbn1cblxuLyoqXG4gKiBBZGRzIGRlY29yYXRvciwgY29uc3RydWN0b3IsIGFuZCBwcm9wZXJ0eSBtZXRhZGF0YSB0byBhIGdpdmVuIHR5cGUgdmlhIHN0YXRpYyBtZXRhZGF0YSBmaWVsZHNcbiAqIG9uIHRoZSB0eXBlLlxuICpcbiAqIFRoZXNlIG1ldGFkYXRhIGZpZWxkcyBjYW4gbGF0ZXIgYmUgcmVhZCB3aXRoIEFuZ3VsYXIncyBgUmVmbGVjdGlvbkNhcGFiaWxpdGllc2AgQVBJLlxuICpcbiAqIENhbGxzIHRvIGBzZXRDbGFzc01ldGFkYXRhYCBjYW4gYmUgZ3VhcmRlZCBieSBuZ0Rldk1vZGUsIHJlc3VsdGluZyBpbiB0aGUgbWV0YWRhdGEgYXNzaWdubWVudHNcbiAqIGJlaW5nIHRyZWUtc2hha2VuIGF3YXkgZHVyaW5nIHByb2R1Y3Rpb24gYnVpbGRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0Q2xhc3NNZXRhZGF0YShcbiAgICB0eXBlOiBUeXBlPGFueT4sIGRlY29yYXRvcnM6IGFueVtdfG51bGwsIGN0b3JQYXJhbWV0ZXJzOiAoKCkgPT4gYW55W10pfG51bGwsXG4gICAgcHJvcERlY29yYXRvcnM6IHtbZmllbGQ6IHN0cmluZ106IGFueX18bnVsbCk6IHZvaWQge1xuICByZXR1cm4gbm9TaWRlRWZmZWN0cygoKSA9PiB7XG4gICAgICAgICAgIGNvbnN0IGNsYXp6ID0gdHlwZSBhcyBUeXBlV2l0aE1ldGFkYXRhO1xuXG4gICAgICAgICAgIGlmIChkZWNvcmF0b3JzICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgaWYgKGNsYXp6Lmhhc093blByb3BlcnR5KCdkZWNvcmF0b3JzJykgJiYgY2xhenouZGVjb3JhdG9ycyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICBjbGF6ei5kZWNvcmF0b3JzLnB1c2goLi4uZGVjb3JhdG9ycyk7XG4gICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgIGNsYXp6LmRlY29yYXRvcnMgPSBkZWNvcmF0b3JzO1xuICAgICAgICAgICAgIH1cbiAgICAgICAgICAgfVxuICAgICAgICAgICBpZiAoY3RvclBhcmFtZXRlcnMgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAvLyBSYXRoZXIgdGhhbiBtZXJnaW5nLCBjbG9iYmVyIHRoZSBleGlzdGluZyBwYXJhbWV0ZXJzLiBJZiBvdGhlciBwcm9qZWN0cyBleGlzdCB3aGljaFxuICAgICAgICAgICAgIC8vIHVzZSB0c2lja2xlLXN0eWxlIGFubm90YXRpb25zIGFuZCByZWZsZWN0IG92ZXIgdGhlbSBpbiB0aGUgc2FtZSB3YXksIHRoaXMgY291bGRcbiAgICAgICAgICAgICAvLyBjYXVzZSBpc3N1ZXMsIGJ1dCB0aGF0IGlzIHZhbmlzaGluZ2x5IHVubGlrZWx5LlxuICAgICAgICAgICAgIGNsYXp6LmN0b3JQYXJhbWV0ZXJzID0gY3RvclBhcmFtZXRlcnM7XG4gICAgICAgICAgIH1cbiAgICAgICAgICAgaWYgKHByb3BEZWNvcmF0b3JzICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgLy8gVGhlIHByb3BlcnR5IGRlY29yYXRvciBvYmplY3RzIGFyZSBtZXJnZWQgYXMgaXQgaXMgcG9zc2libGUgZGlmZmVyZW50IGZpZWxkcyBoYXZlXG4gICAgICAgICAgICAgLy8gZGlmZmVyZW50IGRlY29yYXRvciB0eXBlcy4gRGVjb3JhdG9ycyBvbiBpbmRpdmlkdWFsIGZpZWxkcyBhcmUgbm90IG1lcmdlZCwgYXMgaXQnc1xuICAgICAgICAgICAgIC8vIGFsc28gaW5jcmVkaWJseSB1bmxpa2VseSB0aGF0IGEgZmllbGQgd2lsbCBiZSBkZWNvcmF0ZWQgYm90aCB3aXRoIGFuIEFuZ3VsYXJcbiAgICAgICAgICAgICAvLyBkZWNvcmF0b3IgYW5kIGEgbm9uLUFuZ3VsYXIgZGVjb3JhdG9yIHRoYXQncyBhbHNvIGJlZW4gZG93bmxldmVsZWQuXG4gICAgICAgICAgICAgaWYgKGNsYXp6Lmhhc093blByb3BlcnR5KCdwcm9wRGVjb3JhdG9ycycpICYmIGNsYXp6LnByb3BEZWNvcmF0b3JzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgIGNsYXp6LnByb3BEZWNvcmF0b3JzID0gey4uLmNsYXp6LnByb3BEZWNvcmF0b3JzLCAuLi5wcm9wRGVjb3JhdG9yc307XG4gICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgIGNsYXp6LnByb3BEZWNvcmF0b3JzID0gcHJvcERlY29yYXRvcnM7XG4gICAgICAgICAgICAgfVxuICAgICAgICAgICB9XG4gICAgICAgICB9KSBhcyBuZXZlcjtcbn1cbiJdfQ==