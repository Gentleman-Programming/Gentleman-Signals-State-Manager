/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { ResourceLoader } from '@angular/compiler';
import { ApplicationInitStatus, Compiler, COMPILER_OPTIONS, Injector, LOCALE_ID, ModuleWithComponentFactories, provideZoneChangeDetection, resolveForwardRef, ɵclearResolutionOfComponentResourcesQueue, ɵcompileComponent as compileComponent, ɵcompileDirective as compileDirective, ɵcompileNgModuleDefs as compileNgModuleDefs, ɵcompilePipe as compilePipe, ɵDEFAULT_LOCALE_ID as DEFAULT_LOCALE_ID, ɵDEFER_BLOCK_CONFIG as DEFER_BLOCK_CONFIG, ɵDeferBlockBehavior as DeferBlockBehavior, ɵdepsTracker as depsTracker, ɵgenerateStandaloneInDeclarationsError, ɵgetAsyncClassMetadata as getAsyncClassMetadata, ɵgetInjectableDef as getInjectableDef, ɵisComponentDefPendingResolution, ɵisEnvironmentProviders as isEnvironmentProviders, ɵNG_COMP_DEF as NG_COMP_DEF, ɵNG_DIR_DEF as NG_DIR_DEF, ɵNG_INJ_DEF as NG_INJ_DEF, ɵNG_MOD_DEF as NG_MOD_DEF, ɵNG_PIPE_DEF as NG_PIPE_DEF, ɵNgModuleFactory as R3NgModuleFactory, ɵpatchComponentDefWithScope as patchComponentDefWithScope, ɵRender3ComponentFactory as ComponentFactory, ɵRender3NgModuleRef as NgModuleRef, ɵresolveComponentResources, ɵrestoreComponentResolutionQueue, ɵsetLocaleId as setLocaleId, ɵtransitiveScopesFor as transitiveScopesFor, ɵUSE_RUNTIME_DEPS_TRACKER_FOR_JIT as USE_RUNTIME_DEPS_TRACKER_FOR_JIT } from '@angular/core';
import { ComponentResolver, DirectiveResolver, NgModuleResolver, PipeResolver } from './resolvers';
var TestingModuleOverride;
(function (TestingModuleOverride) {
    TestingModuleOverride[TestingModuleOverride["DECLARATION"] = 0] = "DECLARATION";
    TestingModuleOverride[TestingModuleOverride["OVERRIDE_TEMPLATE"] = 1] = "OVERRIDE_TEMPLATE";
})(TestingModuleOverride || (TestingModuleOverride = {}));
function isTestingModuleOverride(value) {
    return value === TestingModuleOverride.DECLARATION ||
        value === TestingModuleOverride.OVERRIDE_TEMPLATE;
}
function assertNoStandaloneComponents(types, resolver, location) {
    types.forEach(type => {
        if (!getAsyncClassMetadata(type)) {
            const component = resolver.resolve(type);
            if (component && component.standalone) {
                throw new Error(ɵgenerateStandaloneInDeclarationsError(type, location));
            }
        }
    });
}
export class TestBedCompiler {
    constructor(platform, additionalModuleTypes) {
        this.platform = platform;
        this.additionalModuleTypes = additionalModuleTypes;
        this.originalComponentResolutionQueue = null;
        // Testing module configuration
        this.declarations = [];
        this.imports = [];
        this.providers = [];
        this.schemas = [];
        // Queues of components/directives/pipes that should be recompiled.
        this.pendingComponents = new Set();
        this.pendingDirectives = new Set();
        this.pendingPipes = new Set();
        // Keep track of all components and directives, so we can patch Providers onto defs later.
        this.seenComponents = new Set();
        this.seenDirectives = new Set();
        // Keep track of overridden modules, so that we can collect all affected ones in the module tree.
        this.overriddenModules = new Set();
        // Store resolved styles for Components that have template overrides present and `styleUrls`
        // defined at the same time.
        this.existingComponentStyles = new Map();
        this.resolvers = initResolvers();
        this.componentToModuleScope = new Map();
        // Map that keeps initial version of component/directive/pipe defs in case
        // we compile a Type again, thus overriding respective static fields. This is
        // required to make sure we restore defs to their initial states between test runs.
        // Note: one class may have multiple defs (for example: ɵmod and ɵinj in case of an
        // NgModule), store all of them in a map.
        this.initialNgDefs = new Map();
        // Array that keeps cleanup operations for initial versions of component/directive/pipe/module
        // defs in case TestBed makes changes to the originals.
        this.defCleanupOps = [];
        this._injector = null;
        this.compilerProviders = null;
        this.providerOverrides = [];
        this.rootProviderOverrides = [];
        // Overrides for injectables with `{providedIn: SomeModule}` need to be tracked and added to that
        // module's provider list.
        this.providerOverridesByModule = new Map();
        this.providerOverridesByToken = new Map();
        this.scopesWithOverriddenProviders = new Set();
        this.testModuleRef = null;
        this.deferBlockBehavior = DeferBlockBehavior.Manual;
        class DynamicTestModule {
        }
        this.testModuleType = DynamicTestModule;
    }
    setCompilerProviders(providers) {
        this.compilerProviders = providers;
        this._injector = null;
    }
    configureTestingModule(moduleDef) {
        // Enqueue any compilation tasks for the directly declared component.
        if (moduleDef.declarations !== undefined) {
            // Verify that there are no standalone components
            assertNoStandaloneComponents(moduleDef.declarations, this.resolvers.component, '"TestBed.configureTestingModule" call');
            this.queueTypeArray(moduleDef.declarations, TestingModuleOverride.DECLARATION);
            this.declarations.push(...moduleDef.declarations);
        }
        // Enqueue any compilation tasks for imported modules.
        if (moduleDef.imports !== undefined) {
            this.queueTypesFromModulesArray(moduleDef.imports);
            this.imports.push(...moduleDef.imports);
        }
        if (moduleDef.providers !== undefined) {
            this.providers.push(...moduleDef.providers);
        }
        if (moduleDef.schemas !== undefined) {
            this.schemas.push(...moduleDef.schemas);
        }
        this.deferBlockBehavior = moduleDef.deferBlockBehavior ?? DeferBlockBehavior.Manual;
    }
    overrideModule(ngModule, override) {
        if (USE_RUNTIME_DEPS_TRACKER_FOR_JIT) {
            depsTracker.clearScopeCacheFor(ngModule);
        }
        this.overriddenModules.add(ngModule);
        // Compile the module right away.
        this.resolvers.module.addOverride(ngModule, override);
        const metadata = this.resolvers.module.resolve(ngModule);
        if (metadata === null) {
            throw invalidTypeError(ngModule.name, 'NgModule');
        }
        this.recompileNgModule(ngModule, metadata);
        // At this point, the module has a valid module def (ɵmod), but the override may have introduced
        // new declarations or imported modules. Ingest any possible new types and add them to the
        // current queue.
        this.queueTypesFromModulesArray([ngModule]);
    }
    overrideComponent(component, override) {
        this.verifyNoStandaloneFlagOverrides(component, override);
        this.resolvers.component.addOverride(component, override);
        this.pendingComponents.add(component);
    }
    overrideDirective(directive, override) {
        this.verifyNoStandaloneFlagOverrides(directive, override);
        this.resolvers.directive.addOverride(directive, override);
        this.pendingDirectives.add(directive);
    }
    overridePipe(pipe, override) {
        this.verifyNoStandaloneFlagOverrides(pipe, override);
        this.resolvers.pipe.addOverride(pipe, override);
        this.pendingPipes.add(pipe);
    }
    verifyNoStandaloneFlagOverrides(type, override) {
        if (override.add?.hasOwnProperty('standalone') || override.set?.hasOwnProperty('standalone') ||
            override.remove?.hasOwnProperty('standalone')) {
            throw new Error(`An override for the ${type.name} class has the \`standalone\` flag. ` +
                `Changing the \`standalone\` flag via TestBed overrides is not supported.`);
        }
    }
    overrideProvider(token, provider) {
        let providerDef;
        if (provider.useFactory !== undefined) {
            providerDef = {
                provide: token,
                useFactory: provider.useFactory,
                deps: provider.deps || [],
                multi: provider.multi
            };
        }
        else if (provider.useValue !== undefined) {
            providerDef = { provide: token, useValue: provider.useValue, multi: provider.multi };
        }
        else {
            providerDef = { provide: token };
        }
        const injectableDef = typeof token !== 'string' ? getInjectableDef(token) : null;
        const providedIn = injectableDef === null ? null : resolveForwardRef(injectableDef.providedIn);
        const overridesBucket = providedIn === 'root' ? this.rootProviderOverrides : this.providerOverrides;
        overridesBucket.push(providerDef);
        // Keep overrides grouped by token as well for fast lookups using token
        this.providerOverridesByToken.set(token, providerDef);
        if (injectableDef !== null && providedIn !== null && typeof providedIn !== 'string') {
            const existingOverrides = this.providerOverridesByModule.get(providedIn);
            if (existingOverrides !== undefined) {
                existingOverrides.push(providerDef);
            }
            else {
                this.providerOverridesByModule.set(providedIn, [providerDef]);
            }
        }
    }
    overrideTemplateUsingTestingModule(type, template) {
        const def = type[NG_COMP_DEF];
        const hasStyleUrls = () => {
            const metadata = this.resolvers.component.resolve(type);
            return !!metadata.styleUrl || !!metadata.styleUrls?.length;
        };
        const overrideStyleUrls = !!def && !ɵisComponentDefPendingResolution(type) && hasStyleUrls();
        // In Ivy, compiling a component does not require knowing the module providing the
        // component's scope, so overrideTemplateUsingTestingModule can be implemented purely via
        // overrideComponent. Important: overriding template requires full Component re-compilation,
        // which may fail in case styleUrls are also present (thus Component is considered as required
        // resolution). In order to avoid this, we preemptively set styleUrls to an empty array,
        // preserve current styles available on Component def and restore styles back once compilation
        // is complete.
        const override = overrideStyleUrls ? { template, styles: [], styleUrls: [], styleUrl: undefined } : { template };
        this.overrideComponent(type, { set: override });
        if (overrideStyleUrls && def.styles && def.styles.length > 0) {
            this.existingComponentStyles.set(type, def.styles);
        }
        // Set the component's scope to be the testing module.
        this.componentToModuleScope.set(type, TestingModuleOverride.OVERRIDE_TEMPLATE);
    }
    async resolvePendingComponentsWithAsyncMetadata() {
        if (this.pendingComponents.size === 0)
            return;
        const promises = [];
        for (const component of this.pendingComponents) {
            const asyncMetadataPromise = getAsyncClassMetadata(component);
            if (asyncMetadataPromise) {
                promises.push(asyncMetadataPromise);
            }
        }
        const resolvedDeps = await Promise.all(promises);
        this.queueTypesFromModulesArray(resolvedDeps.flat(2));
    }
    async compileComponents() {
        this.clearComponentResolutionQueue();
        // Wait for all async metadata for components that were
        // overridden, we need resolved metadata to perform an override
        // and re-compile a component.
        await this.resolvePendingComponentsWithAsyncMetadata();
        // Verify that there were no standalone components present in the `declarations` field
        // during the `TestBed.configureTestingModule` call. We perform this check here in addition
        // to the logic in the `configureTestingModule` function, since at this point we have
        // all async metadata resolved.
        assertNoStandaloneComponents(this.declarations, this.resolvers.component, '"TestBed.configureTestingModule" call');
        // Run compilers for all queued types.
        let needsAsyncResources = this.compileTypesSync();
        // compileComponents() should not be async unless it needs to be.
        if (needsAsyncResources) {
            let resourceLoader;
            let resolver = (url) => {
                if (!resourceLoader) {
                    resourceLoader = this.injector.get(ResourceLoader);
                }
                return Promise.resolve(resourceLoader.get(url));
            };
            await ɵresolveComponentResources(resolver);
        }
    }
    finalize() {
        // One last compile
        this.compileTypesSync();
        // Create the testing module itself.
        this.compileTestModule();
        this.applyTransitiveScopes();
        this.applyProviderOverrides();
        // Patch previously stored `styles` Component values (taken from ɵcmp), in case these
        // Components have `styleUrls` fields defined and template override was requested.
        this.patchComponentsWithExistingStyles();
        // Clear the componentToModuleScope map, so that future compilations don't reset the scope of
        // every component.
        this.componentToModuleScope.clear();
        const parentInjector = this.platform.injector;
        this.testModuleRef = new NgModuleRef(this.testModuleType, parentInjector, []);
        // ApplicationInitStatus.runInitializers() is marked @internal to core.
        // Cast it to any before accessing it.
        this.testModuleRef.injector.get(ApplicationInitStatus).runInitializers();
        // Set locale ID after running app initializers, since locale information might be updated while
        // running initializers. This is also consistent with the execution order while bootstrapping an
        // app (see `packages/core/src/application_ref.ts` file).
        const localeId = this.testModuleRef.injector.get(LOCALE_ID, DEFAULT_LOCALE_ID);
        setLocaleId(localeId);
        return this.testModuleRef;
    }
    /**
     * @internal
     */
    _compileNgModuleSync(moduleType) {
        this.queueTypesFromModulesArray([moduleType]);
        this.compileTypesSync();
        this.applyProviderOverrides();
        this.applyProviderOverridesInScope(moduleType);
        this.applyTransitiveScopes();
    }
    /**
     * @internal
     */
    async _compileNgModuleAsync(moduleType) {
        this.queueTypesFromModulesArray([moduleType]);
        await this.compileComponents();
        this.applyProviderOverrides();
        this.applyProviderOverridesInScope(moduleType);
        this.applyTransitiveScopes();
    }
    /**
     * @internal
     */
    _getModuleResolver() {
        return this.resolvers.module;
    }
    /**
     * @internal
     */
    _getComponentFactories(moduleType) {
        return maybeUnwrapFn(moduleType.ɵmod.declarations).reduce((factories, declaration) => {
            const componentDef = declaration.ɵcmp;
            componentDef && factories.push(new ComponentFactory(componentDef, this.testModuleRef));
            return factories;
        }, []);
    }
    compileTypesSync() {
        // Compile all queued components, directives, pipes.
        let needsAsyncResources = false;
        this.pendingComponents.forEach(declaration => {
            if (getAsyncClassMetadata(declaration)) {
                throw new Error(`Component '${declaration.name}' has unresolved metadata. ` +
                    `Please call \`await TestBed.compileComponents()\` before running this test.`);
            }
            needsAsyncResources = needsAsyncResources || ɵisComponentDefPendingResolution(declaration);
            const metadata = this.resolvers.component.resolve(declaration);
            if (metadata === null) {
                throw invalidTypeError(declaration.name, 'Component');
            }
            this.maybeStoreNgDef(NG_COMP_DEF, declaration);
            compileComponent(declaration, metadata);
        });
        this.pendingComponents.clear();
        this.pendingDirectives.forEach(declaration => {
            const metadata = this.resolvers.directive.resolve(declaration);
            if (metadata === null) {
                throw invalidTypeError(declaration.name, 'Directive');
            }
            this.maybeStoreNgDef(NG_DIR_DEF, declaration);
            compileDirective(declaration, metadata);
        });
        this.pendingDirectives.clear();
        this.pendingPipes.forEach(declaration => {
            const metadata = this.resolvers.pipe.resolve(declaration);
            if (metadata === null) {
                throw invalidTypeError(declaration.name, 'Pipe');
            }
            this.maybeStoreNgDef(NG_PIPE_DEF, declaration);
            compilePipe(declaration, metadata);
        });
        this.pendingPipes.clear();
        return needsAsyncResources;
    }
    applyTransitiveScopes() {
        if (this.overriddenModules.size > 0) {
            // Module overrides (via `TestBed.overrideModule`) might affect scopes that were previously
            // calculated and stored in `transitiveCompileScopes`. If module overrides are present,
            // collect all affected modules and reset scopes to force their re-calculation.
            const testingModuleDef = this.testModuleType[NG_MOD_DEF];
            const affectedModules = this.collectModulesAffectedByOverrides(testingModuleDef.imports);
            if (affectedModules.size > 0) {
                affectedModules.forEach(moduleType => {
                    if (!USE_RUNTIME_DEPS_TRACKER_FOR_JIT) {
                        this.storeFieldOfDefOnType(moduleType, NG_MOD_DEF, 'transitiveCompileScopes');
                        moduleType[NG_MOD_DEF].transitiveCompileScopes = null;
                    }
                    else {
                        depsTracker.clearScopeCacheFor(moduleType);
                    }
                });
            }
        }
        const moduleToScope = new Map();
        const getScopeOfModule = (moduleType) => {
            if (!moduleToScope.has(moduleType)) {
                const isTestingModule = isTestingModuleOverride(moduleType);
                const realType = isTestingModule ? this.testModuleType : moduleType;
                moduleToScope.set(moduleType, transitiveScopesFor(realType));
            }
            return moduleToScope.get(moduleType);
        };
        this.componentToModuleScope.forEach((moduleType, componentType) => {
            const moduleScope = getScopeOfModule(moduleType);
            this.storeFieldOfDefOnType(componentType, NG_COMP_DEF, 'directiveDefs');
            this.storeFieldOfDefOnType(componentType, NG_COMP_DEF, 'pipeDefs');
            // `tView` that is stored on component def contains information about directives and pipes
            // that are in the scope of this component. Patching component scope will cause `tView` to be
            // changed. Store original `tView` before patching scope, so the `tView` (including scope
            // information) is restored back to its previous/original state before running next test.
            this.storeFieldOfDefOnType(componentType, NG_COMP_DEF, 'tView');
            patchComponentDefWithScope(componentType.ɵcmp, moduleScope);
        });
        this.componentToModuleScope.clear();
    }
    applyProviderOverrides() {
        const maybeApplyOverrides = (field) => (type) => {
            const resolver = field === NG_COMP_DEF ? this.resolvers.component : this.resolvers.directive;
            const metadata = resolver.resolve(type);
            if (this.hasProviderOverrides(metadata.providers)) {
                this.patchDefWithProviderOverrides(type, field);
            }
        };
        this.seenComponents.forEach(maybeApplyOverrides(NG_COMP_DEF));
        this.seenDirectives.forEach(maybeApplyOverrides(NG_DIR_DEF));
        this.seenComponents.clear();
        this.seenDirectives.clear();
    }
    /**
     * Applies provider overrides to a given type (either an NgModule or a standalone component)
     * and all imported NgModules and standalone components recursively.
     */
    applyProviderOverridesInScope(type) {
        const hasScope = isStandaloneComponent(type) || isNgModule(type);
        // The function can be re-entered recursively while inspecting dependencies
        // of an NgModule or a standalone component. Exit early if we come across a
        // type that can not have a scope (directive or pipe) or the type is already
        // processed earlier.
        if (!hasScope || this.scopesWithOverriddenProviders.has(type)) {
            return;
        }
        this.scopesWithOverriddenProviders.add(type);
        // NOTE: the line below triggers JIT compilation of the module injector,
        // which also invokes verification of the NgModule semantics, which produces
        // detailed error messages. The fact that the code relies on this line being
        // present here is suspicious and should be refactored in a way that the line
        // below can be moved (for ex. after an early exit check below).
        const injectorDef = type[NG_INJ_DEF];
        // No provider overrides, exit early.
        if (this.providerOverridesByToken.size === 0)
            return;
        if (isStandaloneComponent(type)) {
            // Visit all component dependencies and override providers there.
            const def = getComponentDef(type);
            const dependencies = maybeUnwrapFn(def.dependencies ?? []);
            for (const dependency of dependencies) {
                this.applyProviderOverridesInScope(dependency);
            }
        }
        else {
            const providers = [
                ...injectorDef.providers,
                ...(this.providerOverridesByModule.get(type) || [])
            ];
            if (this.hasProviderOverrides(providers)) {
                this.maybeStoreNgDef(NG_INJ_DEF, type);
                this.storeFieldOfDefOnType(type, NG_INJ_DEF, 'providers');
                injectorDef.providers = this.getOverriddenProviders(providers);
            }
            // Apply provider overrides to imported modules recursively
            const moduleDef = type[NG_MOD_DEF];
            const imports = maybeUnwrapFn(moduleDef.imports);
            for (const importedModule of imports) {
                this.applyProviderOverridesInScope(importedModule);
            }
            // Also override the providers on any ModuleWithProviders imports since those don't appear in
            // the moduleDef.
            for (const importedModule of flatten(injectorDef.imports)) {
                if (isModuleWithProviders(importedModule)) {
                    this.defCleanupOps.push({
                        object: importedModule,
                        fieldName: 'providers',
                        originalValue: importedModule.providers
                    });
                    importedModule.providers = this.getOverriddenProviders(importedModule.providers);
                }
            }
        }
    }
    patchComponentsWithExistingStyles() {
        this.existingComponentStyles.forEach((styles, type) => type[NG_COMP_DEF].styles = styles);
        this.existingComponentStyles.clear();
    }
    queueTypeArray(arr, moduleType) {
        for (const value of arr) {
            if (Array.isArray(value)) {
                this.queueTypeArray(value, moduleType);
            }
            else {
                this.queueType(value, moduleType);
            }
        }
    }
    recompileNgModule(ngModule, metadata) {
        // Cache the initial ngModuleDef as it will be overwritten.
        this.maybeStoreNgDef(NG_MOD_DEF, ngModule);
        this.maybeStoreNgDef(NG_INJ_DEF, ngModule);
        compileNgModuleDefs(ngModule, metadata);
    }
    queueType(type, moduleType) {
        const component = this.resolvers.component.resolve(type);
        if (component) {
            // Check whether a give Type has respective NG def (ɵcmp) and compile if def is
            // missing. That might happen in case a class without any Angular decorators extends another
            // class where Component/Directive/Pipe decorator is defined.
            if (ɵisComponentDefPendingResolution(type) || !type.hasOwnProperty(NG_COMP_DEF)) {
                this.pendingComponents.add(type);
            }
            this.seenComponents.add(type);
            // Keep track of the module which declares this component, so later the component's scope
            // can be set correctly. If the component has already been recorded here, then one of several
            // cases is true:
            // * the module containing the component was imported multiple times (common).
            // * the component is declared in multiple modules (which is an error).
            // * the component was in 'declarations' of the testing module, and also in an imported module
            //   in which case the module scope will be TestingModuleOverride.DECLARATION.
            // * overrideTemplateUsingTestingModule was called for the component in which case the module
            //   scope will be TestingModuleOverride.OVERRIDE_TEMPLATE.
            //
            // If the component was previously in the testing module's 'declarations' (meaning the
            // current value is TestingModuleOverride.DECLARATION), then `moduleType` is the component's
            // real module, which was imported. This pattern is understood to mean that the component
            // should use its original scope, but that the testing module should also contain the
            // component in its scope.
            //
            // Note: standalone components have no associated NgModule, so the `moduleType` can be `null`.
            if (moduleType !== null &&
                (!this.componentToModuleScope.has(type) ||
                    this.componentToModuleScope.get(type) === TestingModuleOverride.DECLARATION)) {
                this.componentToModuleScope.set(type, moduleType);
            }
            return;
        }
        const directive = this.resolvers.directive.resolve(type);
        if (directive) {
            if (!type.hasOwnProperty(NG_DIR_DEF)) {
                this.pendingDirectives.add(type);
            }
            this.seenDirectives.add(type);
            return;
        }
        const pipe = this.resolvers.pipe.resolve(type);
        if (pipe && !type.hasOwnProperty(NG_PIPE_DEF)) {
            this.pendingPipes.add(type);
            return;
        }
    }
    queueTypesFromModulesArray(arr) {
        // Because we may encounter the same NgModule or a standalone Component while processing
        // the dependencies of an NgModule or a standalone Component, we cache them in this set so we
        // can skip ones that have already been seen encountered. In some test setups, this caching
        // resulted in 10X runtime improvement.
        const processedDefs = new Set();
        const queueTypesFromModulesArrayRecur = (arr) => {
            for (const value of arr) {
                if (Array.isArray(value)) {
                    queueTypesFromModulesArrayRecur(value);
                }
                else if (hasNgModuleDef(value)) {
                    const def = value.ɵmod;
                    if (processedDefs.has(def)) {
                        continue;
                    }
                    processedDefs.add(def);
                    // Look through declarations, imports, and exports, and queue
                    // everything found there.
                    this.queueTypeArray(maybeUnwrapFn(def.declarations), value);
                    queueTypesFromModulesArrayRecur(maybeUnwrapFn(def.imports));
                    queueTypesFromModulesArrayRecur(maybeUnwrapFn(def.exports));
                }
                else if (isModuleWithProviders(value)) {
                    queueTypesFromModulesArrayRecur([value.ngModule]);
                }
                else if (isStandaloneComponent(value)) {
                    this.queueType(value, null);
                    const def = getComponentDef(value);
                    if (processedDefs.has(def)) {
                        continue;
                    }
                    processedDefs.add(def);
                    const dependencies = maybeUnwrapFn(def.dependencies ?? []);
                    dependencies.forEach((dependency) => {
                        // Note: in AOT, the `dependencies` might also contain regular
                        // (NgModule-based) Component, Directive and Pipes, so we handle
                        // them separately and proceed with recursive process for standalone
                        // Components and NgModules only.
                        if (isStandaloneComponent(dependency) || hasNgModuleDef(dependency)) {
                            queueTypesFromModulesArrayRecur([dependency]);
                        }
                        else {
                            this.queueType(dependency, null);
                        }
                    });
                }
            }
        };
        queueTypesFromModulesArrayRecur(arr);
    }
    // When module overrides (via `TestBed.overrideModule`) are present, it might affect all modules
    // that import (even transitively) an overridden one. For all affected modules we need to
    // recalculate their scopes for a given test run and restore original scopes at the end. The goal
    // of this function is to collect all affected modules in a set for further processing. Example:
    // if we have the following module hierarchy: A -> B -> C (where `->` means `imports`) and module
    // `C` is overridden, we consider `A` and `B` as affected, since their scopes might become
    // invalidated with the override.
    collectModulesAffectedByOverrides(arr) {
        const seenModules = new Set();
        const affectedModules = new Set();
        const calcAffectedModulesRecur = (arr, path) => {
            for (const value of arr) {
                if (Array.isArray(value)) {
                    // If the value is an array, just flatten it (by invoking this function recursively),
                    // keeping "path" the same.
                    calcAffectedModulesRecur(value, path);
                }
                else if (hasNgModuleDef(value)) {
                    if (seenModules.has(value)) {
                        // If we've seen this module before and it's included into "affected modules" list, mark
                        // the whole path that leads to that module as affected, but do not descend into its
                        // imports, since we already examined them before.
                        if (affectedModules.has(value)) {
                            path.forEach(item => affectedModules.add(item));
                        }
                        continue;
                    }
                    seenModules.add(value);
                    if (this.overriddenModules.has(value)) {
                        path.forEach(item => affectedModules.add(item));
                    }
                    // Examine module imports recursively to look for overridden modules.
                    const moduleDef = value[NG_MOD_DEF];
                    calcAffectedModulesRecur(maybeUnwrapFn(moduleDef.imports), path.concat(value));
                }
            }
        };
        calcAffectedModulesRecur(arr, []);
        return affectedModules;
    }
    /**
     * Preserve an original def (such as ɵmod, ɵinj, etc) before applying an override.
     * Note: one class may have multiple defs (for example: ɵmod and ɵinj in case of
     * an NgModule). If there is a def in a set already, don't override it, since
     * an original one should be restored at the end of a test.
     */
    maybeStoreNgDef(prop, type) {
        if (!this.initialNgDefs.has(type)) {
            this.initialNgDefs.set(type, new Map());
        }
        const currentDefs = this.initialNgDefs.get(type);
        if (!currentDefs.has(prop)) {
            const currentDef = Object.getOwnPropertyDescriptor(type, prop);
            currentDefs.set(prop, currentDef);
        }
    }
    storeFieldOfDefOnType(type, defField, fieldName) {
        const def = type[defField];
        const originalValue = def[fieldName];
        this.defCleanupOps.push({ object: def, fieldName, originalValue });
    }
    /**
     * Clears current components resolution queue, but stores the state of the queue, so we can
     * restore it later. Clearing the queue is required before we try to compile components (via
     * `TestBed.compileComponents`), so that component defs are in sync with the resolution queue.
     */
    clearComponentResolutionQueue() {
        if (this.originalComponentResolutionQueue === null) {
            this.originalComponentResolutionQueue = new Map();
        }
        ɵclearResolutionOfComponentResourcesQueue().forEach((value, key) => this.originalComponentResolutionQueue.set(key, value));
    }
    /*
     * Restores component resolution queue to the previously saved state. This operation is performed
     * as a part of restoring the state after completion of the current set of tests (that might
     * potentially mutate the state).
     */
    restoreComponentResolutionQueue() {
        if (this.originalComponentResolutionQueue !== null) {
            ɵrestoreComponentResolutionQueue(this.originalComponentResolutionQueue);
            this.originalComponentResolutionQueue = null;
        }
    }
    restoreOriginalState() {
        // Process cleanup ops in reverse order so the field's original value is restored correctly (in
        // case there were multiple overrides for the same field).
        forEachRight(this.defCleanupOps, (op) => {
            op.object[op.fieldName] = op.originalValue;
        });
        // Restore initial component/directive/pipe defs
        this.initialNgDefs.forEach((defs, type) => {
            if (USE_RUNTIME_DEPS_TRACKER_FOR_JIT) {
                depsTracker.clearScopeCacheFor(type);
            }
            defs.forEach((descriptor, prop) => {
                if (!descriptor) {
                    // Delete operations are generally undesirable since they have performance
                    // implications on objects they were applied to. In this particular case, situations
                    // where this code is invoked should be quite rare to cause any noticeable impact,
                    // since it's applied only to some test cases (for example when class with no
                    // annotations extends some @Component) when we need to clear 'ɵcmp' field on a given
                    // class to restore its original state (before applying overrides and running tests).
                    delete type[prop];
                }
                else {
                    Object.defineProperty(type, prop, descriptor);
                }
            });
        });
        this.initialNgDefs.clear();
        this.scopesWithOverriddenProviders.clear();
        this.restoreComponentResolutionQueue();
        // Restore the locale ID to the default value, this shouldn't be necessary but we never know
        setLocaleId(DEFAULT_LOCALE_ID);
    }
    compileTestModule() {
        class RootScopeModule {
        }
        compileNgModuleDefs(RootScopeModule, {
            providers: [...this.rootProviderOverrides],
        });
        const providers = [
            provideZoneChangeDetection(),
            { provide: Compiler, useFactory: () => new R3TestCompiler(this) },
            { provide: DEFER_BLOCK_CONFIG, useValue: { behavior: this.deferBlockBehavior } },
            ...this.providers,
            ...this.providerOverrides,
        ];
        const imports = [RootScopeModule, this.additionalModuleTypes, this.imports || []];
        // clang-format off
        compileNgModuleDefs(this.testModuleType, {
            declarations: this.declarations,
            imports,
            schemas: this.schemas,
            providers,
        }, /* allowDuplicateDeclarationsInRoot */ true);
        // clang-format on
        this.applyProviderOverridesInScope(this.testModuleType);
    }
    get injector() {
        if (this._injector !== null) {
            return this._injector;
        }
        const providers = [];
        const compilerOptions = this.platform.injector.get(COMPILER_OPTIONS);
        compilerOptions.forEach(opts => {
            if (opts.providers) {
                providers.push(opts.providers);
            }
        });
        if (this.compilerProviders !== null) {
            providers.push(...this.compilerProviders);
        }
        this._injector = Injector.create({ providers, parent: this.platform.injector });
        return this._injector;
    }
    // get overrides for a specific provider (if any)
    getSingleProviderOverrides(provider) {
        const token = getProviderToken(provider);
        return this.providerOverridesByToken.get(token) || null;
    }
    getProviderOverrides(providers) {
        if (!providers || !providers.length || this.providerOverridesByToken.size === 0)
            return [];
        // There are two flattening operations here. The inner flattenProviders() operates on the
        // metadata's providers and applies a mapping function which retrieves overrides for each
        // incoming provider. The outer flatten() then flattens the produced overrides array. If this is
        // not done, the array can contain other empty arrays (e.g. `[[], []]`) which leak into the
        // providers array and contaminate any error messages that might be generated.
        return flatten(flattenProviders(providers, (provider) => this.getSingleProviderOverrides(provider) || []));
    }
    getOverriddenProviders(providers) {
        if (!providers || !providers.length || this.providerOverridesByToken.size === 0)
            return [];
        const flattenedProviders = flattenProviders(providers);
        const overrides = this.getProviderOverrides(flattenedProviders);
        const overriddenProviders = [...flattenedProviders, ...overrides];
        const final = [];
        const seenOverriddenProviders = new Set();
        // We iterate through the list of providers in reverse order to make sure provider overrides
        // take precedence over the values defined in provider list. We also filter out all providers
        // that have overrides, keeping overridden values only. This is needed, since presence of a
        // provider with `ngOnDestroy` hook will cause this hook to be registered and invoked later.
        forEachRight(overriddenProviders, (provider) => {
            const token = getProviderToken(provider);
            if (this.providerOverridesByToken.has(token)) {
                if (!seenOverriddenProviders.has(token)) {
                    seenOverriddenProviders.add(token);
                    // Treat all overridden providers as `{multi: false}` (even if it's a multi-provider) to
                    // make sure that provided override takes highest precedence and is not combined with
                    // other instances of the same multi provider.
                    final.unshift({ ...provider, multi: false });
                }
            }
            else {
                final.unshift(provider);
            }
        });
        return final;
    }
    hasProviderOverrides(providers) {
        return this.getProviderOverrides(providers).length > 0;
    }
    patchDefWithProviderOverrides(declaration, field) {
        const def = declaration[field];
        if (def && def.providersResolver) {
            this.maybeStoreNgDef(field, declaration);
            const resolver = def.providersResolver;
            const processProvidersFn = (providers) => this.getOverriddenProviders(providers);
            this.storeFieldOfDefOnType(declaration, field, 'providersResolver');
            def.providersResolver = (ngDef) => resolver(ngDef, processProvidersFn);
        }
    }
}
function initResolvers() {
    return {
        module: new NgModuleResolver(),
        component: new ComponentResolver(),
        directive: new DirectiveResolver(),
        pipe: new PipeResolver()
    };
}
function isStandaloneComponent(value) {
    const def = getComponentDef(value);
    return !!def?.standalone;
}
function getComponentDef(value) {
    return value.ɵcmp ?? null;
}
function hasNgModuleDef(value) {
    return value.hasOwnProperty('ɵmod');
}
function isNgModule(value) {
    return hasNgModuleDef(value);
}
function maybeUnwrapFn(maybeFn) {
    return maybeFn instanceof Function ? maybeFn() : maybeFn;
}
function flatten(values) {
    const out = [];
    values.forEach(value => {
        if (Array.isArray(value)) {
            out.push(...flatten(value));
        }
        else {
            out.push(value);
        }
    });
    return out;
}
function identityFn(value) {
    return value;
}
function flattenProviders(providers, mapFn = identityFn) {
    const out = [];
    for (let provider of providers) {
        if (isEnvironmentProviders(provider)) {
            provider = provider.ɵproviders;
        }
        if (Array.isArray(provider)) {
            out.push(...flattenProviders(provider, mapFn));
        }
        else {
            out.push(mapFn(provider));
        }
    }
    return out;
}
function getProviderField(provider, field) {
    return provider && typeof provider === 'object' && provider[field];
}
function getProviderToken(provider) {
    return getProviderField(provider, 'provide') || provider;
}
function isModuleWithProviders(value) {
    return value.hasOwnProperty('ngModule');
}
function forEachRight(values, fn) {
    for (let idx = values.length - 1; idx >= 0; idx--) {
        fn(values[idx], idx);
    }
}
function invalidTypeError(name, expectedType) {
    return new Error(`${name} class doesn't have @${expectedType} decorator or is missing metadata.`);
}
class R3TestCompiler {
    constructor(testBed) {
        this.testBed = testBed;
    }
    compileModuleSync(moduleType) {
        this.testBed._compileNgModuleSync(moduleType);
        return new R3NgModuleFactory(moduleType);
    }
    async compileModuleAsync(moduleType) {
        await this.testBed._compileNgModuleAsync(moduleType);
        return new R3NgModuleFactory(moduleType);
    }
    compileModuleAndAllComponentsSync(moduleType) {
        const ngModuleFactory = this.compileModuleSync(moduleType);
        const componentFactories = this.testBed._getComponentFactories(moduleType);
        return new ModuleWithComponentFactories(ngModuleFactory, componentFactories);
    }
    async compileModuleAndAllComponentsAsync(moduleType) {
        const ngModuleFactory = await this.compileModuleAsync(moduleType);
        const componentFactories = this.testBed._getComponentFactories(moduleType);
        return new ModuleWithComponentFactories(ngModuleFactory, componentFactories);
    }
    clearCache() { }
    clearCacheFor(type) { }
    getModuleId(moduleType) {
        const meta = this.testBed._getModuleResolver().resolve(moduleType);
        return meta && meta.id || undefined;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdF9iZWRfY29tcGlsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9jb3JlL3Rlc3Rpbmcvc3JjL3Rlc3RfYmVkX2NvbXBpbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBQyxjQUFjLEVBQUMsTUFBTSxtQkFBbUIsQ0FBQztBQUNqRCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsUUFBUSxFQUFFLGdCQUFnQixFQUF3QixRQUFRLEVBQWdCLFNBQVMsRUFBRSw0QkFBNEIsRUFBdUYsMEJBQTBCLEVBQUUsaUJBQWlCLEVBQXdCLHlDQUF5QyxFQUFFLGlCQUFpQixJQUFJLGdCQUFnQixFQUFFLGlCQUFpQixJQUFJLGdCQUFnQixFQUFFLG9CQUFvQixJQUFJLG1CQUFtQixFQUFFLFlBQVksSUFBSSxXQUFXLEVBQUUsa0JBQWtCLElBQUksaUJBQWlCLEVBQUUsbUJBQW1CLElBQUksa0JBQWtCLEVBQUUsbUJBQW1CLElBQUksa0JBQWtCLEVBQUUsWUFBWSxJQUFJLFdBQVcsRUFBaUMsc0NBQXNDLEVBQUUsc0JBQXNCLElBQUkscUJBQXFCLEVBQUUsaUJBQWlCLElBQUksZ0JBQWdCLEVBQWlFLGdDQUFnQyxFQUFFLHVCQUF1QixJQUFJLHNCQUFzQixFQUFFLFlBQVksSUFBSSxXQUFXLEVBQUUsV0FBVyxJQUFJLFVBQVUsRUFBRSxXQUFXLElBQUksVUFBVSxFQUFFLFdBQVcsSUFBSSxVQUFVLEVBQUUsWUFBWSxJQUFJLFdBQVcsRUFBRSxnQkFBZ0IsSUFBSSxpQkFBaUIsRUFBd0YsMkJBQTJCLElBQUksMEJBQTBCLEVBQUUsd0JBQXdCLElBQUksZ0JBQWdCLEVBQUUsbUJBQW1CLElBQUksV0FBVyxFQUFFLDBCQUEwQixFQUFFLGdDQUFnQyxFQUFFLFlBQVksSUFBSSxXQUFXLEVBQUUsb0JBQW9CLElBQUksbUJBQW1CLEVBQUUsaUNBQWlDLElBQUks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QUMsZUFBZSxFQUFFLGtCQUFrQixDQUFDLENBQUM7SUFDL0UsQ0FBQztJQUVELFVBQVUsS0FBVSxDQUFDO0lBRXJCLGFBQWEsQ0FBQyxJQUFlLElBQVMsQ0FBQztJQUV2QyxXQUFXLENBQUMsVUFBcUI7UUFDL0IsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNuRSxPQUFPLElBQUksSUFBSSxJQUFJLENBQUMsRUFBRSxJQUFJLFNBQVMsQ0FBQztJQUN0QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IHtSZXNvdXJjZUxvYWRlcn0gZnJvbSAnQGFuZ3VsYXIvY29tcGlsZXInO1xuaW1wb3J0IHtBcHBsaWNhdGlvbkluaXRTdGF0dXMsIENvbXBpbGVyLCBDT01QSUxFUl9PUFRJT05TLCBDb21wb25lbnQsIERpcmVjdGl2ZSwgSW5qZWN0b3IsIEluamVjdG9yVHlwZSwgTE9DQUxFX0lELCBNb2R1bGVXaXRoQ29tcG9uZW50RmFjdG9yaWVzLCBNb2R1bGVXaXRoUHJvdmlkZXJzLCBOZ01vZHVsZSwgTmdNb2R1bGVGYWN0b3J5LCBOZ1pvbmUsIFBpcGUsIFBsYXRmb3JtUmVmLCBQcm92aWRlciwgcHJvdmlkZVpvbmVDaGFuZ2VEZXRlY3Rpb24sIHJlc29sdmVGb3J3YXJkUmVmLCBTdGF0aWNQcm92aWRlciwgVHlwZSwgybVjbGVhclJlc29sdXRpb25PZkNvbXBvbmVudFJlc291cmNlc1F1ZXVlLCDJtWNvbXBpbGVDb21wb25lbnQgYXMgY29tcGlsZUNvbXBvbmVudCwgybVjb21waWxlRGlyZWN0aXZlIGFzIGNvbXBpbGVEaXJlY3RpdmUsIMm1Y29tcGlsZU5nTW9kdWxlRGVmcyBhcyBjb21waWxlTmdNb2R1bGVEZWZzLCDJtWNvbXBpbGVQaXBlIGFzIGNvbXBpbGVQaXBlLCDJtURFRkFVTFRfTE9DQUxFX0lEIGFzIERFRkFVTFRfTE9DQUxFX0lELCDJtURFRkVSX0JMT0NLX0NPTkZJRyBhcyBERUZFUl9CTE9DS19DT05GSUcsIMm1RGVmZXJCbG9ja0JlaGF2aW9yIGFzIERlZmVyQmxvY2tCZWhhdmlvciwgybVkZXBzVHJhY2tlciBhcyBkZXBzVHJhY2tlciwgybVEaXJlY3RpdmVEZWYgYXMgRGlyZWN0aXZlRGVmLCDJtWdlbmVyYXRlU3RhbmRhbG9uZUluRGVjbGFyYXRpb25zRXJyb3IsIMm1Z2V0QXN5bmNDbGFzc01ldGFkYXRhIGFzIGdldEFzeW5jQ2xhc3NNZXRhZGF0YSwgybVnZXRJbmplY3RhYmxlRGVmIGFzIGdldEluamVjdGFibGVEZWYsIMm1SW50ZXJuYWxFbnZpcm9ubWVudFByb3ZpZGVycyBhcyBJbnRlcm5hbEVudmlyb25tZW50UHJvdmlkZXJzLCDJtWlzQ29tcG9uZW50RGVmUGVuZGluZ1Jlc29sdXRpb24sIMm1aXNFbnZpcm9ubWVudFByb3ZpZGVycyBhcyBpc0Vudmlyb25tZW50UHJvdmlkZXJzLCDJtU5HX0NPTVBfREVGIGFzIE5HX0NPTVBfREVGLCDJtU5HX0RJUl9ERUYgYXMgTkdfRElSX0RFRiwgybVOR19JTkpfREVGIGFzIE5HX0lOSl9ERUYsIMm1TkdfTU9EX0RFRiBhcyBOR19NT0RfREVGLCDJtU5HX1BJUEVfREVGIGFzIE5HX1BJUEVfREVGLCDJtU5nTW9kdWxlRmFjdG9yeSBhcyBSM05nTW9kdWxlRmFjdG9yeSwgybVOZ01vZHVsZVRyYW5zaXRpdmVTY29wZXMgYXMgTmdNb2R1bGVUcmFuc2l0aXZlU2NvcGVzLCDJtU5nTW9kdWxlVHlwZSBhcyBOZ01vZHVsZVR5cGUsIMm1cGF0Y2hDb21wb25lbnREZWZXaXRoU2NvcGUgYXMgcGF0Y2hDb21wb25lbnREZWZXaXRoU2NvcGUsIMm1UmVuZGVyM0NvbXBvbmVudEZhY3RvcnkgYXMgQ29tcG9uZW50RmFjdG9yeSwgybVSZW5kZXIzTmdNb2R1bGVSZWYgYXMgTmdNb2R1bGVSZWYsIMm1cmVzb2x2ZUNvbXBvbmVudFJlc291cmNlcywgybVyZXN0b3JlQ29tcG9uZW50UmVzb2x1dGlvblF1ZXVlLCDJtXNldExvY2FsZUlkIGFzIHNldExvY2FsZUlkLCDJtXRyYW5zaXRpdmVTY29wZXNGb3IgYXMgdHJhbnNpdGl2ZVNjb3Blc0ZvciwgybVVU0VfUlVOVElNRV9ERVBTX1RSQUNLRVJfRk9SX0pJVCBhcyBVU0VfUlVOVElNRV9ERVBTX1RSQUNLRVJfRk9SX0pJVCwgybXJtUluamVjdGFibGVEZWNsYXJhdGlvbiBhcyBJbmplY3RhYmxlRGVjbGFyYXRpb259IGZyb20gJ0Bhbmd1bGFyL2NvcmUnO1xuXG5pbXBvcnQge0NvbXBvbmVudERlZiwgQ29tcG9uZW50VHlwZX0gZnJvbSAnLi4vLi4vc3JjL3JlbmRlcjMnO1xuXG5pbXBvcnQge01ldGFkYXRhT3ZlcnJpZGV9IGZyb20gJy4vbWV0YWRhdGFfb3ZlcnJpZGUnO1xuaW1wb3J0IHtDb21wb25lbnRSZXNvbHZlciwgRGlyZWN0aXZlUmVzb2x2ZXIsIE5nTW9kdWxlUmVzb2x2ZXIsIFBpcGVSZXNvbHZlciwgUmVzb2x2ZXJ9IGZyb20gJy4vcmVzb2x2ZXJzJztcbmltcG9ydCB7VGVzdE1vZHVsZU1ldGFkYXRhfSBmcm9tICcuL3Rlc3RfYmVkX2NvbW1vbic7XG5cbmVudW0gVGVzdGluZ01vZHVsZU92ZXJyaWRlIHtcbiAgREVDTEFSQVRJT04sXG4gIE9WRVJSSURFX1RFTVBMQVRFLFxufVxuXG5mdW5jdGlvbiBpc1Rlc3RpbmdNb2R1bGVPdmVycmlkZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFRlc3RpbmdNb2R1bGVPdmVycmlkZSB7XG4gIHJldHVybiB2YWx1ZSA9PT0gVGVzdGluZ01vZHVsZU92ZXJyaWRlLkRFQ0xBUkFUSU9OIHx8XG4gICAgICB2YWx1ZSA9PT0gVGVzdGluZ01vZHVsZU92ZXJyaWRlLk9WRVJSSURFX1RFTVBMQVRFO1xufVxuXG5mdW5jdGlvbiBhc3NlcnROb1N0YW5kYWxvbmVDb21wb25lbnRzKFxuICAgIHR5cGVzOiBUeXBlPGFueT5bXSwgcmVzb2x2ZXI6IFJlc29sdmVyPGFueT4sIGxvY2F0aW9uOiBzdHJpbmcpIHtcbiAgdHlwZXMuZm9yRWFjaCh0eXBlID0+IHtcbiAgICBpZiAoIWdldEFzeW5jQ2xhc3NNZXRhZGF0YSh0eXBlKSkge1xuICAgICAgY29uc3QgY29tcG9uZW50ID0gcmVzb2x2ZXIucmVzb2x2ZSh0eXBlKTtcbiAgICAgIGlmIChjb21wb25lbnQgJiYgY29tcG9uZW50LnN0YW5kYWxvbmUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKMm1Z2VuZXJhdGVTdGFuZGFsb25lSW5EZWNsYXJhdGlvbnNFcnJvcih0eXBlLCBsb2NhdGlvbikpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG59XG5cbi8vIFJlc29sdmVycyBmb3IgQW5ndWxhciBkZWNvcmF0b3JzXG50eXBlIFJlc29sdmVycyA9IHtcbiAgbW9kdWxlOiBSZXNvbHZlcjxOZ01vZHVsZT4sXG4gIGNvbXBvbmVudDogUmVzb2x2ZXI8RGlyZWN0aXZlPixcbiAgZGlyZWN0aXZlOiBSZXNvbHZlcjxDb21wb25lbnQ+LFxuICBwaXBlOiBSZXNvbHZlcjxQaXBlPixcbn07XG5cbmludGVyZmFjZSBDbGVhbnVwT3BlcmF0aW9uIHtcbiAgZmllbGROYW1lOiBzdHJpbmc7XG4gIG9iamVjdDogYW55O1xuICBvcmlnaW5hbFZhbHVlOiB1bmtub3duO1xufVxuXG5leHBvcnQgY2xhc3MgVGVzdEJlZENvbXBpbGVyIHtcbiAgcHJpdmF0ZSBvcmlnaW5hbENvbXBvbmVudFJlc29sdXRpb25RdWV1ZTogTWFwPFR5cGU8YW55PiwgQ29tcG9uZW50PnxudWxsID0gbnVsbDtcblxuICAvLyBUZXN0aW5nIG1vZHVsZSBjb25maWd1cmF0aW9uXG4gIHByaXZhdGUgZGVjbGFyYXRpb25zOiBUeXBlPGFueT5bXSA9IFtdO1xuICBwcml2YXRlIGltcG9ydHM6IFR5cGU8YW55PltdID0gW107XG4gIHByaXZhdGUgcHJvdmlkZXJzOiBQcm92aWRlcltdID0gW107XG4gIHByaXZhdGUgc2NoZW1hczogYW55W10gPSBbXTtcblxuICAvLyBRdWV1ZXMgb2YgY29tcG9uZW50cy9kaXJlY3RpdmVzL3BpcGVzIHRoYXQgc2hvdWxkIGJlIHJlY29tcGlsZWQuXG4gIHByaXZhdGUgcGVuZGluZ0NvbXBvbmVudHMgPSBuZXcgU2V0PFR5cGU8YW55Pj4oKTtcbiAgcHJpdmF0ZSBwZW5kaW5nRGlyZWN0aXZlcyA9IG5ldyBTZXQ8VHlwZTxhbnk+PigpO1xuICBwcml2YXRlIHBlbmRpbmdQaXBlcyA9IG5ldyBTZXQ8VHlwZTxhbnk+PigpO1xuXG4gIC8vIEtlZXAgdHJhY2sgb2YgYWxsIGNvbXBvbmVudHMgYW5kIGRpcmVjdGl2ZXMsIHNvIHdlIGNhbiBwYXRjaCBQcm92aWRlcnMgb250byBkZWZzIGxhdGVyLlxuICBwcml2YXRlIHNlZW5Db21wb25lbnRzID0gbmV3IFNldDxUeXBlPGFueT4+KCk7XG4gIHByaXZhdGUgc2VlbkRpcmVjdGl2ZXMgPSBuZXcgU2V0PFR5cGU8YW55Pj4oKTtcblxuICAvLyBLZWVwIHRyYWNrIG9mIG92ZXJyaWRkZW4gbW9kdWxlcywgc28gdGhhdCB3ZSBjYW4gY29sbGVjdCBhbGwgYWZmZWN0ZWQgb25lcyBpbiB0aGUgbW9kdWxlIHRyZWUuXG4gIHByaXZhdGUgb3ZlcnJpZGRlbk1vZHVsZXMgPSBuZXcgU2V0PE5nTW9kdWxlVHlwZTxhbnk+PigpO1xuXG4gIC8vIFN0b3JlIHJlc29sdmVkIHN0eWxlcyBmb3IgQ29tcG9uZW50cyB0aGF0IGhhdmUgdGVtcGxhdGUgb3ZlcnJpZGVzIHByZXNlbnQgYW5kIGBzdHlsZVVybHNgXG4gIC8vIGRlZmluZWQgYXQgdGhlIHNhbWUgdGltZS5cbiAgcHJpdmF0ZSBleGlzdGluZ0NvbXBvbmVudFN0eWxlcyA9IG5ldyBNYXA8VHlwZTxhbnk+LCBzdHJpbmdbXT4oKTtcblxuICBwcml2YXRlIHJlc29sdmVyczogUmVzb2x2ZXJzID0gaW5pdFJlc29sdmVycygpO1xuXG4gIHByaXZhdGUgY29tcG9uZW50VG9Nb2R1bGVTY29wZSA9IG5ldyBNYXA8VHlwZTxhbnk+LCBUeXBlPGFueT58VGVzdGluZ01vZHVsZU92ZXJyaWRlPigpO1xuXG4gIC8vIE1hcCB0aGF0IGtlZXBzIGluaXRpYWwgdmVyc2lvbiBvZiBjb21wb25lbnQvZGlyZWN0aXZlL3BpcGUgZGVmcyBpbiBjYXNlXG4gIC8vIHdlIGNvbXBpbGUgYSBUeXBlIGFnYWluLCB0aHVzIG92ZXJyaWRpbmcgcmVzcGVjdGl2ZSBzdGF0aWMgZmllbGRzLiBUaGlzIGlzXG4gIC8vIHJlcXVpcmVkIHRvIG1ha2Ugc3VyZSB3ZSByZXN0b3JlIGRlZnMgdG8gdGhlaXIgaW5pdGlhbCBzdGF0ZXMgYmV0d2VlbiB0ZXN0IHJ1bnMuXG4gIC8vIE5vdGU6IG9uZSBjbGFzcyBtYXkgaGF2ZSBtdWx0aXBsZSBkZWZzIChmb3IgZXhhbXBsZTogybVtb2QgYW5kIMm1aW5qIGluIGNhc2Ugb2YgYW5cbiAgLy8gTmdNb2R1bGUpLCBzdG9yZSBhbGwgb2YgdGhlbSBpbiBhIG1hcC5cbiAgcHJpdmF0ZSBpbml0aWFsTmdEZWZzID0gbmV3IE1hcDxUeXBlPGFueT4sIE1hcDxzdHJpbmcsIFByb3BlcnR5RGVzY3JpcHRvcnx1bmRlZmluZWQ+PigpO1xuXG4gIC8vIEFycmF5IHRoYXQga2VlcHMgY2xlYW51cCBvcGVyYXRpb25zIGZvciBpbml0aWFsIHZlcnNpb25zIG9mIGNvbXBvbmVudC9kaXJlY3RpdmUvcGlwZS9tb2R1bGVcbiAgLy8gZGVmcyBpbiBjYXNlIFRlc3RCZWQgbWFrZXMgY2hhbmdlcyB0byB0aGUgb3JpZ2luYWxzLlxuICBwcml2YXRlIGRlZkNsZWFudXBPcHM6IENsZWFudXBPcGVyYXRpb25bXSA9IFtdO1xuXG4gIHByaXZhdGUgX2luamVjdG9yOiBJbmplY3RvcnxudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjb21waWxlclByb3ZpZGVyczogUHJvdmlkZXJbXXxudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHByb3ZpZGVyT3ZlcnJpZGVzOiBQcm92aWRlcltdID0gW107XG4gIHByaXZhdGUgcm9vdFByb3ZpZGVyT3ZlcnJpZGVzOiBQcm92aWRlcltdID0gW107XG4gIC8vIE92ZXJyaWRlcyBmb3IgaW5qZWN0YWJsZXMgd2l0aCBge3Byb3ZpZGVkSW46IFNvbWVNb2R1bGV9YCBuZWVkIHRvIGJlIHRyYWNrZWQgYW5kIGFkZGVkIHRvIHRoYXRcbiAgLy8gbW9kdWxlJ3MgcHJvdmlkZXIgbGlzdC5cbiAgcHJpdmF0ZSBwcm92aWRlck92ZXJyaWRlc0J5TW9kdWxlID0gbmV3IE1hcDxJbmplY3RvclR5cGU8YW55PiwgUHJvdmlkZXJbXT4oKTtcbiAgcHJpdmF0ZSBwcm92aWRlck92ZXJyaWRlc0J5VG9rZW4gPSBuZXcgTWFwPGFueSwgUHJvdmlkZXI+KCk7XG4gIHByaXZhdGUgc2NvcGVzV2l0aE92ZXJyaWRkZW5Qcm92aWRlcnMgPSBuZXcgU2V0PFR5cGU8YW55Pj4oKTtcblxuICBwcml2YXRlIHRlc3RNb2R1bGVUeXBlOiBOZ01vZHVsZVR5cGU8YW55PjtcbiAgcHJpdmF0ZSB0ZXN0TW9kdWxlUmVmOiBOZ01vZHVsZVJlZjxhbnk+fG51bGwgPSBudWxsO1xuXG4gIHByaXZhdGUgZGVmZXJCbG9ja0JlaGF2aW9yID0gRGVmZXJCbG9ja0JlaGF2aW9yLk1hbnVhbDtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHBsYXRmb3JtOiBQbGF0Zm9ybVJlZiwgcHJpdmF0ZSBhZGRpdGlvbmFsTW9kdWxlVHlwZXM6IFR5cGU8YW55PnxUeXBlPGFueT5bXSkge1xuICAgIGNsYXNzIER5bmFtaWNUZXN0TW9kdWxlIHt9XG4gICAgdGhpcy50ZXN0TW9kdWxlVHlwZSA9IER5bmFtaWNUZXN0TW9kdWxlIGFzIGFueTtcbiAgfVxuXG4gIHNldENvbXBpbGVyUHJvdmlkZXJzKHByb3ZpZGVyczogUHJvdmlkZXJbXXxudWxsKTogdm9pZCB7XG4gICAgdGhpcy5jb21waWxlclByb3ZpZGVycyA9IHByb3ZpZGVycztcbiAgICB0aGlzLl9pbmplY3RvciA9IG51bGw7XG4gIH1cblxuICBjb25maWd1cmVUZXN0aW5nTW9kdWxlKG1vZHVsZURlZjogVGVzdE1vZHVsZU1ldGFkYXRhKTogdm9pZCB7XG4gICAgLy8gRW5xdWV1ZSBhbnkgY29tcGlsYXRpb24gdGFza3MgZm9yIHRoZSBkaXJlY3RseSBkZWNsYXJlZCBjb21wb25lbnQuXG4gICAgaWYgKG1vZHVsZURlZi5kZWNsYXJhdGlvbnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gVmVyaWZ5IHRoYXQgdGhlcmUgYXJlIG5vIHN0YW5kYWxvbmUgY29tcG9uZW50c1xuICAgICAgYXNzZXJ0Tm9TdGFuZGFsb25lQ29tcG9uZW50cyhcbiAgICAgICAgICBtb2R1bGVEZWYuZGVjbGFyYXRpb25zLCB0aGlzLnJlc29sdmVycy5jb21wb25lbnQsXG4gICAgICAgICAgJ1wiVGVzdEJlZC5jb25maWd1cmVUZXN0aW5nTW9kdWxlXCIgY2FsbCcpO1xuICAgICAgdGhpcy5xdWV1ZVR5cGVBcnJheShtb2R1bGVEZWYuZGVjbGFyYXRpb25zLCBUZXN0aW5nTW9kdWxlT3ZlcnJpZGUuREVDTEFSQVRJT04pO1xuICAgICAgdGhpcy5kZWNsYXJhdGlvbnMucHVzaCguLi5tb2R1bGVEZWYuZGVjbGFyYXRpb25zKTtcbiAgICB9XG5cbiAgICAvLyBFbnF1ZXVlIGFueSBjb21waWxhdGlvbiB0YXNrcyBmb3IgaW1wb3J0ZWQgbW9kdWxlcy5cbiAgICBpZiAobW9kdWxlRGVmLmltcG9ydHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5xdWV1ZVR5cGVzRnJvbU1vZHVsZXNBcnJheShtb2R1bGVEZWYuaW1wb3J0cyk7XG4gICAgICB0aGlzLmltcG9ydHMucHVzaCguLi5tb2R1bGVEZWYuaW1wb3J0cyk7XG4gICAgfVxuXG4gICAgaWYgKG1vZHVsZURlZi5wcm92aWRlcnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5wcm92aWRlcnMucHVzaCguLi5tb2R1bGVEZWYucHJvdmlkZXJzKTtcbiAgICB9XG5cbiAgICBpZiAobW9kdWxlRGVmLnNjaGVtYXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5zY2hlbWFzLnB1c2goLi4ubW9kdWxlRGVmLnNjaGVtYXMpO1xuICAgIH1cblxuICAgIHRoaXMuZGVmZXJCbG9ja0JlaGF2aW9yID0gbW9kdWxlRGVmLmRlZmVyQmxvY2tCZWhhdmlvciA/PyBEZWZlckJsb2NrQmVoYXZpb3IuTWFudWFsO1xuICB9XG5cbiAgb3ZlcnJpZGVNb2R1bGUobmdNb2R1bGU6IFR5cGU8YW55Piwgb3ZlcnJpZGU6IE1ldGFkYXRhT3ZlcnJpZGU8TmdNb2R1bGU+KTogdm9pZCB7XG4gICAgaWYgKFVTRV9SVU5USU1FX0RFUFNfVFJBQ0tFUl9GT1JfSklUKSB7XG4gICAgICBkZXBzVHJhY2tlci5jbGVhclNjb3BlQ2FjaGVGb3IobmdNb2R1bGUpO1xuICAgIH1cbiAgICB0aGlzLm92ZXJyaWRkZW5Nb2R1bGVzLmFkZChuZ01vZHVsZSBhcyBOZ01vZHVsZVR5cGU8YW55Pik7XG5cbiAgICAvLyBDb21waWxlIHRoZSBtb2R1bGUgcmlnaHQgYXdheS5cbiAgICB0aGlzLnJlc29sdmVycy5tb2R1bGUuYWRkT3ZlcnJpZGUobmdNb2R1bGUsIG92ZXJyaWRlKTtcbiAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMucmVzb2x2ZXJzLm1vZHVsZS5yZXNvbHZlKG5nTW9kdWxlKTtcbiAgICBpZiAobWV0YWRhdGEgPT09IG51bGwpIHtcbiAgICAgIHRocm93IGludmFsaWRUeXBlRXJyb3IobmdNb2R1bGUubmFtZSwgJ05nTW9kdWxlJyk7XG4gICAgfVxuXG4gICAgdGhpcy5yZWNvbXBpbGVOZ01vZHVsZShuZ01vZHVsZSwgbWV0YWRhdGEpO1xuXG4gICAgLy8gQXQgdGhpcyBwb2ludCwgdGhlIG1vZHVsZSBoYXMgYSB2YWxpZCBtb2R1bGUgZGVmICjJtW1vZCksIGJ1dCB0aGUgb3ZlcnJpZGUgbWF5IGhhdmUgaW50cm9kdWNlZFxuICAgIC8vIG5ldyBkZWNsYXJhdGlvbnMgb3IgaW1wb3J0ZWQgbW9kdWxlcy4gSW5nZXN0IGFueSBwb3NzaWJsZSBuZXcgdHlwZXMgYW5kIGFkZCB0aGVtIHRvIHRoZVxuICAgIC8vIGN1cnJlbnQgcXVldWUuXG4gICAgdGhpcy5xdWV1ZVR5cGVzRnJvbU1vZHVsZXNBcnJheShbbmdNb2R1bGVdKTtcbiAgfVxuXG4gIG92ZXJyaWRlQ29tcG9uZW50KGNvbXBvbmVudDogVHlwZTxhbnk+LCBvdmVycmlkZTogTWV0YWRhdGFPdmVycmlkZTxDb21wb25lbnQ+KTogdm9pZCB7XG4gICAgdGhpcy52ZXJpZnlOb1N0YW5kYWxvbmVGbGFnT3ZlcnJpZGVzKGNvbXBvbmVudCwgb3ZlcnJpZGUpO1xuICAgIHRoaXMucmVzb2x2ZXJzLmNvbXBvbmVudC5hZGRPdmVycmlkZShjb21wb25lbnQsIG92ZXJyaWRlKTtcbiAgICB0aGlzLnBlbmRpbmdDb21wb25lbnRzLmFkZChjb21wb25lbnQpO1xuICB9XG5cbiAgb3ZlcnJpZGVEaXJlY3RpdmUoZGlyZWN0aXZlOiBUeXBlPGFueT4sIG92ZXJyaWRlOiBNZXRhZGF0YU92ZXJyaWRlPERpcmVjdGl2ZT4pOiB2b2lkIHtcbiAgICB0aGlzLnZlcmlmeU5vU3RhbmRhbG9uZUZsYWdPdmVycmlkZXMoZGlyZWN0aXZlLCBvdmVycmlkZSk7XG4gICAgdGhpcy5yZXNvbHZlcnMuZGlyZWN0aXZlLmFkZE92ZXJyaWRlKGRpcmVjdGl2ZSwgb3ZlcnJpZGUpO1xuICAgIHRoaXMucGVuZGluZ0RpcmVjdGl2ZXMuYWRkKGRpcmVjdGl2ZSk7XG4gIH1cblxuICBvdmVycmlkZVBpcGUocGlwZTogVHlwZTxhbnk+LCBvdmVycmlkZTogTWV0YWRhdGFPdmVycmlkZTxQaXBlPik6IHZvaWQge1xuICAgIHRoaXMudmVyaWZ5Tm9TdGFuZGFsb25lRmxhZ092ZXJyaWRlcyhwaXBlLCBvdmVycmlkZSk7XG4gICAgdGhpcy5yZXNvbHZlcnMucGlwZS5hZGRPdmVycmlkZShwaXBlLCBvdmVycmlkZSk7XG4gICAgdGhpcy5wZW5kaW5nUGlwZXMuYWRkKHBpcGUpO1xuICB9XG5cbiAgcHJpdmF0ZSB2ZXJpZnlOb1N0YW5kYWxvbmVGbGFnT3ZlcnJpZGVzKFxuICAgICAgdHlwZTogVHlwZTxhbnk+LCBvdmVycmlkZTogTWV0YWRhdGFPdmVycmlkZTxDb21wb25lbnR8RGlyZWN0aXZlfFBpcGU+KSB7XG4gICAgaWYgKG92ZXJyaWRlLmFkZD8uaGFzT3duUHJvcGVydHkoJ3N0YW5kYWxvbmUnKSB8fCBvdmVycmlkZS5zZXQ/Lmhhc093blByb3BlcnR5KCdzdGFuZGFsb25lJykgfHxcbiAgICAgICAgb3ZlcnJpZGUucmVtb3ZlPy5oYXNPd25Qcm9wZXJ0eSgnc3RhbmRhbG9uZScpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYEFuIG92ZXJyaWRlIGZvciB0aGUgJHt0eXBlLm5hbWV9IGNsYXNzIGhhcyB0aGUgXFxgc3RhbmRhbG9uZVxcYCBmbGFnLiBgICtcbiAgICAgICAgICBgQ2hhbmdpbmcgdGhlIFxcYHN0YW5kYWxvbmVcXGAgZmxhZyB2aWEgVGVzdEJlZCBvdmVycmlkZXMgaXMgbm90IHN1cHBvcnRlZC5gKTtcbiAgICB9XG4gIH1cblxuICBvdmVycmlkZVByb3ZpZGVyKFxuICAgICAgdG9rZW46IGFueSxcbiAgICAgIHByb3ZpZGVyOiB7dXNlRmFjdG9yeT86IEZ1bmN0aW9uLCB1c2VWYWx1ZT86IGFueSwgZGVwcz86IGFueVtdLCBtdWx0aT86IGJvb2xlYW59KTogdm9pZCB7XG4gICAgbGV0IHByb3ZpZGVyRGVmOiBQcm92aWRlcjtcbiAgICBpZiAocHJvdmlkZXIudXNlRmFjdG9yeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwcm92aWRlckRlZiA9IHtcbiAgICAgICAgcHJvdmlkZTogdG9rZW4sXG4gICAgICAgIHVzZUZhY3Rvcnk6IHByb3ZpZGVyLnVzZUZhY3RvcnksXG4gICAgICAgIGRlcHM6IHByb3ZpZGVyLmRlcHMgfHwgW10sXG4gICAgICAgIG11bHRpOiBwcm92aWRlci5tdWx0aVxuICAgICAgfTtcbiAgICB9IGVsc2UgaWYgKHByb3ZpZGVyLnVzZVZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHByb3ZpZGVyRGVmID0ge3Byb3ZpZGU6IHRva2VuLCB1c2VWYWx1ZTogcHJvdmlkZXIudXNlVmFsdWUsIG11bHRpOiBwcm92aWRlci5tdWx0aX07XG4gICAgfSBlbHNlIHtcbiAgICAgIHByb3ZpZGVyRGVmID0ge3Byb3ZpZGU6IHRva2VufTtcbiAgICB9XG5cbiAgICBjb25zdCBpbmplY3RhYmxlRGVmOiBJbmplY3RhYmxlRGVjbGFyYXRpb248YW55PnxudWxsID1cbiAgICAgICAgdHlwZW9mIHRva2VuICE9PSAnc3RyaW5nJyA/IGdldEluamVjdGFibGVEZWYodG9rZW4pIDogbnVsbDtcbiAgICBjb25zdCBwcm92aWRlZEluID0gaW5qZWN0YWJsZURlZiA9PT0gbnVsbCA/IG51bGwgOiByZXNvbHZlRm9yd2FyZFJlZihpbmplY3RhYmxlRGVmLnByb3ZpZGVkSW4pO1xuICAgIGNvbnN0IG92ZXJyaWRlc0J1Y2tldCA9XG4gICAgICAgIHByb3ZpZGVkSW4gPT09ICdyb290JyA/IHRoaXMucm9vdFByb3ZpZGVyT3ZlcnJpZGVzIDogdGhpcy5wcm92aWRlck92ZXJyaWRlcztcbiAgICBvdmVycmlkZXNCdWNrZXQucHVzaChwcm92aWRlckRlZik7XG5cbiAgICAvLyBLZWVwIG92ZXJyaWRlcyBncm91cGVkIGJ5IHRva2VuIGFzIHdlbGwgZm9yIGZhc3QgbG9va3VwcyB1c2luZyB0b2tlblxuICAgIHRoaXMucHJvdmlkZXJPdmVycmlkZXNCeVRva2VuLnNldCh0b2tlbiwgcHJvdmlkZXJEZWYpO1xuICAgIGlmIChpbmplY3RhYmxlRGVmICE9PSBudWxsICYmIHByb3ZpZGVkSW4gIT09IG51bGwgJiYgdHlwZW9mIHByb3ZpZGVkSW4gIT09ICdzdHJpbmcnKSB7XG4gICAgICBjb25zdCBleGlzdGluZ092ZXJyaWRlcyA9IHRoaXMucHJvdmlkZXJPdmVycmlkZXNCeU1vZHVsZS5nZXQocHJvdmlkZWRJbik7XG4gICAgICBpZiAoZXhpc3RpbmdPdmVycmlkZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBleGlzdGluZ092ZXJyaWRlcy5wdXNoKHByb3ZpZGVyRGVmKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucHJvdmlkZXJPdmVycmlkZXNCeU1vZHVsZS5zZXQocHJvdmlkZWRJbiwgW3Byb3ZpZGVyRGVmXSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgb3ZlcnJpZGVUZW1wbGF0ZVVzaW5nVGVzdGluZ01vZHVsZSh0eXBlOiBUeXBlPGFueT4sIHRlbXBsYXRlOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBkZWYgPSAodHlwZSBhcyBhbnkpW05HX0NPTVBfREVGXTtcbiAgICBjb25zdCBoYXNTdHlsZVVybHMgPSAoKTogYm9vbGVhbiA9PiB7XG4gICAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMucmVzb2x2ZXJzLmNvbXBvbmVudC5yZXNvbHZlKHR5cGUpISBhcyBDb21wb25lbnQ7XG4gICAgICByZXR1cm4gISFtZXRhZGF0YS5zdHlsZVVybCB8fCAhIW1ldGFkYXRhLnN0eWxlVXJscz8ubGVuZ3RoO1xuICAgIH07XG4gICAgY29uc3Qgb3ZlcnJpZGVTdHlsZVVybHMgPSAhIWRlZiAmJiAhybVpc0NvbXBvbmVudERlZlBlbmRpbmdSZXNvbHV0aW9uKHR5cGUpICYmIGhhc1N0eWxlVXJscygpO1xuXG4gICAgLy8gSW4gSXZ5LCBjb21waWxpbmcgYSBjb21wb25lbnQgZG9lcyBub3QgcmVxdWlyZSBrbm93aW5nIHRoZSBtb2R1bGUgcHJvdmlkaW5nIHRoZVxuICAgIC8vIGNvbXBvbmVudCdzIHNjb3BlLCBzbyBvdmVycmlkZVRlbXBsYXRlVXNpbmdUZXN0aW5nTW9kdWxlIGNhbiBiZSBpbXBsZW1lbnRlZCBwdXJlbHkgdmlhXG4gICAgLy8gb3ZlcnJpZGVDb21wb25lbnQuIEltcG9ydGFudDogb3ZlcnJpZGluZyB0ZW1wbGF0ZSByZXF1aXJlcyBmdWxsIENvbXBvbmVudCByZS1jb21waWxhdGlvbixcbiAgICAvLyB3aGljaCBtYXkgZmFpbCBpbiBjYXNlIHN0eWxlVXJscyBhcmUgYWxzbyBwcmVzZW50ICh0aHVzIENvbXBvbmVudCBpcyBjb25zaWRlcmVkIGFzIHJlcXVpcmVkXG4gICAgLy8gcmVzb2x1dGlvbikuIEluIG9yZGVyIHRvIGF2b2lkIHRoaXMsIHdlIHByZWVtcHRpdmVseSBzZXQgc3R5bGVVcmxzIHRvIGFuIGVtcHR5IGFycmF5LFxuICAgIC8vIHByZXNlcnZlIGN1cnJlbnQgc3R5bGVzIGF2YWlsYWJsZSBvbiBDb21wb25lbnQgZGVmIGFuZCByZXN0b3JlIHN0eWxlcyBiYWNrIG9uY2UgY29tcGlsYXRpb25cbiAgICAvLyBpcyBjb21wbGV0ZS5cbiAgICBjb25zdCBvdmVycmlkZSA9XG4gICAgICAgIG92ZXJyaWRlU3R5bGVVcmxzID8ge3RlbXBsYXRlLCBzdHlsZXM6IFtdLCBzdHlsZVVybHM6IFtdLCBzdHlsZVVybDogdW5kZWZpbmVkfSA6IHt0ZW1wbGF0ZX07XG4gICAgdGhpcy5vdmVycmlkZUNvbXBvbmVudCh0eXBlLCB7c2V0OiBvdmVycmlkZX0pO1xuXG4gICAgaWYgKG92ZXJyaWRlU3R5bGVVcmxzICYmIGRlZi5zdHlsZXMgJiYgZGVmLnN0eWxlcy5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmV4aXN0aW5nQ29tcG9uZW50U3R5bGVzLnNldCh0eXBlLCBkZWYuc3R5bGVzKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgdGhlIGNvbXBvbmVudCdzIHNjb3BlIHRvIGJlIHRoZSB0ZXN0aW5nIG1vZHVsZS5cbiAgICB0aGlzLmNvbXBvbmVudFRvTW9kdWxlU2NvcGUuc2V0KHR5cGUsIFRlc3RpbmdNb2R1bGVPdmVycmlkZS5PVkVSUklERV9URU1QTEFURSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVQZW5kaW5nQ29tcG9uZW50c1dpdGhBc3luY01ldGFkYXRhKCkge1xuICAgIGlmICh0aGlzLnBlbmRpbmdDb21wb25lbnRzLnNpemUgPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IHByb21pc2VzID0gW107XG4gICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgdGhpcy5wZW5kaW5nQ29tcG9uZW50cykge1xuICAgICAgY29uc3QgYXN5bmNNZXRhZGF0YVByb21pc2UgPSBnZXRBc3luY0NsYXNzTWV0YWRhdGEoY29tcG9uZW50KTtcbiAgICAgIGlmIChhc3luY01ldGFkYXRhUHJvbWlzZSkge1xuICAgICAgICBwcm9taXNlcy5wdXNoKGFzeW5jTWV0YWRhdGFQcm9taXNlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZERlcHMgPSBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgdGhpcy5xdWV1ZVR5cGVzRnJvbU1vZHVsZXNBcnJheShyZXNvbHZlZERlcHMuZmxhdCgyKSk7XG4gIH1cblxuICBhc3luYyBjb21waWxlQ29tcG9uZW50cygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmNsZWFyQ29tcG9uZW50UmVzb2x1dGlvblF1ZXVlKCk7XG5cbiAgICAvLyBXYWl0IGZvciBhbGwgYXN5bmMgbWV0YWRhdGEgZm9yIGNvbXBvbmVudHMgdGhhdCB3ZXJlXG4gICAgLy8gb3ZlcnJpZGRlbiwgd2UgbmVlZCByZXNvbHZlZCBtZXRhZGF0YSB0byBwZXJmb3JtIGFuIG92ZXJyaWRlXG4gICAgLy8gYW5kIHJlLWNvbXBpbGUgYSBjb21wb25lbnQuXG4gICAgYXdhaXQgdGhpcy5yZXNvbHZlUGVuZGluZ0NvbXBvbmVudHNXaXRoQXN5bmNNZXRhZGF0YSgpO1xuXG4gICAgLy8gVmVyaWZ5IHRoYXQgdGhlcmUgd2VyZSBubyBzdGFuZGFsb25lIGNvbXBvbmVudHMgcHJlc2VudCBpbiB0aGUgYGRlY2xhcmF0aW9uc2AgZmllbGRcbiAgICAvLyBkdXJpbmcgdGhlIGBUZXN0QmVkLmNvbmZpZ3VyZVRlc3RpbmdNb2R1bGVgIGNhbGwuIFdlIHBlcmZvcm0gdGhpcyBjaGVjayBoZXJlIGluIGFkZGl0aW9uXG4gICAgLy8gdG8gdGhlIGxvZ2ljIGluIHRoZSBgY29uZmlndXJlVGVzdGluZ01vZHVsZWAgZnVuY3Rpb24sIHNpbmNlIGF0IHRoaXMgcG9pbnQgd2UgaGF2ZVxuICAgIC8vIGFsbCBhc3luYyBtZXRhZGF0YSByZXNvbHZlZC5cbiAgICBhc3NlcnROb1N0YW5kYWxvbmVDb21wb25lbnRzKFxuICAgICAgICB0aGlzLmRlY2xhcmF0aW9ucywgdGhpcy5yZXNvbHZlcnMuY29tcG9uZW50LCAnXCJUZXN0QmVkLmNvbmZpZ3VyZVRlc3RpbmdNb2R1bGVcIiBjYWxsJyk7XG5cbiAgICAvLyBSdW4gY29tcGlsZXJzIGZvciBhbGwgcXVldWVkIHR5cGVzLlxuICAgIGxldCBuZWVkc0FzeW5jUmVzb3VyY2VzID0gdGhpcy5jb21waWxlVHlwZXNTeW5jKCk7XG5cbiAgICAvLyBjb21waWxlQ29tcG9uZW50cygpIHNob3VsZCBub3QgYmUgYXN5bmMgdW5sZXNzIGl0IG5lZWRzIHRvIGJlLlxuICAgIGlmIChuZWVkc0FzeW5jUmVzb3VyY2VzKSB7XG4gICAgICBsZXQgcmVzb3VyY2VMb2FkZXI6IFJlc291cmNlTG9hZGVyO1xuICAgICAgbGV0IHJlc29sdmVyID0gKHVybDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+ID0+IHtcbiAgICAgICAgaWYgKCFyZXNvdXJjZUxvYWRlcikge1xuICAgICAgICAgIHJlc291cmNlTG9hZGVyID0gdGhpcy5pbmplY3Rvci5nZXQoUmVzb3VyY2VMb2FkZXIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzb3VyY2VMb2FkZXIuZ2V0KHVybCkpO1xuICAgICAgfTtcbiAgICAgIGF3YWl0IMm1cmVzb2x2ZUNvbXBvbmVudFJlc291cmNlcyhyZXNvbHZlcik7XG4gICAgfVxuICB9XG5cbiAgZmluYWxpemUoKTogTmdNb2R1bGVSZWY8YW55PiB7XG4gICAgLy8gT25lIGxhc3QgY29tcGlsZVxuICAgIHRoaXMuY29tcGlsZVR5cGVzU3luYygpO1xuXG4gICAgLy8gQ3JlYXRlIHRoZSB0ZXN0aW5nIG1vZHVsZSBpdHNlbGYuXG4gICAgdGhpcy5jb21waWxlVGVzdE1vZHVsZSgpO1xuXG4gICAgdGhpcy5hcHBseVRyYW5zaXRpdmVTY29wZXMoKTtcblxuICAgIHRoaXMuYXBwbHlQcm92aWRlck92ZXJyaWRlcygpO1xuXG4gICAgLy8gUGF0Y2ggcHJldmlvdXNseSBzdG9yZWQgYHN0eWxlc2AgQ29tcG9uZW50IHZhbHVlcyAodGFrZW4gZnJvbSDJtWNtcCksIGluIGNhc2UgdGhlc2VcbiAgICAvLyBDb21wb25lbnRzIGhhdmUgYHN0eWxlVXJsc2AgZmllbGRzIGRlZmluZWQgYW5kIHRlbXBsYXRlIG92ZXJyaWRlIHdhcyByZXF1ZXN0ZWQuXG4gICAgdGhpcy5wYXRjaENvbXBvbmVudHNXaXRoRXhpc3RpbmdTdHlsZXMoKTtcblxuICAgIC8vIENsZWFyIHRoZSBjb21wb25lbnRUb01vZHVsZVNjb3BlIG1hcCwgc28gdGhhdCBmdXR1cmUgY29tcGlsYXRpb25zIGRvbid0IHJlc2V0IHRoZSBzY29wZSBvZlxuICAgIC8vIGV2ZXJ5IGNvbXBvbmVudC5cbiAgICB0aGlzLmNvbXBvbmVudFRvTW9kdWxlU2NvcGUuY2xlYXIoKTtcblxuICAgIGNvbnN0IHBhcmVudEluamVjdG9yID0gdGhpcy5wbGF0Zm9ybS5pbmplY3RvcjtcbiAgICB0aGlzLnRlc3RNb2R1bGVSZWYgPSBuZXcgTmdNb2R1bGVSZWYodGhpcy50ZXN0TW9kdWxlVHlwZSwgcGFyZW50SW5qZWN0b3IsIFtdKTtcblxuICAgIC8vIEFwcGxpY2F0aW9uSW5pdFN0YXR1cy5ydW5Jbml0aWFsaXplcnMoKSBpcyBtYXJrZWQgQGludGVybmFsIHRvIGNvcmUuXG4gICAgLy8gQ2FzdCBpdCB0byBhbnkgYmVmb3JlIGFjY2Vzc2luZyBpdC5cbiAgICAodGhpcy50ZXN0TW9kdWxlUmVmLmluamVjdG9yLmdldChBcHBsaWNhdGlvbkluaXRTdGF0dXMpIGFzIGFueSkucnVuSW5pdGlhbGl6ZXJzKCk7XG5cbiAgICAvLyBTZXQgbG9jYWxlIElEIGFmdGVyIHJ1bm5pbmcgYXBwIGluaXRpYWxpemVycywgc2luY2UgbG9jYWxlIGluZm9ybWF0aW9uIG1pZ2h0IGJlIHVwZGF0ZWQgd2hpbGVcbiAgICAvLyBydW5uaW5nIGluaXRpYWxpemVycy4gVGhpcyBpcyBhbHNvIGNvbnNpc3RlbnQgd2l0aCB0aGUgZXhlY3V0aW9uIG9yZGVyIHdoaWxlIGJvb3RzdHJhcHBpbmcgYW5cbiAgICAvLyBhcHAgKHNlZSBgcGFja2FnZXMvY29yZS9zcmMvYXBwbGljYXRpb25fcmVmLnRzYCBmaWxlKS5cbiAgICBjb25zdCBsb2NhbGVJZCA9IHRoaXMudGVzdE1vZHVsZVJlZi5pbmplY3Rvci5nZXQoTE9DQUxFX0lELCBERUZBVUxUX0xPQ0FMRV9JRCk7XG4gICAgc2V0TG9jYWxlSWQobG9jYWxlSWQpO1xuXG4gICAgcmV0dXJuIHRoaXMudGVzdE1vZHVsZVJlZjtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9jb21waWxlTmdNb2R1bGVTeW5jKG1vZHVsZVR5cGU6IFR5cGU8YW55Pik6IHZvaWQge1xuICAgIHRoaXMucXVldWVUeXBlc0Zyb21Nb2R1bGVzQXJyYXkoW21vZHVsZVR5cGVdKTtcbiAgICB0aGlzLmNvbXBpbGVUeXBlc1N5bmMoKTtcbiAgICB0aGlzLmFwcGx5UHJvdmlkZXJPdmVycmlkZXMoKTtcbiAgICB0aGlzLmFwcGx5UHJvdmlkZXJPdmVycmlkZXNJblNjb3BlKG1vZHVsZVR5cGUpO1xuICAgIHRoaXMuYXBwbHlUcmFuc2l0aXZlU2NvcGVzKCk7XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBfY29tcGlsZU5nTW9kdWxlQXN5bmMobW9kdWxlVHlwZTogVHlwZTxhbnk+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5xdWV1ZVR5cGVzRnJvbU1vZHVsZXNBcnJheShbbW9kdWxlVHlwZV0pO1xuICAgIGF3YWl0IHRoaXMuY29tcGlsZUNvbXBvbmVudHMoKTtcbiAgICB0aGlzLmFwcGx5UHJvdmlkZXJPdmVycmlkZXMoKTtcbiAgICB0aGlzLmFwcGx5UHJvdmlkZXJPdmVycmlkZXNJblNjb3BlKG1vZHVsZVR5cGUpO1xuICAgIHRoaXMuYXBwbHlUcmFuc2l0aXZlU2NvcGVzKCk7XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfZ2V0TW9kdWxlUmVzb2x2ZXIoKTogUmVzb2x2ZXI8TmdNb2R1bGU+IHtcbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlcnMubW9kdWxlO1xuICB9XG5cbiAgLyoqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgX2dldENvbXBvbmVudEZhY3Rvcmllcyhtb2R1bGVUeXBlOiBOZ01vZHVsZVR5cGUpOiBDb21wb25lbnRGYWN0b3J5PGFueT5bXSB7XG4gICAgcmV0dXJuIG1heWJlVW53cmFwRm4obW9kdWxlVHlwZS7JtW1vZC5kZWNsYXJhdGlvbnMpLnJlZHVjZSgoZmFjdG9yaWVzLCBkZWNsYXJhdGlvbikgPT4ge1xuICAgICAgY29uc3QgY29tcG9uZW50RGVmID0gKGRlY2xhcmF0aW9uIGFzIGFueSkuybVjbXA7XG4gICAgICBjb21wb25lbnREZWYgJiYgZmFjdG9yaWVzLnB1c2gobmV3IENvbXBvbmVudEZhY3RvcnkoY29tcG9uZW50RGVmLCB0aGlzLnRlc3RNb2R1bGVSZWYhKSk7XG4gICAgICByZXR1cm4gZmFjdG9yaWVzO1xuICAgIH0sIFtdIGFzIENvbXBvbmVudEZhY3Rvcnk8YW55PltdKTtcbiAgfVxuXG4gIHByaXZhdGUgY29tcGlsZVR5cGVzU3luYygpOiBib29sZWFuIHtcbiAgICAvLyBDb21waWxlIGFsbCBxdWV1ZWQgY29tcG9uZW50cywgZGlyZWN0aXZlcywgcGlwZXMuXG4gICAgbGV0IG5lZWRzQXN5bmNSZXNvdXJjZXMgPSBmYWxzZTtcbiAgICB0aGlzLnBlbmRpbmdDb21wb25lbnRzLmZvckVhY2goZGVjbGFyYXRpb24gPT4ge1xuICAgICAgaWYgKGdldEFzeW5jQ2xhc3NNZXRhZGF0YShkZWNsYXJhdGlvbikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgYENvbXBvbmVudCAnJHtkZWNsYXJhdGlvbi5uYW1lfScgaGFzIHVucmVzb2x2ZWQgbWV0YWRhdGEuIGAgK1xuICAgICAgICAgICAgYFBsZWFzZSBjYWxsIFxcYGF3YWl0IFRlc3RCZWQuY29tcGlsZUNvbXBvbmVudHMoKVxcYCBiZWZvcmUgcnVubmluZyB0aGlzIHRlc3QuYCk7XG4gICAgICB9XG5cbiAgICAgIG5lZWRzQXN5bmNSZXNvdXJjZXMgPSBuZWVkc0FzeW5jUmVzb3VyY2VzIHx8IMm1aXNDb21wb25lbnREZWZQZW5kaW5nUmVzb2x1dGlvbihkZWNsYXJhdGlvbik7XG5cbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy5yZXNvbHZlcnMuY29tcG9uZW50LnJlc29sdmUoZGVjbGFyYXRpb24pO1xuICAgICAgaWYgKG1ldGFkYXRhID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IGludmFsaWRUeXBlRXJyb3IoZGVjbGFyYXRpb24ubmFtZSwgJ0NvbXBvbmVudCcpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm1heWJlU3RvcmVOZ0RlZihOR19DT01QX0RFRiwgZGVjbGFyYXRpb24pO1xuICAgICAgY29tcGlsZUNvbXBvbmVudChkZWNsYXJhdGlvbiwgbWV0YWRhdGEpO1xuICAgIH0pO1xuICAgIHRoaXMucGVuZGluZ0NvbXBvbmVudHMuY2xlYXIoKTtcblxuICAgIHRoaXMucGVuZGluZ0RpcmVjdGl2ZXMuZm9yRWFjaChkZWNsYXJhdGlvbiA9PiB7XG4gICAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMucmVzb2x2ZXJzLmRpcmVjdGl2ZS5yZXNvbHZlKGRlY2xhcmF0aW9uKTtcbiAgICAgIGlmIChtZXRhZGF0YSA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBpbnZhbGlkVHlwZUVycm9yKGRlY2xhcmF0aW9uLm5hbWUsICdEaXJlY3RpdmUnKTtcbiAgICAgIH1cbiAgICAgIHRoaXMubWF5YmVTdG9yZU5nRGVmKE5HX0RJUl9ERUYsIGRlY2xhcmF0aW9uKTtcbiAgICAgIGNvbXBpbGVEaXJlY3RpdmUoZGVjbGFyYXRpb24sIG1ldGFkYXRhKTtcbiAgICB9KTtcbiAgICB0aGlzLnBlbmRpbmdEaXJlY3RpdmVzLmNsZWFyKCk7XG5cbiAgICB0aGlzLnBlbmRpbmdQaXBlcy5mb3JFYWNoKGRlY2xhcmF0aW9uID0+IHtcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy5yZXNvbHZlcnMucGlwZS5yZXNvbHZlKGRlY2xhcmF0aW9uKTtcbiAgICAgIGlmIChtZXRhZGF0YSA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBpbnZhbGlkVHlwZUVycm9yKGRlY2xhcmF0aW9uLm5hbWUsICdQaXBlJyk7XG4gICAgICB9XG4gICAgICB0aGlzLm1heWJlU3RvcmVOZ0RlZihOR19QSVBFX0RFRiwgZGVjbGFyYXRpb24pO1xuICAgICAgY29tcGlsZVBpcGUoZGVjbGFyYXRpb24sIG1ldGFkYXRhKTtcbiAgICB9KTtcbiAgICB0aGlzLnBlbmRpbmdQaXBlcy5jbGVhcigpO1xuXG4gICAgcmV0dXJuIG5lZWRzQXN5bmNSZXNvdXJjZXM7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5VHJhbnNpdGl2ZVNjb3BlcygpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5vdmVycmlkZGVuTW9kdWxlcy5zaXplID4gMCkge1xuICAgICAgLy8gTW9kdWxlIG92ZXJyaWRlcyAodmlhIGBUZXN0QmVkLm92ZXJyaWRlTW9kdWxlYCkgbWlnaHQgYWZmZWN0IHNjb3BlcyB0aGF0IHdlcmUgcHJldmlvdXNseVxuICAgICAgLy8gY2FsY3VsYXRlZCBhbmQgc3RvcmVkIGluIGB0cmFuc2l0aXZlQ29tcGlsZVNjb3Blc2AuIElmIG1vZHVsZSBvdmVycmlkZXMgYXJlIHByZXNlbnQsXG4gICAgICAvLyBjb2xsZWN0IGFsbCBhZmZlY3RlZCBtb2R1bGVzIGFuZCByZXNldCBzY29wZXMgdG8gZm9yY2UgdGhlaXIgcmUtY2FsY3VsYXRpb24uXG4gICAgICBjb25zdCB0ZXN0aW5nTW9kdWxlRGVmID0gKHRoaXMudGVzdE1vZHVsZVR5cGUgYXMgYW55KVtOR19NT0RfREVGXTtcbiAgICAgIGNvbnN0IGFmZmVjdGVkTW9kdWxlcyA9IHRoaXMuY29sbGVjdE1vZHVsZXNBZmZlY3RlZEJ5T3ZlcnJpZGVzKHRlc3RpbmdNb2R1bGVEZWYuaW1wb3J0cyk7XG4gICAgICBpZiAoYWZmZWN0ZWRNb2R1bGVzLnNpemUgPiAwKSB7XG4gICAgICAgIGFmZmVjdGVkTW9kdWxlcy5mb3JFYWNoKG1vZHVsZVR5cGUgPT4ge1xuICAgICAgICAgIGlmICghVVNFX1JVTlRJTUVfREVQU19UUkFDS0VSX0ZPUl9KSVQpIHtcbiAgICAgICAgICAgIHRoaXMuc3RvcmVGaWVsZE9mRGVmT25UeXBlKG1vZHVsZVR5cGUgYXMgYW55LCBOR19NT0RfREVGLCAndHJhbnNpdGl2ZUNvbXBpbGVTY29wZXMnKTtcbiAgICAgICAgICAgIChtb2R1bGVUeXBlIGFzIGFueSlbTkdfTU9EX0RFRl0udHJhbnNpdGl2ZUNvbXBpbGVTY29wZXMgPSBudWxsO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkZXBzVHJhY2tlci5jbGVhclNjb3BlQ2FjaGVGb3IobW9kdWxlVHlwZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtb2R1bGVUb1Njb3BlID0gbmV3IE1hcDxUeXBlPGFueT58VGVzdGluZ01vZHVsZU92ZXJyaWRlLCBOZ01vZHVsZVRyYW5zaXRpdmVTY29wZXM+KCk7XG4gICAgY29uc3QgZ2V0U2NvcGVPZk1vZHVsZSA9XG4gICAgICAgIChtb2R1bGVUeXBlOiBUeXBlPGFueT58VGVzdGluZ01vZHVsZU92ZXJyaWRlKTogTmdNb2R1bGVUcmFuc2l0aXZlU2NvcGVzID0+IHtcbiAgICAgICAgICBpZiAoIW1vZHVsZVRvU2NvcGUuaGFzKG1vZHVsZVR5cGUpKSB7XG4gICAgICAgICAgICBjb25zdCBpc1Rlc3RpbmdNb2R1bGUgPSBpc1Rlc3RpbmdNb2R1bGVPdmVycmlkZShtb2R1bGVUeXBlKTtcbiAgICAgICAgICAgIGNvbnN0IHJlYWxUeXBlID0gaXNUZXN0aW5nTW9kdWxlID8gdGhpcy50ZXN0TW9kdWxlVHlwZSA6IG1vZHVsZVR5cGUgYXMgVHlwZTxhbnk+O1xuICAgICAgICAgICAgbW9kdWxlVG9TY29wZS5zZXQobW9kdWxlVHlwZSwgdHJhbnNpdGl2ZVNjb3Blc0ZvcihyZWFsVHlwZSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbW9kdWxlVG9TY29wZS5nZXQobW9kdWxlVHlwZSkhO1xuICAgICAgICB9O1xuXG4gICAgdGhpcy5jb21wb25lbnRUb01vZHVsZVNjb3BlLmZvckVhY2goKG1vZHVsZVR5cGUsIGNvbXBvbmVudFR5cGUpID0+IHtcbiAgICAgIGNvbnN0IG1vZHVsZVNjb3BlID0gZ2V0U2NvcGVPZk1vZHVsZShtb2R1bGVUeXBlKTtcbiAgICAgIHRoaXMuc3RvcmVGaWVsZE9mRGVmT25UeXBlKGNvbXBvbmVudFR5cGUsIE5HX0NPTVBfREVGLCAnZGlyZWN0aXZlRGVmcycpO1xuICAgICAgdGhpcy5zdG9yZUZpZWxkT2ZEZWZPblR5cGUoY29tcG9uZW50VHlwZSwgTkdfQ09NUF9ERUYsICdwaXBlRGVmcycpO1xuICAgICAgLy8gYHRWaWV3YCB0aGF0IGlzIHN0b3JlZCBvbiBjb21wb25lbnQgZGVmIGNvbnRhaW5zIGluZm9ybWF0aW9uIGFib3V0IGRpcmVjdGl2ZXMgYW5kIHBpcGVzXG4gICAgICAvLyB0aGF0IGFyZSBpbiB0aGUgc2NvcGUgb2YgdGhpcyBjb21wb25lbnQuIFBhdGNoaW5nIGNvbXBvbmVudCBzY29wZSB3aWxsIGNhdXNlIGB0Vmlld2AgdG8gYmVcbiAgICAgIC8vIGNoYW5nZWQuIFN0b3JlIG9yaWdpbmFsIGB0Vmlld2AgYmVmb3JlIHBhdGNoaW5nIHNjb3BlLCBzbyB0aGUgYHRWaWV3YCAoaW5jbHVkaW5nIHNjb3BlXG4gICAgICAvLyBpbmZvcm1hdGlvbikgaXMgcmVzdG9yZWQgYmFjayB0byBpdHMgcHJldmlvdXMvb3JpZ2luYWwgc3RhdGUgYmVmb3JlIHJ1bm5pbmcgbmV4dCB0ZXN0LlxuICAgICAgdGhpcy5zdG9yZUZpZWxkT2ZEZWZPblR5cGUoY29tcG9uZW50VHlwZSwgTkdfQ09NUF9ERUYsICd0VmlldycpO1xuICAgICAgcGF0Y2hDb21wb25lbnREZWZXaXRoU2NvcGUoKGNvbXBvbmVudFR5cGUgYXMgYW55KS7JtWNtcCwgbW9kdWxlU2NvcGUpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5jb21wb25lbnRUb01vZHVsZVNjb3BlLmNsZWFyKCk7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5UHJvdmlkZXJPdmVycmlkZXMoKTogdm9pZCB7XG4gICAgY29uc3QgbWF5YmVBcHBseU92ZXJyaWRlcyA9IChmaWVsZDogc3RyaW5nKSA9PiAodHlwZTogVHlwZTxhbnk+KSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlciA9IGZpZWxkID09PSBOR19DT01QX0RFRiA/IHRoaXMucmVzb2x2ZXJzLmNvbXBvbmVudCA6IHRoaXMucmVzb2x2ZXJzLmRpcmVjdGl2ZTtcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gcmVzb2x2ZXIucmVzb2x2ZSh0eXBlKSE7XG4gICAgICBpZiAodGhpcy5oYXNQcm92aWRlck92ZXJyaWRlcyhtZXRhZGF0YS5wcm92aWRlcnMpKSB7XG4gICAgICAgIHRoaXMucGF0Y2hEZWZXaXRoUHJvdmlkZXJPdmVycmlkZXModHlwZSwgZmllbGQpO1xuICAgICAgfVxuICAgIH07XG4gICAgdGhpcy5zZWVuQ29tcG9uZW50cy5mb3JFYWNoKG1heWJlQXBwbHlPdmVycmlkZXMoTkdfQ09NUF9ERUYpKTtcbiAgICB0aGlzLnNlZW5EaXJlY3RpdmVzLmZvckVhY2gobWF5YmVBcHBseU92ZXJyaWRlcyhOR19ESVJfREVGKSk7XG5cbiAgICB0aGlzLnNlZW5Db21wb25lbnRzLmNsZWFyKCk7XG4gICAgdGhpcy5zZWVuRGlyZWN0aXZlcy5jbGVhcigpO1xuICB9XG5cblxuICAvKipcbiAgICogQXBwbGllcyBwcm92aWRlciBvdmVycmlkZXMgdG8gYSBnaXZlbiB0eXBlIChlaXRoZXIgYW4gTmdNb2R1bGUgb3IgYSBzdGFuZGFsb25lIGNvbXBvbmVudClcbiAgICogYW5kIGFsbCBpbXBvcnRlZCBOZ01vZHVsZXMgYW5kIHN0YW5kYWxvbmUgY29tcG9uZW50cyByZWN1cnNpdmVseS5cbiAgICovXG4gIHByaXZhdGUgYXBwbHlQcm92aWRlck92ZXJyaWRlc0luU2NvcGUodHlwZTogVHlwZTxhbnk+KTogdm9pZCB7XG4gICAgY29uc3QgaGFzU2NvcGUgPSBpc1N0YW5kYWxvbmVDb21wb25lbnQodHlwZSkgfHwgaXNOZ01vZHVsZSh0eXBlKTtcblxuICAgIC8vIFRoZSBmdW5jdGlvbiBjYW4gYmUgcmUtZW50ZXJlZCByZWN1cnNpdmVseSB3aGlsZSBpbnNwZWN0aW5nIGRlcGVuZGVuY2llc1xuICAgIC8vIG9mIGFuIE5nTW9kdWxlIG9yIGEgc3RhbmRhbG9uZSBjb21wb25lbnQuIEV4aXQgZWFybHkgaWYgd2UgY29tZSBhY3Jvc3MgYVxuICAgIC8vIHR5cGUgdGhhdCBjYW4gbm90IGhhdmUgYSBzY29wZSAoZGlyZWN0aXZlIG9yIHBpcGUpIG9yIHRoZSB0eXBlIGlzIGFscmVhZHlcbiAgICAvLyBwcm9jZXNzZWQgZWFybGllci5cbiAgICBpZiAoIWhhc1Njb3BlIHx8IHRoaXMuc2NvcGVzV2l0aE92ZXJyaWRkZW5Qcm92aWRlcnMuaGFzKHR5cGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc2NvcGVzV2l0aE92ZXJyaWRkZW5Qcm92aWRlcnMuYWRkKHR5cGUpO1xuXG4gICAgLy8gTk9URTogdGhlIGxpbmUgYmVsb3cgdHJpZ2dlcnMgSklUIGNvbXBpbGF0aW9uIG9mIHRoZSBtb2R1bGUgaW5qZWN0b3IsXG4gICAgLy8gd2hpY2ggYWxzbyBpbnZva2VzIHZlcmlmaWNhdGlvbiBvZiB0aGUgTmdNb2R1bGUgc2VtYW50aWNzLCB3aGljaCBwcm9kdWNlc1xuICAgIC8vIGRldGFpbGVkIGVycm9yIG1lc3NhZ2VzLiBUaGUgZmFjdCB0aGF0IHRoZSBjb2RlIHJlbGllcyBvbiB0aGlzIGxpbmUgYmVpbmdcbiAgICAvLyBwcmVzZW50IGhlcmUgaXMgc3VzcGljaW91cyBhbmQgc2hvdWxkIGJlIHJlZmFjdG9yZWQgaW4gYSB3YXkgdGhhdCB0aGUgbGluZVxuICAgIC8vIGJlbG93IGNhbiBiZSBtb3ZlZCAoZm9yIGV4LiBhZnRlciBhbiBlYXJseSBleGl0IGNoZWNrIGJlbG93KS5cbiAgICBjb25zdCBpbmplY3RvckRlZjogYW55ID0gKHR5cGUgYXMgYW55KVtOR19JTkpfREVGXTtcblxuICAgIC8vIE5vIHByb3ZpZGVyIG92ZXJyaWRlcywgZXhpdCBlYXJseS5cbiAgICBpZiAodGhpcy5wcm92aWRlck92ZXJyaWRlc0J5VG9rZW4uc2l6ZSA9PT0gMCkgcmV0dXJuO1xuXG4gICAgaWYgKGlzU3RhbmRhbG9uZUNvbXBvbmVudCh0eXBlKSkge1xuICAgICAgLy8gVmlzaXQgYWxsIGNvbXBvbmVudCBkZXBlbmRlbmNpZXMgYW5kIG92ZXJyaWRlIHByb3ZpZGVycyB0aGVyZS5cbiAgICAgIGNvbnN0IGRlZiA9IGdldENvbXBvbmVudERlZih0eXBlKTtcbiAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IG1heWJlVW53cmFwRm4oZGVmLmRlcGVuZGVuY2llcyA/PyBbXSk7XG4gICAgICBmb3IgKGNvbnN0IGRlcGVuZGVuY3kgb2YgZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgIHRoaXMuYXBwbHlQcm92aWRlck92ZXJyaWRlc0luU2NvcGUoZGVwZW5kZW5jeSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHByb3ZpZGVyczogQXJyYXk8UHJvdmlkZXJ8SW50ZXJuYWxFbnZpcm9ubWVudFByb3ZpZGVycz4gPSBbXG4gICAgICAgIC4uLmluamVjdG9yRGVmLnByb3ZpZGVycyxcbiAgICAgICAgLi4uKHRoaXMucHJvdmlkZXJPdmVycmlkZXNCeU1vZHVsZS5nZXQodHlwZSBhcyBJbmplY3RvclR5cGU8YW55PikgfHwgW10pXG4gICAgICBdO1xuICAgICAgaWYgKHRoaXMuaGFzUHJvdmlkZXJPdmVycmlkZXMocHJvdmlkZXJzKSkge1xuICAgICAgICB0aGlzLm1heWJlU3RvcmVOZ0RlZihOR19JTkpfREVGLCB0eXBlKTtcblxuICAgICAgICB0aGlzLnN0b3JlRmllbGRPZkRlZk9uVHlwZSh0eXBlLCBOR19JTkpfREVGLCAncHJvdmlkZXJzJyk7XG4gICAgICAgIGluamVjdG9yRGVmLnByb3ZpZGVycyA9IHRoaXMuZ2V0T3ZlcnJpZGRlblByb3ZpZGVycyhwcm92aWRlcnMpO1xuICAgICAgfVxuXG4gICAgICAvLyBBcHBseSBwcm92aWRlciBvdmVycmlkZXMgdG8gaW1wb3J0ZWQgbW9kdWxlcyByZWN1cnNpdmVseVxuICAgICAgY29uc3QgbW9kdWxlRGVmID0gKHR5cGUgYXMgYW55KVtOR19NT0RfREVGXTtcbiAgICAgIGNvbnN0IGltcG9ydHMgPSBtYXliZVVud3JhcEZuKG1vZHVsZURlZi5pbXBvcnRzKTtcbiAgICAgIGZvciAoY29uc3QgaW1wb3J0ZWRNb2R1bGUgb2YgaW1wb3J0cykge1xuICAgICAgICB0aGlzLmFwcGx5UHJvdmlkZXJPdmVycmlkZXNJblNjb3BlKGltcG9ydGVkTW9kdWxlKTtcbiAgICAgIH1cbiAgICAgIC8vIEFsc28gb3ZlcnJpZGUgdGhlIHByb3ZpZGVycyBvbiBhbnkgTW9kdWxlV2l0aFByb3ZpZGVycyBpbXBvcnRzIHNpbmNlIHRob3NlIGRvbid0IGFwcGVhciBpblxuICAgICAgLy8gdGhlIG1vZHVsZURlZi5cbiAgICAgIGZvciAoY29uc3QgaW1wb3J0ZWRNb2R1bGUgb2YgZmxhdHRlbihpbmplY3RvckRlZi5pbXBvcnRzKSkge1xuICAgICAgICBpZiAoaXNNb2R1bGVXaXRoUHJvdmlkZXJzKGltcG9ydGVkTW9kdWxlKSkge1xuICAgICAgICAgIHRoaXMuZGVmQ2xlYW51cE9wcy5wdXNoKHtcbiAgICAgICAgICAgIG9iamVjdDogaW1wb3J0ZWRNb2R1bGUsXG4gICAgICAgICAgICBmaWVsZE5hbWU6ICdwcm92aWRlcnMnLFxuICAgICAgICAgICAgb3JpZ2luYWxWYWx1ZTogaW1wb3J0ZWRNb2R1bGUucHJvdmlkZXJzXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaW1wb3J0ZWRNb2R1bGUucHJvdmlkZXJzID0gdGhpcy5nZXRPdmVycmlkZGVuUHJvdmlkZXJzKFxuICAgICAgICAgICAgICBpbXBvcnRlZE1vZHVsZS5wcm92aWRlcnMgYXMgQXJyYXk8UHJvdmlkZXJ8SW50ZXJuYWxFbnZpcm9ubWVudFByb3ZpZGVycz4pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwYXRjaENvbXBvbmVudHNXaXRoRXhpc3RpbmdTdHlsZXMoKTogdm9pZCB7XG4gICAgdGhpcy5leGlzdGluZ0NvbXBvbmVudFN0eWxlcy5mb3JFYWNoKFxuICAgICAgICAoc3R5bGVzLCB0eXBlKSA9PiAodHlwZSBhcyBhbnkpW05HX0NPTVBfREVGXS5zdHlsZXMgPSBzdHlsZXMpO1xuICAgIHRoaXMuZXhpc3RpbmdDb21wb25lbnRTdHlsZXMuY2xlYXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgcXVldWVUeXBlQXJyYXkoYXJyOiBhbnlbXSwgbW9kdWxlVHlwZTogVHlwZTxhbnk+fFRlc3RpbmdNb2R1bGVPdmVycmlkZSk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgdmFsdWUgb2YgYXJyKSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdGhpcy5xdWV1ZVR5cGVBcnJheSh2YWx1ZSwgbW9kdWxlVHlwZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnF1ZXVlVHlwZSh2YWx1ZSwgbW9kdWxlVHlwZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZWNvbXBpbGVOZ01vZHVsZShuZ01vZHVsZTogVHlwZTxhbnk+LCBtZXRhZGF0YTogTmdNb2R1bGUpOiB2b2lkIHtcbiAgICAvLyBDYWNoZSB0aGUgaW5pdGlhbCBuZ01vZHVsZURlZiBhcyBpdCB3aWxsIGJlIG92ZXJ3cml0dGVuLlxuICAgIHRoaXMubWF5YmVTdG9yZU5nRGVmKE5HX01PRF9ERUYsIG5nTW9kdWxlKTtcbiAgICB0aGlzLm1heWJlU3RvcmVOZ0RlZihOR19JTkpfREVGLCBuZ01vZHVsZSk7XG5cbiAgICBjb21waWxlTmdNb2R1bGVEZWZzKG5nTW9kdWxlIGFzIE5nTW9kdWxlVHlwZTxhbnk+LCBtZXRhZGF0YSk7XG4gIH1cblxuICBwcml2YXRlIHF1ZXVlVHlwZSh0eXBlOiBUeXBlPGFueT4sIG1vZHVsZVR5cGU6IFR5cGU8YW55PnxUZXN0aW5nTW9kdWxlT3ZlcnJpZGV8bnVsbCk6IHZvaWQge1xuICAgIGNvbnN0IGNvbXBvbmVudCA9IHRoaXMucmVzb2x2ZXJzLmNvbXBvbmVudC5yZXNvbHZlKHR5cGUpO1xuICAgIGlmIChjb21wb25lbnQpIHtcbiAgICAgIC8vIENoZWNrIHdoZXRoZXIgYSBnaXZlIFR5cGUgaGFzIHJlc3BlY3RpdmUgTkcgZGVmICjJtWNtcCkgYW5kIGNvbXBpbGUgaWYgZGVmIGlzXG4gICAgICAvLyBtaXNzaW5nLiBUaGF0IG1pZ2h0IGhhcHBlbiBpbiBjYXNlIGEgY2xhc3Mgd2l0aG91dCBhbnkgQW5ndWxhciBkZWNvcmF0b3JzIGV4dGVuZHMgYW5vdGhlclxuICAgICAgLy8gY2xhc3Mgd2hlcmUgQ29tcG9uZW50L0RpcmVjdGl2ZS9QaXBlIGRlY29yYXRvciBpcyBkZWZpbmVkLlxuICAgICAgaWYgKMm1aXNDb21wb25lbnREZWZQZW5kaW5nUmVzb2x1dGlvbih0eXBlKSB8fCAhdHlwZS5oYXNPd25Qcm9wZXJ0eShOR19DT01QX0RFRikpIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nQ29tcG9uZW50cy5hZGQodHlwZSk7XG4gICAgICB9XG4gICAgICB0aGlzLnNlZW5Db21wb25lbnRzLmFkZCh0eXBlKTtcblxuICAgICAgLy8gS2VlcCB0cmFjayBvZiB0aGUgbW9kdWxlIHdoaWNoIGRlY2xhcmVzIHRoaXMgY29tcG9uZW50LCBzbyBsYXRlciB0aGUgY29tcG9uZW50J3Mgc2NvcGVcbiAgICAgIC8vIGNhbiBiZSBzZXQgY29ycmVjdGx5LiBJZiB0aGUgY29tcG9uZW50IGhhcyBhbHJlYWR5IGJlZW4gcmVjb3JkZWQgaGVyZSwgdGhlbiBvbmUgb2Ygc2V2ZXJhbFxuICAgICAgLy8gY2FzZXMgaXMgdHJ1ZTpcbiAgICAgIC8vICogdGhlIG1vZHVsZSBjb250YWluaW5nIHRoZSBjb21wb25lbnQgd2FzIGltcG9ydGVkIG11bHRpcGxlIHRpbWVzIChjb21tb24pLlxuICAgICAgLy8gKiB0aGUgY29tcG9uZW50IGlzIGRlY2xhcmVkIGluIG11bHRpcGxlIG1vZHVsZXMgKHdoaWNoIGlzIGFuIGVycm9yKS5cbiAgICAgIC8vICogdGhlIGNvbXBvbmVudCB3YXMgaW4gJ2RlY2xhcmF0aW9ucycgb2YgdGhlIHRlc3RpbmcgbW9kdWxlLCBhbmQgYWxzbyBpbiBhbiBpbXBvcnRlZCBtb2R1bGVcbiAgICAgIC8vICAgaW4gd2hpY2ggY2FzZSB0aGUgbW9kdWxlIHNjb3BlIHdpbGwgYmUgVGVzdGluZ01vZHVsZU92ZXJyaWRlLkRFQ0xBUkFUSU9OLlxuICAgICAgLy8gKiBvdmVycmlkZVRlbXBsYXRlVXNpbmdUZXN0aW5nTW9kdWxlIHdhcyBjYWxsZWQgZm9yIHRoZSBjb21wb25lbnQgaW4gd2hpY2ggY2FzZSB0aGUgbW9kdWxlXG4gICAgICAvLyAgIHNjb3BlIHdpbGwgYmUgVGVzdGluZ01vZHVsZU92ZXJyaWRlLk9WRVJSSURFX1RFTVBMQVRFLlxuICAgICAgLy9cbiAgICAgIC8vIElmIHRoZSBjb21wb25lbnQgd2FzIHByZXZpb3VzbHkgaW4gdGhlIHRlc3RpbmcgbW9kdWxlJ3MgJ2RlY2xhcmF0aW9ucycgKG1lYW5pbmcgdGhlXG4gICAgICAvLyBjdXJyZW50IHZhbHVlIGlzIFRlc3RpbmdNb2R1bGVPdmVycmlkZS5ERUNMQVJBVElPTiksIHRoZW4gYG1vZHVsZVR5cGVgIGlzIHRoZSBjb21wb25lbnQnc1xuICAgICAgLy8gcmVhbCBtb2R1bGUsIHdoaWNoIHdhcyBpbXBvcnRlZC4gVGhpcyBwYXR0ZXJuIGlzIHVuZGVyc3Rvb2QgdG8gbWVhbiB0aGF0IHRoZSBjb21wb25lbnRcbiAgICAgIC8vIHNob3VsZCB1c2UgaXRzIG9yaWdpbmFsIHNjb3BlLCBidXQgdGhhdCB0aGUgdGVzdGluZyBtb2R1bGUgc2hvdWxkIGFsc28gY29udGFpbiB0aGVcbiAgICAgIC8vIGNvbXBvbmVudCBpbiBpdHMgc2NvcGUuXG4gICAgICAvL1xuICAgICAgLy8gTm90ZTogc3RhbmRhbG9uZSBjb21wb25lbnRzIGhhdmUgbm8gYXNzb2NpYXRlZCBOZ01vZHVsZSwgc28gdGhlIGBtb2R1bGVUeXBlYCBjYW4gYmUgYG51bGxgLlxuICAgICAgaWYgKG1vZHVsZVR5cGUgIT09IG51bGwgJiZcbiAgICAgICAgICAoIXRoaXMuY29tcG9uZW50VG9Nb2R1bGVTY29wZS5oYXModHlwZSkgfHxcbiAgICAgICAgICAgdGhpcy5jb21wb25lbnRUb01vZHVsZVNjb3BlLmdldCh0eXBlKSA9PT0gVGVzdGluZ01vZHVsZU92ZXJyaWRlLkRFQ0xBUkFUSU9OKSkge1xuICAgICAgICB0aGlzLmNvbXBvbmVudFRvTW9kdWxlU2NvcGUuc2V0KHR5cGUsIG1vZHVsZVR5cGUpO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGRpcmVjdGl2ZSA9IHRoaXMucmVzb2x2ZXJzLmRpcmVjdGl2ZS5yZXNvbHZlKHR5cGUpO1xuICAgIGlmIChkaXJlY3RpdmUpIHtcbiAgICAgIGlmICghdHlwZS5oYXNPd25Qcm9wZXJ0eShOR19ESVJfREVGKSkge1xuICAgICAgICB0aGlzLnBlbmRpbmdEaXJlY3RpdmVzLmFkZCh0eXBlKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuc2VlbkRpcmVjdGl2ZXMuYWRkKHR5cGUpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBpcGUgPSB0aGlzLnJlc29sdmVycy5waXBlLnJlc29sdmUodHlwZSk7XG4gICAgaWYgKHBpcGUgJiYgIXR5cGUuaGFzT3duUHJvcGVydHkoTkdfUElQRV9ERUYpKSB7XG4gICAgICB0aGlzLnBlbmRpbmdQaXBlcy5hZGQodHlwZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBxdWV1ZVR5cGVzRnJvbU1vZHVsZXNBcnJheShhcnI6IGFueVtdKTogdm9pZCB7XG4gICAgLy8gQmVjYXVzZSB3ZSBtYXkgZW5jb3VudGVyIHRoZSBzYW1lIE5nTW9kdWxlIG9yIGEgc3RhbmRhbG9uZSBDb21wb25lbnQgd2hpbGUgcHJvY2Vzc2luZ1xuICAgIC8vIHRoZSBkZXBlbmRlbmNpZXMgb2YgYW4gTmdNb2R1bGUgb3IgYSBzdGFuZGFsb25lIENvbXBvbmVudCwgd2UgY2FjaGUgdGhlbSBpbiB0aGlzIHNldCBzbyB3ZVxuICAgIC8vIGNhbiBza2lwIG9uZXMgdGhhdCBoYXZlIGFscmVhZHkgYmVlbiBzZWVuIGVuY291bnRlcmVkLiBJbiBzb21lIHRlc3Qgc2V0dXBzLCB0aGlzIGNhY2hpbmdcbiAgICAvLyByZXN1bHRlZCBpbiAxMFggcnVudGltZSBpbXByb3ZlbWVudC5cbiAgICBjb25zdCBwcm9jZXNzZWREZWZzID0gbmV3IFNldCgpO1xuICAgIGNvbnN0IHF1ZXVlVHlwZXNGcm9tTW9kdWxlc0FycmF5UmVjdXIgPSAoYXJyOiBhbnlbXSk6IHZvaWQgPT4ge1xuICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiBhcnIpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgcXVldWVUeXBlc0Zyb21Nb2R1bGVzQXJyYXlSZWN1cih2YWx1ZSk7XG4gICAgICAgIH0gZWxzZSBpZiAoaGFzTmdNb2R1bGVEZWYodmFsdWUpKSB7XG4gICAgICAgICAgY29uc3QgZGVmID0gdmFsdWUuybVtb2Q7XG4gICAgICAgICAgaWYgKHByb2Nlc3NlZERlZnMuaGFzKGRlZikpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBwcm9jZXNzZWREZWZzLmFkZChkZWYpO1xuICAgICAgICAgIC8vIExvb2sgdGhyb3VnaCBkZWNsYXJhdGlvbnMsIGltcG9ydHMsIGFuZCBleHBvcnRzLCBhbmQgcXVldWVcbiAgICAgICAgICAvLyBldmVyeXRoaW5nIGZvdW5kIHRoZXJlLlxuICAgICAgICAgIHRoaXMucXVldWVUeXBlQXJyYXkobWF5YmVVbndyYXBGbihkZWYuZGVjbGFyYXRpb25zKSwgdmFsdWUpO1xuICAgICAgICAgIHF1ZXVlVHlwZXNGcm9tTW9kdWxlc0FycmF5UmVjdXIobWF5YmVVbndyYXBGbihkZWYuaW1wb3J0cykpO1xuICAgICAgICAgIHF1ZXVlVHlwZXNGcm9tTW9kdWxlc0FycmF5UmVjdXIobWF5YmVVbndyYXBGbihkZWYuZXhwb3J0cykpO1xuICAgICAgICB9IGVsc2UgaWYgKGlzTW9kdWxlV2l0aFByb3ZpZGVycyh2YWx1ZSkpIHtcbiAgICAgICAgICBxdWV1ZVR5cGVzRnJvbU1vZHVsZXNBcnJheVJlY3VyKFt2YWx1ZS5uZ01vZHVsZV0pO1xuICAgICAgICB9IGVsc2UgaWYgKGlzU3RhbmRhbG9uZUNvbXBvbmVudCh2YWx1ZSkpIHtcbiAgICAgICAgICB0aGlzLnF1ZXVlVHlwZSh2YWx1ZSwgbnVsbCk7XG4gICAgICAgICAgY29uc3QgZGVmID0gZ2V0Q29tcG9uZW50RGVmKHZhbHVlKTtcblxuICAgICAgICAgIGlmIChwcm9jZXNzZWREZWZzLmhhcyhkZWYpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcHJvY2Vzc2VkRGVmcy5hZGQoZGVmKTtcblxuICAgICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IG1heWJlVW53cmFwRm4oZGVmLmRlcGVuZGVuY2llcyA/PyBbXSk7XG4gICAgICAgICAgZGVwZW5kZW5jaWVzLmZvckVhY2goKGRlcGVuZGVuY3kpID0+IHtcbiAgICAgICAgICAgIC8vIE5vdGU6IGluIEFPVCwgdGhlIGBkZXBlbmRlbmNpZXNgIG1pZ2h0IGFsc28gY29udGFpbiByZWd1bGFyXG4gICAgICAgICAgICAvLyAoTmdNb2R1bGUtYmFzZWQpIENvbXBvbmVudCwgRGlyZWN0aXZlIGFuZCBQaXBlcywgc28gd2UgaGFuZGxlXG4gICAgICAgICAgICAvLyB0aGVtIHNlcGFyYXRlbHkgYW5kIHByb2NlZWQgd2l0aCByZWN1cnNpdmUgcHJvY2VzcyBmb3Igc3RhbmRhbG9uZVxuICAgICAgICAgICAgLy8gQ29tcG9uZW50cyBhbmQgTmdNb2R1bGVzIG9ubHkuXG4gICAgICAgICAgICBpZiAoaXNTdGFuZGFsb25lQ29tcG9uZW50KGRlcGVuZGVuY3kpIHx8IGhhc05nTW9kdWxlRGVmKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgIHF1ZXVlVHlwZXNGcm9tTW9kdWxlc0FycmF5UmVjdXIoW2RlcGVuZGVuY3ldKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRoaXMucXVldWVUeXBlKGRlcGVuZGVuY3ksIG51bGwpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgICBxdWV1ZVR5cGVzRnJvbU1vZHVsZXNBcnJheVJlY3VyKGFycik7XG4gIH1cblxuICAvLyBXaGVuIG1vZHVsZSBvdmVycmlkZXMgKHZpYSBgVGVzdEJlZC5vdmVycmlkZU1vZHVsZWApIGFyZSBwcmVzZW50LCBpdCBtaWdodCBhZmZlY3QgYWxsIG1vZHVsZXNcbiAgLy8gdGhhdCBpbXBvcnQgKGV2ZW4gdHJhbnNpdGl2ZWx5KSBhbiBvdmVycmlkZGVuIG9uZS4gRm9yIGFsbCBhZmZlY3RlZCBtb2R1bGVzIHdlIG5lZWQgdG9cbiAgLy8gcmVjYWxjdWxhdGUgdGhlaXIgc2NvcGVzIGZvciBhIGdpdmVuIHRlc3QgcnVuIGFuZCByZXN0b3JlIG9yaWdpbmFsIHNjb3BlcyBhdCB0aGUgZW5kLiBUaGUgZ29hbFxuICAvLyBvZiB0aGlzIGZ1bmN0aW9uIGlzIHRvIGNvbGxlY3QgYWxsIGFmZmVjdGVkIG1vZHVsZXMgaW4gYSBzZXQgZm9yIGZ1cnRoZXIgcHJvY2Vzc2luZy4gRXhhbXBsZTpcbiAgLy8gaWYgd2UgaGF2ZSB0aGUgZm9sbG93aW5nIG1vZHVsZSBoaWVyYXJjaHk6IEEgLT4gQiAtPiBDICh3aGVyZSBgLT5gIG1lYW5zIGBpbXBvcnRzYCkgYW5kIG1vZHVsZVxuICAvLyBgQ2AgaXMgb3ZlcnJpZGRlbiwgd2UgY29uc2lkZXIgYEFgIGFuZCBgQmAgYXMgYWZmZWN0ZWQsIHNpbmNlIHRoZWlyIHNjb3BlcyBtaWdodCBiZWNvbWVcbiAgLy8gaW52YWxpZGF0ZWQgd2l0aCB0aGUgb3ZlcnJpZGUuXG4gIHByaXZhdGUgY29sbGVjdE1vZHVsZXNBZmZlY3RlZEJ5T3ZlcnJpZGVzKGFycjogYW55W10pOiBTZXQ8TmdNb2R1bGVUeXBlPGFueT4+IHtcbiAgICBjb25zdCBzZWVuTW9kdWxlcyA9IG5ldyBTZXQ8TmdNb2R1bGVUeXBlPGFueT4+KCk7XG4gICAgY29uc3QgYWZmZWN0ZWRNb2R1bGVzID0gbmV3IFNldDxOZ01vZHVsZVR5cGU8YW55Pj4oKTtcbiAgICBjb25zdCBjYWxjQWZmZWN0ZWRNb2R1bGVzUmVjdXIgPSAoYXJyOiBhbnlbXSwgcGF0aDogTmdNb2R1bGVUeXBlPGFueT5bXSk6IHZvaWQgPT4ge1xuICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiBhcnIpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgLy8gSWYgdGhlIHZhbHVlIGlzIGFuIGFycmF5LCBqdXN0IGZsYXR0ZW4gaXQgKGJ5IGludm9raW5nIHRoaXMgZnVuY3Rpb24gcmVjdXJzaXZlbHkpLFxuICAgICAgICAgIC8vIGtlZXBpbmcgXCJwYXRoXCIgdGhlIHNhbWUuXG4gICAgICAgICAgY2FsY0FmZmVjdGVkTW9kdWxlc1JlY3VyKHZhbHVlLCBwYXRoKTtcbiAgICAgICAgfSBlbHNlIGlmIChoYXNOZ01vZHVsZURlZih2YWx1ZSkpIHtcbiAgICAgICAgICBpZiAoc2Vlbk1vZHVsZXMuaGFzKHZhbHVlKSkge1xuICAgICAgICAgICAgLy8gSWYgd2UndmUgc2VlbiB0aGlzIG1vZHVsZSBiZWZvcmUgYW5kIGl0J3MgaW5jbHVkZWQgaW50byBcImFmZmVjdGVkIG1vZHVsZXNcIiBsaXN0LCBtYXJrXG4gICAgICAgICAgICAvLyB0aGUgd2hvbGUgcGF0aCB0aGF0IGxlYWRzIHRvIHRoYXQgbW9kdWxlIGFzIGFmZmVjdGVkLCBidXQgZG8gbm90IGRlc2NlbmQgaW50byBpdHNcbiAgICAgICAgICAgIC8vIGltcG9ydHMsIHNpbmNlIHdlIGFscmVhZHkgZXhhbWluZWQgdGhlbSBiZWZvcmUuXG4gICAgICAgICAgICBpZiAoYWZmZWN0ZWRNb2R1bGVzLmhhcyh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgcGF0aC5mb3JFYWNoKGl0ZW0gPT4gYWZmZWN0ZWRNb2R1bGVzLmFkZChpdGVtKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2Vlbk1vZHVsZXMuYWRkKHZhbHVlKTtcbiAgICAgICAgICBpZiAodGhpcy5vdmVycmlkZGVuTW9kdWxlcy5oYXModmFsdWUpKSB7XG4gICAgICAgICAgICBwYXRoLmZvckVhY2goaXRlbSA9PiBhZmZlY3RlZE1vZHVsZXMuYWRkKGl0ZW0pKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gRXhhbWluZSBtb2R1bGUgaW1wb3J0cyByZWN1cnNpdmVseSB0byBsb29rIGZvciBvdmVycmlkZGVuIG1vZHVsZXMuXG4gICAgICAgICAgY29uc3QgbW9kdWxlRGVmID0gKHZhbHVlIGFzIGFueSlbTkdfTU9EX0RFRl07XG4gICAgICAgICAgY2FsY0FmZmVjdGVkTW9kdWxlc1JlY3VyKG1heWJlVW53cmFwRm4obW9kdWxlRGVmLmltcG9ydHMpLCBwYXRoLmNvbmNhdCh2YWx1ZSkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgICBjYWxjQWZmZWN0ZWRNb2R1bGVzUmVjdXIoYXJyLCBbXSk7XG4gICAgcmV0dXJuIGFmZmVjdGVkTW9kdWxlcztcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVzZXJ2ZSBhbiBvcmlnaW5hbCBkZWYgKHN1Y2ggYXMgybVtb2QsIMm1aW5qLCBldGMpIGJlZm9yZSBhcHBseWluZyBhbiBvdmVycmlkZS5cbiAgICogTm90ZTogb25lIGNsYXNzIG1heSBoYXZlIG11bHRpcGxlIGRlZnMgKGZvciBleGFtcGxlOiDJtW1vZCBhbmQgybVpbmogaW4gY2FzZSBvZlxuICAgKiBhbiBOZ01vZHVsZSkuIElmIHRoZXJlIGlzIGEgZGVmIGluIGEgc2V0IGFscmVhZHksIGRvbid0IG92ZXJyaWRlIGl0LCBzaW5jZVxuICAgKiBhbiBvcmlnaW5hbCBvbmUgc2hvdWxkIGJlIHJlc3RvcmVkIGF0IHRoZSBlbmQgb2YgYSB0ZXN0LlxuICAgKi9cbiAgcHJpdmF0ZSBtYXliZVN0b3JlTmdEZWYocHJvcDogc3RyaW5nLCB0eXBlOiBUeXBlPGFueT4pIHtcbiAgICBpZiAoIXRoaXMuaW5pdGlhbE5nRGVmcy5oYXModHlwZSkpIHtcbiAgICAgIHRoaXMuaW5pdGlhbE5nRGVmcy5zZXQodHlwZSwgbmV3IE1hcCgpKTtcbiAgICB9XG4gICAgY29uc3QgY3VycmVudERlZnMgPSB0aGlzLmluaXRpYWxOZ0RlZnMuZ2V0KHR5cGUpITtcbiAgICBpZiAoIWN1cnJlbnREZWZzLmhhcyhwcm9wKSkge1xuICAgICAgY29uc3QgY3VycmVudERlZiA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodHlwZSwgcHJvcCk7XG4gICAgICBjdXJyZW50RGVmcy5zZXQocHJvcCwgY3VycmVudERlZik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzdG9yZUZpZWxkT2ZEZWZPblR5cGUodHlwZTogVHlwZTxhbnk+LCBkZWZGaWVsZDogc3RyaW5nLCBmaWVsZE5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGRlZjogYW55ID0gKHR5cGUgYXMgYW55KVtkZWZGaWVsZF07XG4gICAgY29uc3Qgb3JpZ2luYWxWYWx1ZTogYW55ID0gZGVmW2ZpZWxkTmFtZV07XG4gICAgdGhpcy5kZWZDbGVhbnVwT3BzLnB1c2goe29iamVjdDogZGVmLCBmaWVsZE5hbWUsIG9yaWdpbmFsVmFsdWV9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgY3VycmVudCBjb21wb25lbnRzIHJlc29sdXRpb24gcXVldWUsIGJ1dCBzdG9yZXMgdGhlIHN0YXRlIG9mIHRoZSBxdWV1ZSwgc28gd2UgY2FuXG4gICAqIHJlc3RvcmUgaXQgbGF0ZXIuIENsZWFyaW5nIHRoZSBxdWV1ZSBpcyByZXF1aXJlZCBiZWZvcmUgd2UgdHJ5IHRvIGNvbXBpbGUgY29tcG9uZW50cyAodmlhXG4gICAqIGBUZXN0QmVkLmNvbXBpbGVDb21wb25lbnRzYCksIHNvIHRoYXQgY29tcG9uZW50IGRlZnMgYXJlIGluIHN5bmMgd2l0aCB0aGUgcmVzb2x1dGlvbiBxdWV1ZS5cbiAgICovXG4gIHByaXZhdGUgY2xlYXJDb21wb25lbnRSZXNvbHV0aW9uUXVldWUoKSB7XG4gICAgaWYgKHRoaXMub3JpZ2luYWxDb21wb25lbnRSZXNvbHV0aW9uUXVldWUgPT09IG51bGwpIHtcbiAgICAgIHRoaXMub3JpZ2luYWxDb21wb25lbnRSZXNvbHV0aW9uUXVldWUgPSBuZXcgTWFwKCk7XG4gICAgfVxuICAgIMm1Y2xlYXJSZXNvbHV0aW9uT2ZDb21wb25lbnRSZXNvdXJjZXNRdWV1ZSgpLmZvckVhY2goXG4gICAgICAgICh2YWx1ZSwga2V5KSA9PiB0aGlzLm9yaWdpbmFsQ29tcG9uZW50UmVzb2x1dGlvblF1ZXVlIS5zZXQoa2V5LCB2YWx1ZSkpO1xuICB9XG5cbiAgLypcbiAgICogUmVzdG9yZXMgY29tcG9uZW50IHJlc29sdXRpb24gcXVldWUgdG8gdGhlIHByZXZpb3VzbHkgc2F2ZWQgc3RhdGUuIFRoaXMgb3BlcmF0aW9uIGlzIHBlcmZvcm1lZFxuICAgKiBhcyBhIHBhcnQgb2YgcmVzdG9yaW5nIHRoZSBzdGF0ZSBhZnRlciBjb21wbGV0aW9uIG9mIHRoZSBjdXJyZW50IHNldCBvZiB0ZXN0cyAodGhhdCBtaWdodFxuICAgKiBwb3RlbnRpYWxseSBtdXRhdGUgdGhlIHN0YXRlKS5cbiAgICovXG4gIHByaXZhdGUgcmVzdG9yZUNvbXBvbmVudFJlc29sdXRpb25RdWV1ZSgpIHtcbiAgICBpZiAodGhpcy5vcmlnaW5hbENvbXBvbmVudFJlc29sdXRpb25RdWV1ZSAhPT0gbnVsbCkge1xuICAgICAgybVyZXN0b3JlQ29tcG9uZW50UmVzb2x1dGlvblF1ZXVlKHRoaXMub3JpZ2luYWxDb21wb25lbnRSZXNvbHV0aW9uUXVldWUpO1xuICAgICAgdGhpcy5vcmlnaW5hbENvbXBvbmVudFJlc29sdXRpb25RdWV1ZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmVzdG9yZU9yaWdpbmFsU3RhdGUoKTogdm9pZCB7XG4gICAgLy8gUHJvY2VzcyBjbGVhbnVwIG9wcyBpbiByZXZlcnNlIG9yZGVyIHNvIHRoZSBmaWVsZCdzIG9yaWdpbmFsIHZhbHVlIGlzIHJlc3RvcmVkIGNvcnJlY3RseSAoaW5cbiAgICAvLyBjYXNlIHRoZXJlIHdlcmUgbXVsdGlwbGUgb3ZlcnJpZGVzIGZvciB0aGUgc2FtZSBmaWVsZCkuXG4gICAgZm9yRWFjaFJpZ2h0KHRoaXMuZGVmQ2xlYW51cE9wcywgKG9wOiBDbGVhbnVwT3BlcmF0aW9uKSA9PiB7XG4gICAgICBvcC5vYmplY3Rbb3AuZmllbGROYW1lXSA9IG9wLm9yaWdpbmFsVmFsdWU7XG4gICAgfSk7XG4gICAgLy8gUmVzdG9yZSBpbml0aWFsIGNvbXBvbmVudC9kaXJlY3RpdmUvcGlwZSBkZWZzXG4gICAgdGhpcy5pbml0aWFsTmdEZWZzLmZvckVhY2goXG4gICAgICAgIChkZWZzOiBNYXA8c3RyaW5nLCBQcm9wZXJ0eURlc2NyaXB0b3J8dW5kZWZpbmVkPiwgdHlwZTogVHlwZTxhbnk+KSA9PiB7XG4gICAgICAgICAgaWYgKFVTRV9SVU5USU1FX0RFUFNfVFJBQ0tFUl9GT1JfSklUKSB7XG4gICAgICAgICAgICBkZXBzVHJhY2tlci5jbGVhclNjb3BlQ2FjaGVGb3IodHlwZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRlZnMuZm9yRWFjaCgoZGVzY3JpcHRvciwgcHJvcCkgPT4ge1xuICAgICAgICAgICAgaWYgKCFkZXNjcmlwdG9yKSB7XG4gICAgICAgICAgICAgIC8vIERlbGV0ZSBvcGVyYXRpb25zIGFyZSBnZW5lcmFsbHkgdW5kZXNpcmFibGUgc2luY2UgdGhleSBoYXZlIHBlcmZvcm1hbmNlXG4gICAgICAgICAgICAgIC8vIGltcGxpY2F0aW9ucyBvbiBvYmplY3RzIHRoZXkgd2VyZSBhcHBsaWVkIHRvLiBJbiB0aGlzIHBhcnRpY3VsYXIgY2FzZSwgc2l0dWF0aW9uc1xuICAgICAgICAgICAgICAvLyB3aGVyZSB0aGlzIGNvZGUgaXMgaW52b2tlZCBzaG91bGQgYmUgcXVpdGUgcmFyZSB0byBjYXVzZSBhbnkgbm90aWNlYWJsZSBpbXBhY3QsXG4gICAgICAgICAgICAgIC8vIHNpbmNlIGl0J3MgYXBwbGllZCBvbmx5IHRvIHNvbWUgdGVzdCBjYXNlcyAoZm9yIGV4YW1wbGUgd2hlbiBjbGFzcyB3aXRoIG5vXG4gICAgICAgICAgICAgIC8vIGFubm90YXRpb25zIGV4dGVuZHMgc29tZSBAQ29tcG9uZW50KSB3aGVuIHdlIG5lZWQgdG8gY2xlYXIgJ8m1Y21wJyBmaWVsZCBvbiBhIGdpdmVuXG4gICAgICAgICAgICAgIC8vIGNsYXNzIHRvIHJlc3RvcmUgaXRzIG9yaWdpbmFsIHN0YXRlIChiZWZvcmUgYXBwbHlpbmcgb3ZlcnJpZGVzIGFuZCBydW5uaW5nIHRlc3RzKS5cbiAgICAgICAgICAgICAgZGVsZXRlICh0eXBlIGFzIGFueSlbcHJvcF07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodHlwZSwgcHJvcCwgZGVzY3JpcHRvcik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIHRoaXMuaW5pdGlhbE5nRGVmcy5jbGVhcigpO1xuICAgIHRoaXMuc2NvcGVzV2l0aE92ZXJyaWRkZW5Qcm92aWRlcnMuY2xlYXIoKTtcbiAgICB0aGlzLnJlc3RvcmVDb21wb25lbnRSZXNvbHV0aW9uUXVldWUoKTtcbiAgICAvLyBSZXN0b3JlIHRoZSBsb2NhbGUgSUQgdG8gdGhlIGRlZmF1bHQgdmFsdWUsIHRoaXMgc2hvdWxkbid0IGJlIG5lY2Vzc2FyeSBidXQgd2UgbmV2ZXIga25vd1xuICAgIHNldExvY2FsZUlkKERFRkFVTFRfTE9DQUxFX0lEKTtcbiAgfVxuXG4gIHByaXZhdGUgY29tcGlsZVRlc3RNb2R1bGUoKTogdm9pZCB7XG4gICAgY2xhc3MgUm9vdFNjb3BlTW9kdWxlIHt9XG4gICAgY29tcGlsZU5nTW9kdWxlRGVmcyhSb290U2NvcGVNb2R1bGUgYXMgTmdNb2R1bGVUeXBlPGFueT4sIHtcbiAgICAgIHByb3ZpZGVyczogWy4uLnRoaXMucm9vdFByb3ZpZGVyT3ZlcnJpZGVzXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHByb3ZpZGVycyA9IFtcbiAgICAgIHByb3ZpZGVab25lQ2hhbmdlRGV0ZWN0aW9uKCksXG4gICAgICB7cHJvdmlkZTogQ29tcGlsZXIsIHVzZUZhY3Rvcnk6ICgpID0+IG5ldyBSM1Rlc3RDb21waWxlcih0aGlzKX0sXG4gICAgICB7cHJvdmlkZTogREVGRVJfQkxPQ0tfQ09ORklHLCB1c2VWYWx1ZToge2JlaGF2aW9yOiB0aGlzLmRlZmVyQmxvY2tCZWhhdmlvcn19LFxuICAgICAgLi4udGhpcy5wcm92aWRlcnMsXG4gICAgICAuLi50aGlzLnByb3ZpZGVyT3ZlcnJpZGVzLFxuICAgIF07XG4gICAgY29uc3QgaW1wb3J0cyA9IFtSb290U2NvcGVNb2R1bGUsIHRoaXMuYWRkaXRpb25hbE1vZHVsZVR5cGVzLCB0aGlzLmltcG9ydHMgfHwgW11dO1xuXG4gICAgLy8gY2xhbmctZm9ybWF0IG9mZlxuICAgIGNvbXBpbGVOZ01vZHVsZURlZnModGhpcy50ZXN0TW9kdWxlVHlwZSwge1xuICAgICAgZGVjbGFyYXRpb25zOiB0aGlzLmRlY2xhcmF0aW9ucyxcbiAgICAgIGltcG9ydHMsXG4gICAgICBzY2hlbWFzOiB0aGlzLnNjaGVtYXMsXG4gICAgICBwcm92aWRlcnMsXG4gICAgfSwgLyogYWxsb3dEdXBsaWNhdGVEZWNsYXJhdGlvbnNJblJvb3QgKi8gdHJ1ZSk7XG4gICAgLy8gY2xhbmctZm9ybWF0IG9uXG5cbiAgICB0aGlzLmFwcGx5UHJvdmlkZXJPdmVycmlkZXNJblNjb3BlKHRoaXMudGVzdE1vZHVsZVR5cGUpO1xuICB9XG5cbiAgZ2V0IGluamVjdG9yKCk6IEluamVjdG9yIHtcbiAgICBpZiAodGhpcy5faW5qZWN0b3IgIT09IG51bGwpIHtcbiAgICAgIHJldHVybiB0aGlzLl9pbmplY3RvcjtcbiAgICB9XG5cbiAgICBjb25zdCBwcm92aWRlcnM6IFN0YXRpY1Byb3ZpZGVyW10gPSBbXTtcbiAgICBjb25zdCBjb21waWxlck9wdGlvbnMgPSB0aGlzLnBsYXRmb3JtLmluamVjdG9yLmdldChDT01QSUxFUl9PUFRJT05TKTtcbiAgICBjb21waWxlck9wdGlvbnMuZm9yRWFjaChvcHRzID0+IHtcbiAgICAgIGlmIChvcHRzLnByb3ZpZGVycykge1xuICAgICAgICBwcm92aWRlcnMucHVzaChvcHRzLnByb3ZpZGVycyk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKHRoaXMuY29tcGlsZXJQcm92aWRlcnMgIT09IG51bGwpIHtcbiAgICAgIHByb3ZpZGVycy5wdXNoKC4uLnRoaXMuY29tcGlsZXJQcm92aWRlcnMgYXMgU3RhdGljUHJvdmlkZXJbXSk7XG4gICAgfVxuXG4gICAgdGhpcy5faW5qZWN0b3IgPSBJbmplY3Rvci5jcmVhdGUoe3Byb3ZpZGVycywgcGFyZW50OiB0aGlzLnBsYXRmb3JtLmluamVjdG9yfSk7XG4gICAgcmV0dXJuIHRoaXMuX2luamVjdG9yO1xuICB9XG5cbiAgLy8gZ2V0IG92ZXJyaWRlcyBmb3IgYSBzcGVjaWZpYyBwcm92aWRlciAoaWYgYW55KVxuICBwcml2YXRlIGdldFNpbmdsZVByb3ZpZGVyT3ZlcnJpZGVzKHByb3ZpZGVyOiBQcm92aWRlcik6IFByb3ZpZGVyfG51bGwge1xuICAgIGNvbnN0IHRva2VuID0gZ2V0UHJvdmlkZXJUb2tlbihwcm92aWRlcik7XG4gICAgcmV0dXJuIHRoaXMucHJvdmlkZXJPdmVycmlkZXNCeVRva2VuLmdldCh0b2tlbikgfHwgbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0UHJvdmlkZXJPdmVycmlkZXMocHJvdmlkZXJzPzogQXJyYXk8UHJvdmlkZXJ8SW50ZXJuYWxFbnZpcm9ubWVudFByb3ZpZGVycz4pOlxuICAgICAgUHJvdmlkZXJbXSB7XG4gICAgaWYgKCFwcm92aWRlcnMgfHwgIXByb3ZpZGVycy5sZW5ndGggfHwgdGhpcy5wcm92aWRlck92ZXJyaWRlc0J5VG9rZW4uc2l6ZSA9PT0gMCkgcmV0dXJuIFtdO1xuICAgIC8vIFRoZXJlIGFyZSB0d28gZmxhdHRlbmluZyBvcGVyYXRpb25zIGhlcmUuIFRoZSBpbm5lciBmbGF0dGVuUHJvdmlkZXJzKCkgb3BlcmF0ZXMgb24gdGhlXG4gICAgLy8gbWV0YWRhdGEncyBwcm92aWRlcnMgYW5kIGFwcGxpZXMgYSBtYXBwaW5nIGZ1bmN0aW9uIHdoaWNoIHJldHJpZXZlcyBvdmVycmlkZXMgZm9yIGVhY2hcbiAgICAvLyBpbmNvbWluZyBwcm92aWRlci4gVGhlIG91dGVyIGZsYXR0ZW4oKSB0aGVuIGZsYXR0ZW5zIHRoZSBwcm9kdWNlZCBvdmVycmlkZXMgYXJyYXkuIElmIHRoaXMgaXNcbiAgICAvLyBub3QgZG9uZSwgdGhlIGFycmF5IGNhbiBjb250YWluIG90aGVyIGVtcHR5IGFycmF5cyAoZS5nLiBgW1tdLCBbXV1gKSB3aGljaCBsZWFrIGludG8gdGhlXG4gICAgLy8gcHJvdmlkZXJzIGFycmF5IGFuZCBjb250YW1pbmF0ZSBhbnkgZXJyb3IgbWVzc2FnZXMgdGhhdCBtaWdodCBiZSBnZW5lcmF0ZWQuXG4gICAgcmV0dXJuIGZsYXR0ZW4oZmxhdHRlblByb3ZpZGVycyhcbiAgICAgICAgcHJvdmlkZXJzLCAocHJvdmlkZXI6IFByb3ZpZGVyKSA9PiB0aGlzLmdldFNpbmdsZVByb3ZpZGVyT3ZlcnJpZGVzKHByb3ZpZGVyKSB8fCBbXSkpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRPdmVycmlkZGVuUHJvdmlkZXJzKHByb3ZpZGVycz86IEFycmF5PFByb3ZpZGVyfEludGVybmFsRW52aXJvbm1lbnRQcm92aWRlcnM+KTpcbiAgICAgIFByb3ZpZGVyW10ge1xuICAgIGlmICghcHJvdmlkZXJzIHx8ICFwcm92aWRlcnMubGVuZ3RoIHx8IHRoaXMucHJvdmlkZXJPdmVycmlkZXNCeVRva2VuLnNpemUgPT09IDApIHJldHVybiBbXTtcblxuICAgIGNvbnN0IGZsYXR0ZW5lZFByb3ZpZGVycyA9IGZsYXR0ZW5Qcm92aWRlcnMocHJvdmlkZXJzKTtcbiAgICBjb25zdCBvdmVycmlkZXMgPSB0aGlzLmdldFByb3ZpZGVyT3ZlcnJpZGVzKGZsYXR0ZW5lZFByb3ZpZGVycyk7XG4gICAgY29uc3Qgb3ZlcnJpZGRlblByb3ZpZGVycyA9IFsuLi5mbGF0dGVuZWRQcm92aWRlcnMsIC4uLm92ZXJyaWRlc107XG4gICAgY29uc3QgZmluYWw6IFByb3ZpZGVyW10gPSBbXTtcbiAgICBjb25zdCBzZWVuT3ZlcnJpZGRlblByb3ZpZGVycyA9IG5ldyBTZXQ8UHJvdmlkZXI+KCk7XG5cbiAgICAvLyBXZSBpdGVyYXRlIHRocm91Z2ggdGhlIGxpc3Qgb2YgcHJvdmlkZXJzIGluIHJldmVyc2Ugb3JkZXIgdG8gbWFrZSBzdXJlIHByb3ZpZGVyIG92ZXJyaWRlc1xuICAgIC8vIHRha2UgcHJlY2VkZW5jZSBvdmVyIHRoZSB2YWx1ZXMgZGVmaW5lZCBpbiBwcm92aWRlciBsaXN0LiBXZSBhbHNvIGZpbHRlciBvdXQgYWxsIHByb3ZpZGVyc1xuICAgIC8vIHRoYXQgaGF2ZSBvdmVycmlkZXMsIGtlZXBpbmcgb3ZlcnJpZGRlbiB2YWx1ZXMgb25seS4gVGhpcyBpcyBuZWVkZWQsIHNpbmNlIHByZXNlbmNlIG9mIGFcbiAgICAvLyBwcm92aWRlciB3aXRoIGBuZ09uRGVzdHJveWAgaG9vayB3aWxsIGNhdXNlIHRoaXMgaG9vayB0byBiZSByZWdpc3RlcmVkIGFuZCBpbnZva2VkIGxhdGVyLlxuICAgIGZvckVhY2hSaWdodChvdmVycmlkZGVuUHJvdmlkZXJzLCAocHJvdmlkZXI6IGFueSkgPT4ge1xuICAgICAgY29uc3QgdG9rZW46IGFueSA9IGdldFByb3ZpZGVyVG9rZW4ocHJvdmlkZXIpO1xuICAgICAgaWYgKHRoaXMucHJvdmlkZXJPdmVycmlkZXNCeVRva2VuLmhhcyh0b2tlbikpIHtcbiAgICAgICAgaWYgKCFzZWVuT3ZlcnJpZGRlblByb3ZpZGVycy5oYXModG9rZW4pKSB7XG4gICAgICAgICAgc2Vlbk92ZXJyaWRkZW5Qcm92aWRlcnMuYWRkKHRva2VuKTtcbiAgICAgICAgICAvLyBUcmVhdCBhbGwgb3ZlcnJpZGRlbiBwcm92aWRlcnMgYXMgYHttdWx0aTogZmFsc2V9YCAoZXZlbiBpZiBpdCdzIGEgbXVsdGktcHJvdmlkZXIpIHRvXG4gICAgICAgICAgLy8gbWFrZSBzdXJlIHRoYXQgcHJvdmlkZWQgb3ZlcnJpZGUgdGFrZXMgaGlnaGVzdCBwcmVjZWRlbmNlIGFuZCBpcyBub3QgY29tYmluZWQgd2l0aFxuICAgICAgICAgIC8vIG90aGVyIGluc3RhbmNlcyBvZiB0aGUgc2FtZSBtdWx0aSBwcm92aWRlci5cbiAgICAgICAgICBmaW5hbC51bnNoaWZ0KHsuLi5wcm92aWRlciwgbXVsdGk6IGZhbHNlfSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZpbmFsLnVuc2hpZnQocHJvdmlkZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBmaW5hbDtcbiAgfVxuXG4gIHByaXZhdGUgaGFzUHJvdmlkZXJPdmVycmlkZXMocHJvdmlkZXJzPzogQXJyYXk8UHJvdmlkZXJ8SW50ZXJuYWxFbnZpcm9ubWVudFByb3ZpZGVycz4pOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5nZXRQcm92aWRlck92ZXJyaWRlcyhwcm92aWRlcnMpLmxlbmd0aCA+IDA7XG4gIH1cblxuICBwcml2YXRlIHBhdGNoRGVmV2l0aFByb3ZpZGVyT3ZlcnJpZGVzKGRlY2xhcmF0aW9uOiBUeXBlPGFueT4sIGZpZWxkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBkZWYgPSAoZGVjbGFyYXRpb24gYXMgYW55KVtmaWVsZF07XG4gICAgaWYgKGRlZiAmJiBkZWYucHJvdmlkZXJzUmVzb2x2ZXIpIHtcbiAgICAgIHRoaXMubWF5YmVTdG9yZU5nRGVmKGZpZWxkLCBkZWNsYXJhdGlvbik7XG5cbiAgICAgIGNvbnN0IHJlc29sdmVyID0gZGVmLnByb3ZpZGVyc1Jlc29sdmVyO1xuICAgICAgY29uc3QgcHJvY2Vzc1Byb3ZpZGVyc0ZuID0gKHByb3ZpZGVyczogUHJvdmlkZXJbXSkgPT4gdGhpcy5nZXRPdmVycmlkZGVuUHJvdmlkZXJzKHByb3ZpZGVycyk7XG4gICAgICB0aGlzLnN0b3JlRmllbGRPZkRlZk9uVHlwZShkZWNsYXJhdGlvbiwgZmllbGQsICdwcm92aWRlcnNSZXNvbHZlcicpO1xuICAgICAgZGVmLnByb3ZpZGVyc1Jlc29sdmVyID0gKG5nRGVmOiBEaXJlY3RpdmVEZWY8YW55PikgPT4gcmVzb2x2ZXIobmdEZWYsIHByb2Nlc3NQcm92aWRlcnNGbik7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGluaXRSZXNvbHZlcnMoKTogUmVzb2x2ZXJzIHtcbiAgcmV0dXJuIHtcbiAgICBtb2R1bGU6IG5ldyBOZ01vZHVsZVJlc29sdmVyKCksXG4gICAgY29tcG9uZW50OiBuZXcgQ29tcG9uZW50UmVzb2x2ZXIoKSxcbiAgICBkaXJlY3RpdmU6IG5ldyBEaXJlY3RpdmVSZXNvbHZlcigpLFxuICAgIHBpcGU6IG5ldyBQaXBlUmVzb2x2ZXIoKVxuICB9O1xufVxuXG5mdW5jdGlvbiBpc1N0YW5kYWxvbmVDb21wb25lbnQ8VD4odmFsdWU6IFR5cGU8VD4pOiB2YWx1ZSBpcyBDb21wb25lbnRUeXBlPFQ+IHtcbiAgY29uc3QgZGVmID0gZ2V0Q29tcG9uZW50RGVmKHZhbHVlKTtcbiAgcmV0dXJuICEhZGVmPy5zdGFuZGFsb25lO1xufVxuXG5mdW5jdGlvbiBnZXRDb21wb25lbnREZWYodmFsdWU6IENvbXBvbmVudFR5cGU8dW5rbm93bj4pOiBDb21wb25lbnREZWY8dW5rbm93bj47XG5mdW5jdGlvbiBnZXRDb21wb25lbnREZWYodmFsdWU6IFR5cGU8dW5rbm93bj4pOiBDb21wb25lbnREZWY8dW5rbm93bj58bnVsbDtcbmZ1bmN0aW9uIGdldENvbXBvbmVudERlZih2YWx1ZTogVHlwZTx1bmtub3duPik6IENvbXBvbmVudERlZjx1bmtub3duPnxudWxsIHtcbiAgcmV0dXJuICh2YWx1ZSBhcyBhbnkpLsm1Y21wID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGhhc05nTW9kdWxlRGVmPFQ+KHZhbHVlOiBUeXBlPFQ+KTogdmFsdWUgaXMgTmdNb2R1bGVUeXBlPFQ+IHtcbiAgcmV0dXJuIHZhbHVlLmhhc093blByb3BlcnR5KCfJtW1vZCcpO1xufVxuXG5mdW5jdGlvbiBpc05nTW9kdWxlPFQ+KHZhbHVlOiBUeXBlPFQ+KTogYm9vbGVhbiB7XG4gIHJldHVybiBoYXNOZ01vZHVsZURlZih2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIG1heWJlVW53cmFwRm48VD4obWF5YmVGbjogKCgpID0+IFQpfFQpOiBUIHtcbiAgcmV0dXJuIG1heWJlRm4gaW5zdGFuY2VvZiBGdW5jdGlvbiA/IG1heWJlRm4oKSA6IG1heWJlRm47XG59XG5cbmZ1bmN0aW9uIGZsYXR0ZW48VD4odmFsdWVzOiBhbnlbXSk6IFRbXSB7XG4gIGNvbnN0IG91dDogVFtdID0gW107XG4gIHZhbHVlcy5mb3JFYWNoKHZhbHVlID0+IHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIG91dC5wdXNoKC4uLmZsYXR0ZW48VD4odmFsdWUpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgb3V0LnB1c2godmFsdWUpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIGlkZW50aXR5Rm48VD4odmFsdWU6IFQpOiBUIHtcbiAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBmbGF0dGVuUHJvdmlkZXJzPFQ+KFxuICAgIHByb3ZpZGVyczogQXJyYXk8UHJvdmlkZXJ8SW50ZXJuYWxFbnZpcm9ubWVudFByb3ZpZGVycz4sIG1hcEZuOiAocHJvdmlkZXI6IFByb3ZpZGVyKSA9PiBUKTogVFtdO1xuZnVuY3Rpb24gZmxhdHRlblByb3ZpZGVycyhwcm92aWRlcnM6IEFycmF5PFByb3ZpZGVyfEludGVybmFsRW52aXJvbm1lbnRQcm92aWRlcnM+KTogUHJvdmlkZXJbXTtcbmZ1bmN0aW9uIGZsYXR0ZW5Qcm92aWRlcnMoXG4gICAgcHJvdmlkZXJzOiBBcnJheTxQcm92aWRlcnxJbnRlcm5hbEVudmlyb25tZW50UHJvdmlkZXJzPixcbiAgICBtYXBGbjogKHByb3ZpZGVyOiBQcm92aWRlcikgPT4gYW55ID0gaWRlbnRpdHlGbik6IGFueVtdIHtcbiAgY29uc3Qgb3V0OiBhbnlbXSA9IFtdO1xuICBmb3IgKGxldCBwcm92aWRlciBvZiBwcm92aWRlcnMpIHtcbiAgICBpZiAoaXNFbnZpcm9ubWVudFByb3ZpZGVycyhwcm92aWRlcikpIHtcbiAgICAgIHByb3ZpZGVyID0gcHJvdmlkZXIuybVwcm92aWRlcnM7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHByb3ZpZGVyKSkge1xuICAgICAgb3V0LnB1c2goLi4uZmxhdHRlblByb3ZpZGVycyhwcm92aWRlciwgbWFwRm4pKTtcbiAgICB9IGVsc2Uge1xuICAgICAgb3V0LnB1c2gobWFwRm4ocHJvdmlkZXIpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuZnVuY3Rpb24gZ2V0UHJvdmlkZXJGaWVsZChwcm92aWRlcjogUHJvdmlkZXIsIGZpZWxkOiBzdHJpbmcpIHtcbiAgcmV0dXJuIHByb3ZpZGVyICYmIHR5cGVvZiBwcm92aWRlciA9PT0gJ29iamVjdCcgJiYgKHByb3ZpZGVyIGFzIGFueSlbZmllbGRdO1xufVxuXG5mdW5jdGlvbiBnZXRQcm92aWRlclRva2VuKHByb3ZpZGVyOiBQcm92aWRlcikge1xuICByZXR1cm4gZ2V0UHJvdmlkZXJGaWVsZChwcm92aWRlciwgJ3Byb3ZpZGUnKSB8fCBwcm92aWRlcjtcbn1cblxuZnVuY3Rpb24gaXNNb2R1bGVXaXRoUHJvdmlkZXJzKHZhbHVlOiBhbnkpOiB2YWx1ZSBpcyBNb2R1bGVXaXRoUHJvdmlkZXJzPGFueT4ge1xuICByZXR1cm4gdmFsdWUuaGFzT3duUHJvcGVydHkoJ25nTW9kdWxlJyk7XG59XG5cbmZ1bmN0aW9uIGZvckVhY2hSaWdodDxUPih2YWx1ZXM6IFRbXSwgZm46ICh2YWx1ZTogVCwgaWR4OiBudW1iZXIpID0+IHZvaWQpOiB2b2lkIHtcbiAgZm9yIChsZXQgaWR4ID0gdmFsdWVzLmxlbmd0aCAtIDE7IGlkeCA+PSAwOyBpZHgtLSkge1xuICAgIGZuKHZhbHVlc1tpZHhdLCBpZHgpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGludmFsaWRUeXBlRXJyb3IobmFtZTogc3RyaW5nLCBleHBlY3RlZFR5cGU6IHN0cmluZyk6IEVycm9yIHtcbiAgcmV0dXJuIG5ldyBFcnJvcihgJHtuYW1lfSBjbGFzcyBkb2Vzbid0IGhhdmUgQCR7ZXhwZWN0ZWRUeXBlfSBkZWNvcmF0b3Igb3IgaXMgbWlzc2luZyBtZXRhZGF0YS5gKTtcbn1cblxuY2xhc3MgUjNUZXN0Q29tcGlsZXIgaW1wbGVtZW50cyBDb21waWxlciB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgdGVzdEJlZDogVGVzdEJlZENvbXBpbGVyKSB7fVxuXG4gIGNvbXBpbGVNb2R1bGVTeW5jPFQ+KG1vZHVsZVR5cGU6IFR5cGU8VD4pOiBOZ01vZHVsZUZhY3Rvcnk8VD4ge1xuICAgIHRoaXMudGVzdEJlZC5fY29tcGlsZU5nTW9kdWxlU3luYyhtb2R1bGVUeXBlKTtcbiAgICByZXR1cm4gbmV3IFIzTmdNb2R1bGVGYWN0b3J5KG1vZHVsZVR5cGUpO1xuICB9XG5cbiAgYXN5bmMgY29tcGlsZU1vZHVsZUFzeW5jPFQ+KG1vZHVsZVR5cGU6IFR5cGU8VD4pOiBQcm9taXNlPE5nTW9kdWxlRmFjdG9yeTxUPj4ge1xuICAgIGF3YWl0IHRoaXMudGVzdEJlZC5fY29tcGlsZU5nTW9kdWxlQXN5bmMobW9kdWxlVHlwZSk7XG4gICAgcmV0dXJuIG5ldyBSM05nTW9kdWxlRmFjdG9yeShtb2R1bGVUeXBlKTtcbiAgfVxuXG4gIGNvbXBpbGVNb2R1bGVBbmRBbGxDb21wb25lbnRzU3luYzxUPihtb2R1bGVUeXBlOiBUeXBlPFQ+KTogTW9kdWxlV2l0aENvbXBvbmVudEZhY3RvcmllczxUPiB7XG4gICAgY29uc3QgbmdNb2R1bGVGYWN0b3J5ID0gdGhpcy5jb21waWxlTW9kdWxlU3luYyhtb2R1bGVUeXBlKTtcbiAgICBjb25zdCBjb21wb25lbnRGYWN0b3JpZXMgPSB0aGlzLnRlc3RCZWQuX2dldENvbXBvbmVudEZhY3Rvcmllcyhtb2R1bGVUeXBlIGFzIE5nTW9kdWxlVHlwZTxUPik7XG4gICAgcmV0dXJuIG5ldyBNb2R1bGVXaXRoQ29tcG9uZW50RmFjdG9yaWVzKG5nTW9kdWxlRmFjdG9yeSwgY29tcG9uZW50RmFjdG9yaWVzKTtcbiAgfVxuXG4gIGFzeW5jIGNvbXBpbGVNb2R1bGVBbmRBbGxDb21wb25lbnRzQXN5bmM8VD4obW9kdWxlVHlwZTogVHlwZTxUPik6XG4gICAgICBQcm9taXNlPE1vZHVsZVdpdGhDb21wb25lbnRGYWN0b3JpZXM8VD4+IHtcbiAgICBjb25zdCBuZ01vZHVsZUZhY3RvcnkgPSBhd2FpdCB0aGlzLmNvbXBpbGVNb2R1bGVBc3luYyhtb2R1bGVUeXBlKTtcbiAgICBjb25zdCBjb21wb25lbnRGYWN0b3JpZXMgPSB0aGlzLnRlc3RCZWQuX2dldENvbXBvbmVudEZhY3Rvcmllcyhtb2R1bGVUeXBlIGFzIE5nTW9kdWxlVHlwZTxUPik7XG4gICAgcmV0dXJuIG5ldyBNb2R1bGVXaXRoQ29tcG9uZW50RmFjdG9yaWVzKG5nTW9kdWxlRmFjdG9yeSwgY29tcG9uZW50RmFjdG9yaWVzKTtcbiAgfVxuXG4gIGNsZWFyQ2FjaGUoKTogdm9pZCB7fVxuXG4gIGNsZWFyQ2FjaGVGb3IodHlwZTogVHlwZTxhbnk+KTogdm9pZCB7fVxuXG4gIGdldE1vZHVsZUlkKG1vZHVsZVR5cGU6IFR5cGU8YW55Pik6IHN0cmluZ3x1bmRlZmluZWQge1xuICAgIGNvbnN0IG1ldGEgPSB0aGlzLnRlc3RCZWQuX2dldE1vZHVsZVJlc29sdmVyKCkucmVzb2x2ZShtb2R1bGVUeXBlKTtcbiAgICByZXR1cm4gbWV0YSAmJiBtZXRhLmlkIHx8IHVuZGVmaW5lZDtcbiAgfVxufVxuIl19