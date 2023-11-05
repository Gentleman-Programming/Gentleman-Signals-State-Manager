/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { ViewEncapsulation } from '../metadata';
import { collectNativeNodes, collectNativeNodesInLContainer } from '../render3/collect_native_nodes';
import { getComponentDef } from '../render3/definition';
import { CONTAINER_HEADER_OFFSET } from '../render3/interfaces/container';
import { isTNodeShape } from '../render3/interfaces/node';
import { hasI18n, isComponentHost, isLContainer, isProjectionTNode, isRootView } from '../render3/interfaces/type_checks';
import { CONTEXT, HEADER_OFFSET, HOST, PARENT, RENDERER, TVIEW } from '../render3/interfaces/view';
import { unwrapLView, unwrapRNode } from '../render3/util/view_utils';
import { TransferState } from '../transfer_state';
import { unsupportedProjectionOfDomNodes } from './error_handling';
import { CONTAINERS, DISCONNECTED_NODES, ELEMENT_CONTAINERS, MULTIPLIER, NODES, NUM_ROOT_NODES, TEMPLATE_ID, TEMPLATES } from './interfaces';
import { calcPathForNode } from './node_lookup_utils';
import { isInSkipHydrationBlock, SKIP_HYDRATION_ATTR_NAME } from './skip_hydration';
import { getLNodeForHydration, NGH_ATTR_NAME, NGH_DATA_KEY } from './utils';
/**
 * A collection that tracks all serialized views (`ngh` DOM annotations)
 * to avoid duplication. An attempt to add a duplicate view results in the
 * collection returning the index of the previously collected serialized view.
 * This reduces the number of annotations needed for a given page.
 */
class SerializedViewCollection {
    constructor() {
        this.views = [];
        this.indexByContent = new Map();
    }
    add(serializedView) {
        const viewAsString = JSON.stringify(serializedView);
        if (!this.indexByContent.has(viewAsString)) {
            const index = this.views.length;
            this.views.push(serializedView);
            this.indexByContent.set(viewAsString, index);
            return index;
        }
        return this.indexByContent.get(viewAsString);
    }
    getAll() {
        return this.views;
    }
}
/**
 * Global counter that is used to generate a unique id for TViews
 * during the serialization process.
 */
let tViewSsrId = 0;
/**
 * Generates a unique id for a given TView and returns this id.
 * The id is also stored on this instance of a TView and reused in
 * subsequent calls.
 *
 * This id is needed to uniquely identify and pick up dehydrated views
 * at runtime.
 */
function getSsrId(tView) {
    if (!tView.ssrId) {
        tView.ssrId = `t${tViewSsrId++}`;
    }
    return tView.ssrId;
}
/**
 * Computes the number of root nodes in a given view
 * (or child nodes in a given container if a tNode is provided).
 */
function calcNumRootNodes(tView, lView, tNode) {
    const rootNodes = [];
    collectNativeNodes(tView, lView, tNode, rootNodes);
    return rootNodes.length;
}
/**
 * Computes the number of root nodes in all views in a given LContainer.
 */
function calcNumRootNodesInLContainer(lContainer) {
    const rootNodes = [];
    collectNativeNodesInLContainer(lContainer, rootNodes);
    return rootNodes.length;
}
/**
 * Annotates root level component's LView for hydration,
 * see `annotateHostElementForHydration` for additional information.
 */
function annotateComponentLViewForHydration(lView, context) {
    const hostElement = lView[HOST];
    // Root elements might also be annotated with the `ngSkipHydration` attribute,
    // check if it's present before starting the serialization process.
    if (hostElement && !hostElement.hasAttribute(SKIP_HYDRATION_ATTR_NAME)) {
        return annotateHostElementForHydration(hostElement, lView, context);
    }
    return null;
}
/**
 * Annotates root level LContainer for hydration. This happens when a root component
 * injects ViewContainerRef, thus making the component an anchor for a view container.
 * This function serializes the component itself as well as all views from the view
 * container.
 */
function annotateLContainerForHydration(lContainer, context) {
    const componentLView = unwrapLView(lContainer[HOST]);
    // Serialize the root component itself.
    const componentLViewNghIndex = annotateComponentLViewForHydration(componentLView, context);
    const hostElement = unwrapRNode(componentLView[HOST]);
    // Serialize all views within this view container.
    const rootLView = lContainer[PARENT];
    const rootLViewNghIndex = annotateHostElementForHydration(hostElement, rootLView, context);
    const renderer = componentLView[RENDERER];
    // For cases when a root component also acts as an anchor node for a ViewContainerRef
    // (for example, when ViewContainerRef is injected in a root component), there is a need
    // to serialize information about the component itself, as well as an LContainer that
    // represents this ViewContainerRef. Effectively, we need to serialize 2 pieces of info:
    // (1) hydration info for the root component itself and (2) hydration info for the
    // ViewContainerRef instance (an LContainer). Each piece of information is included into
    // the hydration data (in the TransferState object) separately, thus we end up with 2 ids.
    // Since we only have 1 root element, we encode both bits of info into a single string:
    // ids are separated by the `|` char (e.g. `10|25`, where `10` is the ngh for a component view
    // and 25 is the `ngh` for a root view which holds LContainer).
    const finalIndex = `${componentLViewNghIndex}|${rootLViewNghIndex}`;
    renderer.setAttribute(hostElement, NGH_ATTR_NAME, finalIndex);
}
/**
 * Annotates all components bootstrapped in a given ApplicationRef
 * with info needed for hydration.
 *
 * @param appRef An instance of an ApplicationRef.
 * @param doc A reference to the current Document instance.
 */
export function annotateForHydration(appRef, doc) {
    const serializedViewCollection = new SerializedViewCollection();
    const corruptedTextNodes = new Map();
    const viewRefs = appRef._views;
    for (const viewRef of viewRefs) {
        const lNode = getLNodeForHydration(viewRef);
        // An `lView` might be `null` if a `ViewRef` represents
        // an embedded view (not a component view).
        if (lNode !== null) {
            const context = {
                serializedViewCollection,
                corruptedTextNodes,
            };
            if (isLContainer(lNode)) {
                annotateLContainerForHydration(lNode, context);
            }
            else {
                annotateComponentLViewForHydration(lNode, context);
            }
            insertCorruptedTextNodeMarkers(corruptedTextNodes, doc);
        }
    }
    // Note: we *always* include hydration info key and a corresponding value
    // into the TransferState, even if the list of serialized views is empty.
    // This is needed as a signal to the client that the server part of the
    // hydration logic was setup and enabled correctly. Otherwise, if a client
    // hydration doesn't find a key in the transfer state - an error is produced.
    const serializedViews = serializedViewCollection.getAll();
    const transferState = appRef.injector.get(TransferState);
    transferState.set(NGH_DATA_KEY, serializedViews);
}
/**
 * Serializes the lContainer data into a list of SerializedView objects,
 * that represent views within this lContainer.
 *
 * @param lContainer the lContainer we are serializing
 * @param context the hydration context
 * @returns an array of the `SerializedView` objects
 */
function serializeLContainer(lContainer, context) {
    const views = [];
    let lastViewAsString = '';
    for (let i = CONTAINER_HEADER_OFFSET; i < lContainer.length; i++) {
        let childLView = lContainer[i];
        let template;
        let numRootNodes;
        let serializedView;
        if (isRootView(childLView)) {
            // If this is a root view, get an LView for the underlying component,
            // because it contains information about the view to serialize.
            childLView = childLView[HEADER_OFFSET];
            // If we have an LContainer at this position, this indicates that the
            // host element was used as a ViewContainerRef anchor (e.g. a `ViewContainerRef`
            // was injected within the component class). This case requires special handling.
            if (isLContainer(childLView)) {
                // Calculate the number of root nodes in all views in a given container
                // and increment by one to account for an anchor node itself, i.e. in this
                // scenario we'll have a layout that would look like this:
                // `<app-root /><#VIEW1><#VIEW2>...<!--container-->`
                // The `+1` is to capture the `<app-root />` element.
                numRootNodes = calcNumRootNodesInLContainer(childLView) + 1;
                annotateLContainerForHydration(childLView, context);
                const componentLView = unwrapLView(childLView[HOST]);
                serializedView = {
                    [TEMPLATE_ID]: componentLView[TVIEW].ssrId,
                    [NUM_ROOT_NODES]: numRootNodes,
                };
            }
        }
        if (!serializedView) {
            const childTView = childLView[TVIEW];
            if (childTView.type === 1 /* TViewType.Component */) {
                template = childTView.ssrId;
                // This is a component view, thus it has only 1 root node: the component
                // host node itself (other nodes would be inside that host node).
                numRootNodes = 1;
            }
            else {
                template = getSsrId(childTView);
                numRootNodes = calcNumRootNodes(childTView, childLView, childTView.firstChild);
            }
            serializedView = {
                [TEMPLATE_ID]: template,
                [NUM_ROOT_NODES]: numRootNodes,
                ...serializeLView(lContainer[i], context),
            };
        }
        // Check if the previous view has the same shape (for example, it was
        // produced by the *ngFor), in which case bump the counter on the previous
        // view instead of including the same information again.
        const currentViewAsString = JSON.stringify(serializedView);
        if (views.length > 0 && currentViewAsString === lastViewAsString) {
            const previousView = views[views.length - 1];
            previousView[MULTIPLIER] ??= 1;
            previousView[MULTIPLIER]++;
        }
        else {
            // Record this view as most recently added.
            lastViewAsString = currentViewAsString;
            views.push(serializedView);
        }
    }
    return views;
}
/**
 * Helper function to produce a node path (which navigation steps runtime logic
 * needs to take to locate a node) and stores it in the `NODES` section of the
 * current serialized view.
 */
function appendSerializedNodePath(ngh, tNode, lView) {
    const noOffsetIndex = tNode.index - HEADER_OFFSET;
    ngh[NODES] ??= {};
    ngh[NODES][noOffsetIndex] = calcPathForNode(tNode, lView);
}
/**
 * Helper function to append information about a disconnected node.
 * This info is needed at runtime to avoid DOM lookups for this element
 * and instead, the element would be created from scratch.
 */
function appendDisconnectedNodeIndex(ngh, tNode) {
    const noOffsetIndex = tNode.index - HEADER_OFFSET;
    ngh[DISCONNECTED_NODES] ??= [];
    if (!ngh[DISCONNECTED_NODES].includes(noOffsetIndex)) {
        ngh[DISCONNECTED_NODES].push(noOffsetIndex);
    }
}
/**
 * Serializes the lView data into a SerializedView object that will later be added
 * to the TransferState storage and referenced using the `ngh` attribute on a host
 * element.
 *
 * @param lView the lView we are serializing
 * @param context the hydration context
 * @returns the `SerializedView` object containing the data to be added to the host node
 */
