/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

/**
 * Dos builds distintos desde un único archivo de configuración.
 *
 * - `vite` y `vite build` (modo por defecto) compilan la aplicación de demo.
 * - `vite build --mode lib` compila la librería distribuible.
 *
 * El interruptor es el `mode` y no una variable de entorno a propósito: fijar
 * una variable de entorno dentro de un script de npm tiene una sintaxis distinta
 * en cmd.exe y en sh, así que haría falta una dependencia extra para que el
 * mismo script funcione en Windows y en CI. El flag `--mode` lo entiende la CLI
 * de Vite en cualquier plataforma.
 *
 * Un `mode` propio NO degrada el build a desarrollo: para el comando `build`,
 * Vite fija `NODE_ENV=production` cuando la variable no viene del entorno, sin
 * mirar el modo. La compilación de la librería sale optimizada igual.
 */

/** La raíz del paquete publicado. `src/` es la librería, nada más. */
const LIB_ENTRY = fileURLToPath(new URL('./src/index.ts', import.meta.url))

/**
 * Hoja de estilos de la librería, tal como la resuelve el consumidor.
 *
 * Es el mismo archivo que importan los SFC por efecto secundario, así que el
 * `import 'datatable-vue/style.css'` de la demo resuelve al módulo que ya estaba
 * cargado y no duplica una sola regla.
 */
const LIB_STYLE = fileURLToPath(new URL('./src/styles/datatable.css', import.meta.url))

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'
  // Vitest resuelve este mismo archivo con `mode === 'test'`. La suite solo
  // necesita compilar SFCs: las devtools levantan un cliente de desarrollo que
  // en un entorno sin navegador es puro costo de arranque.
  const isTest = mode === 'test'

  return {
    plugins:
      isLib || isTest
        ? // El build de librería solo necesita compilar SFCs. Las devtools inyectan
          // un cliente de desarrollo y JSX no lo usa ningún archivo del componente:
          // ambos plugins serían peso muerto dentro del paquete publicado.
          [vue()]
        : [vue(), vueJsx(), vueDevTools()],

    resolve: {
      /*
       * La demo importa la librería POR SU NOMBRE DE PAQUETE, no por una ruta
       * relativa ni por un alias de conveniencia tipo `@/`. Es deliberado: así
       * cada archivo de `demo/` está escrito exactamente como lo escribiría una
       * aplicación que instaló el paquete desde npm, y la demo deja de ser una
       * pantalla para pasar a ser una prueba de integración de la API pública.
       * Si algo sale del `index.ts`, la demo no compila.
       *
       * El orden importa. Vite hace coincidir una clave de texto cuando el
       * import es igual a la clave o empieza con la clave más `/`, y se queda
       * con la primera que coincide: `'datatable-vue'` puesto antes se tragaría
       * `datatable-vue/style.css` y lo reescribiría como `<index.ts>/style.css`.
       * La entrada más específica va primero.
       */
      alias: {
        'datatable-vue/style.css': LIB_STYLE,
        'datatable-vue': LIB_ENTRY,
      },
    },

    // `public/` es el directorio de assets estáticos de la demo. Sin esto Vite lo
    // copiaría dentro de `dist` y el favicon terminaría publicado en el paquete.
    publicDir: isLib ? false : 'public',

    build: isLib
      ? {
          // `dist` es lo que viaja en el paquete (ver `files` en package.json).
          outDir: 'dist',
          emptyOutDir: true,
          // Un único archivo CSS para toda la librería. Con code splitting cada
          // chunk emitiría su hoja y el consumidor tendría que importar varias.
          cssCodeSplit: false,
          lib: {
            entry: LIB_ENTRY,
            // Solo ESM. Un bundle UMD existe para cargar la librería con un
            // `<script>` suelto contra el build global de Vue, y ese escenario no
            // aplica a un componente que se consume desde Vite, webpack, Rollup o
            // Nuxt: todos resuelven ESM. Agregarlo duplicaría el artefacto, forzaría
            // inventar un nombre global y obligaría a mantener un mapeo `globals`
            // para algo que nadie va a importar.
            formats: ['es'],
            fileName: () => 'datatable-vue.js',
            // El CSS se emite aparte como `dist/style.css`, nunca inyectado en el
            // JS. Inyectarlo rompe SSR —el bundle tocaría `document` al importarse—
            // y le quita al consumidor la posibilidad de redefinir los tokens
            // `--dt-*` antes del montaje.
            cssFileName: 'style',
          },
          rollupOptions: {
            // Vue JAMÁS se empaqueta. Dos instancias de Vue en la misma aplicación
            // rompen la reactividad de formas prácticamente imposibles de depurar:
            // los efectos se registran en un runtime y se disparan desde el otro.
            external: ['vue'],
          },
        }
      : {
          // La demo se compila a otro directorio para no pisar el artefacto de la
          // librería. `vite preview` lee este mismo valor, así que sigue sirviendo
          // la demo sin configuración adicional.
          outDir: 'dist-demo',
          emptyOutDir: true,
        },

    // La configuración de Vitest vive acá y no en un `vitest.config.ts` aparte
    // para que la suite resuelva exactamente los mismos alias y la misma cadena
    // de plugins que compilan la aplicación. Vite ignora esta clave en `build`,
    // así que ni `vite build` ni `vite build --mode lib` la ven.
    test: {
      // `happy-dom` en lugar de `jsdom`: arranca en una fracción del tiempo y
      // esta suite no necesita nada de lo que jsdom implementa de más
      // (navegación, layout, red). Lo que falta —`ResizeObserver` y un
      // `requestAnimationFrame` gobernable— lo provee `__tests__/setup.ts`.
      environment: 'happy-dom',
      include: ['src/__tests__/**/*.test.ts'],
      setupFiles: ['./src/__tests__/setup.ts'],
      // Los tests de rendimiento parchean prototipos del DOM. Restaurar espías
      // y mocks entre tests evita que una suite contamine a la siguiente.
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        // La cobertura mide la librería. `demo/` es la pantalla de ejemplo y no
        // forma parte de lo que se publica.
        include: ['src/**/*.ts', 'src/**/*.vue'],
        exclude: ['src/__tests__/**'],
      },
    },
  }
})
