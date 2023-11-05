/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { resolveForwardRef } from '../../di';
import { RuntimeError } from '../../errors';
import { flatten } from '../../util/array_utils';
import { getComponentDef, getNgModuleDef, isStandalone } from '../definition';
import { isComponent, isDirective, isNgModule, isPipe, verifyStandaloneImport } from '../jit/util';
import { maybeUnwrapFn } from '../util/misc_utils';
/**
 * Indicates whether to use the runtime dependency tracker for scope calculation in JIT compilation.
 * The value "false" means the old code path based on patching scope info into the types will be
 * used.
 *
 * @deprecated For migration purposes only, to be removed soon.
 */
export const USE_RUNTIME_DEPS_TRACKER_FOR_JIT = true;
/**
 * An implementation of DepsTrackerApi which will be used for JIT and local compilation.
 */
class DepsTracker {
    constructor() {
        this.ownerNgModule = new Map();
        this.ngModulesWithSomeUnresolvedDecls = new Set();
        this.ngModulesScopeCache = new Map();
        this.standaloneComponentsScopeCache = new Map();
    }
    /**
     * Attempts to resolve ng module's forward ref declarations as much as possible and add them to
     * the `ownerNgModule` map. This method normally should be called after the initial parsing when
     * all the forward refs are resolved (e.g., when trying to render a component)
     */
    resolveNgModulesDecls() {
        if (this.ngModulesWithSomeUnresolvedDecls.size === 0) {
            return;
        }
        for (const moduleType of this.ngModulesWithSomeUnresolvedDecls) {
            const def = getNgModuleDef(moduleType);
            if (def?.declarations) {
                for (const decl of maybeUnwrapFn(def.declarations)) {
                    if (isComponent(decl)) {
                        this.ownerNgModule.set(decl, moduleType);
                    }
                }
            }
        }
        this.ngModulesWithSomeUnresolvedDecls.clear();
    }
    /** @override */
    getComponentDependencies(type, rawImports) {
        this.resolveNgModulesDecls();
        const def = getComponentDef(type);
        if (def === null) {
            throw new Error(`Attempting to get component dependencies for a type that is not a component: ${type}`);
        }
        if (def.standalone) {
            const scope = this.getStandaloneComponentScope(type, rawImports);
            if (scope.compilation.isPoisoned) {
                return { dependencies: [] };
            }
            return {
                dependencies: [
                    ...scope.compilation.directives,
                    ...scope.compilation.pipes,
                    ...scope.compilation.ngModules,
                ]
            };
        }
        else {
            if (!this.ownerNgModule.has(type)) {
                // This component is orphan! No need to handle the error since the component rendering
                // pipeline (e.g., view_container_ref) will check for this error based on configs.
                return { dependencies: [] };
            }
            const scope = this.getNgModuleScope(this.ownerNgModule.get(type));
            if (scope.compilation.isPoisoned) {
                return { dependencies: [] };
            }
            return {
                dependencies: [
                    ...scope.compilation.directives,
                    ...scope.compilation.pipes,
                ],
            };
        }
    }
    /**
     * @override
     * This implementation does not make use of param scopeInfo since it assumes the scope info is
     * already added to the type itself through methods like {@link ɵɵsetNgModuleScope}
     */
    registerNgModule(type, scopeInfo) {
        if (!isNgModule(type)) {
            throw new Error(`Attempting to register a Type which is not NgModule as NgModule: ${type}`);
        }
        // Lazily process the NgModules later when needed.
        this.ngModulesWithSomeUnresolvedDecls.add(type);
    }
    /** @override */
    clearScopeCacheFor(type) {
        this.ngModulesScopeCache.delete(type);
        this.standaloneComponentsScopeCache.delete(type);
    }
    /** @override */
    getNgModuleScope(type) {
        if (this.ngModulesScopeCache.has(type)) {
            return this.ngModulesScopeCache.get(type);
        }
        const scope = this.computeNgModuleScope(type);
        this.ngModulesScopeCache.set(type, scope);
        return scope;
    }
    /** Compute NgModule scope afresh. */
    computeNgModuleScope(type) {
        const def = getNgModuleDef(type, true);
        const scope = {
            exported: { directives: new Set(), pipes: new Set() },
            compilation: { directives: new Set(), pipes: new Set() },
        };
        // Analyzing imports
        for (const imported of maybeUnwrapFn(def.imports)) {
            if (isNgModule(imported)) {
                const importedScope = this.getNgModuleScope(imported);
                // When this module imports another, the imported module's exported directives and pipes
                // are added to the compilation scope of this module.
                addSet(importedScope.exported.directives, scope.compilation.directives);
                addSet(importedScope.exported.pipes, scope.compilation.pipes);
            }
            else if (isStandalone(imported)) {
                if (isDirective(imported) || isComponent(imported)) {
                    scope.compilation.directives.add(imported);
                }
                else if (isPipe(imported)) {
                    scope.compilation.pipes.add(imported);
                }
                else {
                    // The standalone thing is neither a component nor a directive nor a pipe ... (what?)
                    throw new RuntimeError(1000 /* RuntimeErrorCode.RUNTIME_DEPS_INVALID_IMPORTED_TYPE */, 'The standalone imported type is neither a component nor a directive nor a pipe');
                }
            }
            else {
                // The import is neither a module nor a module-with-providers nor a standalone thing. This
                // is going to be an error. So we short circuit.
                scope.compilation.isPoisoned = true;
                break;
            }
        }
        // Analyzing declarations
        if (!scope.compilation.isPoisoned) {
            for (const decl of maybeUnwrapFn(def.declarations)) {
                // Cannot declare another NgModule or a standalone thing
                if (isNgModule(decl) || isStandalone(decl)) {
                    scope.compilation.isPoisoned = true;
                    break;
                }
                if (isPipe(decl)) {
                    scope.compilation.pipes.add(decl);
                }
                else {
                    // decl is either a directive or a component. The component may not yet have the ɵcmp due
                    // to async compilation.
                    scope.compilation.directives.add(decl);
                }
            }
        }
        // Analyzing exports
        for (const exported of maybeUnwrapFn(def.exports)) {
            if (isNgModule(exported)) {
                // When this module exports another, the exported module's exported directives and pipes
                // are added to both the compilation and exported scopes of this module.
                const exportedScope = this.getNgModuleScope(exported);
                // Based on the current logic there is no way to have poisoned exported scope. So no need to
                // check for it.
                addSet(exportedScope.exported.directives, scope.exported.directives);
                addSet(exportedScope.exported.pipes, scope.exported.pipes);
                // Some test toolings which run in JIT mode depend on this behavior that the exported scope
                // should also be present in the compilation scope, even though AoT does not support this
                // and it is also in odds with NgModule metadata definitions. Without this some tests in
                // Google will fail.
                addSet(exportedScope.exported.directives, scope.compilation.directives);
                addSet(exportedScope.exported.pipes, scope.compilation.pipes);
            }
            else if (isPipe(exported)) {
                scope.exported.pipes.add(exported);
            }
            else {
                scope.exported.directives.add(exported);
            }
        }
        return scope;
    }
    /** @override */
    getStandaloneComponentScope(type, rawImports) {
        if (this.standaloneComponentsScopeCache.has(type)) {
            return this.standaloneComponentsScopeCache.get(type);
        }
        const ans = this.computeStandaloneComponentScope(type, rawImports);
        this.standaloneComponentsScopeCache.set(type, ans);
        return ans;
    }
    computeStandaloneComponentScope(type, rawImports) {
        const ans = {
            compilation: {
                // Standalone components are always able to self-reference.
                directives: new Set([type]),
                pipes: new Set(),
                ngModules: new Set(),
            },
        };
        for (const rawImport of flatten(rawImports ?? [])) {
            const imported = resolveForwardRef(rawImport);
            try {
                verifyStandaloneImport(imported, type);
            }
            catch (e) {
                // Short-circuit if an import is not valid
                ans.compilation.isPoisoned = true;
                return ans;
            }
            if (isNgModule(imported)) {
                ans.compilation.ngModules.add(imported);
                const importedScope = this.getNgModuleScope(imported);
                // Short-circuit if an imported NgModule has corrupted exported scope.
                if (importedScope.exported.isPoisoned) {
                    ans.compilation.isPoisoned = true;
                    return ans;
                }
                addSet(importedScope.exported.directives, ans.compilation.directives);
                addSet(importedScope.exported.pipes, ans.compilation.pipes);
            }
            else if (isPipe(imported)) {
                ans.compilation.pipes.add(imported);
            }
            else if (isDirective(imported) || isComponent(imported)) {
                ans.compilation.directives.add(imported);
            }
            else {
                // The imported thing is not module/pipe/directive/component, so we error and short-circuit
                // here
                ans.compilation.isPoisoned = true;
                return ans;
            }
        }
        return ans;
    }
    /** @override */
    isOrphanComponent(cmp) {
        const def = getComponentDef(cmp);
        if (!def || def.standalone) {
            return false;
        }
        this.resolveNgModulesDecls();
        return !this.ownerNgModule.has(cmp);
    }
}
function addSet(sourceSet, targetSet) {
    for (const m of sourceSet) {
        targetSet.add(m);
    }
}
/** The deps tracker to be used in the current Angular app in dev mode. */
export const depsTracker = new DepsTracker();
export const TEST_ONLY = { DepsTracker };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwc190cmFja2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvY29yZS9zcmMvcmVuZGVyMy9kZXBzX3RyYWNrZXIvZGVwc190cmFja2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLFVBQVUsQ0FBQztBQUMzQyxPQUFPLEVBQUMsWUFBWSxFQUFtQixNQUFNLGNBQWMsQ0FBQztBQUc1RCxPQUFPLEVBQUMsT0FBTyxFQUFDLE1BQU0sd0JBQXdCLENBQUM7QUFDL0MsT0FBTyxFQUFDLGVBQWUsRUFBRSxjQUFjLEVBQUUsWUFBWSxFQUFDLE1BQU0sZUFBZSxDQUFDO0FBRTVFLE9BQU8sRUFBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsc0JBQXNCLEVBQUMsTUFBTSxhQUFhLENBQUM7QUFDakcsT0FBTyxFQUFDLGFBQWEsRUFBQyxNQUFNLG9CQUFvQixDQUFDO0FBSWpEOzs7Ozs7R0FNRztBQUNILE1BQU0sQ0FBQyxNQUFNLGdDQUFnQyxHQUFHLElBQUksQ0FBQztBQUVyRDs7R0FFRztBQUNILE1BQU0sV0FBVztJQUFqQjtRQUNVLGtCQUFhLEdBQUcsSUFBSSxHQUFHLEVBQXlDLENBQUM7UUFDakUscUNBQWdDLEdBQUcsSUFBSSxHQUFHLEVBQXFCLENBQUM7UUFDaEUsd0JBQW1CLEdBQUcsSUFBSSxHQUFHLEVBQW9DLENBQUM7UUFDbEUsbUNBQThCLEdBQUcsSUFBSSxHQUFHLEVBQWdELENBQUM7SUF1UW5HLENBQUM7SUFyUUM7Ozs7T0FJRztJQUNLLHFCQUFxQjtRQUMzQixJQUFJLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFO1lBQ3BELE9BQU87U0FDUjtRQUVELEtBQUssTUFBTSxVQUFVLElBQUksSUFBSSxDQUFDLGdDQUFnQyxFQUFFO1lB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LEdBQXlCLENBQUMsQ0FBQztJQUM1RCxDQUFDO0NBQ0Y7QUFFRCxTQUFTLE1BQU0sQ0FBSSxTQUFpQixFQUFFLFNBQWlCO0lBQ3JELEtBQUssTUFBTSxDQUFDLElBQUksU0FBUyxFQUFFO1FBQ3pCLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7S0FDbEI7QUFDSCxDQUFDO0FBRUQsMEVBQTBFO0FBQzFFLE1BQU0sQ0FBQyxNQUFNLFdBQVcsR0FBRyxJQUFJLFdBQVcsRUFBRSxDQUFDO0FBRTdDLE1BQU0sQ0FBQyxNQUFNLFNBQVMsR0FBRyxFQUFDLFdBQVcsRUFBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB7cmVzb2x2ZUZvcndhcmRSZWZ9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7UnVudGltZUVycm9yLCBSdW50aW1lRXJyb3JDb2RlfSBmcm9tICcuLi8uLi9lcnJvcnMnO1xuaW1wb3J0IHtUeXBlfSBmcm9tICcuLi8uLi9pbnRlcmZhY2UvdHlwZSc7XG5pbXBvcnQge05nTW9kdWxlVHlwZX0gZnJvbSAnLi4vLi4vbWV0YWRhdGEvbmdfbW9kdWxlX2RlZic7XG5pbXBvcnQge2ZsYXR0ZW59IGZyb20gJy4uLy4uL3V0aWwvYXJyYXlfdXRpbHMnO1xuaW1wb3J0IHtnZXRDb21wb25lbnREZWYsIGdldE5nTW9kdWxlRGVmLCBpc1N0YW5kYWxvbmV9IGZyb20gJy4uL2RlZmluaXRpb24nO1xuaW1wb3J0IHtDb21wb25lbnRUeXBlLCBOZ01vZHVsZVNjb3BlSW5mb0Zyb21EZWNvcmF0b3IsIFJhd1Njb3BlSW5mb0Zyb21EZWNvcmF0b3J9IGZyb20gJy4uL2ludGVyZmFjZXMvZGVmaW5pdGlvbic7XG5pbXBvcnQge2lzQ29tcG9uZW50LCBpc0RpcmVjdGl2ZSwgaXNOZ01vZHVsZSwgaXNQaXBlLCB2ZXJpZnlTdGFuZGFsb25lSW1wb3J0fSBmcm9tICcuLi9qaXQvdXRpbCc7XG5pbXBvcnQge21heWJlVW53cmFwRm59IGZyb20gJy4uL3V0aWwvbWlzY191dGlscyc7XG5cbmltcG9ydCB7Q29tcG9uZW50RGVwZW5kZW5jaWVzLCBEZXBzVHJhY2tlckFwaSwgTmdNb2R1bGVTY29wZSwgU3RhbmRhbG9uZUNvbXBvbmVudFNjb3BlfSBmcm9tICcuL2FwaSc7XG5cbi8qKlxuICogSW5kaWNhdGVzIHdoZXRoZXIgdG8gdXNlIHRoZSBydW50aW1lIGRlcGVuZGVuY3kgdHJhY2tlciBmb3Igc2NvcGUgY2FsY3VsYXRpb24gaW4gSklUIGNvbXBpbGF0aW9uLlxuICogVGhlIHZhbHVlIFwiZmFsc2VcIiBtZWFucyB0aGUgb2xkIGNvZGUgcGF0aCBiYXNlZCBvbiBwYXRjaGluZyBzY29wZSBpbmZvIGludG8gdGhlIHR5cGVzIHdpbGwgYmVcbiAqIHVzZWQuXG4gKlxuICogQGRlcHJlY2F0ZWQgRm9yIG1pZ3JhdGlvbiBwdXJwb3NlcyBvbmx5LCB0byBiZSByZW1vdmVkIHNvb24uXG4gKi9cbmV4cG9ydCBjb25zdCBVU0VfUlVOVElNRV9ERVBTX1RSQUNLRVJfRk9SX0pJVCA9IHRydWU7XG5cbi8qKlxuICogQW4gaW1wbGVtZW50YXRpb24gb2YgRGVwc1RyYWNrZXJBcGkgd2hpY2ggd2lsbCBiZSB1c2VkIGZvciBKSVQgYW5kIGxvY2FsIGNvbXBpbGF0aW9uLlxuICovXG5jbGFzcyBEZXBzVHJhY2tlciBpbXBsZW1lbnRzIERlcHNUcmFja2VyQXBpIHtcbiAgcHJpdmF0ZSBvd25lck5nTW9kdWxlID0gbmV3IE1hcDxDb21wb25lbnRUeXBlPGFueT4sIE5nTW9kdWxlVHlwZTxhbnk+PigpO1xuICBwcml2YXRlIG5nTW9kdWxlc1dpdGhTb21lVW5yZXNvbHZlZERlY2xzID0gbmV3IFNldDxOZ01vZHVsZVR5cGU8YW55Pj4oKTtcbiAgcHJpdmF0ZSBuZ01vZHVsZXNTY29wZUNhY2hlID0gbmV3IE1hcDxOZ01vZHVsZVR5cGU8YW55PiwgTmdNb2R1bGVTY29wZT4oKTtcbiAgcHJpdmF0ZSBzdGFuZGFsb25lQ29tcG9uZW50c1Njb3BlQ2FjaGUgPSBuZXcgTWFwPENvbXBvbmVudFR5cGU8YW55PiwgU3RhbmRhbG9uZUNvbXBvbmVudFNjb3BlPigpO1xuXG4gIC8qKlxuICAgKiBBdHRlbXB0cyB0byByZXNvbHZlIG5nIG1vZHVsZSdzIGZvcndhcmQgcmVmIGRlY2xhcmF0aW9ucyBhcyBtdWNoIGFzIHBvc3NpYmxlIGFuZCBhZGQgdGhlbSB0b1xuICAgKiB0aGUgYG93bmVyTmdNb2R1bGVgIG1hcC4gVGhpcyBtZXRob2Qgbm9ybWFsbHkgc2hvdWxkIGJlIGNhbGxlZCBhZnRlciB0aGUgaW5pdGlhbCBwYXJzaW5nIHdoZW5cbiAgICogYWxsIHRoZSBmb3J3YXJkIHJlZnMgYXJlIHJlc29sdmVkIChlLmcuLCB3aGVuIHRyeWluZyB0byByZW5kZXIgYSBjb21wb25lbnQpXG4gICAqL1xuICBwcml2YXRlIHJlc29sdmVOZ01vZHVsZXNEZWNscygpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5uZ01vZHVsZXNXaXRoU29tZVVucmVzb2x2ZWREZWNscy5zaXplID09PSAwKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBtb2R1bGVUeXBlIG9mIHRoaXMubmdNb2R1bGVzV2l0aFNvbWVVbnJlc29sdmVkRGVjbHMpIHtcbiAgICAgIGNvbnN0IGRlZiA9IGdldE5nTW9kdWxlRGVmKG1vZHVsZVR5cGUpO1xuICAgICAgaWYgKGRlZj8uZGVjbGFyYXRpb25zKSB7XG4gICAgICAgIGZvciAoY29uc3QgZGVjbCBvZiBtYXliZVVud3JhcEZuKGRlZi5kZWNsYXJhdGlvbnMpKSB7XG4gICAgICAgICAgaWYgKGlzQ29tcG9uZW50KGRlY2wpKSB7XG4gICAgICAgICAgICB0aGlzLm93bmVyTmdNb2R1bGUuc2V0KGRlY2wsIG1vZHVsZVR5cGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMubmdNb2R1bGVzV2l0aFNvbWVVbnJlc29sdmVkRGVjbHMuY2xlYXIoKTtcbiAgfVxuXG4gIC8qKiBAb3ZlcnJpZGUgKi9cbiAgZ2V0Q29tcG9uZW50RGVwZW5kZW5jaWVzKHR5cGU6IENvbXBvbmVudFR5cGU8YW55PiwgcmF3SW1wb3J0cz86IFJhd1Njb3BlSW5mb0Zyb21EZWNvcmF0b3JbXSk6XG4gICAgICBDb21wb25lbnREZXBlbmRlbmNpZXMge1xuICAgIHRoaXMucmVzb2x2ZU5nTW9kdWxlc0RlY2xzKCk7XG5cbiAgICBjb25zdCBkZWYgPSBnZXRDb21wb25lbnREZWYodHlwZSk7XG4gICAgaWYgKGRlZiA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBBdHRlbXB0aW5nIHRvIGdldCBjb21wb25lbnQgZGVwZW5kZW5jaWVzIGZvciBhIHR5cGUgdGhhdCBpcyBub3QgYSBjb21wb25lbnQ6ICR7dHlwZX1gKTtcbiAgICB9XG5cbiAgICBpZiAoZGVmLnN0YW5kYWxvbmUpIHtcbiAgICAgIGNvbnN0IHNjb3BlID0gdGhpcy5nZXRTdGFuZGFsb25lQ29tcG9uZW50U2NvcGUodHlwZSwgcmF3SW1wb3J0cyk7XG5cbiAgICAgIGlmIChzY29wZS5jb21waWxhdGlvbi5pc1BvaXNvbmVkKSB7XG4gICAgICAgIHJldHVybiB7ZGVwZW5kZW5jaWVzOiBbXX07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGRlcGVuZGVuY2llczogW1xuICAgICAgICAgIC4uLnNjb3BlLmNvbXBpbGF0aW9uLmRpcmVjdGl2ZXMsXG4gICAgICAgICAgLi4uc2NvcGUuY29tcGlsYXRpb24ucGlwZXMsXG4gICAgICAgICAgLi4uc2NvcGUuY29tcGlsYXRpb24ubmdNb2R1bGVzLFxuICAgICAgICBdXG4gICAgICB9O1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIXRoaXMub3duZXJOZ01vZHVsZS5oYXModHlwZSkpIHtcbiAgICAgICAgLy8gVGhpcyBjb21wb25lbnQgaXMgb3JwaGFuISBObyBuZWVkIHRvIGhhbmRsZSB0aGUgZXJyb3Igc2luY2UgdGhlIGNvbXBvbmVudCByZW5kZXJpbmdcbiAgICAgICAgLy8gcGlwZWxpbmUgKGUuZy4sIHZpZXdfY29udGFpbmVyX3JlZikgd2lsbCBjaGVjayBmb3IgdGhpcyBlcnJvciBiYXNlZCBvbiBjb25maWdzLlxuICAgICAgICByZXR1cm4ge2RlcGVuZGVuY2llczogW119O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzY29wZSA9IHRoaXMuZ2V0TmdNb2R1bGVTY29wZSh0aGlzLm93bmVyTmdNb2R1bGUuZ2V0KHR5cGUpISk7XG5cbiAgICAgIGlmIChzY29wZS5jb21waWxhdGlvbi5pc1BvaXNvbmVkKSB7XG4gICAgICAgIHJldHVybiB7ZGVwZW5kZW5jaWVzOiBbXX07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGRlcGVuZGVuY2llczogW1xuICAgICAgICAgIC4uLnNjb3BlLmNvbXBpbGF0aW9uLmRpcmVjdGl2ZXMsXG4gICAgICAgICAgLi4uc2NvcGUuY29tcGlsYXRpb24ucGlwZXMsXG4gICAgICAgIF0sXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAb3ZlcnJpZGVcbiAgICogVGhpcyBpbXBsZW1lbnRhdGlvbiBkb2VzIG5vdCBtYWtlIHVzZSBvZiBwYXJhbSBzY29wZUluZm8gc2luY2UgaXQgYXNzdW1lcyB0aGUgc2NvcGUgaW5mbyBpc1xuICAgKiBhbHJlYWR5IGFkZGVkIHRvIHRoZSB0eXBlIGl0c2VsZiB0aHJvdWdoIG1ldGhvZHMgbGlrZSB7QGxpbmsgybXJtXNldE5nTW9kdWxlU2NvcGV9XG4gICAqL1xuICByZWdpc3Rlck5nTW9kdWxlKHR5cGU6IFR5cGU8YW55Piwgc2NvcGVJbmZvOiBOZ01vZHVsZVNjb3BlSW5mb0Zyb21EZWNvcmF0b3IpOiB2b2lkIHtcbiAgICBpZiAoIWlzTmdNb2R1bGUodHlwZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0ZW1wdGluZyB0byByZWdpc3RlciBhIFR5cGUgd2hpY2ggaXMgbm90IE5nTW9kdWxlIGFzIE5nTW9kdWxlOiAke3R5cGV9YCk7XG4gICAgfVxuXG4gICAgLy8gTGF6aWx5IHByb2Nlc3MgdGhlIE5nTW9kdWxlcyBsYXRlciB3aGVuIG5lZWRlZC5cbiAgICB0aGlzLm5nTW9kdWxlc1dpdGhTb21lVW5yZXNvbHZlZERlY2xzLmFkZCh0eXBlKTtcbiAgfVxuXG4gIC8qKiBAb3ZlcnJpZGUgKi9cbiAgY2xlYXJTY29wZUNhY2hlRm9yKHR5cGU6IFR5cGU8YW55Pik6IHZvaWQge1xuICAgIHRoaXMubmdNb2R1bGVzU2NvcGVDYWNoZS5kZWxldGUodHlwZSBhcyBOZ01vZHVsZVR5cGUpO1xuICAgIHRoaXMuc3RhbmRhbG9uZUNvbXBvbmVudHNTY29wZUNhY2hlLmRlbGV0ZSh0eXBlIGFzIENvbXBvbmVudFR5cGU8YW55Pik7XG4gIH1cblxuICAvKiogQG92ZXJyaWRlICovXG4gIGdldE5nTW9kdWxlU2NvcGUodHlwZTogTmdNb2R1bGVUeXBlPGFueT4pOiBOZ01vZHVsZVNjb3BlIHtcbiAgICBpZiAodGhpcy5uZ01vZHVsZXNTY29wZUNhY2hlLmhhcyh0eXBlKSkge1xuICAgICAgcmV0dXJuIHRoaXMubmdNb2R1bGVzU2NvcGVDYWNoZS5nZXQodHlwZSkhO1xuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlID0gdGhpcy5jb21wdXRlTmdNb2R1bGVTY29wZSh0eXBlKTtcbiAgICB0aGlzLm5nTW9kdWxlc1Njb3BlQ2FjaGUuc2V0KHR5cGUsIHNjb3BlKTtcblxuICAgIHJldHVybiBzY29wZTtcbiAgfVxuXG4gIC8qKiBDb21wdXRlIE5nTW9kdWxlIHNjb3BlIGFmcmVzaC4gKi9cbiAgcHJpdmF0ZSBjb21wdXRlTmdNb2R1bGVTY29wZSh0eXBlOiBOZ01vZHVsZVR5cGU8YW55Pik6IE5nTW9kdWxlU2NvcGUge1xuICAgIGNvbnN0IGRlZiA9IGdldE5nTW9kdWxlRGVmKHR5cGUsIHRydWUpO1xuICAgIGNvbnN0IHNjb3BlOiBOZ01vZHVsZVNjb3BlID0ge1xuICAgICAgZXhwb3J0ZWQ6IHtkaXJlY3RpdmVzOiBuZXcgU2V0KCksIHBpcGVzOiBuZXcgU2V0KCl9LFxuICAgICAgY29tcGlsYXRpb246IHtkaXJlY3RpdmVzOiBuZXcgU2V0KCksIHBpcGVzOiBuZXcgU2V0KCl9LFxuICAgIH07XG5cbiAgICAvLyBBbmFseXppbmcgaW1wb3J0c1xuICAgIGZvciAoY29uc3QgaW1wb3J0ZWQgb2YgbWF5YmVVbndyYXBGbihkZWYuaW1wb3J0cykpIHtcbiAgICAgIGlmIChpc05nTW9kdWxlKGltcG9ydGVkKSkge1xuICAgICAgICBjb25zdCBpbXBvcnRlZFNjb3BlID0gdGhpcy5nZXROZ01vZHVsZVNjb3BlKGltcG9ydGVkKTtcblxuICAgICAgICAvLyBXaGVuIHRoaXMgbW9kdWxlIGltcG9ydHMgYW5vdGhlciwgdGhlIGltcG9ydGVkIG1vZHVsZSdzIGV4cG9ydGVkIGRpcmVjdGl2ZXMgYW5kIHBpcGVzXG4gICAgICAgIC8vIGFyZSBhZGRlZCB0byB0aGUgY29tcGlsYXRpb24gc2NvcGUgb2YgdGhpcyBtb2R1bGUuXG4gICAgICAgIGFkZFNldChpbXBvcnRlZFNjb3BlLmV4cG9ydGVkLmRpcmVjdGl2ZXMsIHNjb3BlLmNvbXBpbGF0aW9uLmRpcmVjdGl2ZXMpO1xuICAgICAgICBhZGRTZXQoaW1wb3J0ZWRTY29wZS5leHBvcnRlZC5waXBlcywgc2NvcGUuY29tcGlsYXRpb24ucGlwZXMpO1xuICAgICAgfSBlbHNlIGlmIChpc1N0YW5kYWxvbmUoaW1wb3J0ZWQpKSB7XG4gICAgICAgIGlmIChpc0RpcmVjdGl2ZShpbXBvcnRlZCkgfHwgaXNDb21wb25lbnQoaW1wb3J0ZWQpKSB7XG4gICAgICAgICAgc2NvcGUuY29tcGlsYXRpb24uZGlyZWN0aXZlcy5hZGQoaW1wb3J0ZWQpO1xuICAgICAgICB9IGVsc2UgaWYgKGlzUGlwZShpbXBvcnRlZCkpIHtcbiAgICAgICAgICBzY29wZS5jb21waWxhdGlvbi5waXBlcy5hZGQoaW1wb3J0ZWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFRoZSBzdGFuZGFsb25lIHRoaW5nIGlzIG5laXRoZXIgYSBjb21wb25lbnQgbm9yIGEgZGlyZWN0aXZlIG5vciBhIHBpcGUgLi4uICh3aGF0PylcbiAgICAgICAgICB0aHJvdyBuZXcgUnVudGltZUVycm9yKFxuICAgICAgICAgICAgICBSdW50aW1lRXJyb3JDb2RlLlJVTlRJTUVfREVQU19JTlZBTElEX0lNUE9SVEVEX1RZUEUsXG4gICAgICAgICAgICAgICdUaGUgc3RhbmRhbG9uZSBpbXBvcnRlZCB0eXBlIGlzIG5laXRoZXIgYSBjb21wb25lbnQgbm9yIGEgZGlyZWN0aXZlIG5vciBhIHBpcGUnKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGhlIGltcG9ydCBpcyBuZWl0aGVyIGEgbW9kdWxlIG5vciBhIG1vZHVsZS13aXRoLXByb3ZpZGVycyBub3IgYSBzdGFuZGFsb25lIHRoaW5nLiBUaGlzXG4gICAgICAgIC8vIGlzIGdvaW5nIHRvIGJlIGFuIGVycm9yLiBTbyB3ZSBzaG9ydCBjaXJjdWl0LlxuICAgICAgICBzY29wZS5jb21waWxhdGlvbi5pc1BvaXNvbmVkID0gdHJ1ZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQW5hbHl6aW5nIGRlY2xhcmF0aW9uc1xuICAgIGlmICghc2NvcGUuY29tcGlsYXRpb24uaXNQb2lzb25lZCkge1xuICAgICAgZm9yIChjb25zdCBkZWNsIG9mIG1heWJlVW53cmFwRm4oZGVmLmRlY2xhcmF0aW9ucykpIHtcbiAgICAgICAgLy8gQ2Fubm90IGRlY2xhcmUgYW5vdGhlciBOZ01vZHVsZSBvciBhIHN0YW5kYWxvbmUgdGhpbmdcbiAgICAgICAgaWYgKGlzTmdNb2R1bGUoZGVjbCkgfHwgaXNTdGFuZGFsb25lKGRlY2wpKSB7XG4gICAgICAgICAgc2NvcGUuY29tcGlsYXRpb24uaXNQb2lzb25lZCA9IHRydWU7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNQaXBlKGRlY2wpKSB7XG4gICAgICAgICAgc2NvcGUuY29tcGlsYXRpb24ucGlwZXMuYWRkKGRlY2wpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGRlY2wgaXMgZWl0aGVyIGEgZGlyZWN0aXZlIG9yIGEgY29tcG9uZW50LiBUaGUgY29tcG9uZW50IG1heSBub3QgeWV0IGhhdmUgdGhlIMm1Y21wIGR1ZVxuICAgICAgICAgIC8vIHRvIGFzeW5jIGNvbXBpbGF0aW9uLlxuICAgICAgICAgIHNjb3BlLmNvbXBpbGF0aW9uLmRpcmVjdGl2ZXMuYWRkKGRlY2wpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQW5hbHl6aW5nIGV4cG9ydHNcbiAgICBmb3IgKGNvbnN0IGV4cG9ydGVkIG9mIG1heWJlVW53cmFwRm4oZGVmLmV4cG9ydHMpKSB7XG4gICAgICBpZiAoaXNOZ01vZHVsZShleHBvcnRlZCkpIHtcbiAgICAgICAgLy8gV2hlbiB0aGlzIG1vZHVsZSBleHBvcnRzIGFub3RoZXIsIHRoZSBleHBvcnRlZCBtb2R1bGUncyBleHBvcnRlZCBkaXJlY3RpdmVzIGFuZCBwaXBlc1xuICAgICAgICAvLyBhcmUgYWRkZWQgdG8gYm90aCB0aGUgY29tcGlsYXRpb24gYW5kIGV4cG9ydGVkIHNjb3BlcyBvZiB0aGlzIG1vZHVsZS5cbiAgICAgICAgY29uc3QgZXhwb3J0ZWRTY29wZSA9IHRoaXMuZ2V0TmdNb2R1bGVTY29wZShleHBvcnRlZCk7XG5cbiAgICAgICAgLy8gQmFzZWQgb24gdGhlIGN1cnJlbnQgbG9naWMgdGhlcmUgaXMgbm8gd2F5IHRvIGhhdmUgcG9pc29uZWQgZXhwb3J0ZWQgc2NvcGUuIFNvIG5vIG5lZWQgdG9cbiAgICAgICAgLy8gY2hlY2sgZm9yIGl0LlxuICAgICAgICBhZGRTZXQoZXhwb3J0ZWRTY29wZS5leHBvcnRlZC5kaXJlY3RpdmVzLCBzY29wZS5leHBvcnRlZC5kaXJlY3RpdmVzKTtcbiAgICAgICAgYWRkU2V0KGV4cG9ydGVkU2NvcGUuZXhwb3J0ZWQucGlwZXMsIHNjb3BlLmV4cG9ydGVkLnBpcGVzKTtcblxuICAgICAgICAvLyBTb21lIHRlc3QgdG9vbGluZ3Mgd2hpY2ggcnVuIGluIEpJVCBtb2RlIGRlcGVuZCBvbiB0aGlzIGJlaGF2aW9yIHRoYXQgdGhlIGV4cG9ydGVkIHNjb3BlXG4gICAgICAgIC8vIHNob3VsZCBhbHNvIGJlIHByZXNlbnQgaW4gdGhlIGNvbXBpbGF0aW9uIHNjb3BlLCBldmVuIHRob3VnaCBBb1QgZG9lcyBub3Qgc3VwcG9ydCB0aGlzXG4gICAgICAgIC8vIGFuZCBpdCBpcyBhbHNvIGluIG9kZHMgd2l0aCBOZ01vZHVsZSBtZXRhZGF0YSBkZWZpbml0aW9ucy4gV2l0aG91dCB0aGlzIHNvbWUgdGVzdHMgaW5cbiAgICAgICAgLy8gR29vZ2xlIHdpbGwgZmFpbC5cbiAgICAgICAgYWRkU2V0KGV4cG9ydGVkU2NvcGUuZXhwb3J0ZWQuZGlyZWN0aXZlcywgc2NvcGUuY29tcGlsYXRpb24uZGlyZWN0aXZlcyk7XG4gICAgICAgIGFkZFNldChleHBvcnRlZFNjb3BlLmV4cG9ydGVkLnBpcGVzLCBzY29wZS5jb21waWxhdGlvbi5waXBlcyk7XG4gICAgICB9IGVsc2UgaWYgKGlzUGlwZShleHBvcnRlZCkpIHtcbiAgICAgICAgc2NvcGUuZXhwb3J0ZWQucGlwZXMuYWRkKGV4cG9ydGVkKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNjb3BlLmV4cG9ydGVkLmRpcmVjdGl2ZXMuYWRkKGV4cG9ydGVkKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2NvcGU7XG4gIH1cblxuICAvKiogQG92ZXJyaWRlICovXG4gIGdldFN0YW5kYWxvbmVDb21wb25lbnRTY29wZSh0eXBlOiBDb21wb25lbnRUeXBlPGFueT4sIHJhd0ltcG9ydHM/OiBSYXdTY29wZUluZm9Gcm9tRGVjb3JhdG9yW10pOlxuICAgICAgU3RhbmRhbG9uZUNvbXBvbmVudFNjb3BlIHtcbiAgICBpZiAodGhpcy5zdGFuZGFsb25lQ29tcG9uZW50c1Njb3BlQ2FjaGUuaGFzKHR5cGUpKSB7XG4gICAgICByZXR1cm4gdGhpcy5zdGFuZGFsb25lQ29tcG9uZW50c1Njb3BlQ2FjaGUuZ2V0KHR5cGUpITtcbiAgICB9XG5cbiAgICBjb25zdCBhbnMgPSB0aGlzLmNvbXB1dGVTdGFuZGFsb25lQ29tcG9uZW50U2NvcGUodHlwZSwgcmF3SW1wb3J0cyk7XG4gICAgdGhpcy5zdGFuZGFsb25lQ29tcG9uZW50c1Njb3BlQ2FjaGUuc2V0KHR5cGUsIGFucyk7XG5cbiAgICByZXR1cm4gYW5zO1xuICB9XG5cbiAgcHJpdmF0ZSBjb21wdXRlU3RhbmRhbG9uZUNvbXBvbmVudFNjb3BlKFxuICAgICAgdHlwZTogQ29tcG9uZW50VHlwZTxhbnk+LFxuICAgICAgcmF3SW1wb3J0cz86IFJhd1Njb3BlSW5mb0Zyb21EZWNvcmF0b3JbXSk6IFN0YW5kYWxvbmVDb21wb25lbnRTY29wZSB7XG4gICAgY29uc3QgYW5zOiBTdGFuZGFsb25lQ29tcG9uZW50U2NvcGUgPSB7XG4gICAgICBjb21waWxhdGlvbjoge1xuICAgICAgICAvLyBTdGFuZGFsb25lIGNvbXBvbmVudHMgYXJlIGFsd2F5cyBhYmxlIHRvIHNlbGYtcmVmZXJlbmNlLlxuICAgICAgICBkaXJlY3RpdmVzOiBuZXcgU2V0KFt0eXBlXSksXG4gICAgICAgIHBpcGVzOiBuZXcgU2V0KCksXG4gICAgICAgIG5nTW9kdWxlczogbmV3IFNldCgpLFxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgZm9yIChjb25zdCByYXdJbXBvcnQgb2YgZmxhdHRlbihyYXdJbXBvcnRzID8/IFtdKSkge1xuICAgICAgY29uc3QgaW1wb3J0ZWQgPSByZXNvbHZlRm9yd2FyZFJlZihyYXdJbXBvcnQpIGFzIFR5cGU8YW55PjtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgdmVyaWZ5U3RhbmRhbG9uZUltcG9ydChpbXBvcnRlZCwgdHlwZSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIFNob3J0LWNpcmN1aXQgaWYgYW4gaW1wb3J0IGlzIG5vdCB2YWxpZFxuICAgICAgICBhbnMuY29tcGlsYXRpb24uaXNQb2lzb25lZCA9IHRydWU7XG4gICAgICAgIHJldHVybiBhbnM7XG4gICAgICB9XG5cbiAgICAgIGlmIChpc05nTW9kdWxlKGltcG9ydGVkKSkge1xuICAgICAgICBhbnMuY29tcGlsYXRpb24ubmdNb2R1bGVzLmFkZChpbXBvcnRlZCk7XG4gICAgICAgIGNvbnN0IGltcG9ydGVkU2NvcGUgPSB0aGlzLmdldE5nTW9kdWxlU2NvcGUoaW1wb3J0ZWQpO1xuXG4gICAgICAgIC8vIFNob3J0LWNpcmN1aXQgaWYgYW4gaW1wb3J0ZWQgTmdNb2R1bGUgaGFzIGNvcnJ1cHRlZCBleHBvcnRlZCBzY29wZS5cbiAgICAgICAgaWYgKGltcG9ydGVkU2NvcGUuZXhwb3J0ZWQuaXNQb2lzb25lZCkge1xuICAgICAgICAgIGFucy5jb21waWxhdGlvbi5pc1BvaXNvbmVkID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gYW5zO1xuICAgICAgICB9XG5cbiAgICAgICAgYWRkU2V0KGltcG9ydGVkU2NvcGUuZXhwb3J0ZWQuZGlyZWN0aXZlcywgYW5zLmNvbXBpbGF0aW9uLmRpcmVjdGl2ZXMpO1xuICAgICAgICBhZGRTZXQoaW1wb3J0ZWRTY29wZS5leHBvcnRlZC5waXBlcywgYW5zLmNvbXBpbGF0aW9uLnBpcGVzKTtcbiAgICAgIH0gZWxzZSBpZiAoaXNQaXBlKGltcG9ydGVkKSkge1xuICAgICAgICBhbnMuY29tcGlsYXRpb24ucGlwZXMuYWRkKGltcG9ydGVkKTtcbiAgICAgIH0gZWxzZSBpZiAoaXNEaXJlY3RpdmUoaW1wb3J0ZWQpIHx8IGlzQ29tcG9uZW50KGltcG9ydGVkKSkge1xuICAgICAgICBhbnMuY29tcGlsYXRpb24uZGlyZWN0aXZlcy5hZGQoaW1wb3J0ZWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGhlIGltcG9ydGVkIHRoaW5nIGlzIG5vdCBtb2R1bGUvcGlwZS9kaXJlY3RpdmUvY29tcG9uZW50LCBzbyB3ZSBlcnJvciBhbmQgc2hvcnQtY2lyY3VpdFxuICAgICAgICAvLyBoZXJlXG4gICAgICAgIGFucy5jb21waWxhdGlvbi5pc1BvaXNvbmVkID0gdHJ1ZTtcbiAgICAgICAgcmV0dXJuIGFucztcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYW5zO1xuICB9XG5cbiAgLyoqIEBvdmVycmlkZSAqL1xuICBpc09ycGhhbkNvbXBvbmVudChjbXA6IFR5cGU8YW55Pik6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGRlZiA9IGdldENvbXBvbmVudERlZihjbXApO1xuXG4gICAgaWYgKCFkZWYgfHwgZGVmLnN0YW5kYWxvbmUpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICB0aGlzLnJlc29sdmVOZ01vZHVsZXNEZWNscygpO1xuXG4gICAgcmV0dXJuICF0aGlzLm93bmVyTmdNb2R1bGUuaGFzKGNtcCBhcyBDb21wb25lbnRUeXBlPGFueT4pO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFkZFNldDxUPihzb3VyY2VTZXQ6IFNldDxUPiwgdGFyZ2V0U2V0OiBTZXQ8VD4pOiB2b2lkIHtcbiAgZm9yIChjb25zdCBtIG9mIHNvdXJjZVNldCkge1xuICAgIHRhcmdldFNldC5hZGQobSk7XG4gIH1cbn1cblxuLyoqIFRoZSBkZXBzIHRyYWNrZXIgdG8gYmUgdXNlZCBpbiB0aGUgY3VycmVudCBBbmd1bGFyIGFwcCBpbiBkZXYgbW9kZS4gKi9cbmV4cG9ydCBjb25zdCBkZXBzVHJhY2tlciA9IG5ldyBEZXBzVHJhY2tlcigpO1xuXG5leHBvcnQgY29uc3QgVEVTVF9PTkxZID0ge0RlcHNUcmFja2VyfTtcbiJdfQ==