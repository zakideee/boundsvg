/**
 * Safe DOM element access helpers that throw on missing elements
 * instead of returning null.
 */

export function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element #${id} not found`);
  }
  return element as T;
}

export function querySelector<T extends Element = Element>(
  parent: Element | Document,
  selector: string,
): T {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Element "${selector}" not found`);
  }
  return element;
}
