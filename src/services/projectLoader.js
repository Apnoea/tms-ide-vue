// Восстанавливает структуру JointJS-граф'а из экспортированного view.svg.
// Опирается на data-tms-meta JSON-атрибут на каждой ячейке (<g>) и проводе (<path>),
// который пишется в exporter.js. svg-геометрия используется только для transform.

import { getStencilById } from '../stencils/registry'
import { buildPortItems } from '../stencils/svgInjector'
import {
  LINK_DEFAULTS,
  endPoint,
  isFreeEnd,
  linkRouting,
  linkStyleAttrs,
  normalizeLinkZ,
} from '../stencils/linkDefaults'
import { ATTR_META, CELL_META_FIELDS, LINK_META_FIELDS } from '../constants/ids'
import { sanitizeShape } from '../stencils/shapeElement'
import { isBackgroundZ, BACKGROUND_Z_BOUNDS } from '../utils/zOrder'
import { portPoints } from '../utils/portGeom'

/**
 * Первая и последняя точки пути провода — последняя линия обороны: если в meta конец
 * не привязан и координат у него нет, геометрию берём из `d`.
 */
function pathEndpoints(d) {
  if (!d) return null
  const nums = d.match(/-?\d+(\.\d+)?/g)
  if (!nums || nums.length < 4) return null
  const n = nums.map(Number)
  return {
    start: { x: n[0], y: n[1] },
    end: { x: n[n.length - 2], y: n[n.length - 1] },
  }
}

/**
 * Индекс «точка холста → порт символа». Ключ округляется до пикселя: после
 * float-арифметики совпадение уезжает на сотые.
 */
function portKey(x, y) {
  return `${Math.round(x)}:${Math.round(y)}`
}

function indexPorts(index, cellJson, byCellPoint) {
  // Позиции считает общая формула (utils/portGeom) — та же, что у отцепления конца
  // провода и врезки символа в линию.
  for (const { id, x, y } of portPoints(cellJson)) {
    const key = portKey(x, y)
    index.set(key, { id: cellJson.id, port: id })
    // Тот же индекс с привязкой к ячейке: при починке конца порт СВОЕЙ ячейки
    // предпочтительнее чужого в той же точке (у соприкасающихся символов они совпадают).
    if (byCellPoint) byCellPoint.set(`${cellJson.id}@${key}`, id)
  }
}

const TRANSLATE_RE = /translate\s*\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/

/** `transform="translate(X,Y)"` ячейки → позиция на холсте; null — transform'а нет. */
function translateOf(g) {
  const m = (g.getAttribute('transform') || '').match(TRANSLATE_RE)
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null
}

/** Угол из чужого архива → 0..359; null — поворота нет или значение мусорное. */
function normalizedAngle(raw) {
  const angle = Number.parseFloat(raw)
  return Number.isFinite(angle) && angle % 360 !== 0 ? ((angle % 360) + 360) % 360 : null
}

/**
 * tms-поля по тому же дескриптору, что пишет exporter (CELL_META_FIELDS /
 * LINK_META_FIELDS). normalize отдал undefined — значение не спасти: ключ не пишем вовсе,
 * иначе в tms поселится undefined и уедет в следующий экспорт.
 */
function readMetaFields(meta, fields, into) {
  for (const f of fields) {
    const raw = meta[f.key]
    if (raw === undefined) continue
    const v = f.normalize ? f.normalize(raw) : raw
    if (v === undefined) continue
    into[f.key] = f.clone ? { ...v } : v
  }
  return into
}

/**
 * Парсит SVG-текст и возвращает массив JointJS-cells (включая links),
 * готовый для graph.fromJSON.
 *
 * Возвращает { ok, cells, errors, stencilIds }.
 *  - ok: SVG распарсился. Пустая форма (0 ячеек) — ok=true (заготовка или цель
 *    навигации); ok=false только при сбое парсинга.
 *  - cells: массив JointJS-совместимых cell-JSON
 *  - errors: массив warning-строк (для toast'а пользователю)
 *  - stencilIds: все stencilId, встреченные в meta (включая выкинутые из-за
 *    незарегистрированного символа) — для подсчёта недостающих символов
 *
 * Фазы: ячейки → провода (их концы чинятся по индексам портов собранных ячеек) →
 * проверка закреплений на шинах. Общее у фаз — `ctx`.
 */
