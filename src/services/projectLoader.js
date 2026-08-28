// Восстанавливает структуру JointJS-граф'а из экспортированного view.svg.
// Опирается на data-tms-meta JSON-атрибут на каждой ячейке (<g>) и проводе (<path>),
// который пишется в exporter.js. svg-геометрия используется только для transform.

import { getStencilById } from '../stencils/registry'
import { buildPortItems } from '../stencils/svgInjector'
import {
  LINK_DEFAULTS,
  endPoint,
  isFreeEnd,
  linkStyleAttrs,
  normalizeLinkZ,
} from '../stencils/linkDefaults'
import { ATTR_META, CELL_META_FIELDS, LINK_META_FIELDS } from '../constants/ids'
import { sanitizeShape } from '../stencils/shapeElement'
import { isBackgroundZ, BACKGROUND_Z_BOUNDS } from '../utils/zOrder'
import { portPoints } from '../utils/portGeom'
import { textCellToShape, legacyBusPortId, dissolveNodeCells } from './legacyFormat'

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

  const cells = []
  const errors = []
  const stencilIds = new Set()
  const elementIds = new Set() // id успешно собранных ячеек — для отсева висячих проводов
  const busIds = new Set() // id шин: только у них порт-рефы линков переводим на новую схему
  const portIndex = new Map() // точка холста → { id, port }: чинит потерянные привязки
  // id ячейки → имена её портов: ловим провод на порту, которого у символа НЕТ (его
  // пересохранили с другими именами). JointJS такую привязку молча заменяет центром
  // ячейки, поэтому чиним по геометрии.
  const cellPorts = new Map()
  const portByCellPoint = new Map() // `${cellId}@${точка}` → порт этой же ячейки

  // ─── Ячейки: <g> с data-tms-meta ───
  for (const g of doc.querySelectorAll(`g[${ATTR_META}]`)) {
    try {
      const meta = JSON.parse(g.getAttribute(ATTR_META))

      // Фигура-разметка (`kind: 'shape'`): ни символа, ни портов, ни анимаций.
      // Геометрия приходит из чужого архива, поэтому идёт через sanitizeShape.
      if (meta.kind === 'shape') {
        const tr = g.getAttribute('transform') || ''
        const m = tr.match(/translate\s*\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/)
        const shape = sanitizeShape(meta.shape)
        if (!meta.id || !m || !shape) {
          errors.push('Фигура без id/transform/геометрии — пропускаю')
          continue
        }
        const shapeJson = {
          type: 'tms.Shape',
          id: meta.id,
          position: { x: parseFloat(m[1]), y: parseFloat(m[2]) },
          size: { width: meta.width ?? 1, height: meta.height ?? 1 },
          tms: { shape, ...(meta.locked ? { locked: true } : {}) },
        }
        if (meta.groupId) shapeJson.tms.groupId = meta.groupId
        const shapeAngle = Number.parseFloat(meta.angle)
        if (Number.isFinite(shapeAngle) && shapeAngle % 360 !== 0) {
          shapeJson.angle = ((shapeAngle % 360) + 360) % 360
        }
        const shapeZ = Number.parseFloat(meta.z)
        // Разметка живёт и в подложке (ниже проводов), поэтому дно у неё своё: кламп
        // нулём поднял бы залитую плашку поверх проводов.
        if (Number.isFinite(shapeZ)) {
          shapeJson.z = isBackgroundZ(shapeZ)
            ? Math.max(BACKGROUND_Z_BOUNDS.min, shapeZ)
            : Math.max(0, shapeZ)
        }
        cells.push(shapeJson)
        elementIds.add(meta.id)
        continue
      }

      if (!meta.id || !meta.stencilId) {
        errors.push('Символ без id/stencilId — пропускаю')
        continue
      }

      // transform="translate(X,Y)" — координаты на холсте
      const tr = g.getAttribute('transform') || ''
      const m = tr.match(/translate\s*\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/)
      if (!m) {
        errors.push(`Символ ${meta.id}: нет transform`)
        continue
      }
      const x = parseFloat(m[1])
      const y = parseFloat(m[2])

      stencilIds.add(meta.stencilId)
      const stencil = getStencilById(meta.stencilId)
      if (!stencil) {
        errors.push(`Символ "${meta.stencilId}" не зарегистрирован — пропускаю`)
        continue
      }

      const width = meta.width ?? stencil.width
      const height = meta.height ?? stencil.height

      // Порты отражаются под flip символа (x'=W-x / y'=H-y), иначе провода не сойдутся.
      const portItems = buildPortItems(stencil, width, height, {
        flipH: !!meta.flipH,
        flipV: !!meta.flipV,
      })

      // tms-payload по тому же дескриптору, что пишет exporter (CELL_META_FIELDS).
      const tms = { stencilId: meta.stencilId }
      for (const f of CELL_META_FIELDS) {
        const raw = meta[f.key]
        if (raw === undefined) continue
        const v = f.normalize ? f.normalize(raw) : raw
        // normalize отдал undefined = значение не спасти: ключ не пишем вовсе, иначе
        // в tms поселится undefined и уедет в следующий экспорт.
        if (v === undefined) continue
        tms[f.key] = f.clone ? { ...v } : v
      }

      const cellJson = {
        type: 'tms.Stencil',
        id: meta.id,
        position: { x, y },
        size: { width, height },
        tms,
        ports: { items: portItems },
      }
      // angle и z — поля верхнего уровня cell.toJSON(); angle применяется как
      // transform на outer-`<g>`. Значения из чужого архива проверяем: NaN в z ломает
      // сортировку коллекции. angle приводится к 0..359, z клампится нулём снизу
      // (отрицательный утащил бы символ под провода).
      const angle = Number.parseFloat(meta.angle)
      if (Number.isFinite(angle) && angle % 360 !== 0) cellJson.angle = ((angle % 360) + 360) % 360
      const z = Number.parseFloat(meta.z)
      if (Number.isFinite(z)) cellJson.z = Math.max(0, z)
      // Подпись прошлого формата (cell_text) сразу становится фигурой — тем же
      // конвертером, что чинит формы в IDB (services/legacyFormat).
      const migrated = textCellToShape(cellJson)
      cells.push(migrated || cellJson)
      elementIds.add(meta.id)
      if (meta.stencilId === 'cell_bus') busIds.add(meta.id)
      if (!migrated) {
        indexPorts(portIndex, cellJson, portByCellPoint)
        cellPorts.set(meta.id, new Set(portItems.map((it) => it.id)))
      }
    } catch (e) {
      errors.push(`Парсинг символа: ${e.message}`)
    }
  }

  // ─── Провода: <path> с data-tms-meta ───
  for (const p of doc.querySelectorAll(`path[${ATTR_META}]`)) {
    try {
      const meta = JSON.parse(p.getAttribute(ATTR_META))
      // Конец провода — либо привязка к ячейке, либо свободная точка. Ссылка на
      // несобранную ячейку заменяется точкой из геометрии пути, а провод не
      // выбрасывается: линия на схеме нарисована, терять её хуже.
      const pathEnds = pathEndpoints(p.getAttribute('d'))
      const resolveEnd = (end, fallback, which) => {
        // Имя порта у собранной ячейки: у шины прошлой схемы порты переименованы
        // (buildPortItems), без перевода конец повис бы на несуществующем `top_i`.
        const wanted =
          end?.id && busIds.has(end.id) ? legacyBusPortId(end.port) || end.port : end?.port
        const known = end?.id ? cellPorts.get(end.id) : null
        // Порта у символа нет (его пересохранили с другими именами): мёртвую
        // привязку не оставляем — JointJS молча уводит такой конец в центр символа.
        const portMissing = !!(wanted && known && !known.has(wanted))
        if (end?.id && elementIds.has(end.id) && !portMissing) {
          return wanted && wanted !== end.port ? { ...end, port: wanted } : end
        }
        // Точка конца: своя, если в meta она есть (общий предикат — см. isFreeEnd),
        // иначе взятая из геометрии пути.
        const point = endPoint({ ...end, id: undefined }) || fallback
        // Точка совпала с портом — привязка возвращается (порт стоит ровно там, где
        // кончается линия). Сначала порт СВОЕЙ ячейки, потом любой в этой точке.
        const key = point ? portKey(point.x, point.y) : null
        const ownPort = key && end?.id ? portByCellPoint.get(`${end.id}@${key}`) : null
        const hit = ownPort ? { id: end.id, port: ownPort } : key ? portIndex.get(key) : null
        if (portMissing) {
          errors.push(
            hit
              ? `Провод ${meta.id}: ${which} висел на порту "${wanted}", которого у символа нет — привязка восстановлена по геометрии`
              : `Провод ${meta.id}: ${which} висел на порту "${wanted}", которого у символа нет — конец отвязан`
          )
          // Геометрия не помогла, но ячейка есть: привязка к символу целиком —
          // связь сохраняется, а несуществующее имя порта в экспорт не уедет.
          if (!hit) return elementIds.has(end.id) ? { id: end.id } : point
          return { ...hit }
        }
        if (!point) return null
        if (hit) return { ...hit }
        // Свободный конец, приехавший из архива точкой, — штатное состояние: молчим.
        if (!isFreeEnd(end)) {
          errors.push(
            `Провод ${meta.id}: ${which} не привязан к символу — восстановлен по геометрии`
          )
        }
        return point
      }
      const source = resolveEnd(meta.source, pathEnds?.start, 'начало')
      const target = resolveEnd(meta.target, pathEnds?.end, 'конец')
      if (!source || !target) {
        errors.push('Провод без source/target — пропускаю')
        continue
      }

      // Конфиг визуала (router/connector/attrs) — из общего модуля, тот же что у
      // defaultLink: на дефолтах JointJS провод получил бы стрелку на target.
      const link = {
        ...LINK_DEFAULTS,
        type: 'standard.Link',
        id: meta.id,
        source,
        target,
      }
      // Ручные изломы: без них роутер перестроил бы маршрут по дефолту.
      if (Array.isArray(meta.vertices) && meta.vertices.length) link.vertices = meta.vertices
      // Порядок в полосе проводов: значение из чужого архива вне полосы вынесло бы
      // провод поверх символов.
      if (meta.z != null) link.z = normalizeLinkZ(meta.z)
      // tms-поля провода по тому же дескриптору, что пишет exporter (LINK_META_FIELDS).
      for (const f of LINK_META_FIELDS) {
        const v = meta[f.key]
        if (v === undefined) continue
        link.tms = link.tms || {}
        link.tms[f.key] = v
      }
      // Стиль линии из tms → attrs.line (иначе провод нарисуется дефолтным).
      const styleAttrs = linkStyleAttrs(link.tms, source, target)
      if (styleAttrs) link.attrs = styleAttrs
      cells.push(link)
    } catch (e) {
      errors.push(`Парсинг провода: ${e.message}`)
    }
  }

  // Закрепление на шине переживает экспорт полем `busId`, но шина могла в архив не
  // попасть (не зарегистрирован символ, битый transform). Ссылку в пустоту снимаем:
  // иначе символ считался бы прикреплённым и не ездил бы ни за чем.
  for (const cell of cells) {
    const busId = cell.tms?.busId
    if (!busId) continue
    if (busIds.has(busId)) continue
    delete cell.tms.busId
    errors.push(`Символ ${cell.id}: шина ${busId} не найдена — закрепление снято`)
  }

  // Точки соединения прошлого формата растворяем в свободные концы проводов — тем же
  // конвертером, что чинит формы в IDB (см. legacyFormat.dissolveNodeCells).
  const nodes = dissolveNodeCells(cells)
  if (nodes.kept) {
    errors.push(
      `Точек соединения с 2+ проводами: ${nodes.kept} — оставлены символами, остальные стали точками проводов`
    )
  }

  // ok = SVG распарсился (см. docstring). Пустой cells — валидная пустая форма.
  return { ok: true, cells: nodes.cells, errors, stencilIds: [...stencilIds] }
}