function serializeLView(lView, context) {
    const ngh = {};
    const tView = lView[TVIEW];
    // Iterate over DOM element references in an LView.
    for (let i = HEADER_OFFSET; i < tView.bindingStartIndex; i++) {
        const tNode = tView.data[i];
        const noOffsetIndex = i - HEADER_OFFSET;
        // Skip processing of a given slot in the following cases:
        // - Local refs (e.g. <div #localRef>) take up an extra slot in LViews
        //   to store the same element. In this case, there is no information in
        //   a corresponding slot in TNode data structure.
        // - When a slot contains something other than a TNode. For example, there
        //   might be some metadata information about a defer block or a control flow block.
        if (!isTNodeShape(tNode)) {
            continue;
        }
        // Check if a native node that represents a given TNode is disconnected from the DOM tree.
        // Such nodes must be excluded from the hydration (since the hydration won't be able to
        // find them), so the TNode ids are collected and used at runtime to skip the hydration.
        //
        // This situation may happen during the content projection, when some nodes don't make it
        // into one of the content projection slots (for example, when there is no default
        // <ng-content /> slot in projector component's template).
        if (isDisconnectedNode(tNode, lView) && isContentProjectedNode(tNode)) {
            appendDisconnectedNodeIndex(ngh, tNode);
            continue;
        }
        if (Array.isArray(tNode.projection)) {
            for (const projectionHeadTNode of tNode.projection) {
                // We may have `null`s in slots with no projected content.
                if (!projectionHeadTNode)
                    continue;
                if (!Array.isArray(projectionHeadTNode)) {
                    // If we process re-projected content (i.e. `<ng-content>`
                    // appears at projection location), skip annotations for this content
                    // since all DOM nodes in this projection were handled while processing
                    // a parent lView, which contains those nodes.
                    if (!isProjectionTNode(projectionHeadTNode) &&
                        !isInSkipHydrationBlock(projectionHeadTNode)) {
                        if (isDisconnectedNode(projectionHeadTNode, lView)) {
                            // Check whether this node is connected, since we may have a TNode
                            // in the data structure as a projection segment head, but the
                            // content projection slot might be disabled (e.g.
                            // <ng-content *ngIf="false" />).
                            appendDisconnectedNodeIndex(ngh, projectionHeadTNode);
                        }
                        else {
                            appendSerializedNodePath(ngh, projectionHeadTNode, lView);
                        }
                    }
                }
                else {
                    // If a value is an array, it means that we are processing a projection
                    // where projectable nodes were passed in as DOM nodes (for example, when
                    // calling `ViewContainerRef.createComponent(CmpA, {projectableNodes: [...]})`).
                    //
                    // In this scenario, nodes can come from anywhere (either created manually,
                    // accessed via `document.querySelector`, etc) and may be in any state
                    // (attached or detached from the DOM tree). As a result, we can not reliably
                    // restore the state for such cases during hydration.
                    throw unsupportedProjectionOfDomNodes(unwrapRNode(lView[i]));
                }
            }
        }
        if (isLContainer(lView[i])) {
            // Serialize information about a template.
            const embeddedTView = tNode.tView;
            if (embeddedTView !== null) {
                ngh[TEMPLATES] ??= {};
                ngh[TEMPLATES][noOffsetIndex] = getSsrId(embeddedTView);
            }
            // Serialize views within this LContainer.
            const hostNode = lView[i][HOST]; // host node of this container
            // LView[i][HOST] can be of 2 different types:
            // - either a DOM node
            // - or an array that represents an LView of a component
            if (Array.isArray(hostNode)) {
                // This is a component, serialize info about it.
                const targetNode = unwrapRNode(hostNode);
                if (!targetNode.hasAttribute(SKIP_HYDRATION_ATTR_NAME)) {
                    annotateHostElementForHydration(targetNode, hostNode, context);
                }
            }
            ngh[CONTAINERS] ??= {};
            ngh[CONTAINERS][noOffsetIndex] = serializeLContainer(lView[i], context);
        }
        else if (Array.isArray(lView[i])) {
            // This is a component, annotate the host node with an `ngh` attribute.
            const targetNode = unwrapRNode(lView[i][HOST]);
            if (!targetNode.hasAttribute(SKIP_HYDRATION_ATTR_NAME)) {
                annotateHostElementForHydration(targetNode, lView[i], context);
            }
        }
        else {
            // <ng-container> case
            if (tNode.type & 8 /* TNodeType.ElementContainer */) {
                // An <ng-container> is represented by the number of
                // top-level nodes. This information is needed to skip over
                // those nodes to reach a corresponding anchor node (comment node).
                ngh[ELEMENT_CONTAINERS] ??= {};
                ngh[ELEMENT_CONTAINERS][noOffsetIndex] = calcNumRootNodes(tView, lView, tNode.child);
            }
            else if (tNode.type & 16 /* TNodeType.Projection */) {
                // Current TNode represents an `<ng-content>` slot, thus it has no
                // DOM elements associated with it, so the **next sibling** node would
                // not be able to find an anchor. In this case, use full path instead.
                let nextTNode = tNode.next;
                // Skip over all `<ng-content>` slots in a row.
                while (nextTNode !== null && (nextTNode.type & 16 /* TNodeType.Projection */)) {
                    nextTNode = nextTNode.next;
                }
                if (nextTNode && !isInSkipHydrationBlock(nextTNode)) {
                    // Handle a tNode after the `<ng-content>` slot.
                    appendSerializedNodePath(ngh, nextTNode, lView);
                }
            }
            else {
                // Handle cases where text nodes can be lost after DOM serialization:
                //  1. When there is an *empty text node* in DOM: in this case, this
                //     node would not make it into the serialized string and as a result,
                //     this node wouldn't be created in a browser. This would result in
                //     a mismatch during the hydration, where the runtime logic would expect
                //     a text node to be present in live DOM, but no text node would exist.
                //     Example: `<span>{{ name }}</span>` when the `name` is an empty string.
                //     This would result in `<span></span>` string after serialization and
                //     in a browser only the `span` element would be created. To resolve that,
                //     an extra comment node is appended in place of an empty text node and
                //     that special comment node is replaced with an empty text node *before*
                //     hydration.
                //  2. When there are 2 consecutive text nodes present in the DOM.
                //     Example: `<div>Hello <ng-container *ngIf="true">world</ng-container></div>`.
                //     In this scenario, the live DOM would look like this:
                //       <div>#text('Hello ') #text('world') #comment('container')</div>
                //     Serialized string would look like this: `<div>Hello world<!--container--></div>`.
                //     The live DOM in a browser after that would be:
                //       <div>#text('Hello world') #comment('container')</div>
                //     Notice how 2 text nodes are now "merged" into one. This would cause hydration
                //     logic to fail, since it'd expect 2 text nodes being present, not one.
                //     To fix this, we insert a special comment node in between those text nodes, so
                //     serialized representation is: `<div>Hello <!--ngtns-->world<!--container--></div>`.
                //     This forces browser to create 2 text nodes separated by a comment node.
                //     Before running a hydration process, this special comment node is removed, so the
                //     live DOM has exactly the same state as it was before serialization.
                if (tNode.type & 1 /* TNodeType.Text */) {
                    const rNode = unwrapRNode(lView[i]);
                    // Collect this node as required special annotation only when its
                    // contents is empty. Otherwise, such text node would be present on
                    // the client after server-side rendering and no special handling needed.
                    if (rNode.textContent === '') {
                        context.corruptedTextNodes.set(rNode, "ngetn" /* TextNodeMarker.EmptyNode */);
                    }
                    else if (rNode.nextSibling?.nodeType === Node.TEXT_NODE) {
                        context.corruptedTextNodes.set(rNode, "ngtns" /* TextNodeMarker.Separator */);
                    }
                }
                if (tNode.projectionNext && tNode.projectionNext !== tNode.next &&
                    !isInSkipHydrationBlock(tNode.projectionNext)) {
                    // Check if projection next is not the same as next, in which case
                    // the node would not be found at creation time at runtime and we
                    // need to provide a location for that node.
                    appendSerializedNodePath(ngh, tNode.projectionNext, lView);
                }
            }
        }
    }
    return ngh;
}
/**
 * Determines whether a component instance that is represented
 * by a given LView uses `ViewEncapsulation.ShadowDom`.
 */
function componentUsesShadowDomEncapsulation(lView) {
    const instance = lView[CONTEXT];
    return instance?.constructor ?
        getComponentDef(instance.constructor)?.encapsulation === ViewEncapsulation.ShadowDom :
        false;
}
/**
 * Annotates component host element for hydration:
 * - by either adding the `ngh` attribute and collecting hydration-related info
 *   for the serialization and transferring to the client
 * - or by adding the `ngSkipHydration` attribute in case Angular detects that
 *   component contents is not compatible with hydration.
 *
 * @param element The Host element to be annotated
 * @param lView The associated LView
 * @param context The hydration context
 * @returns An index of serialized view from the transfer state object
 *          or `null` when a given component can not be serialized.
 */
function annotateHostElementForHydration(element, lView, context) {
    const renderer = lView[RENDERER];
    if (hasI18n(lView) || componentUsesShadowDomEncapsulation(lView)) {
        // Attach the skip hydration attribute if this component:
        // - either has i18n blocks, since hydrating such blocks is not yet supported
        // - or uses ShadowDom view encapsulation, since Domino doesn't support
        //   shadow DOM, so we can not guarantee that client and server representations
        //   would exactly match
        renderer.setAttribute(element, SKIP_HYDRATION_ATTR_NAME, '');
        return null;
    }
    else {
        const ngh = serializeLView(lView, context);
        const index = context.serializedViewCollection.add(ngh);
        renderer.setAttribute(element, NGH_ATTR_NAME, index.toString());
        return index;
    }
}
/**
 * Physically inserts the comment nodes to ensure empty text nodes and adjacent
 * text node separators are preserved after server serialization of the DOM.
 * These get swapped back for empty text nodes or separators once hydration happens
 * on the client.
 *
 * @param corruptedTextNodes The Map of text nodes to be replaced with comments
 * @param doc The document
 */
function insertCorruptedTextNodeMarkers(corruptedTextNodes, doc) {
    for (const [textNode, marker] of corruptedTextNodes) {
        textNode.after(doc.createComment(marker));
    }
}
/**
 * Detects whether a given TNode represents a node that
 * is being content projected.
 */
function isContentProjectedNode(tNode) {
    let currentTNode = tNode;
    while (currentTNode != null) {
        // If we come across a component host node in parent nodes -
        // this TNode is in the content projection section.
        if (isComponentHost(currentTNode)) {
            return true;
        }
        currentTNode = currentTNode.parent;
    }
    return false;
}
/**
 * Check whether a given node exists, but is disconnected from the DOM.
 *
 * Note: we leverage the fact that we have this information available in the DOM emulation
 * layer (in Domino) for now. Longer-term solution should not rely on the DOM emulation and
 * only use internal data structures and state to compute this information.
 */
