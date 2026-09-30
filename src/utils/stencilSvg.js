/**
 * Модель редактора символов → артефакты проекта: `serializeSvg` даёт shape.svg
 * (viewBox 0 0 W H), `buildStencilJson` — stencil.json, `parseStencilSvg` читает
 * shape.svg обратно в фигуры. Чистые функции: координаты приходят уже в системе
 * символа и снапнутыми, здесь только рендер. Отдельная фигура — в shapeSvg.
 *
 * Фигуры со состоянием группируются в `<g data-anim-suffix=".<ключ>">`, оттуда же
 * строится animationTemplate. Подпись участвует в видимости по состоянию, но не в
 * перекраске — CSS исключает `<text>`.
 */

import {
  ATTR_PARAM,
  ATTR_SUFFIX,
  RANGE_SLOT,
  STENCIL_ID_RE,
  isValidParamKey,
} from '../constants/ids'
import { normalizeStateColor } from '../constants/animation'
import { normalizeDomains } from '../constants/domains'
import { cleanRangeRows } from './rangeRows'
import { TEXT_SHAPE_SIZE, normalizeFont } from '../constants/text'
import {
  VALUE_TEXT_SUFFIX,
  isFillableShape,
  num,
  serializeShape,
  shapesBounds,
  translateShape,
} from './shapeSvg'

// Инверсия TEXT_ANCHORS из shapeSvg: `text-anchor` из файла → поле `align` модели.
const TEXT_ALIGN_BY_ANCHOR = { start: 'left', middle: 'center', end: 'right' }
function textAlignOf(el) {
  return TEXT_ALIGN_BY_ANCHOR[el.getAttribute('text-anchor')] || null
}

/**
 * Габарит контента, кратный grid: bbox фигур + портов, расширенный до сетки (min вниз,
 * max вверх, чтобы контент не срезался). Общий счёт с сохранением — редактор берёт
 * отсюда будущий размер. Обводка в bbox не входит, как и в рукописных символах.
 *
 * @returns {{x:number, y:number, w:number, h:number}|null} null — считать нечего
 */
export function contentBox(shapes, ports = [], grid = 10) {
  const b = shapesBounds(shapes, ports)
  if (!b) return null
  const x0 = Math.floor(b.x / grid) * grid
  const y0 = Math.floor(b.y / grid) * grid
  const x1 = Math.ceil((b.x + b.w) / grid) * grid
  const y1 = Math.ceil((b.y + b.h) / grid) * grid
  return { x: x0, y: y0, w: Math.max(grid, x1 - x0), h: Math.max(grid, y1 - y0) }
}

/**
 * Обрезка пустых полей: контент сдвигается в (0,0), размер = его габарит по сетке.
 *
 * @returns {{shapes:Array, ports:Array, width:number, height:number}}
 */
export function cropToContent(shapes, ports = [], grid = 10) {
  if (!shapes?.length) return { shapes: shapes || [], ports: ports || [], width: 0, height: 0 }
  const box = contentBox(shapes, ports, grid)
  if (!box) return { shapes, ports, width: 0, height: 0 }
  return {
    shapes: shapes.map((s) => translateShape(s, -box.x, -box.y)),
    ports: ports.map((p) => ({ ...p, x: p.x - box.x, y: p.y - box.y })),
    width: box.w,
    height: box.h,
  }
}

// Тело группы: сериализованные фигуры с отступом (пустая строка, если фигур нет).
// markFill пробрасываем в serializeShape — метку заливки ставим лишь у stateful.
function groupBody(shapes, markFill) {
  return (shapes || [])
    .map((s) => serializeShape(s, markFill))
    .filter(Boolean)
    .map((el) => `    ${el}`)
    .join('\n')
}

// Порядок и набор состояний-групп. Булев режим — фикс. `true`,`false` (частный
// случай); режим значения — ключи из meta.states (порядок как задал автор).
function stateKeys(meta) {
  return meta?.stateMode === 'value' ? (meta.states || []).map((s) => s.key) : ['true', 'false']
}

