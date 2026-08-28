import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { shapeBounds } from '../utils/stencilSvg'

/**
 * Лассо фигур в редакторе символов: жесты как на холсте (useLasso), но модель своя —
 * примитивы в user-координатах, а не JointJS-граф.
 *
 * Рамка живёт в user-координатах и рисуется внутри SVG, поэтому зум и скролл stage её
 * не сдвигают. Захват по ПЕРЕСЕЧЕНИЮ bbox: иначе длинную линию не поймать, не обведя
 * целиком. Порты не берутся — у них свой режим.
 *
 * @param {object} deps
 * @param {import('vue').Ref<Array>} deps.shapes — фигуры черновика
 * @param {(e: PointerEvent|MouseEvent) => {x:number,y:number}} deps.unitsFromEvent
 * @param {(ids: string[], additive: boolean) => void} deps.onSelect — результат рамки
 * @param {() => void} deps.onClear — короткий клик по пустому месту
 */
export function useEditorLasso({ shapes, unitsFromEvent, onSelect, onClear }) {
  // { x, y, w, h } в user-координатах; null — рамки нет.
  const lassoRect = ref(null)
  let active = false
  let startUnits = null
  let startClient = null
  let additive = false

  function startLasso(e) {
    active = true
    additive = e.ctrlKey || e.metaKey
    startUnits = unitsFromEvent(e)
    startClient = { x: e.clientX, y: e.clientY }
    lassoRect.value = null
  }

  function rectTo(e) {
    const cur = unitsFromEvent(e)
    return {
      x: Math.min(startUnits.x, cur.x),
      y: Math.min(startUnits.y, cur.y),
      w: Math.abs(cur.x - startUnits.x),
      h: Math.abs(cur.y - startUnits.y),
    }
  }

  function onMove(e) {
    if (!active) return
    lassoRect.value = rectTo(e)
  }

  function onUp(e) {
    if (!active) return
    active = false
    const box = rectTo(e)
    lassoRect.value = null

    // Порог в ЭКРАННЫХ px: в юнитах на большом зуме дрожание руки давало бы рамку,
    // и клик «снять выделение» не срабатывал бы.
    const moved =
      Math.abs(e.clientX - startClient.x) >= 3 || Math.abs(e.clientY - startClient.y) >= 3
    if (!moved) {
      // Additive-клик выделение осознанно сохраняет (как на холсте).
      if (!additive) onClear()
      return
    }
    onSelect(hitShapes(shapes.value, box), additive)
  }

  useEventListener(document, 'pointermove', onMove)
  useEventListener(document, 'pointerup', onUp)

  return { lassoRect, startLasso }
}

/** id фигур, чей bbox пересекается с рамкой. Экспорт — для тестов хит-теста. */
export function hitShapes(shapes, box) {
  const out = []
  for (const s of shapes || []) {
    const b = shapeBounds(s)
    if (!b) continue
    // Касание краями = попадание: у горизонтальной линии h = 0.
    if (b.x <= box.x + box.w && b.x + b.w >= box.x && b.y <= box.y + box.h && b.y + b.h >= box.y) {
      out.push(s.id)
    }
  }
  return out
}
