import { ref } from 'vue'
import { shapes } from '@joint/core'
import { getStencilById } from '../stencils/registry'
import { snapToGrid } from '../utils/grid'
import { pickPassThroughPorts, spliceRotation } from '../utils/wireSplice'
import { LINK_DEFAULTS } from '../stencils/linkDefaults'
import { useCanvas } from './useCanvas'

// Радиус хит-теста (paper-px) для «drop попал на провод».
const SPLIT_HIT_RANGE = 10

/**
 * Врезка стенсила в провод: drop стенсила с ≥2 портами на линию разбивает её на
 * два сегмента с проходом через элемент. Здесь — геометрия (хит-тест, локальное
 * направление сегмента, абсолютные позиции портов с учётом поворота), сам split
 * графа и живое превью при drag'е над проводом. Чистая топология/выбор пары
 * портов вынесены в `utils/wireSplice` (тестируемы без JointJS).
 *
 * Возвращает:
 *  • `splicePreview` — ref { angle, cx, cy } | null (paper-локальные коорд.):
 *    центр прилипает к точке провода, превью повёрнуто под угол врезки. CanvasPane
 *    читает его в previewStyle. null — обычное превью под курсором.
 *  • `findLinkAtPoint(point)` — провод под точкой (для гейта врезки в placeStencil).
 *  • `spliceCellIntoLink(link, cell, cursor)` — выполнить split графа.
 *  • `updateSplicePreview(stencilId, point)` — пересчитать превью под курсором.
 *  • `clearSplicePreview()` — сбросить превью (drop / отмена drag'а).
 */
