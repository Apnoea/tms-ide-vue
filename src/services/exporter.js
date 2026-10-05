import { getStencilById, getAllStencils } from '../stencils/registry'
import { instantiate } from '../stencils/parser'
import { contentTransform, contentScales } from '../stencils/svgInjector'
import { isShapeCell } from '../stencils/shapeElement'
import { serializeShape } from '../utils/shapeSvg'
import { buildBusExportSvg, collectBusMarks } from '../stencils/busCell'
import {
  LINK_Z,
  arrowExportSvg,
  arrowInsetEnds,
  dotExportSvg,
  endPoint,
} from '../stencils/linkDefaults'
import { isBackgroundZ } from '../utils/zOrder'
import { jointGraphAccess, resolveRangeSource } from '../utils/rangeSource'
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
 * точка свободного конца (dotExportSvg).
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

/**
 * Из текущего состояния JointJS-графа собирает два артефакта:
 *  • view.svg        — целостный SVG со всеми ячейками
 *  • animations.json — объединённые карточки всех ячеек для WebScada-рантайма
 *
 * На ячейке должна быть meta `tms = { stencilId, slots? }`. В выходной SVG идут
 * data-tms-* атрибуты для round-trip (открыть view.svg обратно в IDE).
 *
 * Фазы: ячейки → провода → карточки анимаций → SVG. Общее у фаз — `ctx`: карточки,
 * предупреждения (уходят в toast — в консоли их не увидят), занятые короткие id (один
 * Set на ячейки и провода — их префиксы не пересекаются) и габарит формы для viewBox.
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
  const ctx = {
    graph,
    paper,
    // Обход графа для наследования диапазонов (провод → шина или символ).
    access: jointGraphAccess(graph),
    animations: {},
    warnings: [],
    usedOuterKeys: new Set(),
    bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  }
  const cellExports = collectCells(ctx)
  const linkExports = collectLinks(ctx)
  buildCards(ctx, cellExports, linkExports)
  const svgText = renderSvg(ctx, cellExports, linkExports)

  const animationsObject = { animations: ctx.animations }
  return {
    svgText,
    animationsJson: JSON.stringify(animationsObject, null, 2),
    animations: animationsObject,
    count: cellExports.length,
    linkCount: linkExports.length,
    warnings: ctx.warnings,
  }
}

/** Расширить габарит формы прямоугольником. */
function growBounds(b, x1, y1, x2, y2) {
  b.minX = Math.min(b.minX, x1)
  b.minY = Math.min(b.minY, y1)
  b.maxX = Math.max(b.maxX, x2)
  b.maxY = Math.max(b.maxY, y2)
}

function warn(ctx, msg) {
  ctx.warnings.push(msg)
  console.warn(`[Exporter] ${msg}`)
}

// ─── Ячейки (символы и фигуры-разметка) ───

function collectCells(ctx) {
  const out = []
  for (const cell of ctx.graph.getElements()) {
    const tms = cell.get('tms')
    const pos = cell.get('position')
    const size = cell.get('size')
    // Фигура-разметка: без символа, слотов и анимаций, в SVG уезжает статичной
    // геометрией. Идёт в общий список, чтобы document order (= порядок z) не сломался.
    if (isShapeCell(cell)) {
      if (!tms?.shape) continue
      out.push({
        kind: 'shape',
        cellId: cell.id,
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        angle: cell.angle ? cell.angle() : 0,
        z: cell.get('z'),
        shape: tms.shape,
        locked: tms.locked,
        groupId: tms.groupId,
      })
      growBounds(ctx.bounds, pos.x, pos.y, pos.x + size.width, pos.y + size.height)
      continue
    }
    if (!tms?.stencilId) continue

    const stencil = getStencilById(tms.stencilId)
    if (!stencil) {
      warn(ctx, `символ "${tms.stencilId}" не найден в реестре — он выпал из view.svg`)
      continue
    }
    out.push(stencilCellExport(ctx, cell, tms, stencil))
    growBounds(ctx.bounds, pos.x, pos.y, pos.x + size.width, pos.y + size.height)
  }
  return out
}

