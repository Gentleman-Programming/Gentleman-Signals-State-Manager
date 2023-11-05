/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { getCompilerFacade } from '../../compiler/compiler_facade';
import { resolveForwardRef } from '../../di/forward_ref';
import { getReflect, reflectDependencies } from '../../di/jit/util';
import { componentNeedsResolution, maybeQueueResolutionOfComponentResources } from '../../metadata/resource_loading';
import { ViewEncapsulation } from '../../metadata/view';
import { flatten } from '../../util/array_utils';
import { EMPTY_ARRAY, EMPTY_OBJ } from '../../util/empty';
import { initNgDevMode } from '../../util/ng_dev_mode';
import { getComponentDef, getDirectiveDef, getNgModuleDef, getPipeDef } from '../definition';
import { depsTracker, USE_RUNTIME_DEPS_TRACKER_FOR_JIT } from '../deps_tracker/deps_tracker';
import { NG_COMP_DEF, NG_DIR_DEF, NG_FACTORY_DEF } from '../fields';
import { stringifyForError } from '../util/stringify_utils';
import { angularCoreEnv } from './environment';
import { getJitOptions } from './jit_options';
import { flushModuleScopingQueueAsMuchAsPossible, patchComponentDefWithScope, transitiveScopesFor } from './module';
import { isComponent, verifyStandaloneImport } from './util';
/**
 * Keep track of the compilation depth to avoid reentrancy issues during JIT compilation. This
 * matters in the following scenario:
 *
 * Consider a component 'A' that extends component 'B', both declared in module 'M'. During
 * the compilation of 'A' the definition of 'B' is requested to capture the inheritance chain,
 * potentially triggering compilation of 'B'. If this nested compilation were to trigger
 * `flushModuleScopingQueueAsMuchAsPossible` it may happen that module 'M' is still pending in the
 * queue, resulting in 'A' and 'B' to be patched with the NgModule scope. As the compilation of
 * 'A' is still in progress, this would introduce a circular dependency on its compilation. To avoid
 * this issue, the module scope queue is only flushed for compilations at the depth 0, to ensure
 * all compilations have finished.
 */
let compilationDepth = 0;
/**
 * Compile an Angular component according to its decorator metadata, and patch the resulting
 * component def (ɵcmp) onto the component type.
 *
 * Compilation may be asynchronous (due to the need to resolve URLs for the component template or
 * other resources, for example). In the event that compilation is not immediate, `compileComponent`
 * will enqueue resource resolution into a global queue and will fail to return the `ɵcmp`
 * until the global queue has been resolved with a call to `resolveComponentResources`.
 */
export function compileComponent(type, metadata) {
    // Initialize ngDevMode. This must be the first statement in compileComponent.
    // See the `initNgDevMode` docstring for more information.
    (typeof ngDevMode === 'undefined' || ngDevMode) && initNgDevMode();
    let ngComponentDef = null;
    // Metadata may have resources which need to be resolved.
    maybeQueueResolutionOfComponentResources(type, metadata);
    // Note that we're using the same function as `Directive`, because that's only subset of metadata
    // that we need to create the ngFactoryDef. We're avoiding using the component metadata
    // because we'd have to resolve the asynchronous templates.
    addDirectiveFactoryDef(type, metadata);
    Object.defineProperty(type, NG_COMP_DEF, {
        get: () => {
            if (ngComponentDef === null) {
                const compiler = getCompilerFacade({ usage: 0 /* JitCompilerUsage.Decorator */, kind: 'component', type: type });
                if (componentNeedsResolution(metadata)) {
                    const error = [`Component '${type.name}' is not resolved:`];
                    if (metadata.templateUrl) {
                        error.push(` - templateUrl: ${metadata.templateUrl}`);
                    }
                    if (metadata.styleUrls && metadata.styleUrls.length) {
                        error.push(` - styleUrls: ${JSON.stringify(metadata.styleUrls)}`);
                    }
                    if (metadata.styleUrl) {
                        error.push(` - styleUrl: ${metadata.styleUrl}`);
                    }
                    error.push(`Did you run and wait for 'resolveComponentResources()'?`);
                    throw new Error(error.join('\n'));
                }
                // This const was called `jitOptions` previously but had to be renamed to `options` because
                // of a bug with Terser that caused optimized JIT builds to throw a `ReferenceError`.
                // This bug was investigated in https://github.com/angular/angular-cli/issues/17264.
                // We should not rename it back until https://github.com/terser/terser/issues/615 is fixed.
                const options = getJitOptions();
                let preserveWhitespaces = metadata.preserveWhitespaces;
                if (preserveWhitespaces === undefined) {
                    if (options !== null && options.preserveWhitespaces !== undefined) {
                        preserveWhitespaces = options.preserveWhitespaces;
                    }
                    else {
                        preserveWhitespaces = false;
                    }
                }
                let encapsulation = metadata.encapsulation;
                if (encapsulation === undefined) {
                    if (options !== null && options.defaultEncapsulation !== undefined) {
                        encapsulation = options.defaultEncapsulation;
                    }
                    else {
                        encapsulation = ViewEncapsulation.Emulated;
                    }
                }
                const templateUrl = metadata.templateUrl || `ng:///${type.name}/template.html`;
                const meta = {
                    ...directiveMetadata(type, metadata),
                    typeSourceSpan: compiler.createParseSourceSpan('Component', type.name, templateUrl),
                    template: metadata.template || '',
                    preserveWhitespaces,
                    styles: typeof metadata.styles === 'string' ? [metadata.styles] :
                        (metadata.styles || EMPTY_ARRAY),
                    animations: metadata.animations,
                    // JIT components are always compiled against an empty set of `declarations`. Instead, the
                    // `directiveDefs` and `pipeDefs` are updated at a later point:
                    //  * for NgModule-based components, they're set when the NgModule which declares the
                    //    component resolves in the module scoping queue
                    //  * for standalone components, they're set just below, after `compileComponent`.
                    declarations: [],
                    changeDetection: metadata.changeDetection,
                    encapsulation,
                    interpolation: metadata.interpolation,
                    viewProviders: metadata.viewProviders || null,
                };
                compilationDepth++;
                try {
                    if (meta.usesInheritance) {
                        addDirectiveDefToUndecoratedParents(type);
                    }
                    ngComponentDef =
                        compiler.compileComponent(angularCoreEnv, templateUrl, meta);
                    if (metadata.standalone) {
                        // Patch the component definition for standalone components with `directiveDefs` and
                        // `pipeDefs` functions which lazily compute the directives/pipes available in the
                        // standalone component. Also set `dependencies` to the lazily resolved list of imports.
                        const imports = flatten(metadata.imports || EMPTY_ARRAY);
                        const { directiveDefs, pipeDefs } = getStandaloneDefFunctions(type, imports);
                        ngComponentDef.directiveDefs = directiveDefs;
                        ngComponentDef.pipeDefs = pipeDefs;
                        ngComponentDef.dependencies = () => imports.map(resolveForwardRef);
                    }
                }
                finally {
                    // Ensure that the compilation depth is decremented even when the compilation failed.
                    compilationDepth--;
                }
                if (compilationDepth === 0) {
                    // When NgModule decorator executed, we enqueued the module definition such that
                    // it would only dequeue and add itself as module scope to all of its declarations,
                    // but only if  if all of its declarations had resolved. This call runs the check
                    // to see if any modules that are in the queue can be dequeued and add scope to
                    // their declarations.
                    flushModuleScopingQueueAsMuchAsPossible();
                }
                // If component compilation is async, then the @NgModule annotation which declares the
                // component may execute and set an ngSelectorScope property on the component type. This
                // allows the component to patch itself with directiveDefs from the module after it
                // finishes compiling.
                if (hasSelectorScope(type)) {
                    const scopes = transitiveScopesFor(type.ngSelectorScope);
                    patchComponentDefWithScope(ngComponentDef, scopes);
                }
                if (metadata.schemas) {
                    if (metadata.standalone) {
                        ngComponentDef.schemas = metadata.schemas;
                    }
                    else {
                        throw new Error(`The 'schemas' was specified for the ${stringifyForError(type)} but is only valid on a component that is standalone.`);
                    }
                }
                else if (metadata.standalone) {
                    ngComponentDef.schemas = [];
                }
            }
            return ngComponentDef;
        },
        // Make the property configurable in dev mode to allow overriding in tests
        configurable: !!ngDevMode,
    });
}
/**
 * Build memoized `directiveDefs` and `pipeDefs` functions for the component definition of a
 * standalone component, which process `imports` and filter out directives and pipes. The use of
 * memoized functions here allows for the delayed resolution of any `forwardRef`s present in the
 * component's `imports`.
 */