export function parseSvgProject(svgText) {
  if (!svgText || !svgText.trim()) {
    return { ok: false, cells: [], errors: ['Пустой SVG'], stencilIds: [] }
  }
  let doc
  try {
    doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  } catch (e) {
    return { ok: false, cells: [], errors: [`SVG не распарсился: ${e.message}`], stencilIds: [] }
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, cells: [], errors: ['SVG не распарсился (parse error)'], stencilIds: [] }
  }

  const ctx = {
    cells: [],
    errors: [],
    stencilIds: new Set(),
    elementIds: new Set(), // id успешно собранных ячеек — для отсева висячих проводов
    busIds: new Set(), // id шин: по ним проверяем закрепление символов (tms.busId)
    portIndex: new Map(), // точка холста → { id, port }: чинит потерянные привязки
    // id ячейки → имена её портов: ловим провод на порту, которого у символа НЕТ (его
    // пересохранили с другими именами). JointJS такую привязку молча заменяет центром
    // ячейки, поэтому чиним по геометрии.
    cellPorts: new Map(),
    portByCellPoint: new Map(), // `${cellId}@${точка}` → порт этой же ячейки
  }

  for (const g of doc.querySelectorAll(`g[${ATTR_META}]`)) {
    try {
      const meta = JSON.parse(g.getAttribute(ATTR_META))
      if (meta.kind === 'shape') parseShapeCell(ctx, g, meta)
      else parseStencilCell(ctx, g, meta)
    } catch (e) {
      ctx.errors.push(`Парсинг символа: ${e.message}`)
    }
  }
  for (const p of doc.querySelectorAll(`path[${ATTR_META}]`)) {
    try {
      parseLink(ctx, p, JSON.parse(p.getAttribute(ATTR_META)))
    } catch (e) {
      ctx.errors.push(`Парсинг провода: ${e.message}`)
    }
  }
  dropMissingBusLinks(ctx)

  // ok = SVG распарсился (см. docstring). Пустой cells — валидная пустая форма.
  return { ok: true, cells: ctx.cells, errors: ctx.errors, stencilIds: [...ctx.stencilIds] }
}

/**
 * Фигура-разметка (`kind: 'shape'`): ни символа, ни портов, ни анимаций. Геометрия
 * приходит из чужого архива, поэтому идёт через sanitizeShape.
 */
function parseShapeCell(ctx, g, meta) {
  const pos = translateOf(g)
  const shape = sanitizeShape(meta.shape)
  if (!meta.id || !pos || !shape) {
    ctx.errors.push('Фигура без id/transform/геометрии — пропускаю')
    return
  }
  const shapeJson = {
    type: 'tms.Shape',
    id: meta.id,
    position: pos,
    size: { width: meta.width ?? 1, height: meta.height ?? 1 },
    tms: { shape, ...(meta.locked ? { locked: true } : {}) },
  }
  if (meta.groupId) shapeJson.tms.groupId = meta.groupId
  const angle = normalizedAngle(meta.angle)
  if (angle !== null) shapeJson.angle = angle
  const z = Number.parseFloat(meta.z)
  // Разметка живёт и в подложке (ниже проводов), поэтому дно у неё своё: кламп
  // нулём поднял бы залитую плашку поверх проводов.
  if (Number.isFinite(z)) {
    shapeJson.z = isBackgroundZ(z) ? Math.max(BACKGROUND_Z_BOUNDS.min, z) : Math.max(0, z)
  }
  ctx.cells.push(shapeJson)
  ctx.elementIds.add(meta.id)
}

function parseStencilCell(ctx, g, meta) {
  if (!meta.id || !meta.stencilId) {
    ctx.errors.push('Символ без id/stencilId — пропускаю')
    return
  }
  // transform="translate(X,Y)" — координаты на холсте
  const pos = translateOf(g)
  if (!pos) {
    ctx.errors.push(`Символ ${meta.id}: нет transform`)
    return
  }
  ctx.stencilIds.add(meta.stencilId)
  const stencil = getStencilById(meta.stencilId)
  if (!stencil) {
    ctx.errors.push(`Символ "${meta.stencilId}" не зарегистрирован — пропускаю`)
    return
  }

  const width = meta.width ?? stencil.width
  const height = meta.height ?? stencil.height
  // Порты отражаются под flip символа (x'=W-x / y'=H-y), иначе провода не сойдутся.
  const portItems = buildPortItems(stencil, width, height, {
    flipH: !!meta.flipH,
    flipV: !!meta.flipV,
  })
  const cellJson = {
    type: 'tms.Stencil',
    id: meta.id,
    position: pos,
    size: { width, height },
    tms: readMetaFields(meta, CELL_META_FIELDS, { stencilId: meta.stencilId }),
    ports: { items: portItems },
  }
  // angle и z — поля верхнего уровня cell.toJSON(); angle применяется как transform на
  // outer-`<g>`. Значения из чужого архива проверяем: NaN в z ломает сортировку
  // коллекции; z клампится нулём снизу (отрицательный утащил бы символ под провода).
  const angle = normalizedAngle(meta.angle)
  if (angle !== null) cellJson.angle = angle
  const z = Number.parseFloat(meta.z)
  if (Number.isFinite(z)) cellJson.z = Math.max(0, z)
  ctx.cells.push(cellJson)
  ctx.elementIds.add(meta.id)
  if (meta.stencilId === 'cell_bus') ctx.busIds.add(meta.id)
  indexPorts(ctx.portIndex, cellJson, ctx.portByCellPoint)
  ctx.cellPorts.set(meta.id, new Set(portItems.map((it) => it.id)))
}