/** Экспорт ячейки-символа: разметка экземпляра, его карточки и поля round-trip'а. */
function stencilCellExport(ctx, cell, tms, stencil) {
  const pos = cell.get('position')
  const size = cell.get('size')
  const animId = uniqueShortId(cell.id, (id) => ctx.usedOuterKeys.has(outerKey(tms.stencilId, id)))
  ctx.usedOuterKeys.add(outerKey(tms.stencilId, animId))

  // Разметка экземпляра: у программного символа (шина) её строит
  // билдер СТРОКОЙ по фактическому размеру и без редактор-декораций, у остальных
  // это клон разобранного `shape.svg` (DOM). Оба вида сериализуются в renderSvg.
  let cellSvg
  let cellSvgRoot = null
  if (tms.stencilId === 'cell_bus') {
    // Маркеры занятых слотов — тем же сборщиком, что рисует холст (busCell).
    cellSvg = buildBusExportSvg(
      size.width,
      size.height,
      tms.color,
      collectBusMarks(ctx.graph, cell.id)
    )
  } else {
    // parser.instantiate интерполирует {slot.X} → tms.slots[X] в bindings и собирает
    // SVG с id="animation-{stencilId}-{animId}{suffix}"; animId — короткий.
    const inst = instantiate(stencil, animId, tms.slots || {}, tms.params || {})
    // DOM-клон, а не строка: дети сериализуются одним проходом.
    cellSvgRoot = inst.root
    // Точность значения — свойство привязки, а не рисунка: в шаблоне символа её нет,
    // подставляем из tms ячейки.
    for (const card of Object.values(inst.animations)) {
      if (card?.animation !== 'text') continue
      for (const b of card.bindings || []) {
        if (b.output?.text) b.output.decimals = resolveValueDecimals(tms)
      }
    }
    Object.assign(ctx.animations, inst.animations)
  }

  return {
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
    // В мету — только СВОЯ настройка (round-trip); действующий источник (зоны символа
    // с тегом слота, наследование у провода) — в `rangeEffective`, для карточек. Запиши
    // его в мету — при загрузке он стал бы своим и перестал следовать за источником.
    rangeSource: tms.rangeSource || null,
    rangeEffective: resolveRangeSource(ctx.access.of(cell), ctx.access, getStencilById),
    boolSource: tms.boolSource || null,
    // navigation — имя view, на которую рантайм переходит по клику.
    navigation: tms.navigation || null,
    // Цвет тела шины (у подписи-разметки свой, в tms.shape).
    color: tms.color,
    // locked — «замок» ячейки: read-only на холсте, переживает экспорт/импорт.
    locked: tms.locked,
    // groupId — метка логической группы (общий id у членов).
    groupId: tms.groupId,
    // busId — закрепление на шине: без round-trip'а символ перестал бы за ней ездить.
    busId: tms.busId,
    decimals: tms.decimals,
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
  }
}

// ─── Провода ───

function collectLinks(ctx) {
  const out = []
  for (const link of ctx.graph.getLinks()) {
    const geometry = linkGeometry(ctx, link)
    if (!geometry) {
      const msg = `Провод ${link.id}: не удалось вычислить геометрию — пропущен (не попадёт в экспорт)`
      ctx.warnings.push(msg)
      console.warn(`[Export] ${msg}`)
      continue
    }

    // id провода — `animation-wire-{short}` из link.id (UUID стабилен между
    // save/load); round-trip держится на полном id в data-tms-meta. uniqueShortId
    // защищает от слияния двух линков с общим первым сегментом UUID.
    const wireShort = uniqueShortId(link.id, (id) => ctx.usedOuterKeys.has(wireKey(id)))
    const wireId = wireKey(wireShort)
    ctx.usedOuterKeys.add(wireId)

    const linkTms = link.get('tms') || {}
    const vertices = link.vertices?.() || []
    out.push({
      id: wireId,
      linkId: link.id, // JointJS-id для round-trip восстановления редактором
      d: geometry.d,
      // Своя настройка провода — legacy, в мету как есть; красит его действующий
      // источник — унаследованный по цепи (см. utils/rangeSource).
      rangeSource: linkTms.rangeSource || null,
      rangeEffective: resolveRangeSource(ctx.access.of(link), ctx.access, getStencilById),
      boolSource: linkTms.boolSource || null,
      // Толщина и цвет линии: дефолты (2 / #000) в meta не пишутся.
      strokeWidth: linkTms.strokeWidth || null,
      strokeColor: linkTms.strokeColor || null,
      // Привязки концов для редактора — из source/target модели, а не из геометрии
      // пути. Свободный конец записывается ТОЧКОЙ `{x, y}`: `{ id: undefined }` импорт
      // читает как «провод без source/target» и выбрасывает линию.
      source: endpointMeta(link.get('source')),
      target: endpointMeta(link.get('target')),
      // Ручные изломы: геометрия пути в `d` нужна рантайму, изломы — редактору.
      vertices: vertices.length ? vertices.map((v) => ({ x: v.x, y: v.y })) : null,
      // Наконечники + геометрия концов: рисуются в группе провода (arrowExportSvg).
      arrowStart: linkTms.arrowStart || null,
      arrowEnd: linkTms.arrowEnd || null,
      // Маршрут — только для редактора: рантайм рисует готовый путь из `d`.
      route: linkTms.route || null,
      ends: geometry.ends,
      // Порядок в полосе проводов (кто кого огибает); дно полосы не пишем.
      z: link.get('z') !== LINK_Z ? link.get('z') : null,
    })
  }
  return out
}