function getStandaloneDefFunctions(type, imports) {
    let cachedDirectiveDefs = null;
    let cachedPipeDefs = null;
    const directiveDefs = () => {
        if (!USE_RUNTIME_DEPS_TRACKER_FOR_JIT) {
            if (cachedDirectiveDefs === null) {
                // Standalone components are always able to self-reference, so include the component's own
                // definition in its `directiveDefs`.
                cachedDirectiveDefs = [getComponentDef(type)];
                const seen = new Set([type]);
                for (const rawDep of imports) {
                    ngDevMode && verifyStandaloneImport(rawDep, type);
                    const dep = resolveForwardRef(rawDep);
                    if (seen.has(dep)) {
                        continue;
                    }
                    seen.add(dep);
                    if (!!getNgModuleDef(dep)) {
                        const scope = transitiveScopesFor(dep);
                        for (const dir of scope.exported.directives) {
                            const def = getComponentDef(dir) || getDirectiveDef(dir);
                            if (def && !seen.has(dir)) {
                                seen.add(dir);
                                cachedDirectiveDefs.push(def);
                            }
                        }
                    }
                    else {
                        const def = getComponentDef(dep) || getDirectiveDef(dep);
                        if (def) {
                            cachedDirectiveDefs.push(def);
                        }
                    }
                }
            }
            return cachedDirectiveDefs;
        }
        else {
            if (ngDevMode) {
                for (const rawDep of imports) {
                    verifyStandaloneImport(rawDep, type);
                }
            }
            if (!isComponent(type)) {
                return [];
            }
            const scope = depsTracker.getStandaloneComponentScope(type, imports);
            return [...scope.compilation.directives]
                .map(p => (getComponentDef(p) || getDirectiveDef(p)))
                .filter(d => d !== null);
        }
    };
    const pipeDefs = () => {
        if (!USE_RUNTIME_DEPS_TRACKER_FOR_JIT) {
            if (cachedPipeDefs === null) {
                cachedPipeDefs = [];
                const seen = new Set();
                for (const rawDep of imports) {
                    const dep = resolveForwardRef(rawDep);
                    if (seen.has(dep)) {
                        continue;
                    }
                    seen.add(dep);
                    if (!!getNgModuleDef(dep)) {
                        const scope = transitiveScopesFor(dep);
                        for (const pipe of scope.exported.pipes) {
                            const def = getPipeDef(pipe);
                            if (def && !seen.has(pipe)) {
                                seen.add(pipe);
                                cachedPipeDefs.push(def);
                            }
                        }
                    }
                    else {
                        const def = getPipeDef(dep);
                        if (def) {
                            cachedPipeDefs.push(def);
                        }
                    }
                }
            }
            return cachedPipeDefs;
        }
        else {
            if (ngDevMode) {
                for (const rawDep of imports) {
                    verifyStandaloneImport(rawDep, type);
                }
            }
            if (!isComponent(type)) {
                return [];
            }
            const scope = depsTracker.getStandaloneComponentScope(type, imports);
            return [...scope.compilation.pipes].map(p => getPipeDef(p)).filter(d => d !== null);
        }
    };
    return {
        directiveDefs,
        pipeDefs,
    };
}
function hasSelectorScope(component) {
    return component.ngSelectorScope !== undefined;
}
/**
 * Compile an Angular directive according to its decorator metadata, and patch the resulting
 * directive def onto the component type.
 *
 * In the event that compilation is not immediate, `compileDirective` will return a `Promise` which
 * will resolve when compilation completes and the directive becomes usable.
 */
export function compileDirective(type, directive) {
    let ngDirectiveDef = null;
    addDirectiveFactoryDef(type, directive || {});
    Object.defineProperty(type, NG_DIR_DEF, {
        get: () => {
            if (ngDirectiveDef === null) {
                // `directive` can be null in the case of abstract directives as a base class
                // that use `@Directive()` with no selector. In that case, pass empty object to the
                // `directiveMetadata` function instead of null.
                const meta = getDirectiveMetadata(type, directive || {});
                const compiler = getCompilerFacade({ usage: 0 /* JitCompilerUsage.Decorator */, kind: 'directive', type });
                ngDirectiveDef =
                    compiler.compileDirective(angularCoreEnv, meta.sourceMapUrl, meta.metadata);
            }
            return ngDirectiveDef;
        },
        // Make the property configurable in dev mode to allow overriding in tests
        configurable: !!ngDevMode,
    });
}
function getDirectiveMetadata(type, metadata) {
    const name = type && type.name;
    const sourceMapUrl = `ng:///${name}/ɵdir.js`;
    const compiler = getCompilerFacade({ usage: 0 /* JitCompilerUsage.Decorator */, kind: 'directive', type });
    const facade = directiveMetadata(type, metadata);
    facade.typeSourceSpan = compiler.createParseSourceSpan('Directive', name, sourceMapUrl);
    if (facade.usesInheritance) {
        addDirectiveDefToUndecoratedParents(type);
    }
    return { metadata: facade, sourceMapUrl };
}
function addDirectiveFactoryDef(type, metadata) {
    let ngFactoryDef = null;
    Object.defineProperty(type, NG_FACTORY_DEF, {
        get: () => {
            if (ngFactoryDef === null) {
                const meta = getDirectiveMetadata(type, metadata);
                const compiler = getCompilerFacade({ usage: 0 /* JitCompilerUsage.Decorator */, kind: 'directive', type });
                ngFactoryDef = compiler.compileFactory(angularCoreEnv, `ng:///${type.name}/ɵfac.js`, {
                    name: meta.metadata.name,
                    type: meta.metadata.type,
                    typeArgumentCount: 0,
                    deps: reflectDependencies(type),
                    target: compiler.FactoryTarget.Directive
                });
            }
            return ngFactoryDef;
        },
        // Make the property configurable in dev mode to allow overriding in tests
        configurable: !!ngDevMode,
    });
}
export function extendsDirectlyFromObject(type) {
    return Object.getPrototypeOf(type.prototype) === Object.prototype;
}
/**
 * Extract the `R3DirectiveMetadata` for a particular directive (either a `Directive` or a
 * `Component`).
 */
export function directiveMetadata(type, metadata) {
    // Reflect inputs and outputs.
    const reflect = getReflect();
    const propMetadata = reflect.ownPropMetadata(type);
    return {
        name: type.name,
        type: type,
        selector: metadata.selector !== undefined ? metadata.selector : null,
        host: metadata.host || EMPTY_OBJ,
        propMetadata: propMetadata,
        inputs: metadata.inputs || EMPTY_ARRAY,
        outputs: metadata.outputs || EMPTY_ARRAY,
        queries: extractQueriesMetadata(type, propMetadata, isContentQuery),
        lifecycle: { usesOnChanges: reflect.hasLifecycleHook(type, 'ngOnChanges') },
        typeSourceSpan: null,
        usesInheritance: !extendsDirectlyFromObject(type),
        exportAs: extractExportAs(metadata.exportAs),
        providers: metadata.providers || null,
        viewQueries: extractQueriesMetadata(type, propMetadata, isViewQuery),
        isStandalone: !!metadata.standalone,
        isSignal: !!metadata.signals,
        hostDirectives: metadata.hostDirectives?.map(directive => typeof directive === 'function' ? { directive } : directive) ||
            null
    };
}
/**
 * Adds a directive definition to all parent classes of a type that don't have an Angular decorator.
 */
