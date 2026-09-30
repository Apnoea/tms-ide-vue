import { onBeforeUnmount, onMounted } from 'vue'
import interact from 'interactjs'
import { snapToGrid } from '../utils/grid'
import { toPlain } from '../utils/plain'
import { SHAPE_GRID } from './useStencilEditor'

// Селектор существует только внутри редактора символов.
const MOVE_SELECTOR = '[data-se-move]'

/** Точка, по которой снапится перенос фигуры. У подписи она в x/y, как у rect. */
function anchorOf(s) {
  if (s.type === 'rect' || s.type === 'text') return { x: s.x, y: s.y }
  if (s.type === 'circle') return { x: s.cx, y: s.cy }
  if (s.type === 'line') return { x: s.x1, y: s.y1 }
  return { x: s.points[0][0], y: s.points[0][1] }
}

/** Патч геометрии фигуры, сдвинутой на dx/dy от снимка. */
function translated(s, dx, dy) {
  if (s.type === 'rect' || s.type === 'text') return { x: s.x + dx, y: s.y + dy }
  if (s.type === 'circle') return { cx: s.cx + dx, cy: s.cy + dy }
  if (s.type === 'line') return { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
  return { points: s.points.map(([x, y]) => [x + dx, y + dy]) }
}

/**
 * Перемещение фигур и портов и ресайз ручками на столе редактора — через interact.js.
 * Колбэки берут абсолютную позицию курсора, переводят в user-координаты, снапят и
 * пишут в модель; на весь жест — один снимок истории.
 *
 * @param {object} deps
 * @param {object} deps.ed — модель редактора (useStencilEditor)
 * @param {(e: object) => {x: number, y: number}} deps.unitsFromEvent
 * @param {import('vue').Ref<boolean>} deps.shiftHeld — Shift держит круг при ресайзе
 *   ручкой: в колбэке interact самого события клавиатуры нет
 * @param {boolean} deps.locked — рисунок заперт (символ набора, программный символ)
 */
export function useEditorInteract({ ed, unitsFromEvent, shiftHeld, locked }) {
  const {
    tool,
    shapes,
    ports,
    selectedSet,
    selectedPortSet,
    select,
    snapShapeX,
    snapShapeY,
    updateShape,
    updateShapes,
    movePorts,
    dedupePorts,
    commit,
  } = ed

  let dragCtx = null

  function reshape(snap, hKey, cur) {
    const p = { x: snapShapeX(cur.x), y: snapShapeY(cur.y) }
    if (snap.type === 'rect') {
      const fixed = {
        nw: { x: snap.x + snap.w, y: snap.y + snap.h },
        ne: { x: snap.x, y: snap.y + snap.h },
        sw: { x: snap.x + snap.w, y: snap.y },
        se: { x: snap.x, y: snap.y },
      }[hKey]
      updateShape(snap.id, {
        x: Math.min(p.x, fixed.x),
        y: Math.min(p.y, fixed.y),
        w: Math.max(SHAPE_GRID, Math.abs(fixed.x - p.x)),
        h: Math.max(SHAPE_GRID, Math.abs(fixed.y - p.y)),
      })
    } else if (snap.type === 'circle') {
      const along = hKey === 'rx' ? Math.abs(p.x - snap.cx) : Math.abs(p.y - snap.cy)
      const value = Math.max(SHAPE_GRID, snapToGrid(along, SHAPE_GRID))
      // Shift держит круг: тянутся обе полуоси разом.
      updateShape(
        snap.id,
        shiftHeld.value ? { rx: value, ry: value } : hKey === 'rx' ? { rx: value } : { ry: value }
      )
    } else if (snap.type === 'line') {
      updateShape(snap.id, hKey === 'v0' ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y })
    } else if (snap.type === 'polyline') {
      const i = Number(hKey.slice(1))
      updateShape(snap.id, { points: snap.points.map((pt, idx) => (idx === i ? [p.x, p.y] : pt)) })
    }
  }

  function start(e) {
    // Перетаскивание существующих объектов — только в режиме выбора: при активном
    // инструменте клик по фигуре рисует поверх неё.
    if (tool.value !== 'select' || locked) {
      e.interaction.stop()
      return
    }
    const el = e.target
    const role = el.dataset.seMove
    const id = el.dataset.id
    dragCtx = { role, id, hKey: el.dataset.h }
    if (role === 'port') {
      // Порт тащится вместе с ВЫДЕЛЕНИЕМ, как фигуры: клик по невыделенному
      // (его уже обработал onPortDown) оставляет в наборе только его.
      dragCtx.ports = ports.value
        .filter((p) => selectedPortSet.value.has(p.id) || p.id === id)
        .map((p) => ({ id: p.id, x: p.x, y: p.y }))
      dragCtx.start = unitsFromEvent(e)
    } else if (role === 'shape') {
      // Ведущая фигура задаёт сдвиг и снап. Если она в выделении — тащим всё
      // выделение, иначе переключаемся на неё.
      if (!selectedSet.value.has(id)) select(id)
      dragCtx.snapshot = toPlain(shapes.value.find((s) => s.id === id))
      dragCtx.group = toPlain(shapes.value.filter((s) => selectedSet.value.has(s.id)))
      dragCtx.start = unitsFromEvent(e)
    } else if (role === 'handle') {
      dragCtx.snapshot = toPlain(shapes.value.find((s) => s.id === id))
    }
  }

  function move(e) {
    if (!dragCtx) return
    const cur = unitsFromEvent(e)
    if (dragCtx.role === 'port') {
      // Дельта считается от снимка (без дрейфа), проекцию на грань каждому порту
      // делает модель.
      const dx = cur.x - dragCtx.start.x
      const dy = cur.y - dragCtx.start.y
      movePorts(dragCtx.ports.map((p) => ({ id: p.id, x: p.x + dx, y: p.y + dy })))
    } else if (dragCtx.role === 'handle') {
      reshape(dragCtx.snapshot, dragCtx.hKey, cur)
    } else if (dragCtx.role === 'shape') {
      // Снап считается ОДИН раз по ведущей фигуре, общий dx/dy идёт всей пачке:
      // поштучный снап развалил бы взаимное расположение.
      const a = anchorOf(dragCtx.snapshot)
      const dx = snapShapeX(a.x + (cur.x - dragCtx.start.x)) - a.x
      const dy = snapShapeY(a.y + (cur.y - dragCtx.start.y)) - a.y
      const byId = new Map(dragCtx.group.map((s) => [s.id, s]))
      updateShapes(
        dragCtx.group.map((s) => s.id),
        (s) => translated(byId.get(s.id), dx, dy)
      )
    }
  }

  function end() {
    // Порты, брошенные друг на друга, сводим к одному — как при сжатии холста.
    // На `move` этого не делаем: порт, проехавший СКВОЗЬ соседа, съел бы его.
    if (dragCtx?.role === 'port') dedupePorts()
    // Один снимок истории на весь жест (move'ы шли без коммита); commit сам дедупит,
    // если фигуру/порт по факту не сдвинули.
    if (dragCtx) commit()
    dragCtx = null
  }

  onMounted(() => {
    // Курсоры ставим сами. `styleCursor` выключается МЕТОДОМ Interactable (в опциях
    // draggable он игнорируется): иначе interact пишет `element.style.cursor = 'move'`
    // всем элементам селектора — и фигурам, и ручкам, и портам.
    interact(MOVE_SELECTOR).styleCursor(false).draggable({ listeners: { start, move, end } })
  })
  onBeforeUnmount(() => interact(MOVE_SELECTOR).unset())
}