/**
 * Путь провода (`d`) и концы с направлением — для наконечников: они смотрят В точку
 * соединения, поэтому у начала тангенс берётся задом наперёд. null — геометрию не
 * вычислить.
 *
 * С paper'ом путь берётся таким, как отрисован на холсте (роутинг + изломы), без него
 * — прямая между концами.
 */
function linkGeometry(ctx, link) {
  const view = ctx.paper?.findViewByModel(link)
  // У standard.Link два <path> с одинаковым `d` — wrapper (хитбокс) и line: выбираем
  // line по `joint-selector="line"`, querySelector('path') вернул бы wrapper.
  const pathEl = view?.el?.querySelector('path[joint-selector="line"]')
  if (pathEl) {
    let ends = null
    // Габарит — по реальной геометрии.
    try {
      const bbox = view.getBBox()
      if (bbox) growBounds(ctx.bounds, bbox.x, bbox.y, bbox.x + bbox.width, bbox.y + bbox.height)
    } catch {
      // ignore
    }
    // Геометрия концов — от JointJS, а не парсингом `d`: у мостиков (jumpover)
    // в пути есть дуги, и «две последние координаты» уже не задают направление.
    try {
      const conn = view.getConnection?.()
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
      // ignore — наконечники без направления не рисуются
    }
    return { d: pathEl.getAttribute('d'), ends }
  }

  // Fallback: вычисляем source/target и строим прямую.
  const source = getEndpointPos(link.get('source'), ctx.graph, ctx.warnings)
  const target = getEndpointPos(link.get('target'), ctx.graph, ctx.warnings)
  if (!source || !target) return null
  growBounds(
    ctx.bounds,
    Math.min(source.x, target.x),
    Math.min(source.y, target.y),
    Math.max(source.x, target.x),
    Math.max(source.y, target.y)
  )
  // Под наконечником путь укорочен на его длину — как это делает коннектор холста
  // (arrowInsetJumpover): остриё стоит в точке соединения, тело — до основания.
  const { start, end } = arrowInsetEnds(source, target, [], link.get('tms'))
  // Прямая: направление — по линии источник→цель.
  const deg = (Math.atan2(target.y - source.y, target.x - source.x) * 180) / Math.PI
  return {
    d: `M ${start.x},${start.y} L ${end.x},${end.y}`,
    ends: { start: { point: start, angle: deg }, end: { point: end, angle: deg + 180 } },
  }
}

// ─── Карточки анимаций ───

/**
 * Карточки поверх собранных символьных: диапазоны и булево, state-color, навигация,
 * detailTags, quality. Порядок важен: слои мержатся в уже положенные карточки.
 */
