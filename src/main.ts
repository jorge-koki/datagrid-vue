import { createApp } from 'vue'
import App from './App.vue'

// La demo trae sus propios estilos desde `src/demo/demo.css`, que declara los
// mismos tokens `--dt-*` que el componente. No se importa la hoja del andamiaje
// de Vite: define una paleta propia con su propia media query de tema oscuro, y
// eso pelearía con el selector de tema de la demo.
createApp(App).mount('#app')