/**
 * Модель → строка shape.svg. viewBox/width/height берём из meta (кратны шагу сетки).
 * Фигуры оборачиваем в `<g>` — единый формат с рукописными символами (у них
 * всё в группе); на группу состояния вешается data-anim-suffix.
 */
export function serializeSvg(shapes, meta) {
  const w = num(meta.width)
  const h = num(meta.height)
  const all = shapes || []
  // Метку tms-state-fill ставим только у stateful-символов (иначе перекрашивать
  // по состоянию нечего — см. fillClassAttr).
  const markFill = !!meta?.stateful
  let groups
  if (meta?.stateful) {
    // Внутренняя анимация: статику — в базовую группу, каждое состояние — в свой
    // <g data-anim-suffix=".<ключ>"> (рантайм вешает animation-hidden, когда
    // значение тега не совпадает). Порядок: база → состояния (анимируемое поверх).
    // В базовую группу — статика И фигуры на неизвестном ключе (состояние удалили, а
    // привязка осталась): иначе такая фигура не попала бы ни в одну группу.
    const known = new Set(stateKeys(meta))
    const base = groupBody(
      all.filter((s) => !s.state || s.state === 'always' || !known.has(s.state)),
      markFill
    )
    // Пустую базовую группу не пишем — у символа, где все фигуры привязаны к
    // состояниям, это мусорная строка. Разбору она не нужна (collectShapes рекурсивен).
    groups = base ? `  <g>\n${base}\n  </g>\n` : ''
    for (const key of stateKeys(meta)) {
      const body = groupBody(
        all.filter((s) => s.state === key),
        markFill
      )
      if (body) groups += `  <g ${ATTR_SUFFIX}=".${key}">\n${body}\n  </g>\n`
    }
  } else {
    const body = groupBody(all, markFill)
    groups = body ? `  <g>\n${body}\n  </g>\n` : ''
  }
  // Без XML-декларации: `src/library/<id>/shape.svg` пишут два пути (сохранение из
  // редактора и запись при импорте .zip), и второй её не ставит — с ней файл «дышал»
  // бы в гите. Читателям она не нужна: DOMParser получает тип image/svg+xml, UTF-8 —
  // дефолт XML. В экспортном `view.svg` декларация остаётся.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n` +
    groups +
    '</svg>\n'
  )
}

// Атрибуты обводки/заливки фигуры из SVG-элемента (инверсия strokeAttrs/fillAttr).
function readStroke(el) {
  return {
    stroke: el.getAttribute('stroke') || '#000',
    strokeWidth: Number.parseFloat(el.getAttribute('stroke-width')) || 2,
  }
}

// Инверсия roundingAttrs: rect с rx>0 или линия/ломаная с круглыми торцами/стыками.
function isRounded(el) {
  if (el.tagName.toLowerCase() === 'rect') return Number.parseFloat(el.getAttribute('rx')) > 0
  return (
    el.getAttribute('stroke-linecap') === 'round' || el.getAttribute('stroke-linejoin') === 'round'
  )
}

/**
 * Инверсия многострочного рендера: строки собираются из `<tspan>`, `<text>` без них
 * читается целиком. Строки триммятся (в файле tspan'ы стоят с отступами), пустой
 * tspan даёт пустую строку — автор оставил интервал намеренно.
 */
function readTextLines(el) {
  const tspans = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'tspan')
  if (!tspans.length) return (el.textContent || '').trim()
  return tspans.map((t) => (t.textContent || '').trim()).join('\n')
}

/**
 * Разбор одного элемента. `null`, если у фигуры нет ОБЯЗАТЕЛЬНЫХ размеров: `<rect>`
 * без width дал бы `w: NaN`, и такое значение уехало бы в файл при пересохранении.
 * Координаты необязательны (дефолт SVG — 0), у них fallback.
 */
