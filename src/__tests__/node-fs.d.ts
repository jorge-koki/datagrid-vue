/**
 * Lo mínimo de Node que necesita la suite, declarado a mano.
 *
 * ## Por qué no se usa `@types/node`
 *
 * Un solo test —`cell-layout.test.ts`— necesita abrir la hoja de estilos como
 * archivo, porque Vitest no procesa CSS y un `import '...css?raw'` devuelve un
 * string vacío. La salida obvia sería agregar `"node"` a los `types` de
 * `tsconfig.test.json`, y tiene un efecto que no se ve venir: los tests importan
 * los módulos del componente, así que esos módulos se compilan DENTRO de este
 * proyecto y `@types/node` les redefine los globales. `setTimeout` deja de
 * devolver un número y `useTablePersistence.ts` —que lo tipa como número a
 * propósito y lo explica en un comentario— deja de compilar.
 *
 * Declarar solo las tres funciones que se usan evita eso por completo: no entra
 * ningún global de Node, y lo que el test puede hacer con `node:fs` queda
 * acotado a leer un archivo.
 *
 * Si algún día la suite necesita de verdad la API de Node, lo correcto es
 * agregar `"node"` a los `types` y arreglar lo que aparezca, no ensanchar este
 * archivo.
 */

declare module 'node:fs' {
  /** Lee un archivo de texto de forma sincrónica. */
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:path' {
  /** Directorio que contiene una ruta. */
  export function dirname(path: string): string
  /** Une segmentos de ruta con el separador de la plataforma. */
  export function join(...segments: readonly string[]): string
}

declare module 'node:url' {
  /** Convierte una URL `file:` en una ruta del sistema de archivos. */
  export function fileURLToPath(url: string): string
}
