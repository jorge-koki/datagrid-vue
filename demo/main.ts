import { createApp } from 'vue'

/*
 * Las dos líneas que hay que escribir en una aplicación consumidora, en el orden
 * en que hay que escribirlas.
 *
 * La demo importa la hoja de la librería por el nombre del paquete
 * —`datatable-vue/style.css`— y no por una ruta relativa. Dentro de este
 * repositorio el alias de Vite la resuelve al mismo archivo que los SFC importan
 * por efecto secundario, así que no se duplica una sola regla; lo que se gana es
 * que la línea que se lee acá es exactamente la que hay que copiar afuera.
 *
 * Primero la librería y después la demo: `demo.css` redefine los tokens `--dt-*`
 * y necesita ganar la cascada. No se importa la hoja del andamiaje de Vite, que
 * define una paleta propia con su propia media query de tema oscuro y pelearía
 * con el selector de tema de la demo.
 */
import 'datatable-vue/style.css'
import './demo.css'

import App from './App.vue'

createApp(App).mount('#app')