function elementToShape(el) {
  const n = (a, fallback = 0) => {
    const v = Number.parseFloat(el.getAttribute(a))
    return Number.isFinite(v) ? v : fallback
  }
  // Размер, без которого фигуры не существует: NaN/отсутствие → null.
  const size = (a) => {
    const v = Number.parseFloat(el.getAttribute(a))
    return Number.isFinite(v) && v > 0 ? v : null
  }
  const fill = el.getAttribute('fill') || 'none'
  switch (el.tagName.toLowerCase()) {
    case 'rect': {
      const w = size('width')
      const h = size('height')
      if (w === null || h === null) return null
      return { type: 'rect', x: n('x'), y: n('y'), w, h, fill, ...readStroke(el) }
    }
    case 'line':
      return { type: 'line', x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2'), ...readStroke(el) }
    case 'circle': {
      // Единый тип для круга и эллипса: круг = равные радиусы.
      const r = size('r')
      if (r === null) return null
      return { type: 'circle', cx: n('cx'), cy: n('cy'), rx: r, ry: r, fill, ...readStroke(el) }
    }
    case 'ellipse': {
      const rx = size('rx')
      const ry = size('ry')
      if (rx === null || ry === null) return null
      return { type: 'circle', cx: n('cx'), cy: n('cy'), rx, ry, fill, ...readStroke(el) }
    }
    case 'polyline':
    case 'polygon': {
      const points = (el.getAttribute('points') || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p.split(',').map(Number))
      const shape = { type: 'polyline', points, fill, ...readStroke(el) }
      if (el.tagName.toLowerCase() === 'polygon') shape.closed = true
      return shape
    }
    case 'text': {
      // Цвет подписи лежит в fill (у текста нет обводки), поэтому кладём его в
      // `stroke` модели — редактор правит цвет фигуры одним полем для всех типов.
      const align = textAlignOf(el)
      return {
        type: 'text',
        x: n('x'),
        y: n('y'),
        ...(align ? { align } : {}),
        text: readTextLines(el),
        fontSize: size('font-size') ?? TEXT_SHAPE_SIZE,
        // Шрифт — только из whitelist: замер (canvas) и панель должны считать одним
        // и тем же семейством.
        fontFamily: normalizeFont(el.getAttribute('font-family')),
        bold: el.getAttribute('font-weight') === 'bold',
        stroke: fill === 'none' ? '#000' : fill,
        strokeWidth: 2,
        fill: 'none',
        ...(el.getAttribute(ATTR_SUFFIX) === VALUE_TEXT_SUFFIX ? { valueText: true } : {}),
        ...(isValidParamKey(el.getAttribute(ATTR_PARAM))
          ? { param: el.getAttribute(ATTR_PARAM) }
          : {}),
      }
    }
    default:
      return null
  }
}

// Собирает фигуры рекурсивно: заходит внутрь `<g>` (наш формат и рукописные
// символы держат примитивы в группе). Порядок — DFS в порядке документа.
function collectShapes(parent, out, state = 'always') {
  for (const el of Array.from(parent.children)) {
    if (el.tagName.toLowerCase() === 'g') {
      // Суффикс `.<ключ>` → state фигуры (булев `.true`/`.false` или value-ключ
      // `.on`/`.s1`); группа без суффикса — наследует родительское (по умолчанию
      // always). Ключ = суффикс без ведущей точки.
      const suffix = el.getAttribute(ATTR_SUFFIX)
      const childState = suffix && suffix.startsWith('.') ? suffix.slice(1) : state
      collectShapes(el, out, childState)
      continue
    }
    const shape = elementToShape(el)
    if (shape) {
      // Скругление: rect с rx, либо линия/ломаная с круглым linecap/linejoin.
      if (isRounded(el)) shape.rounded = true
      // state пишем только для непустого состояния; `always` — дефолт без поля.
      out.push(state === 'always' ? shape : { ...shape, state })
    }
  }
}

/**
 * Обратный парсинг shape.svg → массив примитивов модели (инверсия serializeSvg).
 * Рекурсит в `<g>`, поэтому читает и наш формат (фигуры в группе), и плоский, и
 * статические рукописные (tv2/tv3). `data-anim-suffix=".<ключ>"` на группе → state
 * фигуры (ключ = суффикс без точки); атрибуты групп (`transform`) и незнакомые
 * элементы (`path`, `text`) — пропускаются.
 */
export function parseStencilSvg(svgText) {
  if (!svgText) return []
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return []
  const out = []
  collectShapes(doc.documentElement, out)
  return out
}

/**
 * Проверка черновика перед сохранением. Чистая: занятые id приходят списком от
 * вызывающего. Каждая проблема помечена ПОЛЕМ (`id`/`label`/`category`/`shapes`/
 * `width`/`height`), чтобы инспектор подсветил его во время ввода.
 *
 * @returns {Array<{field: string, message: string}>} пусто — можно сохранять
 */
export function stencilDraftProblems(meta, shapes, existingIds = []) {
  const problems = []
  const add = (field, message) => problems.push({ field, message })
  const id = (meta.id || '').trim()
  if (!id) add('id', 'Укажи id')
  else if (!STENCIL_ID_RE.test(id)) add('id', 'id: только латиница в нижнем регистре, цифры и _')
  else if (existingIds.includes(id)) add('id', `id «${id}» уже занят`)
  if (!(meta.label || '').trim()) add('label', 'Укажи название')
  if (!(meta.category || '').trim()) add('category', 'Укажи категорию')
  if (!shapes?.length) add('shapes', 'Добавь хотя бы одну фигуру')
  // Слот и суффикс у текста со значением один, поэтому вторая такая подпись в схему
  // не уедет.
  if ((shapes || []).filter((s) => s.type === 'text' && s.valueText).length > 1) {
    add('shapes', 'Значение тега показывает только одна подпись')
  }
  // Обе метки на одной подписи: холст подставил бы параметр, рантайм — значение тега.
  if ((shapes || []).some((s) => s.valueText && s.param)) {
    add('shapes', 'Подпись со значением тега не может правиться на холсте')
  }
  // Кратность 5 = шаг сетки схемы (PORT_GRID в useStencilEditor); минимум 10.
  if (!(meta.width >= 10) || meta.width % 5 !== 0) add('width', 'Ширина кратна 5')
  if (!(meta.height >= 10) || meta.height % 5 !== 0) add('height', 'Высота кратна 5')
  return problems
}

/** Те же проблемы строками — для тоста на сохранении. */
export function stencilDraftIssues(meta, shapes, existingIds = []) {
  return stencilDraftProblems(meta, shapes, existingIds).map((p) => p.message)
}

// Карточка animationTemplate для состояния: элемент виден только в «своём»
// значении тега, т.е. получает animation-hidden на КАЖДОМ из чужих значений
// (hideOn). Булев режим: одно чужое значение (.true прячется на 'false'). Режим
// значения: перечисляем коды остальных состояний — на любом из них группа
// прячется, на своём (нет case) остаётся видимой. Обобщение той же механики.
function stateCard(idSuffix, tag, hideOn) {
  return {
    idSuffix,
    type: 'shape',
    bindings: [{ tag, when: { source: 'value', type: 'map', cases: hideCases(hideOn) } }],
    detailTags: [{ tag }],
  }
}

/** `cases` карточки состояния: группа прячется на каждом из перечисленных значений. */
export function hideCases(hideOn) {
  const cases = {}
  for (const v of Array.isArray(hideOn) ? hideOn : [hideOn]) {
    cases[String(v)] = { apply: { addClass: 'animation-hidden' } }
  }
  return cases
}

/**
 * Коды, на которых прячется группа состояния `key` в режиме «по значению»: коды
 * ОСТАЛЬНЫХ состояний. Состояние без кода рантайм не различает — в список не входит.
 * Одно правило на редактор и на патч проекта поверх набора: смена кода меняет карточки
 * соседей, и считать их надо одинаково.
 */
export function hideOnCodes(states, key) {
  return (states || [])
    .filter((s) => s.key !== key && s.code !== '' && s.code != null)
    .map((s) => s.code)
}

/**
 * Наибольший номер в именах портов вида `pN` — от него продолжается нумерация, если
 * в json нет `portSeq`. От количества считать нельзя: порты удаляются, и
 * `p{count+1}` совпал бы с живым портом.
 */
export function portSeqFrom(ports) {
  let max = 0
  for (const p of ports || []) {
    const n = Number.parseInt(String(p?.name || '').replace(/^p/, ''), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

/**
 * Модель → объект stencil.json. `ports` только непустыми (символ без портов валиден).
 * Анимация состояния при `stateful` — по режиму: булев (slot onoff + карточки
 * `.true`/`.false`) либо «по значению» (slot value + `states` + карточки `.<ключ>`).
 * `locked` не пишем: по умолчанию символ редактируем.
 */
export function buildStencilJson(meta, ports, shapes = []) {
  const json = {
    id: meta.id,
    label: meta.label,
    category: meta.category,
    shapeFile: 'shape.svg',
    width: meta.width,
    height: meta.height,
  }
  // Области применения — только известные ключи и только непустым списком.
  const domains = normalizeDomains(meta.domains)
  if (domains.length) json.domains = domains
  // Декл-флаги пишем только когда включены (json чище; отсутствие = false).
  // `static` в редакторе не задаётся (только у встроенных text/value в их json).
  if (meta.noRotate) json.noRotate = true
  if (meta.noFlip) json.noFlip = true
  if (meta.quality) json.quality = true
  if (ports?.length) {
    json.ports = ports.map((p) => ({ name: p.name, x: p.x, y: p.y }))
    // Счётчик выданных имён — часть данных символа: без него правка отдала бы имя
    // удалённого порта новому. Максимум из поля и фактических имён; ноль не пишем — у
    // символов с рукописными именами (`top`/`bottom`) он пустой и шумит в диффе.
    const seq = Math.max(meta.portSeq || 0, portSeqFrom(ports))
    if (seq) json.portSeq = seq
  }
  buildParams(json, shapes)
  buildValueTextSlot(json, shapes)
  buildRangeZones(json, meta)
  if (meta.stateful) {
    if (meta.stateMode === 'value') buildValueState(json, meta, shapes)
    else buildBooleanState(json, meta, shapes)
    // Цвета состояний (перекрас всего символа) — непустые, только для объявленных
    // состояний. Компактно: только контур → строка; есть заливка → объект
    // { stroke?, fill }. Заливку пишем лишь когда в символе есть заливаемые фигуры
    // (иначе fill-цвет некуда применить — маркера tms-state-fill нет).
    const keys =
      meta.stateMode === 'value' ? (meta.states || []).map((s) => s.key) : ['true', 'false']
    const canFill = (shapes || []).some(isFillableShape)
    const stateColors = {}
    for (const k of keys) {
      const { stroke, fill } = normalizeStateColor(meta.stateColors?.[k])
      const useFill = canFill ? fill : ''
      if (stroke && useFill) stateColors[k] = { stroke, fill: useFill }
      else if (useFill) stateColors[k] = { fill: useFill }
      else if (stroke) stateColors[k] = stroke
    }
    if (Object.keys(stateColors).length) json.stateColors = stateColors
  }
  return json
}

/**
 * Объявления подписей-параметров: ключ + текст из рисунка как значение по умолчанию
 * (он же подпись поля в инспекторе холста), в порядке фигур. Дубль ключа отбрасываем:
 * одно значение в двух подписях допустимо, объявление нужно одно.
 */
function buildParams(json, shapes) {
  const params = []
  for (const shape of shapes || []) {
    if (shape.type !== 'text' || !isValidParamKey(shape.param)) continue
    if (params.some((p) => p.key === shape.param)) continue
    params.push({ key: shape.param, default: shape.text || '' })
  }
  if (params.length) json.params = params
}

/** Ключ слота у текста, показывающего значение тега. */
const VALUE_TEXT_SLOT = 'value_text'

/**
 * Зоны диапазонов символа: границы и цвета едут полем `ranges`, тег привязывают на
 * холсте в слот `range`. Строки без цвета и без обеих границ не пишем — в анимацию они
 * всё равно не попадают. Карточки здесь нет: её собирает exporter из зон и тега слота,
 * тем же путём, что диапазоны провода.
 */
function buildRangeZones(json, meta) {
  const rows = cleanRangeRows(meta.ranges)
  if (!rows.length) return
  addSlot(json, { key: RANGE_SLOT, type: 'Value' })
  json.ranges = rows
}

/** Слоты складываются, а не перетираются: у символа их может быть несколько. */
function addSlot(json, slot) {
  if (!json.slots) json.slots = []
  if (!json.slots.some((s) => s.key === slot.key)) json.slots.push(slot)
}

/** Карточки — тоже: текст со значением и состояния живут в одном символе. */
function addCards(json, cards) {
  if (!cards?.length) return
  json.animationTemplate = [...(json.animationTemplate || []), ...cards]
}

/**
 * Текст, показывающий значение тега → слот + карточка `text`. Точность здесь не
 * пишется: она свойство привязки и живёт в `tms.decimals` ячейки (exporter
 * дописывает её в карточку).
 */
function buildValueTextSlot(json, shapes) {
  if (!(shapes || []).some((s) => s.type === 'text' && s.valueText)) return
  const tag = `{slot.${VALUE_TEXT_SLOT}}`
  addSlot(json, { key: VALUE_TEXT_SLOT, type: 'Text' })
  addCards(json, [
    {
      idSuffix: VALUE_TEXT_SUFFIX,
      type: 'text',
      bindings: [{ tag, output: { text: {} } }],
      detailTags: [{ tag }],
    },
  ])
}

// Булев режим (частный случай): слот onoff + карточки `.true`/`.false`, каждая
// прячется на противоположном значении. Пишем только при наличии таких фигур.
function buildBooleanState(json, meta, shapes) {
  const states = new Set(
    (shapes || []).map((s) => s.state).filter((st) => st === 'true' || st === 'false')
  )
  // Слот пишется при ВКЛЮЧЁННОЙ анимации всегда, даже без state-фигур и цветов: он и
  // есть признак режима (по нему `loadStencil` его восстанавливает), а на холсте — точка
  // привязки тега. Карточки добавляются только там, где есть что прятать.
  const key = meta.stateSlot?.key || 'onoff'
  const tag = `{slot.${key}}`
  addSlot(json, { key, type: 'Boolean' })
  const cards = []
  if (states.has('true')) cards.push(stateCard('.true', tag, ['false']))
  if (states.has('false')) cards.push(stateCard('.false', tag, ['true']))
  addCards(json, cards)
}

// Режим «по значению»: слот value + список состояний (states — редакторные
// подписи/коды для round-trip, рантайм игнорит) + по карточке на каждое состояние
// С ФИГУРАМИ (прячется на кодах остальных). Слот — признак режима, поэтому пишется
// всегда; `states` — при объявленных состояниях, карточки — когда есть что анимировать.
// Смена кода → другой список cases, суффиксы/фигуры не трогаются.
function buildValueState(json, meta, shapes) {
  const declared = meta.states || []
  const key = meta.stateSlot?.key || 'value'
  const tag = `{slot.${key}}`
  addSlot(json, { key, type: 'Value' })
  if (!declared.length) return
  json.states = declared.map((s) => ({ key: s.key, label: s.label || '', code: s.code ?? '' }))
  const shapeStates = new Set((shapes || []).map((s) => s.state).filter(Boolean))
  const cards = declared
    .filter((s) => shapeStates.has(s.key))
    .map((st) => stateCard(`.${st.key}`, tag, hideOnCodes(declared, st.key)))
  addCards(json, cards)
}