export function useWireSplice() {
  const canvas = useCanvas()

  // Превью врезки: курсор над проводом стенсилом с ≥2 портами. { angle, cx, cy }
  // в paper-локальных координатах. null — обычное превью под курсором.
  const splicePreview = ref(null)

  /**
   * Провод под точкой (paper-local) в пределах SPLIT_HIT_RANGE. Возвращает null,
   * если точка над элементом (там обычная укладка поверх, не врезка) или ни один
   * линк не близко. Висячие концы (без source/target.id) пропускаем.
   */
  function findLinkAtPoint(point) {
    const paper = canvas.paperRef.value
    const graph = canvas.graphRef.value
    if (!paper || !graph) return null
    if (paper.findViewsFromPoint(point).length) return null
    let best = null
    let bestDist = SPLIT_HIT_RANGE
    for (const link of graph.getLinks()) {
      if (!link.get('source')?.id || !link.get('target')?.id) continue
      const view = paper.findViewByModel(link)
      const cp = view?.getClosestPoint?.(point)
      if (!cp) continue
      const d = Math.hypot(cp.x - point.x, cp.y - point.y)
      if (d < bestDist) {
        bestDist = d
        best = link
      }
    }
    return best
  }

  // Локальное направление провода в точке (касательная) — по двум точкам на пути
  // рядом с ближайшей. rightAngle-роутер гнёт провод, поэтому сегмент в точке
  // врезки может не совпадать с линией центров ячеек — берём именно сегмент.
  function wireDirAt(linkView, point) {
    if (!linkView?.getClosestPointLength || !linkView.getPointAtLength || !point) return null
    const len = linkView.getClosestPointLength(point)
    if (!Number.isFinite(len)) return null
    const p1 = linkView.getPointAtLength(Math.max(0, len - 3))
    const p2 = linkView.getPointAtLength(len + 3)
    if (!p1 || !p2) return null
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    return dx || dy ? { x: dx, y: dy } : null
  }

  // Геометрия провода в точке врезки: центры концевых ячеек (a/b), точка на
  // проводе рядом с point (wirePoint) и локальное направление сегмента (wireDir,
  // fallback — линия центров). null, если у провода нет валидных концов-ячеек.
  function wireGeometryAt(link, point) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    const srcCell = graph.getCell(link.get('source')?.id)
    const tgtCell = graph.getCell(link.get('target')?.id)
    if (!srcCell || !tgtCell) return null
    const a = srcCell.getBBox().center()
    const b = tgtCell.getBBox().center()
    const view = paper.findViewByModel(link)
    const wirePoint = (point && view?.getClosestPoint?.(point)) || point
    const wireDir = wireDirAt(view, point) || { x: b.x - a.x, y: b.y - a.y }
    return { a, b, wirePoint, wireDir }
  }

  // Абсолютные позиции портов с учётом поворота ячейки. JointJS вращает порты
  // вокруг центра bbox по часовой (угол в градусах, ось Y вниз).
  function portAbsPositions(cell) {
    const pos = cell.get('position')
    const size = cell.get('size')
    const rad = ((cell.angle() || 0) * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const cx = pos.x + size.width / 2
    const cy = pos.y + size.height / 2
    return (cell.get('ports')?.items || []).map((it) => {
      const dx = pos.x + (it.args?.x ?? 0) - cx
      const dy = pos.y + (it.args?.y ?? 0) - cy
      return { id: it.id, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
    })
  }

  /**
   * Разбивает провод на два сегмента с проходом через cell. Исходный линк
   * переиспользуется как source→cell.in (его tms/voltage/switch сохраняются),
   * добавляется новый cell.out→target с клоном анимаций. Элемент наследует
   * voltage/switch провода. Всё синхронно → один шаг undo (debounced snapshot).
   */
  function spliceCellIntoLink(link, cell, cursor = null) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    const tgtRef = link.get('target')
    // Геометрия сегмента в точке врезки — локальное направление (wireDir) и для
    // разворота, и для выбора пары портов (линия центров врёт на согнутых проводах).
    const geo = wireGeometryAt(link, cursor)
    if (!geo) return
    const { a, b, wirePoint, wireDir } = geo

    // Распределяем ручные изломы по сегментам относительно точки врезки: те, что
    // лежат до неё (по длине вдоль пути) — остаются на сегменте 1 (A→cell.in),
    // те, что после — переезжают на сегмент 2 (cell.out→B). Без этого сегмент 1
    // (переиспользованный линк) тащил бы ВСЕ изломы исходного провода, в т.ч.
    // оказавшиеся за элементом → петли и пересечения. Считаем ДО мутации линка
    // (его путь сейчас ещё цельный); cell.position/rotate путь не трогают.
    const view = paper?.findViewByModel(link)
    const origVertices = link.vertices() || []
    const seg1Vertices = []
    const seg2Vertices = []
    if (origVertices.length && view?.getClosestPointLength) {
      const splitLen = view.getClosestPointLength(wirePoint)
      for (const v of origVertices) {
        const lv = view.getClosestPointLength(v)
        ;(Number.isFinite(lv) && Number.isFinite(splitLen) && lv < splitLen
          ? seg1Vertices
          : seg2Vertices
        ).push({ ...v })
      }
    }

    // Авто-ориентация: разворачиваем элемент (если стенсил вращаемый) так, чтобы
    // пара проходных портов легла вдоль провода. Из двух вариантов выбор по
    // стороне курсора (см. spliceRotation). cell ещё в angle 0.
    const stencil = getStencilById(cell.get('tms')?.stencilId)
    if (stencil && !stencil.noRotate) {
      const angle = spliceRotation(portAbsPositions(cell), wireDir, cursor, wirePoint)
      if (angle !== 0) cell.rotate(angle)
    }

    // Сажаем элемент НА провод: координату центра ПОПЕРЁК провода гоним к точке на
    // проводе (wirePoint), вдоль — оставляем (grid-снап курсора из createStencilAt).
    // Иначе при курсоре ближе к соседней клетке снап увёл бы элемент с провода и
    // потянул бы его за собой. Поворот — вокруг центра, поэтому центр = pos+size/2.
    if (wirePoint) {
      const size = cell.get('size')
      const pos = cell.get('position')
      if (Math.abs(wireDir.x) >= Math.abs(wireDir.y)) {
        cell.position(pos.x, wirePoint.y - size.height / 2)
      } else {
        cell.position(wirePoint.x - size.width / 2, pos.y)
      }
    }

    const picked = pickPassThroughPorts(portAbsPositions(cell), a, b, wireDir)
    if (!picked) return
    const { portIn, portOut } = picked

    const linkTms = link.get('tms') || {}
    const inherited = {}
    if (linkTms.voltageSource) inherited.voltageSource = structuredClone(linkTms.voltageSource)
    if (linkTms.switchSources) inherited.switchSources = structuredClone(linkTms.switchSources)

    // Сегмент 1: переиспользуем провод A→cell.in (tms остаётся на нём). Изломы —
    // только те, что были до точки врезки.
    link.set('target', { id: cell.id, port: portIn })
    link.vertices(seg1Vertices)

    // Сегмент 2: cell.out→B с клоном анимаций провода и изломами после врезки.
    const seg2 = new shapes.standard.Link({
      ...LINK_DEFAULTS,
      source: { id: cell.id, port: portOut },
      target: { id: tgtRef.id, ...(tgtRef.port ? { port: tgtRef.port } : {}) },
      ...(seg2Vertices.length ? { vertices: seg2Vertices } : {}),
      ...(Object.keys(inherited).length ? { tms: structuredClone(inherited) } : {}),
    })
    graph.addCell(seg2)

    // Элемент наследует анимации провода (voltage + switch).
    if (Object.keys(inherited).length) {
      cell.set('tms', { ...(cell.get('tms') || {}), ...inherited })
    }

    canvas.selectOnly('cell', cell.id)
  }

  /**
   * Пересчёт splice-превью: если курсор над проводом стенсилом с ≥2 портами —
   * вычисляем угол врезки и точку прилипания к проводу. Иначе splicePreview=null
   * (обычное превью под курсором). Совпадает с логикой drop'а — те же абсолютные
   * позиции портов в snap-позиции и тот же spliceRotation.
   */
  function updateSplicePreview(stencilId, point) {
    const paper = canvas.paperRef.value
    const stencil = stencilId ? getStencilById(stencilId) : null
    if (!paper || !stencil || (stencil.ports?.length || 0) < 2) {
      splicePreview.value = null
      return
    }
    const link = findLinkAtPoint(point)
    const geo = link && wireGeometryAt(link, point)
    if (!geo) {
      splicePreview.value = null
      return
    }
    // Абсолютные позиции портов как при drop'е (cell в snap-позиции, angle 0).
    const g = paper.options.gridSize
    const tlx = snapToGrid(point.x - stencil.width / 2, g)
    const tly = snapToGrid(point.y - stencil.height / 2, g)
    const ports = (stencil.ports || []).map((pt) => ({ id: pt.name, x: tlx + pt.x, y: tly + pt.y }))
    const angle = stencil.noRotate ? 0 : spliceRotation(ports, geo.wireDir, point, geo.wirePoint)
    // Центр превью = как ляжет элемент: ПОПЕРЁК провода — на линии (wirePoint),
    // ВДОЛЬ — grid-снап курсора (как в spliceCellIntoLink). Превью совпадает с фактом.
    const horizontal = Math.abs(geo.wireDir.x) >= Math.abs(geo.wireDir.y)
    const cx = horizontal ? tlx + stencil.width / 2 : geo.wirePoint.x
    const cy = horizontal ? geo.wirePoint.y : tly + stencil.height / 2
    splicePreview.value = { angle, cx, cy }
  }

  function clearSplicePreview() {
    splicePreview.value = null
  }

  return {
    splicePreview,
    findLinkAtPoint,
    spliceCellIntoLink,
    updateSplicePreview,
    clearSplicePreview,
  }
}