function parseLink(ctx, p, meta) {
  // Конец провода — либо привязка к ячейке, либо свободная точка. Ссылка на несобранную
  // ячейку заменяется точкой из геометрии пути, а провод не выбрасывается: линия на
  // схеме нарисована, терять её хуже.
  const pathEnds = pathEndpoints(p.getAttribute('d'))
  const source = resolveEnd(ctx, meta, meta.source, pathEnds?.start, 'начало')
  const target = resolveEnd(ctx, meta, meta.target, pathEnds?.end, 'конец')
  if (!source || !target) {
    ctx.errors.push('Провод без source/target — пропускаю')
    return
  }

  // Конфиг визуала (router/connector/attrs) — из общего модуля, тот же что у
  // defaultLink: на дефолтах JointJS провод получил бы стрелку на target.
  const link = { ...LINK_DEFAULTS, type: 'standard.Link', id: meta.id, source, target }
  // Ручные изломы: без них роутер перестроил бы маршрут по дефолту.
  if (Array.isArray(meta.vertices) && meta.vertices.length) link.vertices = meta.vertices
  // Порядок в полосе проводов: значение из чужого архива вне полосы вынесло бы провод
  // поверх символов.
  if (meta.z != null) link.z = normalizeLinkZ(meta.z)
  // tms-поля провода с той же чисткой, что у ячейки: архив чужой, и мусор уехал бы в
  // следующий экспорт.
  const tms = readMetaFields(meta, LINK_META_FIELDS, {})
  if (Object.keys(tms).length) link.tms = tms
  // Стиль линии из tms → attrs.line (иначе провод нарисуется дефолтным), маршрут — в
  // роутер с коннектором.
  const styleAttrs = linkStyleAttrs(link.tms)
  if (styleAttrs) link.attrs = styleAttrs
  Object.assign(link, linkRouting(link.tms?.route))
  ctx.cells.push(link)
}

/**
 * Конец провода из меты → привязка, свободная точка или null (конец не восстановить).
 * Привязка к собранной ячейке с существующим портом остаётся как есть; иначе точка —
 * своя из меты или конец пути — и, если в ней стоит порт, привязка к нему.
 */
function resolveEnd(ctx, meta, end, fallback, which) {
  const wanted = end?.port
  const known = end?.id ? ctx.cellPorts.get(end.id) : null
  // Порта у символа нет (его пересохранили с другими именами): мёртвую привязку не
  // оставляем — JointJS молча уводит такой конец в центр символа.
  const portMissing = !!(wanted && known && !known.has(wanted))
  if (end?.id && ctx.elementIds.has(end.id) && !portMissing) return end
  // Точка конца: своя, если в meta она есть (общий предикат — см. isFreeEnd), иначе
  // взятая из геометрии пути.
  const point = endPoint({ ...end, id: undefined }) || fallback
  // Точка совпала с портом — привязка возвращается (порт стоит ровно там, где кончается
  // линия). Сначала порт СВОЕЙ ячейки, потом любой в этой точке.
  const key = point ? portKey(point.x, point.y) : null
  const ownPort = key && end?.id ? ctx.portByCellPoint.get(`${end.id}@${key}`) : null
  const hit = ownPort ? { id: end.id, port: ownPort } : key ? ctx.portIndex.get(key) : null
  if (portMissing) {
    ctx.errors.push(
      hit
        ? `Провод ${meta.id}: ${which} висел на порту "${wanted}", которого у символа нет — привязка восстановлена по геометрии`
        : `Провод ${meta.id}: ${which} висел на порту "${wanted}", которого у символа нет — конец отвязан`
    )
    // Геометрия не помогла, но ячейка есть: привязка к символу целиком — связь
    // сохраняется, а несуществующее имя порта в экспорт не уедет.
    if (!hit) return ctx.elementIds.has(end.id) ? { id: end.id } : point
    return { ...hit }
  }
  if (!point) return null
  if (hit) return { ...hit }
  // Свободный конец, приехавший из архива точкой, — штатное состояние: молчим.
  if (!isFreeEnd(end)) {
    ctx.errors.push(`Провод ${meta.id}: ${which} не привязан к символу — восстановлен по геометрии`)
  }
  return point
}

/**
 * Закрепление на шине переживает экспорт полем `busId`, но шина могла в архив не
 * попасть (не зарегистрирован символ, битый transform). Ссылку в пустоту снимаем: иначе
 * символ считался бы прикреплённым и не ездил бы ни за чем.
 */
function dropMissingBusLinks(ctx) {
  for (const cell of ctx.cells) {
    const busId = cell.tms?.busId
    if (!busId || ctx.busIds.has(busId)) continue
    delete cell.tms.busId
    ctx.errors.push(`Символ ${cell.id}: шина ${busId} не найдена — закрепление снято`)
  }
}
