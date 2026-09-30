/**
 * Structural DOM surface the XML layer reads. Browser `Element` and linkedom's
 * document both satisfy it at runtime; declaring it here keeps `lib.dom` out of
 * the contracts tsconfig, so a main-process slip into browser globals fails the
 * compile instead of riding on ambient types.
 */

export interface DomAttributeLike {
  name: string
  value: string
}

export interface DomNodeLike {
  readonly nodeType: number
  readonly textContent: string | null
  readonly nextSibling: DomNodeLike | null
}

export interface DomElementLike extends DomNodeLike {
  readonly tagName: string
  readonly attributes: Iterable<DomAttributeLike>
  readonly childNodes: Iterable<DomNodeLike>
  readonly children: Iterable<DomElementLike>
  getAttribute(name: string): string | null
  querySelector(selectors: string): DomElementLike | null
  querySelectorAll(selectors: string): { readonly length: number } & Iterable<DomElementLike>
}

/** Parser return shape: the strict superset both DOM implementations satisfy. */
export interface ParsedDocumentLike {
  documentElement: DomElementLike
  body?: DomElementLike | null
  querySelector?: (selectors: string) => DomElementLike | null
}