function buildCards(ctx, cellExports, linkExports) {
  const { animations } = ctx
  // Карточки и detailTags строятся по ДЕЙСТВУЮЩЕМУ источнику диапазонов: билдеры
  // читают `rangeSource`, поэтому подставляем его в представление для карточек.
  const cardView = (s) => ({ ...s, rangeSource: s.rangeEffective || null })
  const targets = [
    ...cellExports.map((c) => ({
      src: cardView(c),
      key: outerKey(c.stencilId, c.animId),
      stencilId: c.stencilId,
      animId: c.animId,
    })),
    ...linkExports.map((l) => ({ src: cardView(l), key: l.id })),
  ]

  addSourceCards(ctx, targets)
  for (const t of targets) warnRowsWithoutBounds(ctx, t.src)

  // State-color: перекрас всего символа по состоянию (stateColors символа). Слой на
  // outer (уживается с диапазонами, булевым и quality), на потомков цвет каскадит
  // через CSS. Для needsMulti-целей мержится в их multi.
  for (const c of cellExports) {
    const card = buildStateColorCard(c)
    if (card) assignOrMergeAnimation(animations, outerKey(c.stencilId, c.animId), card)
  }

  // Navigation — поле в карточке outer-обёртки. Без других анимаций создаётся пустая
  // shape-карточка: рантайму нужна запись для click-handler'а.
  for (const c of cellExports) {
    if (c.navigation)
      outerCard(animations, outerKey(c.stencilId, c.animId)).navigation = c.navigation
  }

  // detailTags: рантайм открывает popup с подробностями по клику, читая detailTags
  // карточки внешней обёртки — у ячейки это outer, у провода wire-карточка.
  // cellExports / linkExports по структуре совпадают с tms-payload, поэтому теги
  // собирает тот же getCellTagsFromTms, что и поиск.
  for (const c of cellExports) {
    if (getStencilById(c.stencilId)?.static) continue
    attachDetailTags(animations, outerKey(c.stencilId, c.animId), getCellTagsFromTms(cardView(c)))
  }
  for (const l of linkExports) attachDetailTags(animations, l.id, getCellTagsFromTms(cardView(l)))

  for (const c of cellExports) addQualityBindings(animations, c)
}

/** Карточка outer-обёртки: есть — та же, нет — пустая shape-карточка. */
function outerCard(animations, key) {
  if (!animations[key]) animations[key] = { animation: 'shape', bindings: [] }
  return animations[key]
}

/**
 * Диапазоны и булевы источники. Карточка на outer-id ячейки (+ merge во внутренние
 * shape-карточки символа) либо на wire-id линка. needsMulti-цели получают одну `multi`
 * (диапазоны + булево + quality слоями; у линка нет stencilId — quality пропускается),
 * остальные — shape.
 */
function addSourceCards({ animations }, targets) {
  for (const t of targets) {
    if (needsMulti(t.src)) animations[t.key] = buildMultiCard(t.src)
  }
  // Не-multi источники: диапазоны (range → класс) + булево (любой false → серый).
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
    for (const t of targets) {
      if (needsMulti(t.src) || !has(t.src)) continue
      const card = build(t.src)
      assignOrMergeAnimation(animations, t.key, card)
      if (t.stencilId) mergeBindingsIntoStencilCards(animations, t.stencilId, t.animId, t.key, card)
    }
  }
}

/** Строка без порогов в карточку не попадает, хотя в инспекторе выглядит настроенной. */
function warnRowsWithoutBounds(ctx, src) {
  const vs = src.rangeSource
  if (!vs?.tag || !vs.ranges?.length) return
  const empty = vs.ranges.filter((r) => !Number.isFinite(r.min) && !Number.isFinite(r.max)).length
  if (empty) {
    warn(
      ctx,
      `${src.stencilId || 'провод'}: у тега "${vs.tag}" ${empty} стр. без порогов — в анимацию не попадут`
    )
  }
}

function attachDetailTags(animations, key, tags) {
  if (!tags.length) return
  const card = outerCard(animations, key)
  const existing = card.detailTags || []
  const seen = new Set(existing.map((d) => d.tag))
  const additions = []
  for (const t of tags) {
    if (seen.has(t)) continue
    seen.add(t)
    additions.push({ tag: t })
  }
  if (additions.length) card.detailTags = [...existing, ...additions]
}

