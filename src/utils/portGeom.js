import { rotatePoint } from './paperGeom'

/**
 * Позиции портов ячейки в координатах ХОЛСТА: `args.x/y` порта локальны, а `angle`
 * вращает ячейку вокруг центра bbox, поэтому место порта ≠ `position + args`.
 * Принимает и модель JointJS, и её JSON.
 */
function boxOf(cellLike) {
  if (!cellLike) return null
  const isModel = typeof cellLike.get === 'function'
  const position = isModel ? cellLike.get('position') : cellLike.position
  const size = isModel ? cellLike.get('size') : cellLike.size
  if (!position || !size) return null
  const rawAngle = isModel ? cellLike.angle?.() : cellLike.angle
  const items = (isModel ? cellLike.get('ports') : cellLike.ports)?.items || []
  return { position, size, angle: rawAngle || 0, items }
}

/** Точка порта по его локальным координатам с учётом поворота ячейки. */
function pointOf(box, args) {
  const { position, size, angle } = box
  const local = {
    x: position.x + (args?.x ?? size.width / 2),
    y: position.y + (args?.y ?? size.height / 2),
  }
  if (!angle) return local
  const center = { x: position.x + size.width / 2, y: position.y + size.height / 2 }
  return rotatePoint(local, center, angle)
}

/**
 * Все порты ячейки: `[{ id, x, y }]`. Пустой массив — у ячейки нет портов либо это
 * не ячейка (битые данные из архива).
 */
export function portPoints(cellLike) {
  const box = boxOf(cellLike)
  if (!box) return []
  return box.items.map((item) => ({ id: item.id, ...pointOf(box, item.args) }))
}

/**
 * Точка одного порта. Неизвестный id → ЦЕНТР ячейки (конец провода остаётся на
 * символе, а не улетает в 0,0). null — не ячейка.
 */
export function portPointAt(cellLike, portId) {
  const box = boxOf(cellLike)
  if (!box) return null
  const item = box.items.find((i) => i.id === portId)
  return pointOf(box, item?.args)
}
