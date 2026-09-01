import { getStencilById, getAllStencils } from '../stencils/registry'
import { instantiate } from '../stencils/parser'
import { contentTransform, contentScales } from '../stencils/svgInjector'
import { isShapeCell } from '../stencils/shapeElement'
import { serializeShape } from '../utils/stencilSvg'
import { buildBusExportSvg, collectBusMarks } from '../stencils/busCell'
import { buildTextExportSvg } from '../stencils/textCell'
import { buildNodeExportSvg } from '../stencils/nodeCell'
import { LINK_Z, arrowExportSvg, dotExportSvg, endPoint } from '../stencils/linkDefaults'
import { isBackgroundZ } from '../utils/zOrder'
import {
  CLASS_OFF,
  CLASS_HIDDEN,
  rangeRowColor,
  resolveValueDecimals,
  buildRangeCssRules,
  buildStateColorCssRules,
} from '../constants/animation'
import {
  outerKey,
  innerPrefix,
  wireKey,
  ATTR_META,
  ATTR_STENCIL,
  CELL_META_FIELDS,
  LINK_META_FIELDS,
} from '../constants/ids'
// Билдеры animation-карточек (рантайм-протокол) — в отдельном модуле; здесь только
// оркестрация: обход графа → SVG-сборка + раскладка карточек по id.
import {
  buildRangeCard,
  buildBoolCard,
  buildMultiCard,
  buildStateColorCard,
  needsMulti,
  assignOrMergeAnimation,
  mergeBindingsIntoStencilCards,
} from './animationCards'
import { SVG_NS, escapeAttr } from '../utils/xml'
import { getCellTagsFromTms } from '../utils/cellSearch'
import { boolSourceTags } from '../utils/boolSource'

/**
 * Короткий id из UUID: первый сегмент, при коллизии добираются следующие (две ячейки
 * с общим префиксом слились бы в одну карточку). Round-trip держится на полном UUID в
 * data-tms-meta.
 *
 * @param {string} fullId — JointJS UUID
 * @param {(candidate: string) => boolean} isTaken
 */
function uniqueShortId(fullId, isTaken) {
  const segments = String(fullId).split('-')
  let candidate = segments[0]
  for (let i = 1; i < segments.length && isTaken(candidate); i++) {
    candidate = `${candidate}-${segments[i]}`
  }
  return candidate
}

/**
 * Конец линка для `data-tms-meta`: привязка к ячейке (`{ id, port }`) либо свободная
 * точка (`{ x, y }`). Оба вида обязаны доехать до архива, иначе провод с отцепленным
 * концом при импорте не восстановится.
 */
function endpointMeta(end) {
  if (!end) return null
  if (end.id) return { id: end.id, port: end.port }
  return endPoint(end)
}

/**
 * Разметка конца провода: наконечник, а если его нет и конец не привязан к символу —
 * точка свободного конца (endMarker).
 */
function endMarkSvg(kind, end, ref, width, color) {
  return (
    arrowExportSvg(kind, end?.point, end?.angle, width, color) ||
    (ref?.id ? '' : dotExportSvg(end?.point, width, color))
  )
}

/**
 * Абсолютная позиция конца линка: привязка (`{ id, port }` / `{ id }`) либо свободная
 * точка (`{ x, y }`).
 */
function getEndpointPos(end, graph, warnings) {
  if (!end?.id) return endPoint(end)
  const cell = graph.getCell(end.id)
  if (!cell) return null

  const pos = cell.get('position')
  if (!pos) return null // битая ячейка без позиции — линк пропустим (не роняем экспорт)

  if (end.port) {
    const ports = cell.get('ports')?.items || []
    const port = ports.find((p) => p.id === end.port)
    if (port) {
      return {
        x: pos.x + (port.args?.x ?? 0),
        y: pos.y + (port.args?.y ?? 0),
      }
    }
    // Порт не найден (рассинхрон после ресайза шины) — центр ячейки + предупреждение:
    // тихий сдвиг провода заметить трудно.
    const msg = `Провод: порт "${end.port}" у символа ${end.id} не найден — конец уехал в центр`
    console.warn(`[Export] ${msg}`)
    warnings?.push(msg)
  }
  // fallback: центр ячейки
  const size = cell.get('size')
  if (!size) return null
  return {
    x: pos.x + size.width / 2,
    y: pos.y + size.height / 2,
  }
}