function isDisconnectedNode(tNode, lView) {
    return !(tNode.type & 16 /* TNodeType.Projection */) && !!lView[tNode.index] &&
        !unwrapRNode(lView[tNode.index]).isConnected;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ub3RhdGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9jb3JlL3NyYy9oeWRyYXRpb24vYW5ub3RhdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7OztHQU1HO0FBR0gsT0FBTyxFQUFDLGlCQUFpQixFQUFDLE1BQU0sYUFBYSxDQUFDO0FBRTlDLE9BQU8sRUFBQyxrQkFBa0IsRUFBRSw4QkFBOEIsRUFBQyxNQUFNLGlDQUFpQyxDQUFDO0FBQ25HLE9BQU8sRUFBQyxlQUFlLEVBQUMsTUFBTSx1QkFBdUIsQ0FBQztBQUN0RCxPQUFPLEVBQUMsdUJBQXVCLEVBQWEsTUFBTSxpQ0FBaUMsQ0FBQztBQUNwRixPQUFPLEVBQUMsWUFBWSxFQUFtQixNQUFNLDRCQUE0QixDQUFDO0FBRTFFLE9BQU8sRUFBQyxPQUFPLEVBQUUsZUFBZSxFQUFFLFlBQVksRUFBRSxpQkFBaUIsRUFBRSxVQUFVLEVBQUMsTUFBTSxtQ0FBbUMsQ0FBQztBQUN4SCxPQUFPLEVBQUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxJQUFJLEVBQVMsTUFBTSxFQUFFLFFBQVEsRUFBUyxLQUFLLEVBQVksTUFBTSw0QkFBNEIsQ0FBQztBQUMxSCxPQUFPLEVBQUMsV0FBVyxFQUFFLFdBQVcsRUFBQyxNQUFNLDRCQUE0QixDQUFDO0FBQ3BFLE9BQU8sRUFBQyxhQUFhLEVBQUMsTUFBTSxtQkFBbUIsQ0FBQztBQUVoRCxPQUFPLEVBQUMsK0JBQStCLEVBQUMsTUFBTSxrQkFBa0IsQ0FBQztBQUNqRSxPQUFPLEVBQUMsVUFBVSxFQUFFLGtCQUFrQixFQUFFLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsY0FBYyxFQUEyQyxXQUFXLEVBQUUsU0FBUyxFQUFDLE1BQU0sY0FBYyxDQUFDO0FBQ3BMLE9BQU8sRUFBQyxlQUFlLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQztBQUNwRCxPQUFPLEVBQUMsc0JBQXNCLEVBQUUs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QyxDQUFDLEtBQUssQ0FBQyxJQUFJLGdDQUF1QixDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDO1FBQy9ELENBQUUsV0FBVyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQVUsQ0FBQyxXQUFXLENBQUM7QUFDN0QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQge0FwcGxpY2F0aW9uUmVmfSBmcm9tICcuLi9hcHBsaWNhdGlvbl9yZWYnO1xuaW1wb3J0IHtWaWV3RW5jYXBzdWxhdGlvbn0gZnJvbSAnLi4vbWV0YWRhdGEnO1xuaW1wb3J0IHtSZW5kZXJlcjJ9IGZyb20gJy4uL3JlbmRlcic7XG5pbXBvcnQge2NvbGxlY3ROYXRpdmVOb2RlcywgY29sbGVjdE5hdGl2ZU5vZGVzSW5MQ29udGFpbmVyfSBmcm9tICcuLi9yZW5kZXIzL2NvbGxlY3RfbmF0aXZlX25vZGVzJztcbmltcG9ydCB7Z2V0Q29tcG9uZW50RGVmfSBmcm9tICcuLi9yZW5kZXIzL2RlZmluaXRpb24nO1xuaW1wb3J0IHtDT05UQUlORVJfSEVBREVSX09GRlNFVCwgTENvbnRhaW5lcn0gZnJvbSAnLi4vcmVuZGVyMy9pbnRlcmZhY2VzL2NvbnRhaW5lcic7XG5pbXBvcnQge2lzVE5vZGVTaGFwZSwgVE5vZGUsIFROb2RlVHlwZX0gZnJvbSAnLi4vcmVuZGVyMy9pbnRlcmZhY2VzL25vZGUnO1xuaW1wb3J0IHtSRWxlbWVudH0gZnJvbSAnLi4vcmVuZGVyMy9pbnRlcmZhY2VzL3JlbmRlcmVyX2RvbSc7XG5pbXBvcnQge2hhc0kxOG4sIGlzQ29tcG9uZW50SG9zdCwgaXNMQ29udGFpbmVyLCBpc1Byb2plY3Rpb25UTm9kZSwgaXNSb290Vmlld30gZnJvbSAnLi4vcmVuZGVyMy9pbnRlcmZhY2VzL3R5cGVfY2hlY2tzJztcbmltcG9ydCB7Q09OVEVYVCwgSEVBREVSX09GRlNFVCwgSE9TVCwgTFZpZXcsIFBBUkVOVCwgUkVOREVSRVIsIFRWaWV3LCBUVklFVywgVFZpZXdUeXBlfSBmcm9tICcuLi9yZW5kZXIzL2ludGVyZmFjZXMvdmlldyc7XG5pbXBvcnQge3Vud3JhcExWaWV3LCB1bndyYXBSTm9kZX0gZnJvbSAnLi4vcmVuZGVyMy91dGlsL3ZpZXdfdXRpbHMnO1xuaW1wb3J0IHtUcmFuc2ZlclN0YXRlfSBmcm9tICcuLi90cmFuc2Zlcl9zdGF0ZSc7XG5cbmltcG9ydCB7dW5zdXBwb3J0ZWRQcm9qZWN0aW9uT2ZEb21Ob2Rlc30gZnJvbSAnLi9lcnJvcl9oYW5kbGluZyc7XG5pbXBvcnQge0NPTlRBSU5FUlMsIERJU0NPTk5FQ1RFRF9OT0RFUywgRUxFTUVOVF9DT05UQUlORVJTLCBNVUxUSVBMSUVSLCBOT0RFUywgTlVNX1JPT1RfTk9ERVMsIFNlcmlhbGl6ZWRDb250YWluZXJWaWV3LCBTZXJpYWxpemVkVmlldywgVEVNUExBVEVfSUQsIFRFTVBMQVRFU30gZnJvbSAnLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7Y2FsY1BhdGhGb3JOb2RlfSBmcm9tICcuL25vZGVfbG9va3VwX3V0aWxzJztcbmltcG9ydCB7aXNJblNraXBIeWRyYXRpb25CbG9jaywgU0tJUF9IWURSQVRJT05fQVRUUl9OQU1FfSBmcm9tICcuL3NraXBfaHlkcmF0aW9uJztcbmltcG9ydCB7Z2V0TE5vZGVGb3JIeWRyYXRpb24sIE5HSF9BVFRSX05BTUUsIE5HSF9EQVRBX0tFWSwgVGV4dE5vZGVNYXJrZXJ9IGZyb20gJy4vdXRpbHMnO1xuXG4vKipcbiAqIEEgY29sbGVjdGlvbiB0aGF0IHRyYWNrcyBhbGwgc2VyaWFsaXplZCB2aWV3cyAoYG5naGAgRE9NIGFubm90YXRpb25zKVxuICogdG8gYXZvaWQgZHVwbGljYXRpb24uIEFuIGF0dGVtcHQgdG8gYWRkIGEgZHVwbGljYXRlIHZpZXcgcmVzdWx0cyBpbiB0aGVcbiAqIGNvbGxlY3Rpb24gcmV0dXJuaW5nIHRoZSBpbmRleCBvZiB0aGUgcHJldmlvdXNseSBjb2xsZWN0ZWQgc2VyaWFsaXplZCB2aWV3LlxuICogVGhpcyByZWR1Y2VzIHRoZSBudW1iZXIgb2YgYW5ub3RhdGlvbnMgbmVlZGVkIGZvciBhIGdpdmVuIHBhZ2UuXG4gKi9cbmNsYXNzIFNlcmlhbGl6ZWRWaWV3Q29sbGVjdGlvbiB7XG4gIHByaXZhdGUgdmlld3M6IFNlcmlhbGl6ZWRWaWV3W10gPSBbXTtcbiAgcHJpdmF0ZSBpbmRleEJ5Q29udGVudCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG5cbiAgYWRkKHNlcmlhbGl6ZWRWaWV3OiBTZXJpYWxpemVkVmlldyk6IG51bWJlciB7XG4gICAgY29uc3Qgdmlld0FzU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplZFZpZXcpO1xuICAgIGlmICghdGhpcy5pbmRleEJ5Q29udGVudC5oYXModmlld0FzU3RyaW5nKSkge1xuICAgICAgY29uc3QgaW5kZXggPSB0aGlzLnZpZXdzLmxlbmd0aDtcbiAgICAgIHRoaXMudmlld3MucHVzaChzZXJpYWxpemVkVmlldyk7XG4gICAgICB0aGlzLmluZGV4QnlDb250ZW50LnNldCh2aWV3QXNTdHJpbmcsIGluZGV4KTtcbiAgICAgIHJldHVybiBpbmRleDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuaW5kZXhCeUNvbnRlbnQuZ2V0KHZpZXdBc1N0cmluZykhO1xuICB9XG5cbiAgZ2V0QWxsKCk6IFNlcmlhbGl6ZWRWaWV3W10ge1xuICAgIHJldHVybiB0aGlzLnZpZXdzO1xuICB9XG59XG5cbi8qKlxuICogR2xvYmFsIGNvdW50ZXIgdGhhdCBpcyB1c2VkIHRvIGdlbmVyYXRlIGEgdW5pcXVlIGlkIGZvciBUVmlld3NcbiAqIGR1cmluZyB0aGUgc2VyaWFsaXphdGlvbiBwcm9jZXNzLlxuICovXG5sZXQgdFZpZXdTc3JJZCA9IDA7XG5cbi8qKlxuICogR2VuZXJhdGVzIGEgdW5pcXVlIGlkIGZvciBhIGdpdmVuIFRWaWV3IGFuZCByZXR1cm5zIHRoaXMgaWQuXG4gKiBUaGUgaWQgaXMgYWxzbyBzdG9yZWQgb24gdGhpcyBpbnN0YW5jZSBvZiBhIFRWaWV3IGFuZCByZXVzZWQgaW5cbiAqIHN1YnNlcXVlbnQgY2FsbHMuXG4gKlxuICogVGhpcyBpZCBpcyBuZWVkZWQgdG8gdW5pcXVlbHkgaWRlbnRpZnkgYW5kIHBpY2sgdXAgZGVoeWRyYXRlZCB2aWV3c1xuICogYXQgcnVudGltZS5cbiAqL1xuZnVuY3Rpb24gZ2V0U3NySWQodFZpZXc6IFRWaWV3KTogc3RyaW5nIHtcbiAgaWYgKCF0Vmlldy5zc3JJZCkge1xuICAgIHRWaWV3LnNzcklkID0gYHQke3RWaWV3U3NySWQrK31gO1xuICB9XG4gIHJldHVybiB0Vmlldy5zc3JJZDtcbn1cblxuLyoqXG4gKiBEZXNjcmliZXMgYSBjb250ZXh0IGF2YWlsYWJsZSBkdXJpbmcgdGhlIHNlcmlhbGl6YXRpb25cbiAqIHByb2Nlc3MuIFRoZSBjb250ZXh0IGlzIHVzZWQgdG8gc2hhcmUgYW5kIGNvbGxlY3QgaW5mb3JtYXRpb25cbiAqIGR1cmluZyB0aGUgc2VyaWFsaXphdGlvbi5cbiAqL1xuaW50ZXJmYWNlIEh5ZHJhdGlvbkNvbnRleHQge1xuICBzZXJpYWxpemVkVmlld0NvbGxlY3Rpb246IFNlcmlhbGl6ZWRWaWV3Q29sbGVjdGlvbjtcbiAgY29ycnVwdGVkVGV4dE5vZGVzOiBNYXA8SFRNTEVsZW1lbnQsIFRleHROb2RlTWFya2VyPjtcbn1cblxuLyoqXG4gKiBDb21wdXRlcyB0aGUgbnVtYmVyIG9mIHJvb3Qgbm9kZXMgaW4gYSBnaXZlbiB2aWV3XG4gKiAob3IgY2hpbGQgbm9kZXMgaW4gYSBnaXZlbiBjb250YWluZXIgaWYgYSB0Tm9kZSBpcyBwcm92aWRlZCkuXG4gKi9cbmZ1bmN0aW9uIGNhbGNOdW1Sb290Tm9kZXModFZpZXc6IFRWaWV3LCBsVmlldzogTFZpZXcsIHROb2RlOiBUTm9kZXxudWxsKTogbnVtYmVyIHtcbiAgY29uc3Qgcm9vdE5vZGVzOiB1bmtub3duW10gPSBbXTtcbiAgY29sbGVjdE5hdGl2ZU5vZGVzKHRWaWV3LCBsVmlldywgdE5vZGUsIHJvb3ROb2Rlcyk7XG4gIHJldHVybiByb290Tm9kZXMubGVuZ3RoO1xufVxuXG4vKipcbiAqIENvbXB1dGVzIHRoZSBudW1iZXIgb2Ygcm9vdCBub2RlcyBpbiBhbGwgdmlld3MgaW4gYSBnaXZlbiBMQ29udGFpbmVyLlxuICovXG5mdW5jdGlvbiBjYWxjTnVtUm9vdE5vZGVzSW5MQ29udGFpbmVyKGxDb250YWluZXI6IExDb250YWluZXIpOiBudW1iZXIge1xuICBjb25zdCByb290Tm9kZXM6IHVua25vd25bXSA9IFtdO1xuICBjb2xsZWN0TmF0aXZlTm9kZXNJbkxDb250YWluZXIobENvbnRhaW5lciwgcm9vdE5vZGVzKTtcbiAgcmV0dXJuIHJvb3ROb2Rlcy5sZW5ndGg7XG59XG5cblxuLyoqXG4gKiBBbm5vdGF0ZXMgcm9vdCBsZXZlbCBjb21wb25lbnQncyBMVmlldyBmb3IgaHlkcmF0aW9uLFxuICogc2VlIGBhbm5vdGF0ZUhvc3RFbGVtZW50Rm9ySHlkcmF0aW9uYCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbi5cbiAqL1xuZnVuY3Rpb24gYW5ub3RhdGVDb21wb25lbnRMVmlld0Zvckh5ZHJhdGlvbihsVmlldzogTFZpZXcsIGNvbnRleHQ6IEh5ZHJhdGlvbkNvbnRleHQpOiBudW1iZXJ8bnVsbCB7XG4gIGNvbnN0IGhvc3RFbGVtZW50ID0gbFZpZXdbSE9TVF07XG4gIC8vIFJvb3QgZWxlbWVudHMgbWlnaHQgYWxzbyBiZSBhbm5vdGF0ZWQgd2l0aCB0aGUgYG5nU2tpcEh5ZHJhdGlvbmAgYXR0cmlidXRlLFxuICAvLyBjaGVjayBpZiBpdCdzIHByZXNlbnQgYmVmb3JlIHN0YXJ0aW5nIHRoZSBzZXJpYWxpemF0aW9uIHByb2Nlc3MuXG4gIGlmIChob3N0RWxlbWVudCAmJiAhKGhvc3RFbGVtZW50IGFzIEhUTUxFbGVtZW50KS5oYXNBdHRyaWJ1dGUoU0tJUF9IWURSQVRJT05fQVRUUl9OQU1FKSkge1xuICAgIHJldHVybiBhbm5vdGF0ZUhvc3RFbGVtZW50Rm9ySHlkcmF0aW9uKGhvc3RFbGVtZW50IGFzIEhUTUxFbGVtZW50LCBsVmlldywgY29udGV4dCk7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogQW5ub3RhdGVzIHJvb3QgbGV2ZWwgTENvbnRhaW5lciBmb3IgaHlkcmF0aW9uLiBUaGlzIGhhcHBlbnMgd2hlbiBhIHJvb3QgY29tcG9uZW50XG4gKiBpbmplY3RzIFZpZXdDb250YWluZXJSZWYsIHRodXMgbWFraW5nIHRoZSBjb21wb25lbnQgYW4gYW5jaG9yIGZvciBhIHZpZXcgY29udGFpbmVyLlxuICogVGhpcyBmdW5jdGlvbiBzZXJpYWxpemVzIHRoZSBjb21wb25lbnQgaXRzZWxmIGFzIHdlbGwgYXMgYWxsIHZpZXdzIGZyb20gdGhlIHZpZXdcbiAqIGNvbnRhaW5lci5cbiAqL1xuZnVuY3Rpb24gYW5ub3RhdGVMQ29udGFpbmVyRm9ySHlkcmF0aW9uKGxDb250YWluZXI6IExDb250YWluZXIsIGNvbnRleHQ6IEh5ZHJhdGlvbkNvbnRleHQpIHtcbiAgY29uc3QgY29tcG9uZW50TFZpZXcgPSB1bndyYXBMVmlldyhsQ29udGFpbmVyW0hPU1RdKSBhcyBMVmlldzx1bmtub3duPjtcblxuICAvLyBTZXJpYWxpemUgdGhlIHJvb3QgY29tcG9uZW50IGl0c2VsZi5cbiAgY29uc3QgY29tcG9uZW50TFZpZXdOZ2hJbmRleCA9IGFubm90YXRlQ29tcG9uZW50TFZpZXdGb3JIeWRyYXRpb24oY29tcG9uZW50TFZpZXcsIGNvbnRleHQpO1xuXG4gIGNvbnN0IGhvc3RFbGVtZW50ID0gdW53cmFwUk5vZGUoY29tcG9uZW50TFZpZXdbSE9TVF0hKSBhcyBIVE1MRWxlbWVudDtcblxuICAvLyBTZXJpYWxpemUgYWxsIHZpZXdzIHdpdGhpbiB0aGlzIHZpZXcgY29udGFpbmVyLlxuICBjb25zdCByb290TFZpZXcgPSBsQ29udGFpbmVyW1BBUkVOVF07XG4gIGNvbnN0IHJvb3RMVmlld05naEluZGV4ID0gYW5ub3RhdGVIb3N0RWxlbWVudEZvckh5ZHJhdGlvbihob3N0RWxlbWVudCwgcm9vdExWaWV3LCBjb250ZXh0KTtcblxuICBjb25zdCByZW5kZXJlciA9IGNvbXBvbmVudExWaWV3W1JFTkRFUkVSXSBhcyBSZW5kZXJlcjI7XG5cbiAgLy8gRm9yIGNhc2VzIHdoZW4gYSByb290IGNvbXBvbmVudCBhbHNvIGFjdHMgYXMgYW4gYW5jaG9yIG5vZGUgZm9yIGEgVmlld0NvbnRhaW5lclJlZlxuICAvLyAoZm9yIGV4YW1wbGUsIHdoZW4gVmlld0NvbnRhaW5lclJlZiBpcyBpbmplY3RlZCBpbiBhIHJvb3QgY29tcG9uZW50KSwgdGhlcmUgaXMgYSBuZWVkXG4gIC8vIHRvIHNlcmlhbGl6ZSBpbmZvcm1hdGlvbiBhYm91dCB0aGUgY29tcG9uZW50IGl0c2VsZiwgYXMgd2VsbCBhcyBhbiBMQ29udGFpbmVyIHRoYXRcbiAgLy8gcmVwcmVzZW50cyB0aGlzIFZpZXdDb250YWluZXJSZWYuIEVmZmVjdGl2ZWx5LCB3ZSBuZWVkIHRvIHNlcmlhbGl6ZSAyIHBpZWNlcyBvZiBpbmZvOlxuICAvLyAoMSkgaHlkcmF0aW9uIGluZm8gZm9yIHRoZSByb290IGNvbXBvbmVudCBpdHNlbGYgYW5kICgyKSBoeWRyYXRpb24gaW5mbyBmb3IgdGhlXG4gIC8vIFZpZXdDb250YWluZXJSZWYgaW5zdGFuY2UgKGFuIExDb250YWluZXIpLiBFYWNoIHBpZWNlIG9mIGluZm9ybWF0aW9uIGlzIGluY2x1ZGVkIGludG9cbiAgLy8gdGhlIGh5ZHJhdGlvbiBkYXRhIChpbiB0aGUgVHJhbnNmZXJTdGF0ZSBvYmplY3QpIHNlcGFyYXRlbHksIHRodXMgd2UgZW5kIHVwIHdpdGggMiBpZHMuXG4gIC8vIFNpbmNlIHdlIG9ubHkgaGF2ZSAxIHJvb3QgZWxlbWVudCwgd2UgZW5jb2RlIGJvdGggYml0cyBvZiBpbmZvIGludG8gYSBzaW5nbGUgc3RyaW5nOlxuICAvLyBpZHMgYXJlIHNlcGFyYXRlZCBieSB0aGUgYHxgIGNoYXIgKGUuZy4gYDEwfDI1YCwgd2hlcmUgYDEwYCBpcyB0aGUgbmdoIGZvciBhIGNvbXBvbmVudCB2aWV3XG4gIC8vIGFuZCAyNSBpcyB0aGUgYG5naGAgZm9yIGEgcm9vdCB2aWV3IHdoaWNoIGhvbGRzIExDb250YWluZXIpLlxuICBjb25zdCBmaW5hbEluZGV4ID0gYCR7Y29tcG9uZW50TFZpZXdOZ2hJbmRleH18JHtyb290TFZpZXdOZ2hJbmRleH1gO1xuICByZW5kZXJlci5zZXRBdHRyaWJ1dGUoaG9zdEVsZW1lbnQsIE5HSF9BVFRSX05BTUUsIGZpbmFsSW5kZXgpO1xufVxuXG4vKipcbiAqIEFubm90YXRlcyBhbGwgY29tcG9uZW50cyBib290c3RyYXBwZWQgaW4gYSBnaXZlbiBBcHBsaWNhdGlvblJlZlxuICogd2l0aCBpbmZvIG5lZWRlZCBmb3IgaHlkcmF0aW9uLlxuICpcbiAqIEBwYXJhbSBhcHBSZWYgQW4gaW5zdGFuY2Ugb2YgYW4gQXBwbGljYXRpb25SZWYuXG4gKiBAcGFyYW0gZG9jIEEgcmVmZXJlbmNlIHRvIHRoZSBjdXJyZW50IERvY3VtZW50IGluc3RhbmNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYW5ub3RhdGVGb3JIeWRyYXRpb24oYXBwUmVmOiBBcHBsaWNhdGlvblJlZiwgZG9jOiBEb2N1bWVudCkge1xuICBjb25zdCBzZXJpYWxpemVkVmlld0NvbGxlY3Rpb24gPSBuZXcgU2VyaWFsaXplZFZpZXdDb2xsZWN0aW9uKCk7XG4gIGNvbnN0IGNvcnJ1cHRlZFRleHROb2RlcyA9IG5ldyBNYXA8SFRNTEVsZW1lbnQsIFRleHROb2RlTWFya2VyPigpO1xuICBjb25zdCB2aWV3UmVmcyA9IGFwcFJlZi5fdmlld3M7XG4gIGZvciAoY29uc3Qgdmlld1JlZiBvZiB2aWV3UmVmcykge1xuICAgIGNvbnN0IGxOb2RlID0gZ2V0TE5vZGVGb3JIeWRyYXRpb24odmlld1JlZik7XG5cbiAgICAvLyBBbiBgbFZpZXdgIG1pZ2h0IGJlIGBudWxsYCBpZiBhIGBWaWV3UmVmYCByZXByZXNlbnRzXG4gICAgLy8gYW4gZW1iZWRkZWQgdmlldyAobm90IGEgY29tcG9uZW50IHZpZXcpLlxuICAgIGlmIChsTm9kZSAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgY29udGV4dDogSHlkcmF0aW9uQ29udGV4dCA9IHtcbiAgICAgICAgc2VyaWFsaXplZFZpZXdDb2xsZWN0aW9uLFxuICAgICAgICBjb3JydXB0ZWRUZXh0Tm9kZXMsXG4gICAgICB9O1xuICAgICAgaWYgKGlzTENvbnRhaW5lcihsTm9kZSkpIHtcbiAgICAgICAgYW5ub3RhdGVMQ29udGFpbmVyRm9ySHlkcmF0aW9uKGxOb2RlLCBjb250ZXh0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFubm90YXRlQ29tcG9uZW50TFZpZXdGb3JIeWRyYXRpb24obE5vZGUsIGNvbnRleHQpO1xuICAgICAgfVxuICAgICAgaW5zZXJ0Q29ycnVwdGVkVGV4dE5vZGVNYXJrZXJzKGNvcnJ1cHRlZFRleHROb2RlcywgZG9jKTtcbiAgICB9XG4gIH1cblxuICAvLyBOb3RlOiB3ZSAqYWx3YXlzKiBpbmNsdWRlIGh5ZHJhdGlvbiBpbmZvIGtleSBhbmQgYSBjb3JyZXNwb25kaW5nIHZhbHVlXG4gIC8vIGludG8gdGhlIFRyYW5zZmVyU3RhdGUsIGV2ZW4gaWYgdGhlIGxpc3Qgb2Ygc2VyaWFsaXplZCB2aWV3cyBpcyBlbXB0eS5cbiAgLy8gVGhpcyBpcyBuZWVkZWQgYXMgYSBzaWduYWwgdG8gdGhlIGNsaWVudCB0aGF0IHRoZSBzZXJ2ZXIgcGFydCBvZiB0aGVcbiAgLy8gaHlkcmF0aW9uIGxvZ2ljIHdhcyBzZXR1cCBhbmQgZW5hYmxlZCBjb3JyZWN0bHkuIE90aGVyd2lzZSwgaWYgYSBjbGllbnRcbiAgLy8gaHlkcmF0aW9uIGRvZXNuJ3QgZmluZCBhIGtleSBpbiB0aGUgdHJhbnNmZXIgc3RhdGUgLSBhbiBlcnJvciBpcyBwcm9kdWNlZC5cbiAgY29uc3Qgc2VyaWFsaXplZFZpZXdzID0gc2VyaWFsaXplZFZpZXdDb2xsZWN0aW9uLmdldEFsbCgpO1xuICBjb25zdCB0cmFuc2ZlclN0YXRlID0gYXBwUmVmLmluamVjdG9yLmdldChUcmFuc2ZlclN0YXRlKTtcbiAgdHJhbnNmZXJTdGF0ZS5zZXQoTkdIX0RBVEFfS0VZLCBzZXJpYWxpemVkVmlld3MpO1xufVxuXG4vKipcbiAqIFNlcmlhbGl6ZXMgdGhlIGxDb250YWluZXIgZGF0YSBpbnRvIGEgbGlzdCBvZiBTZXJpYWxpemVkVmlldyBvYmplY3RzLFxuICogdGhhdCByZXByZXNlbnQgdmlld3Mgd2l0aGluIHRoaXMgbENvbnRhaW5lci5cbiAqXG4gKiBAcGFyYW0gbENvbnRhaW5lciB0aGUgbENvbnRhaW5lciB3ZSBhcmUgc2VyaWFsaXppbmdcbiAqIEBwYXJhbSBjb250ZXh0IHRoZSBoeWRyYXRpb24gY29udGV4dFxuICogQHJldHVybnMgYW4gYXJyYXkgb2YgdGhlIGBTZXJpYWxpemVkVmlld2Agb2JqZWN0c1xuICovXG5mdW5jdGlvbiBzZXJpYWxpemVMQ29udGFpbmVyKFxuICAgIGxDb250YWluZXI6IExDb250YWluZXIsIGNvbnRleHQ6IEh5ZHJhdGlvbkNvbnRleHQpOiBTZXJpYWxpemVkQ29udGFpbmVyVmlld1tdIHtcbiAgY29uc3Qgdmlld3M6IFNlcmlhbGl6ZWRDb250YWluZXJWaWV3W10gPSBbXTtcbiAgbGV0IGxhc3RWaWV3QXNTdHJpbmcgPSAnJztcblxuICBmb3IgKGxldCBpID0gQ09OVEFJTkVSX0hFQURFUl9PRkZTRVQ7IGkgPCBsQ29udGFpbmVyLmxlbmd0aDsgaSsrKSB7XG4gICAgbGV0IGNoaWxkTFZpZXcgPSBsQ29udGFpbmVyW2ldIGFzIExWaWV3O1xuXG4gICAgbGV0IHRlbXBsYXRlOiBzdHJpbmc7XG4gICAgbGV0IG51bVJvb3ROb2RlczogbnVtYmVyO1xuICAgIGxldCBzZXJpYWxpemVkVmlldzogU2VyaWFsaXplZENvbnRhaW5lclZpZXd8dW5kZWZpbmVkO1xuXG4gICAgaWYgKGlzUm9vdFZpZXcoY2hpbGRMVmlldykpIHtcbiAgICAgIC8vIElmIHRoaXMgaXMgYSByb290IHZpZXcsIGdldCBhbiBMVmlldyBmb3IgdGhlIHVuZGVybHlpbmcgY29tcG9uZW50LFxuICAgICAgLy8gYmVjYXVzZSBpdCBjb250YWlucyBpbmZvcm1hdGlvbiBhYm91dCB0aGUgdmlldyB0byBzZXJpYWxpemUuXG4gICAgICBjaGlsZExWaWV3ID0gY2hpbGRMVmlld1tIRUFERVJfT0ZGU0VUXTtcblxuICAgICAgLy8gSWYgd2UgaGF2ZSBhbiBMQ29udGFpbmVyIGF0IHRoaXMgcG9zaXRpb24sIHRoaXMgaW5kaWNhdGVzIHRoYXQgdGhlXG4gICAgICAvLyBob3N0IGVsZW1lbnQgd2FzIHVzZWQgYXMgYSBWaWV3Q29udGFpbmVyUmVmIGFuY2hvciAoZS5nLiBhIGBWaWV3Q29udGFpbmVyUmVmYFxuICAgICAgLy8gd2FzIGluamVjdGVkIHdpdGhpbiB0aGUgY29tcG9uZW50IGNsYXNzKS4gVGhpcyBjYXNlIHJlcXVpcmVzIHNwZWNpYWwgaGFuZGxpbmcuXG4gICAgICBpZiAoaXNMQ29udGFpbmVyKGNoaWxkTFZpZXcpKSB7XG4gICAgICAgIC8vIENhbGN1bGF0ZSB0aGUgbnVtYmVyIG9mIHJvb3Qgbm9kZXMgaW4gYWxsIHZpZXdzIGluIGEgZ2l2ZW4gY29udGFpbmVyXG4gICAgICAgIC8vIGFuZCBpbmNyZW1lbnQgYnkgb25lIHRvIGFjY291bnQgZm9yIGFuIGFuY2hvciBub2RlIGl0c2VsZiwgaS5lLiBpbiB0aGlzXG4gICAgICAgIC8vIHNjZW5hcmlvIHdlJ2xsIGhhdmUgYSBsYXlvdXQgdGhhdCB3b3VsZCBsb29rIGxpa2UgdGhpczpcbiAgICAgICAgLy8gYDxhcHAtcm9vdCAvPjwjVklFVzE+PCNWSUVXMj4uLi48IS0tY29udGFpbmVyLS0+YFxuICAgICAgICAvLyBUaGUgYCsxYCBpcyB0byBjYXB0dXJlIHRoZSBgPGFwcC1yb290IC8+YCBlbGVtZW50LlxuICAgICAgICBudW1Sb290Tm9kZXMgPSBjYWxjTnVtUm9vdE5vZGVzSW5MQ29udGFpbmVyKGNoaWxkTFZpZXcpICsgMTtcblxuICAgICAgICBhbm5vdGF0ZUxDb250YWluZXJGb3JIeWRyYXRpb24oY2hpbGRMVmlldywgY29udGV4dCk7XG5cbiAgICAgICAgY29uc3QgY29tcG9uZW50TFZpZXcgPSB1bndyYXBMVmlldyhjaGlsZExWaWV3W0hPU1RdKSBhcyBMVmlldzx1bmtub3duPjtcblxuICAgICAgICBzZXJpYWxpemVkVmlldyA9IHtcbiAgICAgICAgICBbVEVNUExBVEVfSURdOiBjb21wb25lbnRMVmlld1tUVklFV10uc3NySWQhLFxuICAgICAgICAgIFtOVU1fUk9PVF9OT0RFU106IG51bVJvb3ROb2RlcyxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIXNlcmlhbGl6ZWRWaWV3KSB7XG4gICAgICBjb25zdCBjaGlsZFRWaWV3ID0gY2hpbGRMVmlld1tUVklFV107XG5cbiAgICAgIGlmIChjaGlsZFRWaWV3LnR5cGUgPT09IFRWaWV3VHlwZS5Db21wb25lbnQpIHtcbiAgICAgICAgdGVtcGxhdGUgPSBjaGlsZFRWaWV3LnNzcklkITtcblxuICAgICAgICAvLyBUaGlzIGlzIGEgY29tcG9uZW50IHZpZXcsIHRodXMgaXQgaGFzIG9ubHkgMSByb290IG5vZGU6IHRoZSBjb21wb25lbnRcbiAgICAgICAgLy8gaG9zdCBub2RlIGl0c2VsZiAob3RoZXIgbm9kZXMgd291bGQgYmUgaW5zaWRlIHRoYXQgaG9zdCBub2RlKS5cbiAgICAgICAgbnVtUm9vdE5vZGVzID0gMTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRlbXBsYXRlID0gZ2V0U3NySWQoY2hpbGRUVmlldyk7XG4gICAgICAgIG51bVJvb3ROb2RlcyA9IGNhbGNOdW1Sb290Tm9kZXMoY2hpbGRUVmlldywgY2hpbGRMVmlldywgY2hpbGRUVmlldy5maXJzdENoaWxkKTtcbiAgICAgIH1cblxuICAgICAgc2VyaWFsaXplZFZpZXcgPSB7XG4gICAgICAgIFtURU1QTEFURV9JRF06IHRlbXBsYXRlLFxuICAgICAgICBbTlVNX1JPT1RfTk9ERVNdOiBudW1Sb290Tm9kZXMsXG4gICAgICAgIC4uLnNlcmlhbGl6ZUxWaWV3KGxDb250YWluZXJbaV0gYXMgTFZpZXcsIGNvbnRleHQpLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiB0aGUgcHJldmlvdXMgdmlldyBoYXMgdGhlIHNhbWUgc2hhcGUgKGZvciBleGFtcGxlLCBpdCB3YXNcbiAgICAvLyBwcm9kdWNlZCBieSB0aGUgKm5nRm9yKSwgaW4gd2hpY2ggY2FzZSBidW1wIHRoZSBjb3VudGVyIG9uIHRoZSBwcmV2aW91c1xuICAgIC8vIHZpZXcgaW5zdGVhZCBvZiBpbmNsdWRpbmcgdGhlIHNhbWUgaW5mb3JtYXRpb24gYWdhaW4uXG4gICAgY29uc3QgY3VycmVudFZpZXdBc1N0cmluZyA9IEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZWRWaWV3KTtcbiAgICBpZiAodmlld3MubGVuZ3RoID4gMCAmJiBjdXJyZW50Vmlld0FzU3RyaW5nID09PSBsYXN0Vmlld0FzU3RyaW5nKSB7XG4gICAgICBjb25zdCBwcmV2aW91c1ZpZXcgPSB2aWV3c1t2aWV3cy5sZW5ndGggLSAxXTtcbiAgICAgIHByZXZpb3VzVmlld1tNVUxUSVBMSUVSXSA/Pz0gMTtcbiAgICAgIHByZXZpb3VzVmlld1tNVUxUSVBMSUVSXSsrO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZWNvcmQgdGhpcyB2aWV3IGFzIG1vc3QgcmVjZW50bHkgYWRkZWQuXG4gICAgICBsYXN0Vmlld0FzU3RyaW5nID0gY3VycmVudFZpZXdBc1N0cmluZztcbiAgICAgIHZpZXdzLnB1c2goc2VyaWFsaXplZFZpZXcpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmlld3M7XG59XG5cbi8qKlxuICogSGVscGVyIGZ1bmN0aW9uIHRvIHByb2R1Y2UgYSBub2RlIHBhdGggKHdoaWNoIG5hdmlnYXRpb24gc3RlcHMgcnVudGltZSBsb2dpY1xuICogbmVlZHMgdG8gdGFrZSB0byBsb2NhdGUgYSBub2RlKSBhbmQgc3RvcmVzIGl0IGluIHRoZSBgTk9ERVNgIHNlY3Rpb24gb2YgdGhlXG4gKiBjdXJyZW50IHNlcmlhbGl6ZWQgdmlldy5cbiAqL1xuZnVuY3Rpb24gYXBwZW5kU2VyaWFsaXplZE5vZGVQYXRoKG5naDogU2VyaWFsaXplZFZpZXcsIHROb2RlOiBUTm9kZSwgbFZpZXc6IExWaWV3KSB7XG4gIGNvbnN0IG5vT2Zmc2V0SW5kZXggPSB0Tm9kZS5pbmRleCAtIEhFQURFUl9PRkZTRVQ7XG4gIG5naFtOT0RFU10gPz89IHt9O1xuICBuZ2hbTk9ERVNdW25vT2Zmc2V0SW5kZXhdID0gY2FsY1BhdGhGb3JOb2RlKHROb2RlLCBsVmlldyk7XG59XG5cbi8qKlxuICogSGVscGVyIGZ1bmN0aW9uIHRvIGFwcGVuZCBpbmZvcm1hdGlvbiBhYm91dCBhIGRpc2Nvbm5lY3RlZCBub2RlLlxuICogVGhpcyBpbmZvIGlzIG5lZWRlZCBhdCBydW50aW1lIHRvIGF2b2lkIERPTSBsb29rdXBzIGZvciB0aGlzIGVsZW1lbnRcbiAqIGFuZCBpbnN0ZWFkLCB0aGUgZWxlbWVudCB3b3VsZCBiZSBjcmVhdGVkIGZyb20gc2NyYXRjaC5cbiAqL1xuZnVuY3Rpb24gYXBwZW5kRGlzY29ubmVjdGVkTm9kZUluZGV4KG5naDogU2VyaWFsaXplZFZpZXcsIHROb2RlOiBUTm9kZSkge1xuICBjb25zdCBub09mZnNldEluZGV4ID0gdE5vZGUuaW5kZXggLSBIRUFERVJfT0ZGU0VUO1xuICBuZ2hbRElTQ09OTkVDVEVEX05PREVTXSA/Pz0gW107XG4gIGlmICghbmdoW0RJU0NPTk5FQ1RFRF9OT0RFU10uaW5jbHVkZXMobm9PZmZzZXRJbmRleCkpIHtcbiAgICBuZ2hbRElTQ09OTkVDVEVEX05PREVTXS5wdXNoKG5vT2Zmc2V0SW5kZXgpO1xuICB9XG59XG5cbi8qKlxuICogU2VyaWFsaXplcyB0aGUgbFZpZXcgZGF0YSBpbnRvIGEgU2VyaWFsaXplZFZpZXcgb2JqZWN0IHRoYXQgd2lsbCBsYXRlciBiZSBhZGRlZFxuICogdG8gdGhlIFRyYW5zZmVyU3RhdGUgc3RvcmFnZSBhbmQgcmVmZXJlbmNlZCB1c2luZyB0aGUgYG5naGAgYXR0cmlidXRlIG9uIGEgaG9zdFxuICogZWxlbWVudC5cbiAqXG4gKiBAcGFyYW0gbFZpZXcgdGhlIGxWaWV3IHdlIGFyZSBzZXJpYWxpemluZ1xuICogQHBhcmFtIGNvbnRleHQgdGhlIGh5ZHJhdGlvbiBjb250ZXh0XG4gKiBAcmV0dXJucyB0aGUgYFNlcmlhbGl6ZWRWaWV3YCBvYmplY3QgY29udGFpbmluZyB0aGUgZGF0YSB0byBiZSBhZGRlZCB0byB0aGUgaG9zdCBub2RlXG4gKi9cbmZ1bmN0aW9uIHNlcmlhbGl6ZUxWaWV3KGxWaWV3OiBMVmlldywgY29udGV4dDogSHlkcmF0aW9uQ29udGV4dCk6IFNlcmlhbGl6ZWRWaWV3IHtcbiAgY29uc3QgbmdoOiBTZXJpYWxpemVkVmlldyA9IHt9O1xuICBjb25zdCB0VmlldyA9IGxWaWV3W1RWSUVXXTtcbiAgLy8gSXRlcmF0ZSBvdmVyIERPTSBlbGVtZW50IHJlZmVyZW5jZXMgaW4gYW4gTFZpZXcuXG4gIGZvciAobGV0IGkgPSBIRUFERVJfT0ZGU0VUOyBpIDwgdFZpZXcuYmluZGluZ1N0YXJ0SW5kZXg7IGkrKykge1xuICAgIGNvbnN0IHROb2RlID0gdFZpZXcuZGF0YVtpXSBhcyBUTm9kZTtcbiAgICBjb25zdCBub09mZnNldEluZGV4ID0gaSAtIEhFQURFUl9PRkZTRVQ7XG4gICAgLy8gU2tpcCBwcm9jZXNzaW5nIG9mIGEgZ2l2ZW4gc2xvdCBpbiB0aGUgZm9sbG93aW5nIGNhc2VzOlxuICAgIC8vIC0gTG9jYWwgcmVmcyAoZS5nLiA8ZGl2ICNsb2NhbFJlZj4pIHRha2UgdXAgYW4gZXh0cmEgc2xvdCBpbiBMVmlld3NcbiAgICAvLyAgIHRvIHN0b3JlIHRoZSBzYW1lIGVsZW1lbnQuIEluIHRoaXMgY2FzZSwgdGhlcmUgaXMgbm8gaW5mb3JtYXRpb24gaW5cbiAgICAvLyAgIGEgY29ycmVzcG9uZGluZyBzbG90IGluIFROb2RlIGRhdGEgc3RydWN0dXJlLlxuICAgIC8vIC0gV2hlbiBhIHNsb3QgY29udGFpbnMgc29tZXRoaW5nIG90aGVyIHRoYW4gYSBUTm9kZS4gRm9yIGV4YW1wbGUsIHRoZXJlXG4gICAgLy8gICBtaWdodCBiZSBzb21lIG1ldGFkYXRhIGluZm9ybWF0aW9uIGFib3V0IGEgZGVmZXIgYmxvY2sgb3IgYSBjb250cm9sIGZsb3cgYmxvY2suXG4gICAgaWYgKCFpc1ROb2RlU2hhcGUodE5vZGUpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiBhIG5hdGl2ZSBub2RlIHRoYXQgcmVwcmVzZW50cyBhIGdpdmVuIFROb2RlIGlzIGRpc2Nvbm5lY3RlZCBmcm9tIHRoZSBET00gdHJlZS5cbiAgICAvLyBTdWNoIG5vZGVzIG11c3QgYmUgZXhjbHVkZWQgZnJvbSB0aGUgaHlkcmF0aW9uIChzaW5jZSB0aGUgaHlkcmF0aW9uIHdvbid0IGJlIGFibGUgdG9cbiAgICAvLyBmaW5kIHRoZW0pLCBzbyB0aGUgVE5vZGUgaWRzIGFyZSBjb2xsZWN0ZWQgYW5kIHVzZWQgYXQgcnVudGltZSB0byBza2lwIHRoZSBoeWRyYXRpb24uXG4gICAgLy9cbiAgICAvLyBUaGlzIHNpdHVhdGlvbiBtYXkgaGFwcGVuIGR1cmluZyB0aGUgY29udGVudCBwcm9qZWN0aW9uLCB3aGVuIHNvbWUgbm9kZXMgZG9uJ3QgbWFrZSBpdFxuICAgIC8vIGludG8gb25lIG9mIHRoZSBjb250ZW50IHByb2plY3Rpb24gc2xvdHMgKGZvciBleGFtcGxlLCB3aGVuIHRoZXJlIGlzIG5vIGRlZmF1bHRcbiAgICAvLyA8bmctY29udGVudCAvPiBzbG90IGluIHByb2plY3RvciBjb21wb25lbnQncyB0ZW1wbGF0ZSkuXG4gICAgaWYgKGlzRGlzY29ubmVjdGVkTm9kZSh0Tm9kZSwgbFZpZXcpICYmIGlzQ29udGVudFByb2plY3RlZE5vZGUodE5vZGUpKSB7XG4gICAgICBhcHBlbmREaXNjb25uZWN0ZWROb2RlSW5kZXgobmdoLCB0Tm9kZSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodE5vZGUucHJvamVjdGlvbikpIHtcbiAgICAgIGZvciAoY29uc3QgcHJvamVjdGlvbkhlYWRUTm9kZSBvZiB0Tm9kZS5wcm9qZWN0aW9uKSB7XG4gICAgICAgIC8vIFdlIG1heSBoYXZlIGBudWxsYHMgaW4gc2xvdHMgd2l0aCBubyBwcm9qZWN0ZWQgY29udGVudC5cbiAgICAgICAgaWYgKCFwcm9qZWN0aW9uSGVhZFROb2RlKSBjb250aW51ZTtcblxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkocHJvamVjdGlvbkhlYWRUTm9kZSkpIHtcbiAgICAgICAgICAvLyBJZiB3ZSBwcm9jZXNzIHJlLXByb2plY3RlZCBjb250ZW50IChpLmUuIGA8bmctY29udGVudD5gXG4gICAgICAgICAgLy8gYXBwZWFycyBhdCBwcm9qZWN0aW9uIGxvY2F0aW9uKSwgc2tpcCBhbm5vdGF0aW9ucyBmb3IgdGhpcyBjb250ZW50XG4gICAgICAgICAgLy8gc2luY2UgYWxsIERPTSBub2RlcyBpbiB0aGlzIHByb2plY3Rpb24gd2VyZSBoYW5kbGVkIHdoaWxlIHByb2Nlc3NpbmdcbiAgICAgICAgICAvLyBhIHBhcmVudCBsVmlldywgd2hpY2ggY29udGFpbnMgdGhvc2Ugbm9kZXMuXG4gICAgICAgICAgaWYgKCFpc1Byb2plY3Rpb25UTm9kZShwcm9qZWN0aW9uSGVhZFROb2RlKSAmJlxuICAgICAgICAgICAgICAhaXNJblNraXBIeWRyYXRpb25CbG9jayhwcm9qZWN0aW9uSGVhZFROb2RlKSkge1xuICAgICAgICAgICAgaWYgKGlzRGlzY29ubmVjdGVkTm9kZShwcm9qZWN0aW9uSGVhZFROb2RlLCBsVmlldykpIHtcbiAgICAgICAgICAgICAgLy8gQ2hlY2sgd2hldGhlciB0aGlzIG5vZGUgaXMgY29ubmVjdGVkLCBzaW5jZSB3ZSBtYXkgaGF2ZSBhIFROb2RlXG4gICAgICAgICAgICAgIC8vIGluIHRoZSBkYXRhIHN0cnVjdHVyZSBhcyBhIHByb2plY3Rpb24gc2VnbWVudCBoZWFkLCBidXQgdGhlXG4gICAgICAgICAgICAgIC8vIGNvbnRlbnQgcHJvamVjdGlvbiBzbG90IG1pZ2h0IGJlIGRpc2FibGVkIChlLmcuXG4gICAgICAgICAgICAgIC8vIDxuZy1jb250ZW50ICpuZ0lmPVwiZmFsc2VcIiAvPikuXG4gICAgICAgICAgICAgIGFwcGVuZERpc2Nvbm5lY3RlZE5vZGVJbmRleChuZ2gsIHByb2plY3Rpb25IZWFkVE5vZGUpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgYXBwZW5kU2VyaWFsaXplZE5vZGVQYXRoKG5naCwgcHJvamVjdGlvbkhlYWRUTm9kZSwgbFZpZXcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBJZiBhIHZhbHVlIGlzIGFuIGFycmF5LCBpdCBtZWFucyB0aGF0IHdlIGFyZSBwcm9jZXNzaW5nIGEgcHJvamVjdGlvblxuICAgICAgICAgIC8vIHdoZXJlIHByb2plY3RhYmxlIG5vZGVzIHdlcmUgcGFzc2VkIGluIGFzIERPTSBub2RlcyAoZm9yIGV4YW1wbGUsIHdoZW5cbiAgICAgICAgICAvLyBjYWxsaW5nIGBWaWV3Q29udGFpbmVyUmVmLmNyZWF0ZUNvbXBvbmVudChDbXBBLCB7cHJvamVjdGFibGVOb2RlczogWy4uLl19KWApLlxuICAgICAgICAgIC8vXG4gICAgICAgICAgLy8gSW4gdGhpcyBzY2VuYXJpbywgbm9kZXMgY2FuIGNvbWUgZnJvbSBhbnl3aGVyZSAoZWl0aGVyIGNyZWF0ZWQgbWFudWFsbHksXG4gICAgICAgICAgLy8gYWNjZXNzZWQgdmlhIGBkb2N1bWVudC5xdWVyeVNlbGVjdG9yYCwgZXRjKSBhbmQgbWF5IGJlIGluIGFueSBzdGF0ZVxuICAgICAgICAgIC8vIChhdHRhY2hlZCBvciBkZXRhY2hlZCBmcm9tIHRoZSBET00gdHJlZSkuIEFzIGEgcmVzdWx0LCB3ZSBjYW4gbm90IHJlbGlhYmx5XG4gICAgICAgICAgLy8gcmVzdG9yZSB0aGUgc3RhdGUgZm9yIHN1Y2ggY2FzZXMgZHVyaW5nIGh5ZHJhdGlvbi5cblxuICAgICAgICAgIHRocm93IHVuc3VwcG9ydGVkUHJvamVjdGlvbk9mRG9tTm9kZXModW53cmFwUk5vZGUobFZpZXdbaV0pKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaXNMQ29udGFpbmVyKGxWaWV3W2ldKSkge1xuICAgICAgLy8gU2VyaWFsaXplIGluZm9ybWF0aW9uIGFib3V0IGEgdGVtcGxhdGUuXG4gICAgICBjb25zdCBlbWJlZGRlZFRWaWV3ID0gdE5vZGUudFZpZXc7XG4gICAgICBpZiAoZW1iZWRkZWRUVmlldyAhPT0gbnVsbCkge1xuICAgICAgICBuZ2hbVEVNUExBVEVTXSA/Pz0ge307XG4gICAgICAgIG5naFtURU1QTEFURVNdW25vT2Zmc2V0SW5kZXhdID0gZ2V0U3NySWQoZW1iZWRkZWRUVmlldyk7XG4gICAgICB9XG5cbiAgICAgIC8vIFNlcmlhbGl6ZSB2aWV3cyB3aXRoaW4gdGhpcyBMQ29udGFpbmVyLlxuICAgICAgY29uc3QgaG9zdE5vZGUgPSBsVmlld1tpXVtIT1NUXSE7ICAvLyBob3N0IG5vZGUgb2YgdGhpcyBjb250YWluZXJcblxuICAgICAgLy8gTFZpZXdbaV1bSE9TVF0gY2FuIGJlIG9mIDIgZGlmZmVyZW50IHR5cGVzOlxuICAgICAgLy8gLSBlaXRoZXIgYSBET00gbm9kZVxuICAgICAgLy8gLSBvciBhbiBhcnJheSB0aGF0IHJlcHJlc2VudHMgYW4gTFZpZXcgb2YgYSBjb21wb25lbnRcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGhvc3ROb2RlKSkge1xuICAgICAgICAvLyBUaGlzIGlzIGEgY29tcG9uZW50LCBzZXJpYWxpemUgaW5mbyBhYm91dCBpdC5cbiAgICAgICAgY29uc3QgdGFyZ2V0Tm9kZSA9IHVud3JhcFJOb2RlKGhvc3ROb2RlIGFzIExWaWV3KSBhcyBSRWxlbWVudDtcbiAgICAgICAgaWYgKCEodGFyZ2V0Tm9kZSBhcyBIVE1MRWxlbWVudCkuaGFzQXR0cmlidXRlKFNLSVBfSFlEUkFUSU9OX0FUVFJfTkFNRSkpIHtcbiAgICAgICAgICBhbm5vdGF0ZUhvc3RFbGVtZW50Rm9ySHlkcmF0aW9uKHRhcmdldE5vZGUsIGhvc3ROb2RlIGFzIExWaWV3LCBjb250ZXh0KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBuZ2hbQ09OVEFJTkVSU10gPz89IHt9O1xuICAgICAgbmdoW0NPTlRBSU5FUlNdW25vT2Zmc2V0SW5kZXhdID0gc2VyaWFsaXplTENvbnRhaW5lcihsVmlld1tpXSwgY29udGV4dCk7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGxWaWV3W2ldKSkge1xuICAgICAgLy8gVGhpcyBpcyBhIGNvbXBvbmVudCwgYW5ub3RhdGUgdGhlIGhvc3Qgbm9kZSB3aXRoIGFuIGBuZ2hgIGF0dHJpYnV0ZS5cbiAgICAgIGNvbnN0IHRhcmdldE5vZGUgPSB1bndyYXBSTm9kZShsVmlld1tpXVtIT1NUXSEpO1xuICAgICAgaWYgKCEodGFyZ2V0Tm9kZSBhcyBIVE1MRWxlbWVudCkuaGFzQXR0cmlidXRlKFNLSVBfSFlEUkFUSU9OX0FUVFJfTkFNRSkpIHtcbiAgICAgICAgYW5ub3RhdGVIb3N0RWxlbWVudEZvckh5ZHJhdGlvbih0YXJnZXROb2RlIGFzIFJFbGVtZW50LCBsVmlld1tpXSwgY29udGV4dCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIDxuZy1jb250YWluZXI+IGNhc2VcbiAgICAgIGlmICh0Tm9kZS50eXBlICYgVE5vZGVUeXBlLkVsZW1lbnRDb250YWluZXIpIHtcbiAgICAgICAgLy8gQW4gPG5nLWNvbnRhaW5lcj4gaXMgcmVwcmVzZW50ZWQgYnkgdGhlIG51bWJlciBvZlxuICAgICAgICAvLyB0b3AtbGV2ZWwgbm9kZXMuIFRoaXMgaW5mb3JtYXRpb24gaXMgbmVlZGVkIHRvIHNraXAgb3ZlclxuICAgICAgICAvLyB0aG9zZSBub2RlcyB0byByZWFjaCBhIGNvcnJlc3BvbmRpbmcgYW5jaG9yIG5vZGUgKGNvbW1lbnQgbm9kZSkuXG4gICAgICAgIG5naFtFTEVNRU5UX0NPTlRBSU5FUlNdID8/PSB7fTtcbiAgICAgICAgbmdoW0VMRU1FTlRfQ09OVEFJTkVSU11bbm9PZmZzZXRJbmRleF0gPSBjYWxjTnVtUm9vdE5vZGVzKHRWaWV3LCBsVmlldywgdE5vZGUuY2hpbGQpO1xuICAgICAgfSBlbHNlIGlmICh0Tm9kZS50eXBlICYgVE5vZGVUeXBlLlByb2plY3Rpb24pIHtcbiAgICAgICAgLy8gQ3VycmVudCBUTm9kZSByZXByZXNlbnRzIGFuIGA8bmctY29udGVudD5gIHNsb3QsIHRodXMgaXQgaGFzIG5vXG4gICAgICAgIC8vIERPTSBlbGVtZW50cyBhc3NvY2lhdGVkIHdpdGggaXQsIHNvIHRoZSAqKm5leHQgc2libGluZyoqIG5vZGUgd291bGRcbiAgICAgICAgLy8gbm90IGJlIGFibGUgdG8gZmluZCBhbiBhbmNob3IuIEluIHRoaXMgY2FzZSwgdXNlIGZ1bGwgcGF0aCBpbnN0ZWFkLlxuICAgICAgICBsZXQgbmV4dFROb2RlID0gdE5vZGUubmV4dDtcbiAgICAgICAgLy8gU2tpcCBvdmVyIGFsbCBgPG5nLWNvbnRlbnQ+YCBzbG90cyBpbiBhIHJvdy5cbiAgICAgICAgd2hpbGUgKG5leHRUTm9kZSAhPT0gbnVsbCAmJiAobmV4dFROb2RlLnR5cGUgJiBUTm9kZVR5cGUuUHJvamVjdGlvbikpIHtcbiAgICAgICAgICBuZXh0VE5vZGUgPSBuZXh0VE5vZGUubmV4dDtcbiAgICAgICAgfVxuICAgICAgICBpZiAobmV4dFROb2RlICYmICFpc0luU2tpcEh5ZHJhdGlvbkJsb2NrKG5leHRUTm9kZSkpIHtcbiAgICAgICAgICAvLyBIYW5kbGUgYSB0Tm9kZSBhZnRlciB0aGUgYDxuZy1jb250ZW50PmAgc2xvdC5cbiAgICAgICAgICBhcHBlbmRTZXJpYWxpemVkTm9kZVBhdGgobmdoLCBuZXh0VE5vZGUsIGxWaWV3KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gSGFuZGxlIGNhc2VzIHdoZXJlIHRleHQgbm9kZXMgY2FuIGJlIGxvc3QgYWZ0ZXIgRE9NIHNlcmlhbGl6YXRpb246XG4gICAgICAgIC8vICAxLiBXaGVuIHRoZXJlIGlzIGFuICplbXB0eSB0ZXh0IG5vZGUqIGluIERPTTogaW4gdGhpcyBjYXNlLCB0aGlzXG4gICAgICAgIC8vICAgICBub2RlIHdvdWxkIG5vdCBtYWtlIGl0IGludG8gdGhlIHNlcmlhbGl6ZWQgc3RyaW5nIGFuZCBhcyBhIHJlc3VsdCxcbiAgICAgICAgLy8gICAgIHRoaXMgbm9kZSB3b3VsZG4ndCBiZSBjcmVhdGVkIGluIGEgYnJvd3Nlci4gVGhpcyB3b3VsZCByZXN1bHQgaW5cbiAgICAgICAgLy8gICAgIGEgbWlzbWF0Y2ggZHVyaW5nIHRoZSBoeWRyYXRpb24sIHdoZXJlIHRoZSBydW50aW1lIGxvZ2ljIHdvdWxkIGV4cGVjdFxuICAgICAgICAvLyAgICAgYSB0ZXh0IG5vZGUgdG8gYmUgcHJlc2VudCBpbiBsaXZlIERPTSwgYnV0IG5vIHRleHQgbm9kZSB3b3VsZCBleGlzdC5cbiAgICAgICAgLy8gICAgIEV4YW1wbGU6IGA8c3Bhbj57eyBuYW1lIH19PC9zcGFuPmAgd2hlbiB0aGUgYG5hbWVgIGlzIGFuIGVtcHR5IHN0cmluZy5cbiAgICAgICAgLy8gICAgIFRoaXMgd291bGQgcmVzdWx0IGluIGA8c3Bhbj48L3NwYW4+YCBzdHJpbmcgYWZ0ZXIgc2VyaWFsaXphdGlvbiBhbmRcbiAgICAgICAgLy8gICAgIGluIGEgYnJvd3NlciBvbmx5IHRoZSBgc3BhbmAgZWxlbWVudCB3b3VsZCBiZSBjcmVhdGVkLiBUbyByZXNvbHZlIHRoYXQsXG4gICAgICAgIC8vICAgICBhbiBleHRyYSBjb21tZW50IG5vZGUgaXMgYXBwZW5kZWQgaW4gcGxhY2Ugb2YgYW4gZW1wdHkgdGV4dCBub2RlIGFuZFxuICAgICAgICAvLyAgICAgdGhhdCBzcGVjaWFsIGNvbW1lbnQgbm9kZSBpcyByZXBsYWNlZCB3aXRoIGFuIGVtcHR5IHRleHQgbm9kZSAqYmVmb3JlKlxuICAgICAgICAvLyAgICAgaHlkcmF0aW9uLlxuICAgICAgICAvLyAgMi4gV2hlbiB0aGVyZSBhcmUgMiBjb25zZWN1dGl2ZSB0ZXh0IG5vZGVzIHByZXNlbnQgaW4gdGhlIERPTS5cbiAgICAgICAgLy8gICAgIEV4YW1wbGU6IGA8ZGl2PkhlbGxvIDxuZy1jb250YWluZXIgKm5nSWY9XCJ0cnVlXCI+d29ybGQ8L25nLWNvbnRhaW5lcj48L2Rpdj5gLlxuICAgICAgICAvLyAgICAgSW4gdGhpcyBzY2VuYXJpbywgdGhlIGxpdmUgRE9NIHdvdWxkIGxvb2sgbGlrZSB0aGlzOlxuICAgICAgICAvLyAgICAgICA8ZGl2PiN0ZXh0KCdIZWxsbyAnKSAjdGV4dCgnd29ybGQnKSAjY29tbWVudCgnY29udGFpbmVyJyk8L2Rpdj5cbiAgICAgICAgLy8gICAgIFNlcmlhbGl6ZWQgc3RyaW5nIHdvdWxkIGxvb2sgbGlrZSB0aGlzOiBgPGRpdj5IZWxsbyB3b3JsZDwhLS1jb250YWluZXItLT48L2Rpdj5gLlxuICAgICAgICAvLyAgICAgVGhlIGxpdmUgRE9NIGluIGEgYnJvd3NlciBhZnRlciB0aGF0IHdvdWxkIGJlOlxuICAgICAgICAvLyAgICAgICA8ZGl2PiN0ZXh0KCdIZWxsbyB3b3JsZCcpICNjb21tZW50KCdjb250YWluZXInKTwvZGl2PlxuICAgICAgICAvLyAgICAgTm90aWNlIGhvdyAyIHRleHQgbm9kZXMgYXJlIG5vdyBcIm1lcmdlZFwiIGludG8gb25lLiBUaGlzIHdvdWxkIGNhdXNlIGh5ZHJhdGlvblxuICAgICAgICAvLyAgICAgbG9naWMgdG8gZmFpbCwgc2luY2UgaXQnZCBleHBlY3QgMiB0ZXh0IG5vZGVzIGJlaW5nIHByZXNlbnQsIG5vdCBvbmUuXG4gICAgICAgIC8vICAgICBUbyBmaXggdGhpcywgd2UgaW5zZXJ0IGEgc3BlY2lhbCBjb21tZW50IG5vZGUgaW4gYmV0d2VlbiB0aG9zZSB0ZXh0IG5vZGVzLCBzb1xuICAgICAgICAvLyAgICAgc2VyaWFsaXplZCByZXByZXNlbnRhdGlvbiBpczogYDxkaXY+SGVsbG8gPCEtLW5ndG5zLS0+d29ybGQ8IS0tY29udGFpbmVyLS0+PC9kaXY+YC5cbiAgICAgICAgLy8gICAgIFRoaXMgZm9yY2VzIGJyb3dzZXIgdG8gY3JlYXRlIDIgdGV4dCBub2RlcyBzZXBhcmF0ZWQgYnkgYSBjb21tZW50IG5vZGUuXG4gICAgICAgIC8vICAgICBCZWZvcmUgcnVubmluZyBhIGh5ZHJhdGlvbiBwcm9jZXNzLCB0aGlzIHNwZWNpYWwgY29tbWVudCBub2RlIGlzIHJlbW92ZWQsIHNvIHRoZVxuICAgICAgICAvLyAgICAgbGl2ZSBET00gaGFzIGV4YWN0bHkgdGhlIHNhbWUgc3RhdGUgYXMgaXQgd2FzIGJlZm9yZSBzZXJpYWxpemF0aW9uLlxuICAgICAgICBpZiAodE5vZGUudHlwZSAmIFROb2RlVHlwZS5UZXh0KSB7XG4gICAgICAgICAgY29uc3Qgck5vZGUgPSB1bndyYXBSTm9kZShsVmlld1tpXSkgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgLy8gQ29sbGVjdCB0aGlzIG5vZGUgYXMgcmVxdWlyZWQgc3BlY2lhbCBhbm5vdGF0aW9uIG9ubHkgd2hlbiBpdHNcbiAgICAgICAgICAvLyBjb250ZW50cyBpcyBlbXB0eS4gT3RoZXJ3aXNlLCBzdWNoIHRleHQgbm9kZSB3b3VsZCBiZSBwcmVzZW50IG9uXG4gICAgICAgICAgLy8gdGhlIGNsaWVudCBhZnRlciBzZXJ2ZXItc2lkZSByZW5kZXJpbmcgYW5kIG5vIHNwZWNpYWwgaGFuZGxpbmcgbmVlZGVkLlxuICAgICAgICAgIGlmIChyTm9kZS50ZXh0Q29udGVudCA9PT0gJycpIHtcbiAgICAgICAgICAgIGNvbnRleHQuY29ycnVwdGVkVGV4dE5vZGVzLnNldChyTm9kZSwgVGV4dE5vZGVNYXJrZXIuRW1wdHlOb2RlKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHJOb2RlLm5leHRTaWJsaW5nPy5ub2RlVHlwZSA9PT0gTm9kZS5URVhUX05PREUpIHtcbiAgICAgICAgICAgIGNvbnRleHQuY29ycnVwdGVkVGV4dE5vZGVzLnNldChyTm9kZSwgVGV4dE5vZGVNYXJrZXIuU2VwYXJhdG9yKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodE5vZGUucHJvamVjdGlvbk5leHQgJiYgdE5vZGUucHJvamVjdGlvbk5leHQgIT09IHROb2RlLm5leHQgJiZcbiAgICAgICAgICAgICFpc0luU2tpcEh5ZHJhdGlvbkJsb2NrKHROb2RlLnByb2plY3Rpb25OZXh0KSkge1xuICAgICAgICAgIC8vIENoZWNrIGlmIHByb2plY3Rpb24gbmV4dCBpcyBub3QgdGhlIHNhbWUgYXMgbmV4dCwgaW4gd2hpY2ggY2FzZVxuICAgICAgICAgIC8vIHRoZSBub2RlIHdvdWxkIG5vdCBiZSBmb3VuZCBhdCBjcmVhdGlvbiB0aW1lIGF0IHJ1bnRpbWUgYW5kIHdlXG4gICAgICAgICAgLy8gbmVlZCB0byBwcm92aWRlIGEgbG9jYXRpb24gZm9yIHRoYXQgbm9kZS5cbiAgICAgICAgICBhcHBlbmRTZXJpYWxpemVkTm9kZVBhdGgobmdoLCB0Tm9kZS5wcm9qZWN0aW9uTmV4dCwgbFZpZXcpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBuZ2g7XG59XG5cbi8qKlxuICogRGV0ZXJtaW5lcyB3aGV0aGVyIGEgY29tcG9uZW50IGluc3RhbmNlIHRoYXQgaXMgcmVwcmVzZW50ZWRcbiAqIGJ5IGEgZ2l2ZW4gTFZpZXcgdXNlcyBgVmlld0VuY2Fwc3VsYXRpb24uU2hhZG93RG9tYC5cbiAqL1xuZnVuY3Rpb24gY29tcG9uZW50VXNlc1NoYWRvd0RvbUVuY2Fwc3VsYXRpb24obFZpZXc6IExWaWV3KTogYm9vbGVhbiB7XG4gIGNvbnN0IGluc3RhbmNlID0gbFZpZXdbQ09OVEVYVF07XG4gIHJldHVybiBpbnN0YW5jZT8uY29uc3RydWN0b3IgP1xuICAgICAgZ2V0Q29tcG9uZW50RGVmKGluc3RhbmNlLmNvbnN0cnVjdG9yKT8uZW5jYXBzdWxhdGlvbiA9PT0gVmlld0VuY2Fwc3VsYXRpb24uU2hhZG93RG9tIDpcbiAgICAgIGZhbHNlO1xufVxuXG4vKipcbiAqIEFubm90YXRlcyBjb21wb25lbnQgaG9zdCBlbGVtZW50IGZvciBoeWRyYXRpb246XG4gKiAtIGJ5IGVpdGhlciBhZGRpbmcgdGhlIGBuZ2hgIGF0dHJpYnV0ZSBhbmQgY29sbGVjdGluZyBoeWRyYXRpb24tcmVsYXRlZCBpbmZvXG4gKiAgIGZvciB0aGUgc2VyaWFsaXphdGlvbiBhbmQgdHJhbnNmZXJyaW5nIHRvIHRoZSBjbGllbnRcbiAqIC0gb3IgYnkgYWRkaW5nIHRoZSBgbmdTa2lwSHlkcmF0aW9uYCBhdHRyaWJ1dGUgaW4gY2FzZSBBbmd1bGFyIGRldGVjdHMgdGhhdFxuICogICBjb21wb25lbnQgY29udGVudHMgaXMgbm90IGNvbXBhdGlibGUgd2l0aCBoeWRyYXRpb24uXG4gKlxuICogQHBhcmFtIGVsZW1lbnQgVGhlIEhvc3QgZWxlbWVudCB0byBiZSBhbm5vdGF0ZWRcbiAqIEBwYXJhbSBsVmlldyBUaGUgYXNzb2NpYXRlZCBMVmlld1xuICogQHBhcmFtIGNvbnRleHQgVGhlIGh5ZHJhdGlvbiBjb250ZXh0XG4gKiBAcmV0dXJucyBBbiBpbmRleCBvZiBzZXJpYWxpemVkIHZpZXcgZnJvbSB0aGUgdHJhbnNmZXIgc3RhdGUgb2JqZWN0XG4gKiAgICAgICAgICBvciBgbnVsbGAgd2hlbiBhIGdpdmVuIGNvbXBvbmVudCBjYW4gbm90IGJlIHNlcmlhbGl6ZWQuXG4gKi9cbmZ1bmN0aW9uIGFubm90YXRlSG9zdEVsZW1lbnRGb3JIeWRyYXRpb24oXG4gICAgZWxlbWVudDogUkVsZW1lbnQsIGxWaWV3OiBMVmlldywgY29udGV4dDogSHlkcmF0aW9uQ29udGV4dCk6IG51bWJlcnxudWxsIHtcbiAgY29uc3QgcmVuZGVyZXIgPSBsVmlld1tSRU5ERVJFUl07XG4gIGlmIChoYXNJMThuKGxWaWV3KSB8fCBjb21wb25lbnRVc2VzU2hhZG93RG9tRW5jYXBzdWxhdGlvbihsVmlldykpIHtcbiAgICAvLyBBdHRhY2ggdGhlIHNraXAgaHlkcmF0aW9uIGF0dHJpYnV0ZSBpZiB0aGlzIGNvbXBvbmVudDpcbiAgICAvLyAtIGVpdGhlciBoYXMgaTE4biBibG9ja3MsIHNpbmNlIGh5ZHJhdGluZyBzdWNoIGJsb2NrcyBpcyBub3QgeWV0IHN1cHBvcnRlZFxuICAgIC8vIC0gb3IgdXNlcyBTaGFkb3dEb20gdmlldyBlbmNhcHN1bGF0aW9uLCBzaW5jZSBEb21pbm8gZG9lc24ndCBzdXBwb3J0XG4gICAgLy8gICBzaGFkb3cgRE9NLCBzbyB3ZSBjYW4gbm90IGd1YXJhbnRlZSB0aGF0IGNsaWVudCBhbmQgc2VydmVyIHJlcHJlc2VudGF0aW9uc1xuICAgIC8vICAgd291bGQgZXhhY3RseSBtYXRjaFxuICAgIHJlbmRlcmVyLnNldEF0dHJpYnV0ZShlbGVtZW50LCBTS0lQX0hZRFJBVElPTl9BVFRSX05BTUUsICcnKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBuZ2ggPSBzZXJpYWxpemVMVmlldyhsVmlldywgY29udGV4dCk7XG4gICAgY29uc3QgaW5kZXggPSBjb250ZXh0LnNlcmlhbGl6ZWRWaWV3Q29sbGVjdGlvbi5hZGQobmdoKTtcbiAgICByZW5kZXJlci5zZXRBdHRyaWJ1dGUoZWxlbWVudCwgTkdIX0FUVFJfTkFNRSwgaW5kZXgudG9TdHJpbmcoKSk7XG4gICAgcmV0dXJuIGluZGV4O1xuICB9XG59XG5cbi8qKlxuICogUGh5c2ljYWxseSBpbnNlcnRzIHRoZSBjb21tZW50IG5vZGVzIHRvIGVuc3VyZSBlbXB0eSB0ZXh0IG5vZGVzIGFuZCBhZGphY2VudFxuICogdGV4dCBub2RlIHNlcGFyYXRvcnMgYXJlIHByZXNlcnZlZCBhZnRlciBzZXJ2ZXIgc2VyaWFsaXphdGlvbiBvZiB0aGUgRE9NLlxuICogVGhlc2UgZ2V0IHN3YXBwZWQgYmFjayBmb3IgZW1wdHkgdGV4dCBub2RlcyBvciBzZXBhcmF0b3JzIG9uY2UgaHlkcmF0aW9uIGhhcHBlbnNcbiAqIG9uIHRoZSBjbGllbnQuXG4gKlxuICogQHBhcmFtIGNvcnJ1cHRlZFRleHROb2RlcyBUaGUgTWFwIG9mIHRleHQgbm9kZXMgdG8gYmUgcmVwbGFjZWQgd2l0aCBjb21tZW50c1xuICogQHBhcmFtIGRvYyBUaGUgZG9jdW1lbnRcbiAqL1xuZnVuY3Rpb24gaW5zZXJ0Q29ycnVwdGVkVGV4dE5vZGVNYXJrZXJzKFxuICAgIGNvcnJ1cHRlZFRleHROb2RlczogTWFwPEhUTUxFbGVtZW50LCBzdHJpbmc+LCBkb2M6IERvY3VtZW50KSB7XG4gIGZvciAoY29uc3QgW3RleHROb2RlLCBtYXJrZXJdIG9mIGNvcnJ1cHRlZFRleHROb2Rlcykge1xuICAgIHRleHROb2RlLmFmdGVyKGRvYy5jcmVhdGVDb21tZW50KG1hcmtlcikpO1xuICB9XG59XG5cbi8qKlxuICogRGV0ZWN0cyB3aGV0aGVyIGEgZ2l2ZW4gVE5vZGUgcmVwcmVzZW50cyBhIG5vZGUgdGhhdFxuICogaXMgYmVpbmcgY29udGVudCBwcm9qZWN0ZWQuXG4gKi9cbmZ1bmN0aW9uIGlzQ29udGVudFByb2plY3RlZE5vZGUodE5vZGU6IFROb2RlKTogYm9vbGVhbiB7XG4gIGxldCBjdXJyZW50VE5vZGUgPSB0Tm9kZTtcbiAgd2hpbGUgKGN1cnJlbnRUTm9kZSAhPSBudWxsKSB7XG4gICAgLy8gSWYgd2UgY29tZSBhY3Jvc3MgYSBjb21wb25lbnQgaG9zdCBub2RlIGluIHBhcmVudCBub2RlcyAtXG4gICAgLy8gdGhpcyBUTm9kZSBpcyBpbiB0aGUgY29udGVudCBwcm9qZWN0aW9uIHNlY3Rpb24uXG4gICAgaWYgKGlzQ29tcG9uZW50SG9zdChjdXJyZW50VE5vZGUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgY3VycmVudFROb2RlID0gY3VycmVudFROb2RlLnBhcmVudCBhcyBUTm9kZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogQ2hlY2sgd2hldGhlciBhIGdpdmVuIG5vZGUgZXhpc3RzLCBidXQgaXMgZGlzY29ubmVjdGVkIGZyb20gdGhlIERPTS5cbiAqXG4gKiBOb3RlOiB3ZSBsZXZlcmFnZSB0aGUgZmFjdCB0aGF0IHdlIGhhdmUgdGhpcyBpbmZvcm1hdGlvbiBhdmFpbGFibGUgaW4gdGhlIERPTSBlbXVsYXRpb25cbiAqIGxheWVyIChpbiBEb21pbm8pIGZvciBub3cuIExvbmdlci10ZXJtIHNvbHV0aW9uIHNob3VsZCBub3QgcmVseSBvbiB0aGUgRE9NIGVtdWxhdGlvbiBhbmRcbiAqIG9ubHkgdXNlIGludGVybmFsIGRhdGEgc3RydWN0dXJlcyBhbmQgc3RhdGUgdG8gY29tcHV0ZSB0aGlzIGluZm9ybWF0aW9uLlxuICovXG5mdW5jdGlvbiBpc0Rpc2Nvbm5lY3RlZE5vZGUodE5vZGU6IFROb2RlLCBsVmlldzogTFZpZXcpIHtcbiAgcmV0dXJuICEodE5vZGUudHlwZSAmIFROb2RlVHlwZS5Qcm9qZWN0aW9uKSAmJiAhIWxWaWV3W3ROb2RlLmluZGV4XSAmJlxuICAgICAgISh1bndyYXBSTm9kZShsVmlld1t0Tm9kZS5pbmRleF0pIGFzIE5vZGUpLmlzQ29ubmVjdGVkO1xufVxuIl19