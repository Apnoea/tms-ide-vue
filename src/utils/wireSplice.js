// Геометрия/топология редактирования провода стенсилом — две инверсные операции:
//   • врезка    (split): `pickPassThroughPorts` + `spliceRotation` — как элемент
//     ложится на провод (какие порты, под каким углом). CanvasPane.spliceCellIntoLink.
//   • срастание (merge): `planWireBridge` — как объединить два провода при удалении
//     промежуточного элемента. useCanvas.deleteItems.
// Всё — чистые функции (без JointJS), вынесены сюда ради юнит-тестов.

// ─── Врезка ──────────────────────────────────────────────────────────────────

/** Два крайних порта вдоль направления (dx,dy) — кандидаты на пару «вход/выход». */
function widestPair(ports, dx, dy) {
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const sorted = [...ports].sort((m, n) => m.x * ux + m.y * uy - (n.x * ux + n.y * uy))
  return [sorted[0], sorted[sorted.length - 1]]
}

/**
 * Пара портов для прохода провода сквозь элемент.
 *
 * @param {{ id: string, x: number, y: number }[]} ports — порты с АБСОЛЮТНЫМИ
 *   координатами (позиция ячейки + offset порта).
 * @param {{ x: number, y: number }} source — центр ячейки-источника провода.
 * @param {{ x: number, y: number }} target — центр ячейки-цели провода.
 * @param {{ x: number, y: number }} [wireDir] — направление ЛОКАЛЬНОГО сегмента
 *   провода в точке врезки; вдоль него выбирается пара (для >2 портов). Без него
 *   — вдоль линии центров source→target (хуже для согнутых проводов).
 * @returns {{ portIn: string, portOut: string } | null} portIn ближе к source,
 *   portOut ближе к target. null, если портов меньше двух.
 *
 * Ровно 2 порта → берём оба (любая ориентация провода даёт валидную врезку).
 * >2 портов → пара, максимально вытянутая вдоль провода (top/bottom для
 * вертикального сегмента, left/right для горизонтального).
 */
export function pickPassThroughPorts(ports, source, target, wireDir) {
  if (!ports || ports.length < 2) return null

  let pair
  if (ports.length === 2) {
    pair = [ports[0], ports[1]]
  } else {
    const dx = wireDir ? wireDir.x : target.x - source.x
    const dy = wireDir ? wireDir.y : target.y - source.y
    pair = widestPair(ports, dx, dy)
  }

  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)
  const [p0, p1] = pair
  const p0NearSource = dist(p0, source) <= dist(p1, source)
  return {
    portIn: (p0NearSource ? p0 : p1).id,
    portOut: (p0NearSource ? p1 : p0).id,
  }
}

/**
 * Угол поворота (снап к 90°) при врезке элемента в провод: пара проходных портов
 * ложится вдоль ЛОКАЛЬНОГО направления провода в точке врезки (`wireDir` —
 * касательная, не линия центров ячеек: rightAngle-роутер гнёт провод, и сегмент
 * может быть перпендикулярен линии центров). Сторона курсора относительно
 * провода выбирает между двумя выравнивающими вариантами (отличаются на 180°):
 *  • горизонтальный сегмент: курсор ВЫШЕ → по часовой, НИЖЕ → против;
 *  • вертикальный сегмент: курсор СЛЕВА → как есть, СПРАВА → разворот на 180°.
 * Многопортовые (>2) элементы по курсору не доворачиваются — только выравнивание.
 *
 * @param {{id:string,x:number,y:number}[]} ports — абсолютные позиции портов.
 * @param {{x:number,y:number}} wireDir — направление провода в точке врезки.
 * @param {{x:number,y:number}|null} [cursor] — точка курсора (paper-локальная).
 * @param {{x:number,y:number}|null} [wirePoint] — точка НА проводе рядом с
 *   курсором; сторона курсора считается относительно неё.
 * @returns {number} угол в градусах [0,360).
 */
export function spliceRotation(ports, wireDir, cursor, wirePoint) {
  if (!ports || ports.length < 2 || !wireDir) return 0
  const horizontal = Math.abs(wireDir.x) >= Math.abs(wireDir.y)
  const wireAxis = horizontal ? 0 : Math.PI / 2

  // Пара портов, наиболее вытянутая вдоль провода (для 2-портовых — оба).
  const pair = ports.length === 2 ? [ports[0], ports[1]] : widestPair(ports, wireDir.x, wireDir.y)
  // Ось пары в фиксированном порядке (сорт по y, затем x) — детерминированно.
  const [pA, pB] = [...pair].sort((a, b) => a.y - b.y || a.x - b.x)
  const portAxis = Math.atan2(pB.y - pA.y, pB.x - pA.x)
  const base = (((Math.round((wireAxis - portAxis) / (Math.PI / 2)) * 90) % 360) + 360) % 360

  if (ports.length !== 2 || !cursor || !wirePoint) return base

  // flip = «противоположный базовому» вариант. Горизонталь: курсор выше провода;
  // вертикаль: курсор справа от провода.
  const flip = horizontal ? cursor.y < wirePoint.y : cursor.x > wirePoint.x
  return flip ? (base + 180) % 360 : base
}

// ─── Срастание ───────────────────────────────────────────────────────────────

/**
 * План срастания при удалении элемента-прохода.
 *
 * @param {{ id: string, source: object, target: object }[]} links — линки,
 *   подключённые к удаляемому элементу (source/target = { id, port? }).
 * @param {string} elementId — id удаляемого элемента.
 * @returns {{ survivorId: string, survivorEnd: 'source'|'target',
 *   endpoint: { id: string, port?: string }, dropId: string } | null}
 *   survivorId — провод, который оставляем; survivorEnd — его конец, что был на
 *   элементе (перецеливаем); endpoint — куда (дальний конец второго провода);
 *   dropId — второй провод (уйдёт каскадом с элементом). null — не сращиваем.
 *
 * Сращиваем только «проход»: ровно 2 провода к 2 РАЗНЫМ соседям.
 */
export function planWireBridge(links, elementId) {
  if (!links || links.length !== 2) return null

  const endOnElement = (l) =>
    l.source?.id === elementId ? 'source' : l.target?.id === elementId ? 'target' : null
  const farEnd = (l) => {
    const e = endOnElement(l)
    if (!e) return null
    return e === 'source' ? l.target : l.source
  }

  const [l1, l2] = links
  const e1 = endOnElement(l1)
  if (!e1 || !endOnElement(l2)) return null

  const a = farEnd(l1)
  const b = farEnd(l2)
  if (!a?.id || !b?.id) return null // висячий конец
  if (a.id === elementId || b.id === elementId) return null // самопетля
  if (a.id === b.id) return null // оба к одному соседу — не «проход»

  return {
    survivorId: l1.id,
    survivorEnd: e1,
    endpoint: { id: b.id, ...(b.port ? { port: b.port } : {}) },
    dropId: l2.id,
  }
}