/**
 * Quality (OPC DA): non-good → animation-off. Шкала: 192-255 good, 64-191 uncertain,
 * 0-63 bad. Символы с `quality: true` в stencil.json получают range-кейс [0, 191] →
 * addClass `animation-off`; сравнение в рантайме inclusive, поэтому max=191 — последнее
 * non-good значение.
 *
 * Биндинги только на OUTER-карточку: оттуда каскад `.animation-off *:not(text)`
 * затемняет весь символ, а на inner-карточках серым стал бы один видимый рычаг.
 * Outer создаём, если её ещё нет; text/value-карточки не трогаем — у них своя
 * quality-семантика в рантайме.
 */
function addQualityBindings(animations, c) {
  if (needsMulti(c) || !getStencilById(c.stencilId)?.quality) return
  // Уникальные теги из inner-карточек (slot.onoff) + outer (диапазоны, булево). Без
  // тегов quality-биндинги бессмысленны — пропускаем.
  const prefix = innerPrefix(c.stencilId, c.animId)
  const key = outerKey(c.stencilId, c.animId)
  const seen = new Set()
  for (const [k, card] of Object.entries(animations)) {
    if (k !== key && !k.startsWith(prefix)) continue
    if (card?.animation !== 'shape') continue
    for (const b of card.bindings || []) {
      if (b.tag) seen.add(b.tag)
    }
  }
  if (!seen.size) return
  const outer = outerCard(animations, key)
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

// ─── SVG ───

/**
 * Сборка view.svg. data-tms-meta — авторитет для редактора при загрузке; рантайм
 * игнорирует. Порядок в файле = порядок наложения: подложка (разметка ниже проводов, см.
 * utils/zOrder) идёт ПЕРЕД линиями, остальные ячейки — после. Иначе залитая плашка,
 * уведённая под провода в IDE, в view.svg снова оказалась бы поверх них.
 */
function renderSvg({ bounds }, cellExports, linkExports) {
  const empty = cellExports.length === 0 && linkExports.length === 0
  const padding = 20
  const vb = empty
    ? { x: 0, y: 0, w: 800, h: 600 }
    : {
        x: Math.floor(bounds.minX - padding),
        y: Math.floor(bounds.minY - padding),
        w: Math.ceil(bounds.maxX - bounds.minX + padding * 2),
        h: Math.ceil(bounds.maxY - bounds.minY + padding * 2),
      }
  const serializer = new XMLSerializer()
  const cellsSvg = (list) => list.map((c) => renderCell(c, serializer)).join('\n')
  const background = cellsSvg(cellExports.filter((c) => isBackgroundZ(c.z)))
  const groups = cellsSvg(cellExports.filter((c) => !isBackgroundZ(c.z)))
  const lines = linkExports.map(renderLink).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${vb.w}" height="${vb.h}">
${inlineStyles(cellExports, linkExports)}
${background}
${lines}
${groups}
</svg>
`
}

function renderLink(l) {
  const meta = { id: l.linkId, source: l.source, target: l.target }
  // tms-поля провода — по единому дескриптору (см. LINK_META_FIELDS), чтобы запись и
  // чтение (projectLoader) не разъезжались. vertices — отдельно (поле верхнего уровня
  // линка, не tms).
  for (const f of LINK_META_FIELDS) {
    if (f.keep(l[f.key])) meta[f.key] = l[f.key]
  }
  if (l.vertices) meta.vertices = l.vertices
  if (l.z != null) meta.z = l.z
  const metaAttr = escapeAttr(JSON.stringify(meta))
  // l.id и l.d составляются из UUID-производных и сгенерированных path-данных, то есть
  // symbol-safe; escapeAttr держит инвариант на любой вход.
  const color = escapeAttr(l.strokeColor || '#000')
  const width = l.strokeWidth ?? 2
  const lineAttrs = `d="${escapeAttr(l.d)}" stroke="${color}" stroke-width="${width}" fill="none" ${ATTR_META}="${metaAttr}"`
  const arrows = [
    endMarkSvg(l.arrowStart, l.ends?.start, l.source, width, color),
    endMarkSvg(l.arrowEnd, l.ends?.end, l.target, width, color),
  ].filter(Boolean)
  // Без наконечников — один <path> с id. С наконечниками id на группе: рантайм вешает
  // класс на неё, и правила анимации каскадом достают и линию, и наконечники.
  if (!arrows.length) return `  <path id="${escapeAttr(l.id)}" ${lineAttrs}/>`
  return `  <g id="${escapeAttr(l.id)}"><path ${lineAttrs}/>${arrows.join('')}</g>`
}

function renderCell(c, serializer) {
  // translate(x,y) ставит ячейку на холст; rotate (если есть) вращает вокруг центра
  // ячейки в её локальных координатах.
  let transform = `translate(${c.x},${c.y})`
  if (c.angle) transform += ` rotate(${c.angle} ${c.width / 2} ${c.height / 2})`

  if (c.kind === 'shape') {
    // Рисуем тем же генератором, что холст и редактор символов — иначе выгрузка
    // разошлась бы с тем, что автор видел. id не нужен: карточек анимации у разметки
    // нет, рантайм её не адресует. `kind` в meta — метка для разбора.
    const meta = { kind: 'shape', id: c.cellId, width: c.width, height: c.height, shape: c.shape }
    if (c.locked) meta.locked = true
    if (c.groupId) meta.groupId = c.groupId
    if (c.angle) meta.angle = c.angle
    if (c.z != null) meta.z = c.z
    return `  <g transform="${transform}" ${ATTR_META}="${escapeAttr(JSON.stringify(meta))}">${serializeShape(c.shape, false)}</g>`
  }

  // Шаблонный символ приходит DOM-клоном (parser.instantiate), программный — строкой от
  // своего билдера: её парсим, чтобы вырезать корневой <svg>.
  const sourceRoot =
    c.svgRoot ?? new DOMParser().parseFromString(c.svgContent, 'image/svg+xml').documentElement
  let inner = ''
  for (const child of Array.from(sourceRoot.children)) {
    inner += serializer.serializeToString(child)
  }
  // Отражение и масштаб: контент оборачиваем во внутреннюю группу (позиция и поворот —
  // на outer, как в редакторе). Порты в экспорт не идут.
  const ct = contentTransform({
    baseWidth: c.baseWidth,
    baseHeight: c.baseHeight,
    width: c.width,
    height: c.height,
    flipH: c.flipH,
    flipV: c.flipV,
  })
  if (ct) inner = `<g transform="${ct}">${inner}</g>`
  const meta = { id: c.cellId, stencilId: c.stencilId, width: c.width, height: c.height }
  // tms-поля — по единому дескриптору (см. CELL_META_FIELDS), чтобы запись и чтение
  // (projectLoader) не разъезжались. angle — отдельно (в JointJS-поле).
  for (const f of CELL_META_FIELDS) {
    const v = f.normalize ? f.normalize(c[f.key]) : c[f.key]
    if (f.keep(v)) meta[f.key] = f.flag ? true : v
  }
  if (c.angle) meta.angle = c.angle
  if (c.z != null) meta.z = c.z
  const metaAttr = escapeAttr(JSON.stringify(meta))
  // stencilId по инварианту реестра уже в маске [a-z0-9_], escapeAttr на нём — страховка
  // от нового пути регистрации в обход registry.isValidStencilId.
  return `  <g id="${escapeAttr(outerKey(c.stencilId, c.animId))}" transform="${transform}" ${ATTR_STENCIL}="${escapeAttr(c.stencilId)}" ${ATTR_META}="${metaAttr}">${inner}</g>`
}

/**
 * Стили инлайном: рантайм только навешивает классы, CSS обязан быть в SVG.
 * Descendant-селектор `* { stroke }` нужен из-за presentation-атрибутов внутри ячеек;
 * `animation-off` объявлен ПОСЛЕ диапазонов и перебивает их по каскаду. Правила
 * диапазонов — по цветам, реально выбранным в этой форме, со всех источников (ячейки и
 * провода).
 */
function inlineStyles(cellExports, linkExports) {
  const indent = (rules) => rules.map((r) => `    ${r}`).join('\n')
  const rangeCss = indent(
    buildRangeCssRules(
      [...cellExports, ...linkExports].flatMap((s) =>
        (s.rangeEffective?.ranges || []).map((r) => rangeRowColor(r))
      )
    )
  )
  // State-color: перекрас символа по состоянию. Тот же генератор, что в симуляции.
  const stateColorCss = indent(buildStateColorCssRules(getAllStencils()))
  return `  <style>
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
}