// Алиас: ниже объявляется локальная `outerKey`, которая перекрыла бы импорт.
const outerKeyFor = outerKey

/**
 * Из текущего состояния JointJS-графа собирает два артефакта:
 *  • view.svg        — целостный SVG со всеми ячейками
 *  • animations.json — объединённые карточки всех ячеек для WebScada-рантайма
 *
 * На ячейке должна быть meta `tms = { stencilId, slots? }`. В выходной SVG идут
 * data-tms-* атрибуты для round-trip (открыть view.svg обратно в IDE).
 *
 * @param {dia.Graph} graph
 * @param {dia.Paper} [paper] — с ним линии экспортируются реальными ортогональными
 *   путями, как на холсте; без него — прямыми (fallback).
 * @returns {{
 *   svgText: string, animationsJson: string, animations: object,
 *   count: number, linkCount: number, warnings: string[]
 * }}
 */
export function exportProject(graph, paper = null) {
  const elements = graph.getElements()
  const links = graph.getLinks()

  const cellExports = []
  const linkExports = []
  const animations = {}
  // Один Set на ячейки и провода — их префиксы не пересекаются.
  const usedOuterKeys = new Set()
  // Предупреждения уходят в toast (в консоли их не увидят).
  const warnings = []

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  // ─── Ячейки (символы) ───
  for (const cell of elements) {
    const tms = cell.get('tms')
    // Фигура-разметка: без символа, слотов и анимаций, в SVG уезжает статичной
    // геометрией. Идёт в общий список, чтобы document order (= порядок z) не сломался.
    if (isShapeCell(cell)) {
      const shape = tms?.shape
      if (!shape) continue
      const pos = cell.get('position')
      const size = cell.get('size')
      cellExports.push({
        kind: 'shape',
        cellId: cell.id,
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        angle: cell.angle ? cell.angle() : 0,
        z: cell.get('z'),
        shape,
        locked: tms.locked,
        groupId: tms.groupId,
      })
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x + size.width)
      maxY = Math.max(maxY, pos.y + size.height)
      continue
    }
    if (!tms?.stencilId) continue

    const stencil = getStencilById(tms.stencilId)
    if (!stencil) {
      const msg = `символ "${tms.stencilId}" не найден в реестре — он выпал из view.svg`
      warnings.push(msg)
      console.warn(`[Exporter] ${msg}`)
      continue
    }

    const pos = cell.get('position')
    const size = cell.get('size')

    const animId = uniqueShortId(cell.id, (id) => usedOuterKeys.has(outerKeyFor(tms.stencilId, id)))
    usedOuterKeys.add(outerKeyFor(tms.stencilId, animId))

    // Разметка экземпляра: у программных символов (шина, подпись, точка) её строит
    // билдер СТРОКОЙ по фактическому размеру и без редактор-декораций, у остальных
    // это клон разобранного `shape.svg` (DOM). Оба вида сериализуются ниже.
    let cellSvg
    let cellSvgRoot = null
    if (tms.stencilId === 'cell_bus') {
      // Маркеры занятых слотов — тем же сборщиком, что рисует холст (busCell).
      cellSvg = buildBusExportSvg(
        size.width,
        size.height,
        tms.color,
        collectBusMarks(graph, cell.id)
      )
    } else if (tms.stencilId === 'cell_text') {
      cellSvg = buildTextExportSvg(tms.text ?? '', size.height, {
        fontSize: tms.fontSize,
        bold: tms.bold,
        color: tms.color,
        font: tms.fontFamily,
      })
    } else if (tms.stencilId === 'cell_node') {
      cellSvg = buildNodeExportSvg(size.width, size.height, tms)
    } else {
      // parser.instantiate интерполирует {slot.X} → tms.slots[X] в bindings и собирает
      // SVG с id="animation-{stencilId}-{animId}{suffix}"; animId — короткий.
      const inst = instantiate(stencil, animId, tms.slots || {}, tms.params || {})
      // DOM-клон, а не строка: дети сериализуются ниже одним проходом.
      cellSvgRoot = inst.root
      // Точность значения — свойство привязки, а не рисунка: в шаблоне символа её нет,
      // подставляем из tms ячейки.
      for (const card of Object.values(inst.animations)) {
        if (card?.animation !== 'text') continue
        for (const b of card.bindings || []) {
          if (b.output?.text) b.output.decimals = resolveValueDecimals(tms)
        }
      }
      Object.assign(animations, inst.animations)
    }

    cellExports.push({
      cellId: cell.id, // полный JointJS-UUID — для data-tms-meta + связей в проводах
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      stencilId: tms.stencilId,
      // База масштаба контента: размер определения у обычных символов, фактический —
      // у программных (их билдеры уже нарисовали по нему).
      baseWidth: contentScales(stencil) ? stencil.width : size.width,
      baseHeight: contentScales(stencil) ? stencil.height : size.height,
      // Масштаб экземпляра: размер уже в width/height, но при загрузке габарит
      // выводится из множителя (syncStencilInstances), поэтому он нужен в meta.
      scale: tms.scale,
      animId,
      svgContent: cellSvg,
      svgRoot: cellSvgRoot,
      slots: tms.slots || null,
      // Значения правимых подписей: рисунок уже с ними, но при загрузке поля
      // инспектора берут их отсюда.
      params: tms.params || null,
      rangeSource: tms.rangeSource || null,
      boolSource: tms.boolSource || null,
      // navigation — имя view, на которую рантайм переходит по клику.
      navigation: tms.navigation || null,
      // Поля символа для round-trip восстановления редактором
      text: tms.text,
      fontSize: tms.fontSize,
      bold: tms.bold,
      color: tms.color,
      // Шрифт подписи: габарит ячейки посчитан им, без round-trip'а замер разойдётся.
      fontFamily: tms.fontFamily,
      // align — якорь роста текста: позиция уже в c.x/c.y, а поле задаёт, от какого
      // края блок растёт при следующей правке.
      align: tms.align,
      // locked — «замок» ячейки: read-only на холсте, переживает экспорт/импорт.
      locked: tms.locked,
      // groupId — метка логической группы (общий id у членов).
      groupId: tms.groupId,
      // busId — закрепление на шине: без round-trip'а символ перестал бы за ней ездить.
      busId: tms.busId,
      // Поля карточки значения прошлого формата: у новых ячеек их нет, а старые
      // конвертирует миграция — экспорт их только переносит.
      valueTag: tms.valueTag,
      valueLabel: tms.valueLabel,
      valueUnit: tms.valueUnit,
      decimals: tms.decimals,
      // Диаметр точки соединения (cell_node) — вид, заданный автором.
      dotSize: tms.dotSize,
      // Геометрический трансформ для round-trip: angle применяется как rotate вокруг
      // центра ячейки на outer-`<g>`.
      angle: cell.angle ? cell.angle() : 0,
      // z-index: document order SVG уже упорядочен, но точное значение нужно
      // round-trip'у и командам порядка наложения.
      z: cell.get('z'),
      // Отражение (flip): визуал — transform на внутренней группе, позиции портов уже
      // отражены в живом paper (buildPortItems).
      flipH: tms.flipH,
      flipV: tms.flipV,
    })

    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + size.width)
    maxY = Math.max(maxY, pos.y + size.height)
  }

  // ─── Линии (links) ───
  for (const link of links) {
    let pathD = null
    // Концы пути с направлением — для наконечников: они смотрят В точку соединения,
    // поэтому у начала тангенс берётся задом наперёд.
    let ends = null

    // С paper'ом путь берётся таким, как отрисован на холсте (роутинг + изломы). У
    // standard.Link два <path> с одинаковым `d` — wrapper (хитбокс) и line: выбираем
    // line по `joint-selector="line"`, querySelector('path') вернул бы wrapper.
    if (paper) {
      const linkView = paper.findViewByModel(link)
      if (linkView?.el) {
        const pathEl = linkView.el.querySelector('path[joint-selector="line"]')
        if (pathEl) {
          pathD = pathEl.getAttribute('d')
          // Заодно собираем bbox по реальной геометрии
          try {
            const bbox = linkView.getBBox()
            if (bbox) {
              minX = Math.min(minX, bbox.x)
              minY = Math.min(minY, bbox.y)
              maxX = Math.max(maxX, bbox.x + bbox.width)
              maxY = Math.max(maxY, bbox.y + bbox.height)
            }
          } catch {
            // ignore
          }
        }
        // Геометрия концов — от JointJS, а не парсингом `d`: у мостиков (jumpover)
        // в пути есть дуги, и «две последние координаты» уже не задают направление.
        try {
          const conn = linkView?.getConnection?.()
          if (conn?.length) {
            const first = conn.tangentAtLength(0)
            const last = conn.tangentAtLength(conn.length())
            // Тело наконечника рисуется в +X (arrowPath), поэтому поворачивается вдоль
            // линии внутрь: у начала это направление пути, у конца — обратное.
            ends = {
              start: { point: first.start, angle: first.angle() },
              end: { point: last.end, angle: last.angle() + 180 },
            }
          }
        } catch {
          // ignore — упадём в fallback ниже
        }
      }
    }

    // Fallback: вычисляем source/target и строим прямую
    if (!pathD) {
      const source = getEndpointPos(link.get('source'), graph, warnings)
      const target = getEndpointPos(link.get('target'), graph, warnings)
      if (!source || !target) {
        const msg = `Провод ${link.id}: не удалось вычислить геометрию — пропущен (не попадёт в экспорт)`
        console.warn(`[Export] ${msg}`)
        warnings.push(msg)
        continue
      }
      pathD = `M ${source.x},${source.y} L ${target.x},${target.y}`
      // Прямая: направление — по линии источник→цель.
      const deg = (Math.atan2(target.y - source.y, target.x - source.x) * 180) / Math.PI
      ends = {
        start: { point: source, angle: deg },
        end: { point: target, angle: deg + 180 },
      }

      minX = Math.min(minX, source.x, target.x)
      minY = Math.min(minY, source.y, target.y)
      maxX = Math.max(maxX, source.x, target.x)
      maxY = Math.max(maxY, source.y, target.y)
    }

    // id провода — `animation-wire-{short}` из link.id (UUID стабилен между
    // save/load); round-trip держится на полном id в data-tms-meta. uniqueShortId
    // защищает от слияния двух линков с общим первым сегментом UUID.
    const wireShort = uniqueShortId(link.id, (id) => usedOuterKeys.has(wireKey(id)))
    const wireId = wireKey(wireShort)
    usedOuterKeys.add(wireId)

    const linkTms = link.get('tms') || {}
    const sourceRef = link.get('source')
    const targetRef = link.get('target')
    const vertices = link.vertices?.() || []

    linkExports.push({
      id: wireId,
      linkId: link.id, // JointJS-id для round-trip восстановления редактором
      d: pathD,
      rangeSource: linkTms.rangeSource || null,
      boolSource: linkTms.boolSource || null,
      // Толщина и цвет линии: дефолты (2 / #000) в meta не пишутся.
      strokeWidth: linkTms.strokeWidth || null,
      strokeColor: linkTms.strokeColor || null,
      // Привязки концов для редактора — из source/target модели, а не из геометрии
      // пути. Свободный конец записывается ТОЧКОЙ `{x, y}`: `{ id: undefined }` импорт
      // читает как «провод без source/target» и выбрасывает линию.
      source: endpointMeta(sourceRef),
      target: endpointMeta(targetRef),
      // Ручные изломы: геометрия пути в `d` нужна рантайму, изломы — редактору.
      vertices: vertices.length ? vertices.map((v) => ({ x: v.x, y: v.y })) : null,
      // Наконечники + геометрия концов: рисуются в группе провода (arrowExportSvg).
      arrowStart: linkTms.arrowStart || null,
      arrowEnd: linkTms.arrowEnd || null,
      ends,
      // Порядок в полосе проводов (кто кого огибает); дно полосы не пишем.
      z: link.get('z') !== LINK_Z ? link.get('z') : null,
    })
  }

  // ─── ViewBox ───
  let viewBoxX, viewBoxY, viewBoxW, viewBoxH
  if (cellExports.length === 0 && linkExports.length === 0) {
    viewBoxX = 0
    viewBoxY = 0
    viewBoxW = 800
    viewBoxH = 600
  } else {
    const padding = 20
    viewBoxX = Math.floor(minX - padding)
    viewBoxY = Math.floor(minY - padding)
    viewBoxW = Math.ceil(maxX - minX + padding * 2)
    viewBoxH = Math.ceil(maxY - minY + padding * 2)
  }

  // ─── Диапазоны / булевы источники ───
  // Карточка на outer-id ячейки (+ merge во внутренние shape-карточки символа) либо
  // на wire-id линка. needsMulti-цели получают одну `multi` (диапазоны + булево +
  // quality слоями), остальные — shape.
  const bindingTargets = [
    ...cellExports.map((c) => ({
      src: c,
      key: outerKeyFor(c.stencilId, c.animId),
      stencilId: c.stencilId,
      animId: c.animId,
    })),
    ...linkExports.map((l) => ({ src: l, key: l.id })),
  ]

  // buildMultiCard работает и для линка (нет stencilId → quality пропускается).
  for (const t of bindingTargets) {
    if (needsMulti(t.src)) animations[t.key] = buildMultiCard(t.src)
  }

  // Кладёт shape-карточку на key + (для ячеек) мержит во внутренние символьные.
  const addShapeCard = (t, card) => {
    assignOrMergeAnimation(animations, t.key, card)
    if (t.stencilId) mergeBindingsIntoStencilCards(animations, t.stencilId, t.animId, t.key, card)
  }
  // Не-multi источники: диапазоны (range → класс) + булево (любой false → серый).
  // needsMulti-цели пропускаются — их эффекты уже в multi.
  const shapeSources = [
    {
      has: (s) => !!s.rangeSource?.tag && s.rangeSource.ranges?.length > 0,
      build: (s) => buildRangeCard(s.rangeSource),
    },
    {
      has: (s) => boolSourceTags(s.boolSource).length > 0,
      build: (s) => buildBoolCard(boolSourceTags(s.boolSource)),
    },
  ]
  for (const { has, build } of shapeSources) {
    for (const t of bindingTargets) {
      if (needsMulti(t.src) || !has(t.src)) continue
      addShapeCard(t, build(t.src))
    }
  }

  // ─── Проверка источника значения ───
  // Строка без порогов в карточку не попадает, хотя в инспекторе выглядит настроенной.
  for (const t of bindingTargets) {
    const vs = t.src.rangeSource
    if (!vs?.tag || !vs.ranges?.length) continue
    const empty = vs.ranges.filter((r) => !Number.isFinite(r.min) && !Number.isFinite(r.max)).length
    if (!empty) continue
    const msg = `${t.src.stencilId || 'провод'}: у тега "${vs.tag}" ${empty} стр. без порогов — в анимацию не попадут`
    warnings.push(msg)
    console.warn(`[Exporter] ${msg}`)
  }

  // ─── State-color: перекрас всего символа по состоянию (stateColors символа) ───
  // Слой на outer (уживается с диапазонами, булевым и quality), на потомков цвет
  // каскадит через CSS. Для needsMulti-целей мержится в их multi.
  for (const c of cellExports) {
    const card = buildStateColorCard(c)
    if (card) assignOrMergeAnimation(animations, outerKeyFor(c.stencilId, c.animId), card)
  }

  // ─── cell_node наследует диапазоны от соединённого провода ───
  // Без своего rangeSource узел берёт первый соединённый провод с диапазонами и ту же
  // range-карточку — в рантайме перекрасится в цвет провода.
  for (const c of cellExports) {
    if (needsMulti(c)) continue
    if (c.stencilId !== 'cell_node') continue
    if (c.rangeSource?.tag) continue
    for (const l of linkExports) {
      if (!l.rangeSource?.tag) continue
      if (l.source?.id !== c.cellId && l.target?.id !== c.cellId) continue
      const card = buildRangeCard(l.rangeSource)
      assignOrMergeAnimation(animations, outerKeyFor(c.stencilId, c.animId), card)
      break
    }
  }

  // ─── Navigation ───
  // Поле navigation в карточке outer-обёртки. Без других анимаций создаётся пустая
  // shape-карточка: рантайму нужна запись для click-handler'а.
  for (const c of cellExports) {
    if (!c.navigation) continue
    const outerKey = outerKeyFor(c.stencilId, c.animId)
    if (!animations[outerKey]) {
      animations[outerKey] = { animation: 'shape', bindings: [] }
    }
    animations[outerKey].navigation = c.navigation
  }

  // ─── detailTags на outer-wrapper / wire-card ───
  // Рантайм открывает popup с подробностями по клику, читая detailTags карточки
  // внешней обёртки — у ячейки это outer, у провода wire-карточка.
  function attachDetailTags(key, tags) {
    if (!tags.length) return
    if (!animations[key]) {
      animations[key] = { animation: 'shape', bindings: [] }
    }
    const existing = animations[key].detailTags || []
    const seen = new Set(existing.map((d) => d.tag))
    const additions = []
    for (const t of tags) {
      if (!seen.has(t)) {
        seen.add(t)
        additions.push({ tag: t })
      }
    }
    if (additions.length) {
      animations[key].detailTags = [...existing, ...additions]
    }
  }
  // cellExports / linkExports по структуре совпадают с tms-payload, поэтому теги
  // собирает тот же getCellTagsFromTms, что и поиск.
  for (const c of cellExports) {
    if (getStencilById(c.stencilId)?.static) continue
    attachDetailTags(outerKeyFor(c.stencilId, c.animId), getCellTagsFromTms(c))
  }
  for (const l of linkExports) {
    attachDetailTags(l.id, getCellTagsFromTms(l))
  }

  // ─── Quality (OPC DA): non-good → animation-off ───
  // quality тега: 192-255 = good, 64-191 = uncertain, 0-63 = bad. Символы с
  // флагом `quality: true` в stencil.json (cell_qk/qr/qf) получают range-кейс
  // [0, 191] → addClass: animation-off — cell станет серым, если данные
  // ненадёжны. WebScada сравнивает inclusive (>=min && <=max), поэтому
  // max=191 — последнее non-good значение, 192 уже good и в range не попадёт.
  //
  // Биндинги кладём ТОЛЬКО на outer-карточку — оттуда CSS-каскад
  // `.animation-off *:not(text) { stroke }` затемняет ВСЕ stroke-элементы
  // символа. На inner-карточках (.true / .false) серым стал бы только
  // текущий видимый рычаг — остальной корпус остался бы чёрным.
  //
  // Outer-карточку создаём если её ещё нет (аналогично navigation-логике
  // выше). text/value-карточки сюда не включаются — у них своя
  // quality-семантика в рантайме.
  for (const c of cellExports) {
    if (needsMulti(c)) continue
    if (!getStencilById(c.stencilId)?.quality) continue
    // Собираем уникальные теги из inner-карточек (slot.onoff) + outer (диапазоны,
    // булево). Без тегов quality-биндинги бессмысленны — пропускаем.
    const stencilPrefix = innerPrefix(c.stencilId, c.animId)
    const outerKey = outerKeyFor(c.stencilId, c.animId)
    const seen = new Set()
    for (const key of Object.keys(animations)) {
      if (key !== outerKey && !key.startsWith(stencilPrefix)) continue
      const card = animations[key]
      if (card?.animation !== 'shape') continue
      for (const b of card.bindings || []) {
        if (b.tag) seen.add(b.tag)
      }
    }
    if (!seen.size) continue
    if (!animations[outerKey]) animations[outerKey] = { animation: 'shape', bindings: [] }
    const outer = animations[outerKey]
    for (const tag of seen) {
      outer.bindings.push({
        tag,
        when: {
          source: 'quality',
          type: 'range',
          cases: [{ min: 0, max: 191, apply: { addClass: CLASS_OFF } }],
        },
      })
    }
  }

  // ─── SVG-фрагменты ───
  // data-tms-meta — авторитет для редактора при загрузке; рантайм игнорирует.
  // escapeAttr импортируется из utils/xml — один источник правды
  // для обоих писателей SVG-строк (exporter и svgInjector).
  //
  // Линии — первыми (фон), ячейки сверху, чтобы цеплялись к портам.
  const lines = linkExports
    .map((l) => {
      const meta = {
        id: l.linkId,
        source: l.source,
        target: l.target,
      }
      // tms-поля провода — по единому дескриптору (см. LINK_META_FIELDS), чтобы
      // запись и чтение (projectLoader) не разъезжались. vertices — отдельно
      // (поле верхнего уровня линка, не tms).
      for (const f of LINK_META_FIELDS) {
        if (f.keep(l[f.key])) meta[f.key] = l[f.key]
      }
      if (l.vertices) meta.vertices = l.vertices
      if (l.z != null) meta.z = l.z
      const metaAttr = escapeAttr(JSON.stringify(meta))
      // l.id и l.d составляются из UUID-производных и сгенерированных path-данных,
      // то есть symbol-safe; escapeAttr держит инвариант на любой вход.
      const color = escapeAttr(l.strokeColor || '#000')
      const width = l.strokeWidth ?? 2
      const lineAttrs = `d="${escapeAttr(l.d)}" stroke="${color}" stroke-width="${width}" fill="none" ${ATTR_META}="${metaAttr}"`
      const arrows = [
        endMarkSvg(l.arrowStart, l.ends?.start, l.source, width, color),
        endMarkSvg(l.arrowEnd, l.ends?.end, l.target, width, color),
      ].filter(Boolean)
      // Без наконечников структура прежняя (один <path> с id) — уже выгруженные схемы
      // не переписываются. Со наконечниками id переезжает на группу: рантайм вешает
      // класс на неё, и правила анимации каскадом достают и линию, и наконечники.
      if (!arrows.length) return `  <path id="${escapeAttr(l.id)}" ${lineAttrs}/>`
      return `  <g id="${escapeAttr(l.id)}"><path ${lineAttrs}/>${arrows.join('')}</g>`
    })
    .join('\n')

  const serializer = new XMLSerializer()
  const renderCells = (list) =>
    list
      .map((c) => {
        if (c.kind === 'shape') {
          // Рисуем тем же генератором, что холст и редактор символов — иначе выгрузка
          // разошлась бы с тем, что автор видел. id не нужен: карточек анимации у
          // разметки нет, рантайм её не адресует. `kind` в meta — метка для разбора.
          const meta = {
            kind: 'shape',
            id: c.cellId,
            width: c.width,
            height: c.height,
            shape: c.shape,
          }
          if (c.locked) meta.locked = true
          if (c.groupId) meta.groupId = c.groupId
          if (c.angle) meta.angle = c.angle
          if (c.z != null) meta.z = c.z
          let transform = `translate(${c.x},${c.y})`
          if (c.angle) transform += ` rotate(${c.angle} ${c.width / 2} ${c.height / 2})`
          return `  <g transform="${transform}" ${ATTR_META}="${escapeAttr(JSON.stringify(meta))}">${serializeShape(c.shape, false)}</g>`
        }
        // Шаблонный символ приходит DOM-клоном (parser.instantiate), программный —
        // строкой от своего билдера: её парсим, чтобы вырезать корневой <svg>.
        const sourceRoot =
          c.svgRoot ??
          new DOMParser().parseFromString(c.svgContent, 'image/svg+xml').documentElement
        let inner = ''
        for (const child of Array.from(sourceRoot.children)) {
          inner += serializer.serializeToString(child)
        }
        // Отражение и масштаб: контент оборачиваем во внутреннюю группу (позиция и
        // поворот — на outer, как в редакторе). Порты в экспорт не идут.
        const ct = contentTransform({
          baseWidth: c.baseWidth,
          baseHeight: c.baseHeight,
          width: c.width,
          height: c.height,
          flipH: c.flipH,
          flipV: c.flipV,
        })
        if (ct) inner = `<g transform="${ct}">${inner}</g>`
        const meta = {
          id: c.cellId,
          stencilId: c.stencilId,
          width: c.width,
          height: c.height,
        }
        // tms-поля — по единому дескриптору (см. CELL_META_FIELDS), чтобы запись и
        // чтение (projectLoader) не разъезжались. angle — отдельно (в JointJS-поле).
        for (const f of CELL_META_FIELDS) {
          const v = f.normalize ? f.normalize(c[f.key]) : c[f.key]
          if (f.keep(v)) meta[f.key] = f.flag ? true : v
        }
        if (c.angle) meta.angle = c.angle
        if (c.z != null) meta.z = c.z
        const metaAttr = escapeAttr(JSON.stringify(meta))
        // translate(x,y) ставит ячейку на холст; rotate (если есть) вращает
        // вокруг центра ячейки в её локальных координатах.
        let transform = `translate(${c.x},${c.y})`
        if (c.angle) transform += ` rotate(${c.angle} ${c.width / 2} ${c.height / 2})`
        // stencilId по инварианту реестра уже в маске [a-z0-9_], escapeAttr на нём —
        // страховка от нового пути регистрации в обход registry.isValidStencilId.
        return `  <g id="${escapeAttr(outerKeyFor(c.stencilId, c.animId))}" transform="${transform}" ${ATTR_STENCIL}="${escapeAttr(c.stencilId)}" ${ATTR_META}="${metaAttr}">${inner}</g>`
      })
      .join('\n')

  // Порядок в файле = порядок наложения: подложка (разметка ниже проводов, см.
  // utils/zOrder) идёт ПЕРЕД линиями, остальные ячейки — после. Иначе залитая
  // плашка, уведённая под провода в IDE, в view.svg снова оказалась бы поверх них.
  const background = renderCells(cellExports.filter((c) => isBackgroundZ(c.z)))
  const groups = renderCells(cellExports.filter((c) => !isBackgroundZ(c.z)))

  // Инлайн-стили — рантайм только навешивает классы, CSS должен быть в SVG.
  // Descendant-селектор `* { stroke }` нужен из-за inline presentation-атрибутов
  // внутри ячеек. animation-off объявлен ПОСЛЕ правил диапазонов — перебивает по каскаду.
  // цвет по диапазонам (stroke + opt-in fill) + animation-off серым поверх.
  // Чистый SVG: без scope и без live-DOM исключений (см. buildRangeCssRules).
  // Правила — по цветам, реально выбранным в этой форме: состав задаёт схема, поэтому
  // собираем со всех источников (ячейки + провода), включая прежние class-имена.
  const rangeCss = buildRangeCssRules(
    [...cellExports, ...linkExports].flatMap((s) =>
      (s.rangeSource?.ranges || []).map((r) => rangeRowColor(r))
    )
  )
    .map((r) => `    ${r}`)
    .join('\n')
  // State-color: перекрас символа по состоянию. Тот же генератор, что в симуляции.
  const stateColorCss = buildStateColorCssRules(getAllStencils())
    .map((r) => `    ${r}`)
    .join('\n')
  const inlineStyles = `  <style>
    <![CDATA[
    .${CLASS_HIDDEN} { display: none; }
${rangeCss}
${stateColorCss}
    /* Quality-stencils: при bad-качестве (animation-off на outer) показываем
       обе позиции рычага одновременно — отменяем animation-hidden у потомков.
       Конвенция «данные ненадёжны → не врём про конкретное состояние».
       id подставляется в селектор внутри CDATA без эскейпа сознательно: в
       CSS-контексте escapeAttr не помог бы, безопасность держит маска реестра
       (constants/ids STENCIL_ID_RE). */
${getAllStencils()
  .filter((s) => s.quality)
  .map(
    (s) =>
      `    [${ATTR_STENCIL}="${s.id}"].${CLASS_OFF} .${CLASS_HIDDEN} { display: initial !important; }`
  )
  .join('\n')}
    ]]>
  </style>`

  const svgText = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="${viewBoxW}" height="${viewBoxH}">
${inlineStyles}
${background}
${lines}
${groups}
</svg>
`

  const animationsObject = { animations }
  const animationsJson = JSON.stringify(animationsObject, null, 2)

  return {
    svgText,
    animationsJson,
    animations: animationsObject,
    count: cellExports.length,
    linkCount: linkExports.length,
    warnings,
  }
}
