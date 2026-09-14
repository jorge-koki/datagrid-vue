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
const LIB_ENTRY = fileURLToPath(new URL('./src/components/ui/datatable/index.ts', import.meta.url))

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  return {
    plugins: isLib
      ? // El build de librería solo necesita compilar SFCs. Las devtools inyectan
        // un cliente de desarrollo y JSX no lo usa ningún archivo del componente:
        // ambos plugins serían peso muerto dentro del paquete publicado.
        [vue()]
      : [vue(), vueJsx(), vueDevTools()],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
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
            fileName: () => 'datagrid-vue.js',
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
  }
})