function addDirectiveDefToUndecoratedParents(type) {
    const objPrototype = Object.prototype;
    let parent = Object.getPrototypeOf(type.prototype).constructor;
    // Go up the prototype until we hit `Object`.
    while (parent && parent !== objPrototype) {
        // Since inheritance works if the class was annotated already, we only need to add
        // the def if there are no annotations and the def hasn't been created already.
        if (!getDirectiveDef(parent) && !getComponentDef(parent) &&
            shouldAddAbstractDirective(parent)) {
            compileDirective(parent, null);
        }
        parent = Object.getPrototypeOf(parent);
    }
}
function convertToR3QueryPredicate(selector) {
    return typeof selector === 'string' ? splitByComma(selector) : resolveForwardRef(selector);
}
export function convertToR3QueryMetadata(propertyName, ann) {
    return {
        propertyName: propertyName,
        predicate: convertToR3QueryPredicate(ann.selector),
        descendants: ann.descendants,
        first: ann.first,
        read: ann.read ? ann.read : null,
        static: !!ann.static,
        emitDistinctChangesOnly: !!ann.emitDistinctChangesOnly,
    };
}
function extractQueriesMetadata(type, propMetadata, isQueryAnn) {
    const queriesMeta = [];
    for (const field in propMetadata) {
        if (propMetadata.hasOwnProperty(field)) {
            const annotations = propMetadata[field];
            annotations.forEach(ann => {
                if (isQueryAnn(ann)) {
                    if (!ann.selector) {
                        throw new Error(`Can't construct a query for the property "${field}" of ` +
                            `"${stringifyForError(type)}" since the query selector wasn't defined.`);
                    }
                    if (annotations.some(isInputAnnotation)) {
                        throw new Error(`Cannot combine @Input decorators with query decorators`);
                    }
                    queriesMeta.push(convertToR3QueryMetadata(field, ann));
                }
            });
        }
    }
    return queriesMeta;
}
function extractExportAs(exportAs) {
    return exportAs === undefined ? null : splitByComma(exportAs);
}
function isContentQuery(value) {
    const name = value.ngMetadataName;
    return name === 'ContentChild' || name === 'ContentChildren';
}
function isViewQuery(value) {
    const name = value.ngMetadataName;
    return name === 'ViewChild' || name === 'ViewChildren';
}
function isInputAnnotation(value) {
    return value.ngMetadataName === 'Input';
}
function splitByComma(value) {
    return value.split(',').map(piece => piece.trim());
}
const LIFECYCLE_HOOKS = [
    'ngOnChanges', 'ngOnInit', 'ngOnDestroy', 'ngDoCheck', 'ngAfterViewInit', 'ngAfterViewChecked',
    'ngAfterContentInit', 'ngAfterContentChecked'
];
function shouldAddAbstractDirective(type) {
    const reflect = getReflect();
    if (LIFECYCLE_HOOKS.some(hookName => reflect.hasLifecycleHook(type, hookName))) {
        return true;
    }
    const propMetadata = reflect.propMetadata(type);
    for (const field in propMetadata) {
        const annotations = propMetadata[field];
        for (let i = 0; i < annotations.length; i++) {
            const current = annotations[i];
            const metadataName = current.ngMetadataName;
            if (isInputAnnotation(current) || isContentQuery(current) || isViewQuery(current) ||
                metadataName === 'Output' || metadataName === 'HostBinding' ||
                metadataName === 'HostListener') {
                return true;
            }
        }
    }
    return false;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlyZWN0aXZlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvY29yZS9zcmMvcmVuZGVyMy9qaXQvZGlyZWN0aXZlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBQyxpQkFBaUIsRUFBOEMsTUFBTSxnQ0FBZ0MsQ0FBQztBQUU5RyxPQUFPLEVBQUMsaUJBQWlCLEVBQUMsTUFBTSxzQkFBc0IsQ0FBQztBQUN2RCxPQUFPLEVBQUMsVUFBVSxFQUFFLG1CQUFtQixFQUFDLE1BQU0sbUJBQW1CLENBQUM7QUFJbEUsT0FBTyxFQUFDLHdCQUF3QixFQUFFLHdDQUF3QyxFQUFDLE1BQU0saUNBQWlDLENBQUM7QUFDbkgsT0FBTyxFQUFDLGlCQUFpQixFQUFDLE1BQU0scUJBQXFCLENBQUM7QUFDdEQsT0FBTyxFQUFDLE9BQU8sRUFBQyxNQUFNLHdCQUF3QixDQUFDO0FBQy9DLE9BQU8sRUFBQyxXQUFXLEVBQUUsU0FBUyxFQUFDLE1BQU0sa0JBQWtCLENBQUM7QUFDeEQsT0FBTyxFQUFDLGFBQWEsRUFBQyxNQUFNLHdCQUF3QixDQUFDO0FBQ3JELE9BQU8sRUFBQyxlQUFlLEVBQUUsZUFBZSxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUMsTUFBTSxlQUFlLENBQUM7QUFDM0YsT0FBTyxFQUFDLFdBQVcsRUFBRSxnQ0FBZ0MsRUFBQyxNQUFNLDhCQUE4QixDQUFDO0FBQzNGLE9BQU8sRUFBQyxXQUFXLEVBQUUsVUFBVSxFQUFFLGNBQWMsRUFBQyxNQUFNLFdBQVcsQ0FBQztBQUVsRSxPQUFPLEVBQUMsaUJBQWlCLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQztBQUUxRCxPQUFPLEVBQUMsY0FBYyxFQUFDLE1BQU0sZUFBZSxDQUFDO0FBQzdDLE9BQU8sRUFBQyxhQUFhLEVBQUMsTUFBTSxlQUFlLENBQUM7QUFDNUMsT0FBTyxFQUFDLHVDQUF1QyxFQUFFLDBC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aEQsS0FBSyxNQUFNLEtBQUssSUFBSSxZQUFZLEVBQUU7UUFDaEMsTUFBTSxXQUFXLEdBQUcsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBRXhDLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxXQUFXLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO1lBQzNDLE1BQU0sT0FBTyxHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUMvQixNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDO1lBRTVDLElBQUksaUJBQWlCLENBQUMsT0FBTyxDQUFDLElBQUksY0FBYyxDQUFDLE9BQU8sQ0FBQyxJQUFJLFdBQVcsQ0FBQyxPQUFPLENBQUM7Z0JBQzdFLFlBQVksS0FBSyxRQUFRLElBQUksWUFBWSxLQUFLLGFBQWE7Z0JBQzNELFlBQVksS0FBSyxjQUFjLEVBQUU7Z0JBQ25DLE9BQU8sSUFBSSxDQUFDO2FBQ2I7U0FDRjtLQUNGO0lBRUQsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB7Z2V0Q29tcGlsZXJGYWNhZGUsIEppdENvbXBpbGVyVXNhZ2UsIFIzRGlyZWN0aXZlTWV0YWRhdGFGYWNhZGV9IGZyb20gJy4uLy4uL2NvbXBpbGVyL2NvbXBpbGVyX2ZhY2FkZSc7XG5pbXBvcnQge1IzQ29tcG9uZW50TWV0YWRhdGFGYWNhZGUsIFIzUXVlcnlNZXRhZGF0YUZhY2FkZX0gZnJvbSAnLi4vLi4vY29tcGlsZXIvY29tcGlsZXJfZmFjYWRlX2ludGVyZmFjZSc7XG5pbXBvcnQge3Jlc29sdmVGb3J3YXJkUmVmfSBmcm9tICcuLi8uLi9kaS9mb3J3YXJkX3JlZic7XG5pbXBvcnQge2dldFJlZmxlY3QsIHJlZmxlY3REZXBlbmRlbmNpZXN9IGZyb20gJy4uLy4uL2RpL2ppdC91dGlsJztcbmltcG9ydCB7VHlwZX0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlL3R5cGUnO1xuaW1wb3J0IHtRdWVyeX0gZnJvbSAnLi4vLi4vbWV0YWRhdGEvZGknO1xuaW1wb3J0IHtDb21wb25lbnQsIERpcmVjdGl2ZSwgSW5wdXR9IGZyb20gJy4uLy4uL21ldGFkYXRhL2RpcmVjdGl2ZXMnO1xuaW1wb3J0IHtjb21wb25lbnROZWVkc1Jlc29sdXRpb24sIG1heWJlUXVldWVSZXNvbHV0aW9uT2ZDb21wb25lbnRSZXNvdXJjZXN9IGZyb20gJy4uLy4uL21ldGFkYXRhL3Jlc291cmNlX2xvYWRpbmcnO1xuaW1wb3J0IHtWaWV3RW5jYXBzdWxhdGlvbn0gZnJvbSAnLi4vLi4vbWV0YWRhdGEvdmlldyc7XG5pbXBvcnQge2ZsYXR0ZW59IGZyb20gJy4uLy4uL3V0aWwvYXJyYXlfdXRpbHMnO1xuaW1wb3J0IHtFTVBUWV9BUlJBWSwgRU1QVFlfT0JKfSBmcm9tICcuLi8uLi91dGlsL2VtcHR5JztcbmltcG9ydCB7aW5pdE5nRGV2TW9kZX0gZnJvbSAnLi4vLi4vdXRpbC9uZ19kZXZfbW9kZSc7XG5pbXBvcnQge2dldENvbXBvbmVudERlZiwgZ2V0RGlyZWN0aXZlRGVmLCBnZXROZ01vZHVsZURlZiwgZ2V0UGlwZURlZn0gZnJvbSAnLi4vZGVmaW5pdGlvbic7XG5pbXBvcnQge2RlcHNUcmFja2VyLCBVU0VfUlVOVElNRV9ERVBTX1RSQUNLRVJfRk9SX0pJVH0gZnJvbSAnLi4vZGVwc190cmFja2VyL2RlcHNfdHJhY2tlcic7XG5pbXBvcnQge05HX0NPTVBfREVGLCBOR19ESVJfREVGLCBOR19GQUNUT1JZX0RFRn0gZnJvbSAnLi4vZmllbGRzJztcbmltcG9ydCB7Q29tcG9uZW50RGVmLCBDb21wb25lbnRUeXBlLCBEaXJlY3RpdmVEZWZMaXN0LCBQaXBlRGVmTGlzdH0gZnJvbSAnLi4vaW50ZXJmYWNlcy9kZWZpbml0aW9uJztcbmltcG9ydCB7c3RyaW5naWZ5Rm9yRXJyb3J9IGZyb20gJy4uL3V0aWwvc3RyaW5naWZ5X3V0aWxzJztcblxuaW1wb3J0IHthbmd1bGFyQ29yZUVudn0gZnJvbSAnLi9lbnZpcm9ubWVudCc7XG5pbXBvcnQge2dldEppdE9wdGlvbnN9IGZyb20gJy4vaml0X29wdGlvbnMnO1xuaW1wb3J0IHtmbHVzaE1vZHVsZVNjb3BpbmdRdWV1ZUFzTXVjaEFzUG9zc2libGUsIHBhdGNoQ29tcG9uZW50RGVmV2l0aFNjb3BlLCB0cmFuc2l0aXZlU2NvcGVzRm9yfSBmcm9tICcuL21vZHVsZSc7XG5pbXBvcnQge2lzQ29tcG9uZW50LCB2ZXJpZnlTdGFuZGFsb25lSW1wb3J0fSBmcm9tICcuL3V0aWwnO1xuXG4vKipcbiAqIEtlZXAgdHJhY2sgb2YgdGhlIGNvbXBpbGF0aW9uIGRlcHRoIHRvIGF2b2lkIHJlZW50cmFuY3kgaXNzdWVzIGR1cmluZyBKSVQgY29tcGlsYXRpb24uIFRoaXNcbiAqIG1hdHRlcnMgaW4gdGhlIGZvbGxvd2luZyBzY2VuYXJpbzpcbiAqXG4gKiBDb25zaWRlciBhIGNvbXBvbmVudCAnQScgdGhhdCBleHRlbmRzIGNvbXBvbmVudCAnQicsIGJvdGggZGVjbGFyZWQgaW4gbW9kdWxlICdNJy4gRHVyaW5nXG4gKiB0aGUgY29tcGlsYXRpb24gb2YgJ0EnIHRoZSBkZWZpbml0aW9uIG9mICdCJyBpcyByZXF1ZXN0ZWQgdG8gY2FwdHVyZSB0aGUgaW5oZXJpdGFuY2UgY2hhaW4sXG4gKiBwb3RlbnRpYWxseSB0cmlnZ2VyaW5nIGNvbXBpbGF0aW9uIG9mICdCJy4gSWYgdGhpcyBuZXN0ZWQgY29tcGlsYXRpb24gd2VyZSB0byB0cmlnZ2VyXG4gKiBgZmx1c2hNb2R1bGVTY29waW5nUXVldWVBc011Y2hBc1Bvc3NpYmxlYCBpdCBtYXkgaGFwcGVuIHRoYXQgbW9kdWxlICdNJyBpcyBzdGlsbCBwZW5kaW5nIGluIHRoZVxuICogcXVldWUsIHJlc3VsdGluZyBpbiAnQScgYW5kICdCJyB0byBiZSBwYXRjaGVkIHdpdGggdGhlIE5nTW9kdWxlIHNjb3BlLiBBcyB0aGUgY29tcGlsYXRpb24gb2ZcbiAqICdBJyBpcyBzdGlsbCBpbiBwcm9ncmVzcywgdGhpcyB3b3VsZCBpbnRyb2R1Y2UgYSBjaXJjdWxhciBkZXBlbmRlbmN5IG9uIGl0cyBjb21waWxhdGlvbi4gVG8gYXZvaWRcbiAqIHRoaXMgaXNzdWUsIHRoZSBtb2R1bGUgc2NvcGUgcXVldWUgaXMgb25seSBmbHVzaGVkIGZvciBjb21waWxhdGlvbnMgYXQgdGhlIGRlcHRoIDAsIHRvIGVuc3VyZVxuICogYWxsIGNvbXBpbGF0aW9ucyBoYXZlIGZpbmlzaGVkLlxuICovXG5sZXQgY29tcGlsYXRpb25EZXB0aCA9IDA7XG5cbi8qKlxuICogQ29tcGlsZSBhbiBBbmd1bGFyIGNvbXBvbmVudCBhY2NvcmRpbmcgdG8gaXRzIGRlY29yYXRvciBtZXRhZGF0YSwgYW5kIHBhdGNoIHRoZSByZXN1bHRpbmdcbiAqIGNvbXBvbmVudCBkZWYgKMm1Y21wKSBvbnRvIHRoZSBjb21wb25lbnQgdHlwZS5cbiAqXG4gKiBDb21waWxhdGlvbiBtYXkgYmUgYXN5bmNocm9ub3VzIChkdWUgdG8gdGhlIG5lZWQgdG8gcmVzb2x2ZSBVUkxzIGZvciB0aGUgY29tcG9uZW50IHRlbXBsYXRlIG9yXG4gKiBvdGhlciByZXNvdXJjZXMsIGZvciBleGFtcGxlKS4gSW4gdGhlIGV2ZW50IHRoYXQgY29tcGlsYXRpb24gaXMgbm90IGltbWVkaWF0ZSwgYGNvbXBpbGVDb21wb25lbnRgXG4gKiB3aWxsIGVucXVldWUgcmVzb3VyY2UgcmVzb2x1dGlvbiBpbnRvIGEgZ2xvYmFsIHF1ZXVlIGFuZCB3aWxsIGZhaWwgdG8gcmV0dXJuIHRoZSBgybVjbXBgXG4gKiB1bnRpbCB0aGUgZ2xvYmFsIHF1ZXVlIGhhcyBiZWVuIHJlc29sdmVkIHdpdGggYSBjYWxsIHRvIGByZXNvbHZlQ29tcG9uZW50UmVzb3VyY2VzYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVDb21wb25lbnQodHlwZTogVHlwZTxhbnk+LCBtZXRhZGF0YTogQ29tcG9uZW50KTogdm9pZCB7XG4gIC8vIEluaXRpYWxpemUgbmdEZXZNb2RlLiBUaGlzIG11c3QgYmUgdGhlIGZpcnN0IHN0YXRlbWVudCBpbiBjb21waWxlQ29tcG9uZW50LlxuICAvLyBTZWUgdGhlIGBpbml0TmdEZXZNb2RlYCBkb2NzdHJpbmcgZm9yIG1vcmUgaW5mb3JtYXRpb24uXG4gICh0eXBlb2YgbmdEZXZNb2RlID09PSAndW5kZWZpbmVkJyB8fCBuZ0Rldk1vZGUpICYmIGluaXROZ0Rldk1vZGUoKTtcblxuICBsZXQgbmdDb21wb25lbnREZWY6IENvbXBvbmVudERlZjx1bmtub3duPnxudWxsID0gbnVsbDtcblxuICAvLyBNZXRhZGF0YSBtYXkgaGF2ZSByZXNvdXJjZXMgd2hpY2ggbmVlZCB0byBiZSByZXNvbHZlZC5cbiAgbWF5YmVRdWV1ZVJlc29sdXRpb25PZkNvbXBvbmVudFJlc291cmNlcyh0eXBlLCBtZXRhZGF0YSk7XG5cbiAgLy8gTm90ZSB0aGF0IHdlJ3JlIHVzaW5nIHRoZSBzYW1lIGZ1bmN0aW9uIGFzIGBEaXJlY3RpdmVgLCBiZWNhdXNlIHRoYXQncyBvbmx5IHN1YnNldCBvZiBtZXRhZGF0YVxuICAvLyB0aGF0IHdlIG5lZWQgdG8gY3JlYXRlIHRoZSBuZ0ZhY3RvcnlEZWYuIFdlJ3JlIGF2b2lkaW5nIHVzaW5nIHRoZSBjb21wb25lbnQgbWV0YWRhdGFcbiAgLy8gYmVjYXVzZSB3ZSdkIGhhdmUgdG8gcmVzb2x2ZSB0aGUgYXN5bmNocm9ub3VzIHRlbXBsYXRlcy5cbiAgYWRkRGlyZWN0aXZlRmFjdG9yeURlZih0eXBlLCBtZXRhZGF0YSk7XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHR5cGUsIE5HX0NPTVBfREVGLCB7XG4gICAgZ2V0OiAoKSA9PiB7XG4gICAgICBpZiAobmdDb21wb25lbnREZWYgPT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgY29tcGlsZXIgPVxuICAgICAgICAgICAgZ2V0Q29tcGlsZXJGYWNhZGUoe3VzYWdlOiBKaXRDb21waWxlclVzYWdlLkRlY29yYXRvciwga2luZDogJ2NvbXBvbmVudCcsIHR5cGU6IHR5cGV9KTtcblxuICAgICAgICBpZiAoY29tcG9uZW50TmVlZHNSZXNvbHV0aW9uKG1ldGFkYXRhKSkge1xuICAgICAgICAgIGNvbnN0IGVycm9yID0gW2BDb21wb25lbnQgJyR7dHlwZS5uYW1lfScgaXMgbm90IHJlc29sdmVkOmBdO1xuICAgICAgICAgIGlmIChtZXRhZGF0YS50ZW1wbGF0ZVVybCkge1xuICAgICAgICAgICAgZXJyb3IucHVzaChgIC0gdGVtcGxhdGVVcmw6ICR7bWV0YWRhdGEudGVtcGxhdGVVcmx9YCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChtZXRhZGF0YS5zdHlsZVVybHMgJiYgbWV0YWRhdGEuc3R5bGVVcmxzLmxlbmd0aCkge1xuICAgICAgICAgICAgZXJyb3IucHVzaChgIC0gc3R5bGVVcmxzOiAke0pTT04uc3RyaW5naWZ5KG1ldGFkYXRhLnN0eWxlVXJscyl9YCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChtZXRhZGF0YS5zdHlsZVVybCkge1xuICAgICAgICAgICAgZXJyb3IucHVzaChgIC0gc3R5bGVVcmw6ICR7bWV0YWRhdGEuc3R5bGVVcmx9YCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGVycm9yLnB1c2goYERpZCB5b3UgcnVuIGFuZCB3YWl0IGZvciAncmVzb2x2ZUNvbXBvbmVudFJlc291cmNlcygpJz9gKTtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3Iuam9pbignXFxuJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVGhpcyBjb25zdCB3YXMgY2FsbGVkIGBqaXRPcHRpb25zYCBwcmV2aW91c2x5IGJ1dCBoYWQgdG8gYmUgcmVuYW1lZCB0byBgb3B0aW9uc2AgYmVjYXVzZVxuICAgICAgICAvLyBvZiBhIGJ1ZyB3aXRoIFRlcnNlciB0aGF0IGNhdXNlZCBvcHRpbWl6ZWQgSklUIGJ1aWxkcyB0byB0aHJvdyBhIGBSZWZlcmVuY2VFcnJvcmAuXG4gICAgICAgIC8vIFRoaXMgYnVnIHdhcyBpbnZlc3RpZ2F0ZWQgaW4gaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci1jbGkvaXNzdWVzLzE3MjY0LlxuICAgICAgICAvLyBXZSBzaG91bGQgbm90IHJlbmFtZSBpdCBiYWNrIHVudGlsIGh0dHBzOi8vZ2l0aHViLmNvbS90ZXJzZXIvdGVyc2VyL2lzc3Vlcy82MTUgaXMgZml4ZWQuXG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSBnZXRKaXRPcHRpb25zKCk7XG4gICAgICAgIGxldCBwcmVzZXJ2ZVdoaXRlc3BhY2VzID0gbWV0YWRhdGEucHJlc2VydmVXaGl0ZXNwYWNlcztcbiAgICAgICAgaWYgKHByZXNlcnZlV2hpdGVzcGFjZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGlmIChvcHRpb25zICE9PSBudWxsICYmIG9wdGlvbnMucHJlc2VydmVXaGl0ZXNwYWNlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBwcmVzZXJ2ZVdoaXRlc3BhY2VzID0gb3B0aW9ucy5wcmVzZXJ2ZVdoaXRlc3BhY2VzO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwcmVzZXJ2ZVdoaXRlc3BhY2VzID0gZmFsc2U7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGxldCBlbmNhcHN1bGF0aW9uID0gbWV0YWRhdGEuZW5jYXBzdWxhdGlvbjtcbiAgICAgICAgaWYgKGVuY2Fwc3VsYXRpb24gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGlmIChvcHRpb25zICE9PSBudWxsICYmIG9wdGlvbnMuZGVmYXVsdEVuY2Fwc3VsYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZW5jYXBzdWxhdGlvbiA9IG9wdGlvbnMuZGVmYXVsdEVuY2Fwc3VsYXRpb247XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVuY2Fwc3VsYXRpb24gPSBWaWV3RW5jYXBzdWxhdGlvbi5FbXVsYXRlZDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0ZW1wbGF0ZVVybCA9IG1ldGFkYXRhLnRlbXBsYXRlVXJsIHx8IGBuZzovLy8ke3R5cGUubmFtZX0vdGVtcGxhdGUuaHRtbGA7XG4gICAgICAgIGNvbnN0IG1ldGE6IFIzQ29tcG9uZW50TWV0YWRhdGFGYWNhZGUgPSB7XG4gICAgICAgICAgLi4uZGlyZWN0aXZlTWV0YWRhdGEodHlwZSwgbWV0YWRhdGEpLFxuICAgICAgICAgIHR5cGVTb3VyY2VTcGFuOiBjb21waWxlci5jcmVhdGVQYXJzZVNvdXJjZVNwYW4oJ0NvbXBvbmVudCcsIHR5cGUubmFtZSwgdGVtcGxhdGVVcmwpLFxuICAgICAgICAgIHRlbXBsYXRlOiBtZXRhZGF0YS50ZW1wbGF0ZSB8fCAnJyxcbiAgICAgICAgICBwcmVzZXJ2ZVdoaXRlc3BhY2VzLFxuICAgICAgICAgIHN0eWxlczogdHlwZW9mIG1ldGFkYXRhLnN0eWxlcyA9PT0gJ3N0cmluZycgPyBbbWV0YWRhdGEuc3R5bGVzXSA6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChtZXRhZGF0YS5zdHlsZXMgfHwgRU1QVFlfQVJSQVkpLFxuICAgICAgICAgIGFuaW1hdGlvbnM6IG1ldGFkYXRhLmFuaW1hdGlvbnMsXG4gICAgICAgICAgLy8gSklUIGNvbXBvbmVudHMgYXJlIGFsd2F5cyBjb21waWxlZCBhZ2FpbnN0IGFuIGVtcHR5IHNldCBvZiBgZGVjbGFyYXRpb25zYC4gSW5zdGVhZCwgdGhlXG4gICAgICAgICAgLy8gYGRpcmVjdGl2ZURlZnNgIGFuZCBgcGlwZURlZnNgIGFyZSB1cGRhdGVkIGF0IGEgbGF0ZXIgcG9pbnQ6XG4gICAgICAgICAgLy8gICogZm9yIE5nTW9kdWxlLWJhc2VkIGNvbXBvbmVudHMsIHRoZXkncmUgc2V0IHdoZW4gdGhlIE5nTW9kdWxlIHdoaWNoIGRlY2xhcmVzIHRoZVxuICAgICAgICAgIC8vICAgIGNvbXBvbmVudCByZXNvbHZlcyBpbiB0aGUgbW9kdWxlIHNjb3BpbmcgcXVldWVcbiAgICAgICAgICAvLyAgKiBmb3Igc3RhbmRhbG9uZSBjb21wb25lbnRzLCB0aGV5J3JlIHNldCBqdXN0IGJlbG93LCBhZnRlciBgY29tcGlsZUNvbXBvbmVudGAuXG4gICAgICAgICAgZGVjbGFyYXRpb25zOiBbXSxcbiAgICAgICAgICBjaGFuZ2VEZXRlY3Rpb246IG1ldGFkYXRhLmNoYW5nZURldGVjdGlvbixcbiAgICAgICAgICBlbmNhcHN1bGF0aW9uLFxuICAgICAgICAgIGludGVycG9sYXRpb246IG1ldGFkYXRhLmludGVycG9sYXRpb24sXG4gICAgICAgICAgdmlld1Byb3ZpZGVyczogbWV0YWRhdGEudmlld1Byb3ZpZGVycyB8fCBudWxsLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbXBpbGF0aW9uRGVwdGgrKztcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAobWV0YS51c2VzSW5oZXJpdGFuY2UpIHtcbiAgICAgICAgICAgIGFkZERpcmVjdGl2ZURlZlRvVW5kZWNvcmF0ZWRQYXJlbnRzKHR5cGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBuZ0NvbXBvbmVudERlZiA9XG4gICAgICAgICAgICAgIGNvbXBpbGVyLmNvbXBpbGVDb21wb25lbnQoYW5ndWxhckNvcmVFbnYsIHRlbXBsYXRlVXJsLCBtZXRhKSBhcyBDb21wb25lbnREZWY8dW5rbm93bj47XG5cbiAgICAgICAgICBpZiAobWV0YWRhdGEuc3RhbmRhbG9uZSkge1xuICAgICAgICAgICAgLy8gUGF0Y2ggdGhlIGNvbXBvbmVudCBkZWZpbml0aW9uIGZvciBzdGFuZGFsb25lIGNvbXBvbmVudHMgd2l0aCBgZGlyZWN0aXZlRGVmc2AgYW5kXG4gICAgICAgICAgICAvLyBgcGlwZURlZnNgIGZ1bmN0aW9ucyB3aGljaCBsYXppbHkgY29tcHV0ZSB0aGUgZGlyZWN0aXZlcy9waXBlcyBhdmFpbGFibGUgaW4gdGhlXG4gICAgICAgICAgICAvLyBzdGFuZGFsb25lIGNvbXBvbmVudC4gQWxzbyBzZXQgYGRlcGVuZGVuY2llc2AgdG8gdGhlIGxhemlseSByZXNvbHZlZCBsaXN0IG9mIGltcG9ydHMuXG4gICAgICAgICAgICBjb25zdCBpbXBvcnRzOiBUeXBlPGFueT5bXSA9IGZsYXR0ZW4obWV0YWRhdGEuaW1wb3J0cyB8fCBFTVBUWV9BUlJBWSk7XG4gICAgICAgICAgICBjb25zdCB7ZGlyZWN0aXZlRGVmcywgcGlwZURlZnN9ID0gZ2V0U3RhbmRhbG9uZURlZkZ1bmN0aW9ucyh0eXBlLCBpbXBvcnRzKTtcbiAgICAgICAgICAgIG5nQ29tcG9uZW50RGVmLmRpcmVjdGl2ZURlZnMgPSBkaXJlY3RpdmVEZWZzO1xuICAgICAgICAgICAgbmdDb21wb25lbnREZWYucGlwZURlZnMgPSBwaXBlRGVmcztcbiAgICAgICAgICAgIG5nQ29tcG9uZW50RGVmLmRlcGVuZGVuY2llcyA9ICgpID0+IGltcG9ydHMubWFwKHJlc29sdmVGb3J3YXJkUmVmKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIGNvbXBpbGF0aW9uIGRlcHRoIGlzIGRlY3JlbWVudGVkIGV2ZW4gd2hlbiB0aGUgY29tcGlsYXRpb24gZmFpbGVkLlxuICAgICAgICAgIGNvbXBpbGF0aW9uRGVwdGgtLTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb21waWxhdGlvbkRlcHRoID09PSAwKSB7XG4gICAgICAgICAgLy8gV2hlbiBOZ01vZHVsZSBkZWNvcmF0b3IgZXhlY3V0ZWQsIHdlIGVucXVldWVkIHRoZSBtb2R1bGUgZGVmaW5pdGlvbiBzdWNoIHRoYXRcbiAgICAgICAgICAvLyBpdCB3b3VsZCBvbmx5IGRlcXVldWUgYW5kIGFkZCBpdHNlbGYgYXMgbW9kdWxlIHNjb3BlIHRvIGFsbCBvZiBpdHMgZGVjbGFyYXRpb25zLFxuICAgICAgICAgIC8vIGJ1dCBvbmx5IGlmICBpZiBhbGwgb2YgaXRzIGRlY2xhcmF0aW9ucyBoYWQgcmVzb2x2ZWQuIFRoaXMgY2FsbCBydW5zIHRoZSBjaGVja1xuICAgICAgICAgIC8vIHRvIHNlZSBpZiBhbnkgbW9kdWxlcyB0aGF0IGFyZSBpbiB0aGUgcXVldWUgY2FuIGJlIGRlcXVldWVkIGFuZCBhZGQgc2NvcGUgdG9cbiAgICAgICAgICAvLyB0aGVpciBkZWNsYXJhdGlvbnMuXG4gICAgICAgICAgZmx1c2hNb2R1bGVTY29waW5nUXVldWVBc011Y2hBc1Bvc3NpYmxlKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZiBjb21wb25lbnQgY29tcGlsYXRpb24gaXMgYXN5bmMsIHRoZW4gdGhlIEBOZ01vZHVsZSBhbm5vdGF0aW9uIHdoaWNoIGRlY2xhcmVzIHRoZVxuICAgICAgICAvLyBjb21wb25lbnQgbWF5IGV4ZWN1dGUgYW5kIHNldCBhbiBuZ1NlbGVjdG9yU2NvcGUgcHJvcGVydHkgb24gdGhlIGNvbXBvbmVudCB0eXBlLiBUaGlzXG4gICAgICAgIC8vIGFsbG93cyB0aGUgY29tcG9uZW50IHRvIHBhdGNoIGl0c2VsZiB3aXRoIGRpcmVjdGl2ZURlZnMgZnJvbSB0aGUgbW9kdWxlIGFmdGVyIGl0XG4gICAgICAgIC8vIGZpbmlzaGVzIGNvbXBpbGluZy5cbiAgICAgICAgaWYgKGhhc1NlbGVjdG9yU2NvcGUodHlwZSkpIHtcbiAgICAgICAgICBjb25zdCBzY29wZXMgPSB0cmFuc2l0aXZlU2NvcGVzRm9yKHR5cGUubmdTZWxlY3RvclNjb3BlKTtcbiAgICAgICAgICBwYXRjaENvbXBvbmVudERlZldpdGhTY29wZShuZ0NvbXBvbmVudERlZiwgc2NvcGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChtZXRhZGF0YS5zY2hlbWFzKSB7XG4gICAgICAgICAgaWYgKG1ldGFkYXRhLnN0YW5kYWxvbmUpIHtcbiAgICAgICAgICAgIG5nQ29tcG9uZW50RGVmLnNjaGVtYXMgPSBtZXRhZGF0YS5zY2hlbWFzO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSAnc2NoZW1hcycgd2FzIHNwZWNpZmllZCBmb3IgdGhlICR7XG4gICAgICAgICAgICAgICAgc3RyaW5naWZ5Rm9yRXJyb3IodHlwZSl9IGJ1dCBpcyBvbmx5IHZhbGlkIG9uIGEgY29tcG9uZW50IHRoYXQgaXMgc3RhbmRhbG9uZS5gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAobWV0YWRhdGEuc3RhbmRhbG9uZSkge1xuICAgICAgICAgIG5nQ29tcG9uZW50RGVmLnNjaGVtYXMgPSBbXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIG5nQ29tcG9uZW50RGVmO1xuICAgIH0sXG4gICAgLy8gTWFrZSB0aGUgcHJvcGVydHkgY29uZmlndXJhYmxlIGluIGRldiBtb2RlIHRvIGFsbG93IG92ZXJyaWRpbmcgaW4gdGVzdHNcbiAgICBjb25maWd1cmFibGU6ICEhbmdEZXZNb2RlLFxuICB9KTtcbn1cblxuLyoqXG4gKiBCdWlsZCBtZW1vaXplZCBgZGlyZWN0aXZlRGVmc2AgYW5kIGBwaXBlRGVmc2AgZnVuY3Rpb25zIGZvciB0aGUgY29tcG9uZW50IGRlZmluaXRpb24gb2YgYVxuICogc3RhbmRhbG9uZSBjb21wb25lbnQsIHdoaWNoIHByb2Nlc3MgYGltcG9ydHNgIGFuZCBmaWx0ZXIgb3V0IGRpcmVjdGl2ZXMgYW5kIHBpcGVzLiBUaGUgdXNlIG9mXG4gKiBtZW1vaXplZCBmdW5jdGlvbnMgaGVyZSBhbGxvd3MgZm9yIHRoZSBkZWxheWVkIHJlc29sdXRpb24gb2YgYW55IGBmb3J3YXJkUmVmYHMgcHJlc2VudCBpbiB0aGVcbiAqIGNvbXBvbmVudCdzIGBpbXBvcnRzYC5cbiAqL1xuZnVuY3Rpb24gZ2V0U3RhbmRhbG9uZURlZkZ1bmN0aW9ucyh0eXBlOiBUeXBlPGFueT4sIGltcG9ydHM6IFR5cGU8YW55PltdKToge1xuICBkaXJlY3RpdmVEZWZzOiAoKSA9PiBEaXJlY3RpdmVEZWZMaXN0LFxuICBwaXBlRGVmczogKCkgPT4gUGlwZURlZkxpc3QsXG59IHtcbiAgbGV0IGNhY2hlZERpcmVjdGl2ZURlZnM6IERpcmVjdGl2ZURlZkxpc3R8bnVsbCA9IG51bGw7XG4gIGxldCBjYWNoZWRQaXBlRGVmczogUGlwZURlZkxpc3R8bnVsbCA9IG51bGw7XG4gIGNvbnN0IGRpcmVjdGl2ZURlZnMgPSAoKSA9PiB7XG4gICAgaWYgKCFVU0VfUlVOVElNRV9ERVBTX1RSQUNLRVJfRk9SX0pJVCkge1xuICAgICAgaWYgKGNhY2hlZERpcmVjdGl2ZURlZnMgPT09IG51bGwpIHtcbiAgICAgICAgLy8gU3RhbmRhbG9uZSBjb21wb25lbnRzIGFyZSBhbHdheXMgYWJsZSB0byBzZWxmLXJlZmVyZW5jZSwgc28gaW5jbHVkZSB0aGUgY29tcG9uZW50J3Mgb3duXG4gICAgICAgIC8vIGRlZmluaXRpb24gaW4gaXRzIGBkaXJlY3RpdmVEZWZzYC5cbiAgICAgICAgY2FjaGVkRGlyZWN0aXZlRGVmcyA9IFtnZXRDb21wb25lbnREZWYodHlwZSkhXTtcbiAgICAgICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8VHlwZTx1bmtub3duPj4oW3R5cGVdKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHJhd0RlcCBvZiBpbXBvcnRzKSB7XG4gICAgICAgICAgbmdEZXZNb2RlICYmIHZlcmlmeVN0YW5kYWxvbmVJbXBvcnQocmF3RGVwLCB0eXBlKTtcblxuICAgICAgICAgIGNvbnN0IGRlcCA9IHJlc29sdmVGb3J3YXJkUmVmKHJhd0RlcCk7XG4gICAgICAgICAgaWYgKHNlZW4uaGFzKGRlcCkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzZWVuLmFkZChkZXApO1xuXG4gICAgICAgICAgaWYgKCEhZ2V0TmdNb2R1bGVEZWYoZGVwKSkge1xuICAgICAgICAgICAgY29uc3Qgc2NvcGUgPSB0cmFuc2l0aXZlU2NvcGVzRm9yKGRlcCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGRpciBvZiBzY29wZS5leHBvcnRlZC5kaXJlY3RpdmVzKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGRlZiA9IGdldENvbXBvbmVudERlZihkaXIpIHx8IGdldERpcmVjdGl2ZURlZihkaXIpO1xuICAgICAgICAgICAgICBpZiAoZGVmICYmICFzZWVuLmhhcyhkaXIpKSB7XG4gICAgICAgICAgICAgICAgc2Vlbi5hZGQoZGlyKTtcbiAgICAgICAgICAgICAgICBjYWNoZWREaXJlY3RpdmVEZWZzLnB1c2goZGVmKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBkZWYgPSBnZXRDb21wb25lbnREZWYoZGVwKSB8fCBnZXREaXJlY3RpdmVEZWYoZGVwKTtcbiAgICAgICAgICAgIGlmIChkZWYpIHtcbiAgICAgICAgICAgICAgY2FjaGVkRGlyZWN0aXZlRGVmcy5wdXNoKGRlZik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gY2FjaGVkRGlyZWN0aXZlRGVmcztcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKG5nRGV2TW9kZSkge1xuICAgICAgICBmb3IgKGNvbnN0IHJhd0RlcCBvZiBpbXBvcnRzKSB7XG4gICAgICAgICAgdmVyaWZ5U3RhbmRhbG9uZUltcG9ydChyYXdEZXAsIHR5cGUpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghaXNDb21wb25lbnQodHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzY29wZSA9IGRlcHNUcmFja2VyLmdldFN0YW5kYWxvbmVDb21wb25lbnRTY29wZSh0eXBlLCBpbXBvcnRzKTtcblxuICAgICAgcmV0dXJuIFsuLi5zY29wZS5jb21waWxhdGlvbi5kaXJlY3RpdmVzXVxuICAgICAgICAgIC5tYXAocCA9PiAoZ2V0Q29tcG9uZW50RGVmKHApIHx8IGdldERpcmVjdGl2ZURlZihwKSkhKVxuICAgICAgICAgIC5maWx0ZXIoZCA9PiBkICE9PSBudWxsKTtcbiAgICB9XG4gIH07XG5cbiAgY29uc3QgcGlwZURlZnMgPSAoKSA9PiB7XG4gICAgaWYgKCFVU0VfUlVOVElNRV9ERVBTX1RSQUNLRVJfRk9SX0pJVCkge1xuICAgICAgaWYgKGNhY2hlZFBpcGVEZWZzID09PSBudWxsKSB7XG4gICAgICAgIGNhY2hlZFBpcGVEZWZzID0gW107XG4gICAgICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0PFR5cGU8dW5rbm93bj4+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCByYXdEZXAgb2YgaW1wb3J0cykge1xuICAgICAgICAgIGNvbnN0IGRlcCA9IHJlc29sdmVGb3J3YXJkUmVmKHJhd0RlcCk7XG4gICAgICAgICAgaWYgKHNlZW4uaGFzKGRlcCkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzZWVuLmFkZChkZXApO1xuXG4gICAgICAgICAgaWYgKCEhZ2V0TmdNb2R1bGVEZWYoZGVwKSkge1xuICAgICAgICAgICAgY29uc3Qgc2NvcGUgPSB0cmFuc2l0aXZlU2NvcGVzRm9yKGRlcCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBpcGUgb2Ygc2NvcGUuZXhwb3J0ZWQucGlwZXMpIHtcbiAgICAgICAgICAgICAgY29uc3QgZGVmID0gZ2V0UGlwZURlZihwaXBlKTtcbiAgICAgICAgICAgICAgaWYgKGRlZiAmJiAhc2Vlbi5oYXMocGlwZSkpIHtcbiAgICAgICAgICAgICAgICBzZWVuLmFkZChwaXBlKTtcbiAgICAgICAgICAgICAgICBjYWNoZWRQaXBlRGVmcy5wdXNoKGRlZik7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgZGVmID0gZ2V0UGlwZURlZihkZXApO1xuICAgICAgICAgICAgaWYgKGRlZikge1xuICAgICAgICAgICAgICBjYWNoZWRQaXBlRGVmcy5wdXNoKGRlZik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gY2FjaGVkUGlwZURlZnM7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChuZ0Rldk1vZGUpIHtcbiAgICAgICAgZm9yIChjb25zdCByYXdEZXAgb2YgaW1wb3J0cykge1xuICAgICAgICAgIHZlcmlmeVN0YW5kYWxvbmVJbXBvcnQocmF3RGVwLCB0eXBlKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoIWlzQ29tcG9uZW50KHR5cGUpKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2NvcGUgPSBkZXBzVHJhY2tlci5nZXRTdGFuZGFsb25lQ29tcG9uZW50U2NvcGUodHlwZSwgaW1wb3J0cyk7XG5cbiAgICAgIHJldHVybiBbLi4uc2NvcGUuY29tcGlsYXRpb24ucGlwZXNdLm1hcChwID0+IGdldFBpcGVEZWYocCkhKS5maWx0ZXIoZCA9PiBkICE9PSBudWxsKTtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBkaXJlY3RpdmVEZWZzLFxuICAgIHBpcGVEZWZzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBoYXNTZWxlY3RvclNjb3BlPFQ+KGNvbXBvbmVudDogVHlwZTxUPik6IGNvbXBvbmVudCBpcyBUeXBlPFQ+JlxuICAgIHtuZ1NlbGVjdG9yU2NvcGU6IFR5cGU8YW55Pn0ge1xuICByZXR1cm4gKGNvbXBvbmVudCBhcyB7bmdTZWxlY3RvclNjb3BlPzogYW55fSkubmdTZWxlY3RvclNjb3BlICE9PSB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogQ29tcGlsZSBhbiBBbmd1bGFyIGRpcmVjdGl2ZSBhY2NvcmRpbmcgdG8gaXRzIGRlY29yYXRvciBtZXRhZGF0YSwgYW5kIHBhdGNoIHRoZSByZXN1bHRpbmdcbiAqIGRpcmVjdGl2ZSBkZWYgb250byB0aGUgY29tcG9uZW50IHR5cGUuXG4gKlxuICogSW4gdGhlIGV2ZW50IHRoYXQgY29tcGlsYXRpb24gaXMgbm90IGltbWVkaWF0ZSwgYGNvbXBpbGVEaXJlY3RpdmVgIHdpbGwgcmV0dXJuIGEgYFByb21pc2VgIHdoaWNoXG4gKiB3aWxsIHJlc29sdmUgd2hlbiBjb21waWxhdGlvbiBjb21wbGV0ZXMgYW5kIHRoZSBkaXJlY3RpdmUgYmVjb21lcyB1c2FibGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlRGlyZWN0aXZlKHR5cGU6IFR5cGU8YW55PiwgZGlyZWN0aXZlOiBEaXJlY3RpdmV8bnVsbCk6IHZvaWQge1xuICBsZXQgbmdEaXJlY3RpdmVEZWY6IGFueSA9IG51bGw7XG5cbiAgYWRkRGlyZWN0aXZlRmFjdG9yeURlZih0eXBlLCBkaXJlY3RpdmUgfHwge30pO1xuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0eXBlLCBOR19ESVJfREVGLCB7XG4gICAgZ2V0OiAoKSA9PiB7XG4gICAgICBpZiAobmdEaXJlY3RpdmVEZWYgPT09IG51bGwpIHtcbiAgICAgICAgLy8gYGRpcmVjdGl2ZWAgY2FuIGJlIG51bGwgaW4gdGhlIGNhc2Ugb2YgYWJzdHJhY3QgZGlyZWN0aXZlcyBhcyBhIGJhc2UgY2xhc3NcbiAgICAgICAgLy8gdGhhdCB1c2UgYEBEaXJlY3RpdmUoKWAgd2l0aCBubyBzZWxlY3Rvci4gSW4gdGhhdCBjYXNlLCBwYXNzIGVtcHR5IG9iamVjdCB0byB0aGVcbiAgICAgICAgLy8gYGRpcmVjdGl2ZU1ldGFkYXRhYCBmdW5jdGlvbiBpbnN0ZWFkIG9mIG51bGwuXG4gICAgICAgIGNvbnN0IG1ldGEgPSBnZXREaXJlY3RpdmVNZXRhZGF0YSh0eXBlLCBkaXJlY3RpdmUgfHwge30pO1xuICAgICAgICBjb25zdCBjb21waWxlciA9XG4gICAgICAgICAgICBnZXRDb21waWxlckZhY2FkZSh7dXNhZ2U6IEppdENvbXBpbGVyVXNhZ2UuRGVjb3JhdG9yLCBraW5kOiAnZGlyZWN0aXZlJywgdHlwZX0pO1xuICAgICAgICBuZ0RpcmVjdGl2ZURlZiA9XG4gICAgICAgICAgICBjb21waWxlci5jb21waWxlRGlyZWN0aXZlKGFuZ3VsYXJDb3JlRW52LCBtZXRhLnNvdXJjZU1hcFVybCwgbWV0YS5tZXRhZGF0YSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmdEaXJlY3RpdmVEZWY7XG4gICAgfSxcbiAgICAvLyBNYWtlIHRoZSBwcm9wZXJ0eSBjb25maWd1cmFibGUgaW4gZGV2IG1vZGUgdG8gYWxsb3cgb3ZlcnJpZGluZyBpbiB0ZXN0c1xuICAgIGNvbmZpZ3VyYWJsZTogISFuZ0Rldk1vZGUsXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBnZXREaXJlY3RpdmVNZXRhZGF0YSh0eXBlOiBUeXBlPGFueT4sIG1ldGFkYXRhOiBEaXJlY3RpdmUpIHtcbiAgY29uc3QgbmFtZSA9IHR5cGUgJiYgdHlwZS5uYW1lO1xuICBjb25zdCBzb3VyY2VNYXBVcmwgPSBgbmc6Ly8vJHtuYW1lfS/JtWRpci5qc2A7XG4gIGNvbnN0IGNvbXBpbGVyID0gZ2V0Q29tcGlsZXJGYWNhZGUoe3VzYWdlOiBKaXRDb21waWxlclVzYWdlLkRlY29yYXRvciwga2luZDogJ2RpcmVjdGl2ZScsIHR5cGV9KTtcbiAgY29uc3QgZmFjYWRlID0gZGlyZWN0aXZlTWV0YWRhdGEodHlwZSBhcyBDb21wb25lbnRUeXBlPGFueT4sIG1ldGFkYXRhKTtcbiAgZmFjYWRlLnR5cGVTb3VyY2VTcGFuID0gY29tcGlsZXIuY3JlYXRlUGFyc2VTb3VyY2VTcGFuKCdEaXJlY3RpdmUnLCBuYW1lLCBzb3VyY2VNYXBVcmwpO1xuICBpZiAoZmFjYWRlLnVzZXNJbmhlcml0YW5jZSkge1xuICAgIGFkZERpcmVjdGl2ZURlZlRvVW5kZWNvcmF0ZWRQYXJlbnRzKHR5cGUpO1xuICB9XG4gIHJldHVybiB7bWV0YWRhdGE6IGZhY2FkZSwgc291cmNlTWFwVXJsfTtcbn1cblxuZnVuY3Rpb24gYWRkRGlyZWN0aXZlRmFjdG9yeURlZih0eXBlOiBUeXBlPGFueT4sIG1ldGFkYXRhOiBEaXJlY3RpdmV8Q29tcG9uZW50KSB7XG4gIGxldCBuZ0ZhY3RvcnlEZWY6IGFueSA9IG51bGw7XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHR5cGUsIE5HX0ZBQ1RPUllfREVGLCB7XG4gICAgZ2V0OiAoKSA9PiB7XG4gICAgICBpZiAobmdGYWN0b3J5RGVmID09PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IG1ldGEgPSBnZXREaXJlY3RpdmVNZXRhZGF0YSh0eXBlLCBtZXRhZGF0YSk7XG4gICAgICAgIGNvbnN0IGNvbXBpbGVyID1cbiAgICAgICAgICAgIGdldENvbXBpbGVyRmFjYWRlKHt1c2FnZTogSml0Q29tcGlsZXJVc2FnZS5EZWNvcmF0b3IsIGtpbmQ6ICdkaXJlY3RpdmUnLCB0eXBlfSk7XG4gICAgICAgIG5nRmFjdG9yeURlZiA9IGNvbXBpbGVyLmNvbXBpbGVGYWN0b3J5KGFuZ3VsYXJDb3JlRW52LCBgbmc6Ly8vJHt0eXBlLm5hbWV9L8m1ZmFjLmpzYCwge1xuICAgICAgICAgIG5hbWU6IG1ldGEubWV0YWRhdGEubmFtZSxcbiAgICAgICAgICB0eXBlOiBtZXRhLm1ldGFkYXRhLnR5cGUsXG4gICAgICAgICAgdHlwZUFyZ3VtZW50Q291bnQ6IDAsXG4gICAgICAgICAgZGVwczogcmVmbGVjdERlcGVuZGVuY2llcyh0eXBlKSxcbiAgICAgICAgICB0YXJnZXQ6IGNvbXBpbGVyLkZhY3RvcnlUYXJnZXQuRGlyZWN0aXZlXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5nRmFjdG9yeURlZjtcbiAgICB9LFxuICAgIC8vIE1ha2UgdGhlIHByb3BlcnR5IGNvbmZpZ3VyYWJsZSBpbiBkZXYgbW9kZSB0byBhbGxvdyBvdmVycmlkaW5nIGluIHRlc3RzXG4gICAgY29uZmlndXJhYmxlOiAhIW5nRGV2TW9kZSxcbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBleHRlbmRzRGlyZWN0bHlGcm9tT2JqZWN0KHR5cGU6IFR5cGU8YW55Pik6IGJvb2xlYW4ge1xuICByZXR1cm4gT2JqZWN0LmdldFByb3RvdHlwZU9mKHR5cGUucHJvdG90eXBlKSA9PT0gT2JqZWN0LnByb3RvdHlwZTtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRoZSBgUjNEaXJlY3RpdmVNZXRhZGF0YWAgZm9yIGEgcGFydGljdWxhciBkaXJlY3RpdmUgKGVpdGhlciBhIGBEaXJlY3RpdmVgIG9yIGFcbiAqIGBDb21wb25lbnRgKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpcmVjdGl2ZU1ldGFkYXRhKHR5cGU6IFR5cGU8YW55PiwgbWV0YWRhdGE6IERpcmVjdGl2ZSk6IFIzRGlyZWN0aXZlTWV0YWRhdGFGYWNhZGUge1xuICAvLyBSZWZsZWN0IGlucHV0cyBhbmQgb3V0cHV0cy5cbiAgY29uc3QgcmVmbGVjdCA9IGdldFJlZmxlY3QoKTtcbiAgY29uc3QgcHJvcE1ldGFkYXRhID0gcmVmbGVjdC5vd25Qcm9wTWV0YWRhdGEodHlwZSk7XG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lOiB0eXBlLm5hbWUsXG4gICAgdHlwZTogdHlwZSxcbiAgICBzZWxlY3RvcjogbWV0YWRhdGEuc2VsZWN0b3IgIT09IHVuZGVmaW5lZCA/IG1ldGFkYXRhLnNlbGVjdG9yIDogbnVsbCxcbiAgICBob3N0OiBtZXRhZGF0YS5ob3N0IHx8IEVNUFRZX09CSixcbiAgICBwcm9wTWV0YWRhdGE6IHByb3BNZXRhZGF0YSxcbiAgICBpbnB1dHM6IG1ldGFkYXRhLmlucHV0cyB8fCBFTVBUWV9BUlJBWSxcbiAgICBvdXRwdXRzOiBtZXRhZGF0YS5vdXRwdXRzIHx8IEVNUFRZX0FSUkFZLFxuICAgIHF1ZXJpZXM6IGV4dHJhY3RRdWVyaWVzTWV0YWRhdGEodHlwZSwgcHJvcE1ldGFkYXRhLCBpc0NvbnRlbnRRdWVyeSksXG4gICAgbGlmZWN5Y2xlOiB7dXNlc09uQ2hhbmdlczogcmVmbGVjdC5oYXNMaWZlY3ljbGVIb29rKHR5cGUsICduZ09uQ2hhbmdlcycpfSxcbiAgICB0eXBlU291cmNlU3BhbjogbnVsbCEsXG4gICAgdXNlc0luaGVyaXRhbmNlOiAhZXh0ZW5kc0RpcmVjdGx5RnJvbU9iamVjdCh0eXBlKSxcbiAgICBleHBvcnRBczogZXh0cmFjdEV4cG9ydEFzKG1ldGFkYXRhLmV4cG9ydEFzKSxcbiAgICBwcm92aWRlcnM6IG1ldGFkYXRhLnByb3ZpZGVycyB8fCBudWxsLFxuICAgIHZpZXdRdWVyaWVzOiBleHRyYWN0UXVlcmllc01ldGFkYXRhKHR5cGUsIHByb3BNZXRhZGF0YSwgaXNWaWV3UXVlcnkpLFxuICAgIGlzU3RhbmRhbG9uZTogISFtZXRhZGF0YS5zdGFuZGFsb25lLFxuICAgIGlzU2lnbmFsOiAhIW1ldGFkYXRhLnNpZ25hbHMsXG4gICAgaG9zdERpcmVjdGl2ZXM6IG1ldGFkYXRhLmhvc3REaXJlY3RpdmVzPy5tYXAoXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXJlY3RpdmUgPT4gdHlwZW9mIGRpcmVjdGl2ZSA9PT0gJ2Z1bmN0aW9uJyA/IHtkaXJlY3RpdmV9IDogZGlyZWN0aXZlKSB8fFxuICAgICAgICBudWxsXG4gIH07XG59XG5cbi8qKlxuICogQWRkcyBhIGRpcmVjdGl2ZSBkZWZpbml0aW9uIHRvIGFsbCBwYXJlbnQgY2xhc3NlcyBvZiBhIHR5cGUgdGhhdCBkb24ndCBoYXZlIGFuIEFuZ3VsYXIgZGVjb3JhdG9yLlxuICovXG5mdW5jdGlvbiBhZGREaXJlY3RpdmVEZWZUb1VuZGVjb3JhdGVkUGFyZW50cyh0eXBlOiBUeXBlPGFueT4pIHtcbiAgY29uc3Qgb2JqUHJvdG90eXBlID0gT2JqZWN0LnByb3RvdHlwZTtcbiAgbGV0IHBhcmVudCA9IE9iamVjdC5nZXRQcm90b3R5cGVPZih0eXBlLnByb3RvdHlwZSkuY29uc3RydWN0b3I7XG5cbiAgLy8gR28gdXAgdGhlIHByb3RvdHlwZSB1bnRpbCB3ZSBoaXQgYE9iamVjdGAuXG4gIHdoaWxlIChwYXJlbnQgJiYgcGFyZW50ICE9PSBvYmpQcm90b3R5cGUpIHtcbiAgICAvLyBTaW5jZSBpbmhlcml0YW5jZSB3b3JrcyBpZiB0aGUgY2xhc3Mgd2FzIGFubm90YXRlZCBhbHJlYWR5LCB3ZSBvbmx5IG5lZWQgdG8gYWRkXG4gICAgLy8gdGhlIGRlZiBpZiB0aGVyZSBhcmUgbm8gYW5ub3RhdGlvbnMgYW5kIHRoZSBkZWYgaGFzbid0IGJlZW4gY3JlYXRlZCBhbHJlYWR5LlxuICAgIGlmICghZ2V0RGlyZWN0aXZlRGVmKHBhcmVudCkgJiYgIWdldENvbXBvbmVudERlZihwYXJlbnQpICYmXG4gICAgICAgIHNob3VsZEFkZEFic3RyYWN0RGlyZWN0aXZlKHBhcmVudCkpIHtcbiAgICAgIGNvbXBpbGVEaXJlY3RpdmUocGFyZW50LCBudWxsKTtcbiAgICB9XG4gICAgcGFyZW50ID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHBhcmVudCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY29udmVydFRvUjNRdWVyeVByZWRpY2F0ZShzZWxlY3RvcjogYW55KTogYW55fHN0cmluZ1tdIHtcbiAgcmV0dXJuIHR5cGVvZiBzZWxlY3RvciA9PT0gJ3N0cmluZycgPyBzcGxpdEJ5Q29tbWEoc2VsZWN0b3IpIDogcmVzb2x2ZUZvcndhcmRSZWYoc2VsZWN0b3IpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvUjNRdWVyeU1ldGFkYXRhKHByb3BlcnR5TmFtZTogc3RyaW5nLCBhbm46IFF1ZXJ5KTogUjNRdWVyeU1ldGFkYXRhRmFjYWRlIHtcbiAgcmV0dXJuIHtcbiAgICBwcm9wZXJ0eU5hbWU6IHByb3BlcnR5TmFtZSxcbiAgICBwcmVkaWNhdGU6IGNvbnZlcnRUb1IzUXVlcnlQcmVkaWNhdGUoYW5uLnNlbGVjdG9yKSxcbiAgICBkZXNjZW5kYW50czogYW5uLmRlc2NlbmRhbnRzLFxuICAgIGZpcnN0OiBhbm4uZmlyc3QsXG4gICAgcmVhZDogYW5uLnJlYWQgPyBhbm4ucmVhZCA6IG51bGwsXG4gICAgc3RhdGljOiAhIWFubi5zdGF0aWMsXG4gICAgZW1pdERpc3RpbmN0Q2hhbmdlc09ubHk6ICEhYW5uLmVtaXREaXN0aW5jdENoYW5nZXNPbmx5LFxuICB9O1xufVxuZnVuY3Rpb24gZXh0cmFjdFF1ZXJpZXNNZXRhZGF0YShcbiAgICB0eXBlOiBUeXBlPGFueT4sIHByb3BNZXRhZGF0YToge1trZXk6IHN0cmluZ106IGFueVtdfSxcbiAgICBpc1F1ZXJ5QW5uOiAoYW5uOiBhbnkpID0+IGFubiBpcyBRdWVyeSk6IFIzUXVlcnlNZXRhZGF0YUZhY2FkZVtdIHtcbiAgY29uc3QgcXVlcmllc01ldGE6IFIzUXVlcnlNZXRhZGF0YUZhY2FkZVtdID0gW107XG4gIGZvciAoY29uc3QgZmllbGQgaW4gcHJvcE1ldGFkYXRhKSB7XG4gICAgaWYgKHByb3BNZXRhZGF0YS5oYXNPd25Qcm9wZXJ0eShmaWVsZCkpIHtcbiAgICAgIGNvbnN0IGFubm90YXRpb25zID0gcHJvcE1ldGFkYXRhW2ZpZWxkXTtcbiAgICAgIGFubm90YXRpb25zLmZvckVhY2goYW5uID0+IHtcbiAgICAgICAgaWYgKGlzUXVlcnlBbm4oYW5uKSkge1xuICAgICAgICAgIGlmICghYW5uLnNlbGVjdG9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgYENhbid0IGNvbnN0cnVjdCBhIHF1ZXJ5IGZvciB0aGUgcHJvcGVydHkgXCIke2ZpZWxkfVwiIG9mIGAgK1xuICAgICAgICAgICAgICAgIGBcIiR7c3RyaW5naWZ5Rm9yRXJyb3IodHlwZSl9XCIgc2luY2UgdGhlIHF1ZXJ5IHNlbGVjdG9yIHdhc24ndCBkZWZpbmVkLmApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoYW5ub3RhdGlvbnMuc29tZShpc0lucHV0QW5ub3RhdGlvbikpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNvbWJpbmUgQElucHV0IGRlY29yYXRvcnMgd2l0aCBxdWVyeSBkZWNvcmF0b3JzYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHF1ZXJpZXNNZXRhLnB1c2goY29udmVydFRvUjNRdWVyeU1ldGFkYXRhKGZpZWxkLCBhbm4pKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBxdWVyaWVzTWV0YTtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdEV4cG9ydEFzKGV4cG9ydEFzOiBzdHJpbmd8dW5kZWZpbmVkKTogc3RyaW5nW118bnVsbCB7XG4gIHJldHVybiBleHBvcnRBcyA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHNwbGl0QnlDb21tYShleHBvcnRBcyk7XG59XG5cbmZ1bmN0aW9uIGlzQ29udGVudFF1ZXJ5KHZhbHVlOiBhbnkpOiB2YWx1ZSBpcyBRdWVyeSB7XG4gIGNvbnN0IG5hbWUgPSB2YWx1ZS5uZ01ldGFkYXRhTmFtZTtcbiAgcmV0dXJuIG5hbWUgPT09ICdDb250ZW50Q2hpbGQnIHx8IG5hbWUgPT09ICdDb250ZW50Q2hpbGRyZW4nO1xufVxuXG5mdW5jdGlvbiBpc1ZpZXdRdWVyeSh2YWx1ZTogYW55KTogdmFsdWUgaXMgUXVlcnkge1xuICBjb25zdCBuYW1lID0gdmFsdWUubmdNZXRhZGF0YU5hbWU7XG4gIHJldHVybiBuYW1lID09PSAnVmlld0NoaWxkJyB8fCBuYW1lID09PSAnVmlld0NoaWxkcmVuJztcbn1cblxuZnVuY3Rpb24gaXNJbnB1dEFubm90YXRpb24odmFsdWU6IGFueSk6IHZhbHVlIGlzIElucHV0IHtcbiAgcmV0dXJuIHZhbHVlLm5nTWV0YWRhdGFOYW1lID09PSAnSW5wdXQnO1xufVxuXG5mdW5jdGlvbiBzcGxpdEJ5Q29tbWEodmFsdWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHZhbHVlLnNwbGl0KCcsJykubWFwKHBpZWNlID0+IHBpZWNlLnRyaW0oKSk7XG59XG5cbmNvbnN0IExJRkVDWUNMRV9IT09LUyA9IFtcbiAgJ25nT25DaGFuZ2VzJywgJ25nT25Jbml0JywgJ25nT25EZXN0cm95JywgJ25nRG9DaGVjaycsICduZ0FmdGVyVmlld0luaXQnLCAnbmdBZnRlclZpZXdDaGVja2VkJyxcbiAgJ25nQWZ0ZXJDb250ZW50SW5pdCcsICduZ0FmdGVyQ29udGVudENoZWNrZWQnXG5dO1xuXG5mdW5jdGlvbiBzaG91bGRBZGRBYnN0cmFjdERpcmVjdGl2ZSh0eXBlOiBUeXBlPGFueT4pOiBib29sZWFuIHtcbiAgY29uc3QgcmVmbGVjdCA9IGdldFJlZmxlY3QoKTtcblxuICBpZiAoTElGRUNZQ0xFX0hPT0tTLnNvbWUoaG9va05hbWUgPT4gcmVmbGVjdC5oYXNMaWZlY3ljbGVIb29rKHR5cGUsIGhvb2tOYW1lKSkpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGNvbnN0IHByb3BNZXRhZGF0YSA9IHJlZmxlY3QucHJvcE1ldGFkYXRhKHR5cGUpO1xuXG4gIGZvciAoY29uc3QgZmllbGQgaW4gcHJvcE1ldGFkYXRhKSB7XG4gICAgY29uc3QgYW5ub3RhdGlvbnMgPSBwcm9wTWV0YWRhdGFbZmllbGRdO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhbm5vdGF0aW9ucy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgY3VycmVudCA9IGFubm90YXRpb25zW2ldO1xuICAgICAgY29uc3QgbWV0YWRhdGFOYW1lID0gY3VycmVudC5uZ01ldGFkYXRhTmFtZTtcblxuICAgICAgaWYgKGlzSW5wdXRBbm5vdGF0aW9uKGN1cnJlbnQpIHx8IGlzQ29udGVudFF1ZXJ5KGN1cnJlbnQpIHx8IGlzVmlld1F1ZXJ5KGN1cnJlbnQpIHx8XG4gICAgICAgICAgbWV0YWRhdGFOYW1lID09PSAnT3V0cHV0JyB8fCBtZXRhZGF0YU5hbWUgPT09ICdIb3N0QmluZGluZycgfHxcbiAgICAgICAgICBtZXRhZGF0YU5hbWUgPT09ICdIb3N0TGlzdGVuZXInKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cbiJdfQ==