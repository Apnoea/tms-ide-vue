import { ref } from 'vue'
import { getStencilById } from '../stencils/registry'
import { busAttachPlacement, busLineY, BUS_SNAP_RANGE } from '../utils/busSnap'
import { useCanvas } from './useCanvas'

/**
 * Символ на шине: ложится на неё центром, разворачивается по стороне подноса и
 * ЗАКРЕПЛЯЕТСЯ — дальше едет за шиной. Снять закрепление можно через контекст-меню.
 *
 * Проводов при этом не появляется и шина не разбивается: символ сидит на ней сверху.
 * Закрепление держит `tms.busId`, а не embed от JointJS: тот каскадно удаляет детей
 * вместе с родителем и лезет в z-порядок.
 *
 * Врезка в провод — соседняя операция, см. useWireSplice.
 */
export function useBusSnap() {
  const canvas = useCanvas()

  // Превью: { angle, cx, cy } в paper-координатах, как splicePreview (usePaletteDrag
  // читает оба); null = обычное превью под курсором.
  const busSnapPreview = ref(null)

  function isBus(cell) {
    return cell?.get('tms')?.stencilId === 'cell_bus'
  }

  /**
   * Шина под точкой: по X в пределах тела, по Y — в допуске от её линии (тело тонкое,
   * 8px, курсором в него не попасть). Заблокированная шина символы не принимает.
   */
  function findBusAtPoint(point) {
    const graph = canvas.graphRef.value
    if (!graph || !point) return null
    let best = null
    let bestDist = Infinity
    for (const cell of graph.getElements()) {
      if (!isBus(cell) || cell.get('tms')?.locked) continue
      const pos = cell.get('position')
      const size = cell.get('size')
      if (point.x < pos.x || point.x > pos.x + size.width) continue
      const dist = Math.abs(point.y - busLineY(pos, size))
      if (dist > BUS_SNAP_RANGE + size.height / 2 || dist >= bestDist) continue
      bestDist = dist
      best = cell
    }
    return best
  }

  /** Раскладка для ячейки этого символа: угол + позиция на шине. */
  function placementFor(bus, stencilId, cellSize, point) {
    const stencil = getStencilById(stencilId)
    if (!stencil) return null
    const paper = canvas.paperRef.value
    return busAttachPlacement(
      { position: bus.get('position'), size: bus.get('size') },
      cellSize || { width: stencil.width, height: stencil.height },
      point,
      {
        // Разворот на 180° не получают символы с текстовым содержимым (`static`:
        // карточка значения, подпись) и те, у кого стоит `noRotate`.
        canRotate: !stencil.noRotate && !stencil.static,
        gridSize: paper?.options?.gridSize || 10,
      }
    )
  }

  /**
   * Кладёт символ на шину и закрепляет. z поднимаем при необходимости: символ обязан
   * лежать ПОВЕРХ тела шины, а перетащить на неё могли и тот, что был ниже по порядку.
   *
   * @returns {boolean} лёг ли (false — неизвестный символ)
   */
  function attachToBus(bus, cell, point) {
    const tms = cell.get('tms') || {}
    const placement = placementFor(bus, tms.stencilId, cell.get('size'), point)
    if (!placement) return false

    // angle — поле верхнего уровня JointJS, и `cell.angle()` только читает: писать
    // можно либо set, либо rotate. Ставим до позиции — поворот идёт вокруг центра
    // bbox, габарит от него не меняется, так что позиция считается независимо.
    if ((cell.angle() || 0) !== placement.angle) cell.set('angle', placement.angle)
    cell.position(placement.position.x, placement.position.y)
    cell.set('tms', { ...tms, busId: bus.id })

    const busZ = bus.get('z')
    if (Number.isFinite(busZ) && !(cell.get('z') > busZ)) cell.set('z', busZ + 1)
    return true
  }

  /**
   * Сверяет закрепление с фактическим положением символа — вызывается после его drag'а.
   * Центр в зоне шины → лёг на неё (и переехал, если это уже другая шина); увели с шины
   * → закрепление снимаем. Иначе символ, уведённый в сторону, продолжал бы ездить за
   * шиной, хотя на ней уже не лежит.
   *
   * Сама шина, фигуры-разметка и заблокированные не в счёт.
   *
   * @returns {boolean} менялось ли закрепление
   */
  function syncBusAttachment(cell) {
    const tms = cell?.get('tms') || {}
    if (!tms.stencilId || tms.stencilId === 'cell_bus' || tms.locked) return false
    const pos = cell.get('position')
    const size = cell.get('size')
    const center = { x: pos.x + size.width / 2, y: pos.y + size.height / 2 }
    const bus = findBusAtPoint(center)
    if (bus) return attachToBus(bus, cell, center)
    return detachFromBus(cell)
  }

  /**
   * Снимает символ с шины. Позицию не трогаем: снятие не должно перекладывать схему,
   * автор сам решит, куда убрать символ.
   *
   * @returns {boolean} было ли что снимать
   */
  function detachFromBus(cell) {
    const tms = cell?.get('tms')
    if (!tms?.busId) return false
    const next = { ...tms }
    delete next.busId
    cell.set('tms', next)
    return true
  }

  /**
   * Сдвигает закреплённые символы на ту же дельту, что и шина. `skip` — ячейки, уже
   * сдвинутые своим жестом (multi-drag двигает выделенных сам, иначе они уехали бы на
   * двойную дельту).
   */
  function followBus(bus, dx, dy, skip = null) {
    const graph = canvas.graphRef.value
    if (!graph || (!dx && !dy)) return
    for (const cell of graph.getElements()) {
      if (cell.get('tms')?.busId !== bus.id) continue
      if (skip?.has(cell.id)) continue
      const pos = cell.get('position')
      cell.set('position', { x: pos.x + dx, y: pos.y + dy }, { busFollow: true })
    }
  }

  /** Снимает закрепление у символов удаляемой шины: ссылка на мёртвую ячейку. */
  function releaseBus(bus) {
    const graph = canvas.graphRef.value
    if (!graph) return
    for (const cell of graph.getElements()) {
      const tms = cell.get('tms')
      if (tms?.busId !== bus.id) continue
      const next = { ...tms }
      delete next.busId
      cell.set('tms', next)
    }
  }

  /**
   * Превью под курсором при drag'е из палитры. Считает ту же раскладку, что и drop, —
   * рамка лежит ровно там, куда ляжет символ.
   */
  function updateBusSnapPreview(stencilId, point) {
    const bus = stencilId ? findBusAtPoint(point) : null
    const placement = bus ? placementFor(bus, stencilId, null, point) : null
    const stencil = placement ? getStencilById(stencilId) : null
    if (!stencil) {
      busSnapPreview.value = null
      return
    }
    busSnapPreview.value = {
      angle: placement.angle,
      cx: placement.position.x + stencil.width / 2,
      cy: placement.position.y + stencil.height / 2,
    }
  }

  function clearBusSnapPreview() {
    busSnapPreview.value = null
  }

  return {
    busSnapPreview,
    findBusAtPoint,
    attachToBus,
    syncBusAttachment,
    detachFromBus,
    followBus,
    releaseBus,
    updateBusSnapPreview,
    clearBusSnapPreview,
  }
}
