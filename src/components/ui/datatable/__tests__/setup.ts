/**
 * Setup global de la suite, cargado por `setupFiles` en `vite.config.ts`.
 *
 * Instala los dobles de `requestAnimationFrame` y `ResizeObserver` una sola vez
 * y los deja en un estado limpio antes de cada test. La alternativa —que cada
 * archivo los instale por su cuenta— haría que un test que olvida desinstalar
 * contamine al siguiente, y el síntoma sería un frame fantasma ejecutándose en
 * otro archivo.
 */

import { afterEach, beforeEach } from 'vitest'
import { FakeResizeObserver, installFakeRaf, installFakeResizeObserver, resetFrames } from './fakes'

installFakeRaf()
installFakeResizeObserver()

beforeEach(() => {
  resetFrames()
  FakeResizeObserver.reset()
})

afterEach(() => {
  // El DOM es compartido dentro de un archivo de test. Dejar nodos colgados hace
  // que un `querySelector` del test siguiente encuentre la tabla anterior.
  document.body.textContent = ''
  resetFrames()
  FakeResizeObserver.reset()
})
