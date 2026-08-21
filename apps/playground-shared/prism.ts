import Prism from "prismjs";

/**
 * Retrieve a Prism grammar by name, throwing if it is not loaded.
 */
export function getPrismGrammar(name: string): Prism.Grammar {
  const grammar = Prism.languages[name];
  if (!grammar) {
    throw new Error(`Prism grammar "${name}" not loaded`);
  }
  return grammar;
}
