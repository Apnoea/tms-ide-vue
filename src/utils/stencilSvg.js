/**
 * Сериализация модели редактора стенсилов в артефакты формата проекта:
 *   • serializeSvg(shapes, meta) → строка shape.svg (viewBox 0 0 W H)
 *   • buildStencilJson(meta, ports) → объект stencil.json
 *
 * Чистые функции без side-effect'ов и без обращения к DOM: модель у нас своя
 * (массив примитивов + порты), поэтому выход валиден и чист по построению —
 * никакого парсинга/санитайза чужого SVG не требуется. Координаты в модели уже
 * в системе стенсила (0..W, 0..H) и снапнуты к сетке, здесь только рендер.
 *
 * Поддерживаемые примитивы: rect, line, circle, polyline. Внутренняя анимация
 * состояния: фигуры группируются по state в <g data-anim-suffix=".<ключ>">, из
 * них же строится animationTemplate. Ключи — либо булевы (true/false), либо
 * произвольные состояния «по значению» (см. meta.stateMode / meta.states).
 */

import { ATTR_SUFFIX } from '../constants/ids'

// Числа в атрибутах — без хвостовых нулей и float-мусора (модель снапнута к
// сетке, но масштаб/дробный шаг могут дать 12.5 → оставляем как есть, а 12.0 → 12).
function num(v) {
  return Number.parseFloat(Number(v).toFixed(3)).toString()
}

// Обводка есть у всех примитивов; fill — только у замкнутых (rect/circle/polyline),
// по умолчанию none (SCADA-символы — контурные). У линии заливки нет.
function strokeAttrs(shape) {
  return `stroke="${shape.stroke || '#000'}" stroke-width="${num(shape.strokeWidth ?? 2)}"`
}
function fillAttr(shape) {
  return `fill="${shape.fill || 'none'}"`
}

// Радиус скругления углов прямоугольника (в user-единицах) при shape.rounded.
export const ROUND_RX = 2

// Опциональное скругление (тумблер в редакторе): у линии/ломаной — круглые торцы
// и стыки, у прямоугольника — скруглённые углы (rx). У круга скруглять нечего.
function roundingAttrs(shape) {
  if (!shape.rounded) return ''
  if (shape.type === 'rect') return ` rx="${num(ROUND_RX)}"`
  if (shape.type === 'line') return ' stroke-linecap="round"'
  if (shape.type === 'polyline') return ' stroke-linecap="round" stroke-linejoin="round"'
  return ''
}

function serializeShape(shape) {
  switch (shape.type) {
    case 'rect':
      return (
        `<rect x="${num(shape.x)}" y="${num(shape.y)}" ` +
        `width="${num(shape.w)}" height="${num(shape.h)}" ` +
        `${fillAttr(shape)} ${strokeAttrs(shape)}${roundingAttrs(shape)}/>`
      )
    case 'line':
      return (
        `<line x1="${num(shape.x1)}" y1="${num(shape.y1)}" ` +
        `x2="${num(shape.x2)}" y2="${num(shape.y2)}" ${strokeAttrs(shape)}${roundingAttrs(shape)}/>`
      )
    case 'circle':
      return (
        `<circle cx="${num(shape.cx)}" cy="${num(shape.cy)}" r="${num(shape.r)}" ` +
        `${fillAttr(shape)} ${strokeAttrs(shape)}${roundingAttrs(shape)}/>`
      )
    case 'polyline': {
      const pts = (shape.points || []).map(([x, y]) => `${num(x)},${num(y)}`).join(' ')
      // Замкнутая ломаная — это <polygon> (сам соединяет конец с началом).
      const tag = shape.closed ? 'polygon' : 'polyline'
      return `<${tag} points="${pts}" ${fillAttr(shape)} ${strokeAttrs(shape)}${roundingAttrs(shape)}/>`
    }
    default:
      return ''
  }
}

// Сдвиг всех координат фигуры на (dx, dy). Возвращает новый объект.
function translateShape(s, dx, dy) {
  if (s.type === 'rect') return { ...s, x: s.x + dx, y: s.y + dy }
  if (s.type === 'line') return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
  if (s.type === 'circle') return { ...s, cx: s.cx + dx, cy: s.cy + dy }
  if (s.type === 'polyline') return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy]) }
  return s
}

/**
 * Обрезка пустых полей: считаем bbox фигур + портов, расширяем до кратных grid
 * границ (min — вниз, max — вверх, чтобы контент не срезался), сдвигаем всё в
 * (0,0). Итоговый стенсил = ровно контент, размеры кратны grid. Обводку в bbox
 * не учитываем — как в рукописных стенсилах (rect x=0 со stroke срезается вьюбоксом).
 *
 * @returns {{shapes:Array, ports:Array, width:number, height:number}}
 */
export function cropToContent(shapes, ports = [], grid = 10) {
  if (!shapes?.length) return { shapes: shapes || [], ports: ports || [], width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const acc = (x, y) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const s of shapes) {
    if (s.type === 'rect') {
      acc(s.x, s.y)
      acc(s.x + s.w, s.y + s.h)
    } else if (s.type === 'line') {
      acc(s.x1, s.y1)
      acc(s.x2, s.y2)
    } else if (s.type === 'circle') {
      acc(s.cx - s.r, s.cy - s.r)
      acc(s.cx + s.r, s.cy + s.r)
    } else if (s.type === 'polyline') {
      for (const [x, y] of s.points) acc(x, y)
    }
  }
  for (const p of ports) acc(p.x, p.y)

  const x0 = Math.floor(minX / grid) * grid
  const y0 = Math.floor(minY / grid) * grid
  const x1 = Math.ceil(maxX / grid) * grid
  const y1 = Math.ceil(maxY / grid) * grid
  const dx = -x0
  const dy = -y0
  return {
    shapes: shapes.map((s) => translateShape(s, dx, dy)),
    ports: ports.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    width: Math.max(grid, x1 - x0),
    height: Math.max(grid, y1 - y0),
  }
}

/**
 * Модель → строка shape.svg. viewBox/width/height берём из meta (кратны 10).
 * Фигуры оборачиваем в `<g>` — единый формат с рукописными стенсилами (у них
 * всё в группе); на группу состояния вешается data-anim-suffix.
 */
// Тело группы: сериализованные фигуры с отступом (пустая строка, если фигур нет).
function groupBody(shapes) {
  return (shapes || [])
    .map(serializeShape)
    .filter(Boolean)
    .map((el) => `    ${el}`)
    .join('\n')
}

// Порядок и набор состояний-групп. Булев режим — фикс. `true`,`false` (частный
// случай); режим значения — ключи из meta.states (порядок как задал автор).
function stateKeys(meta) {
  return meta?.stateMode === 'value' ? (meta.states || []).map((s) => s.key) : ['true', 'false']
}

export function serializeSvg(shapes, meta) {
  const w = num(meta.width)
  const h = num(meta.height)
  const all = shapes || []
  let groups
  if (meta?.stateful) {
    // Внутренняя анимация: статику — в базовую группу, каждое состояние — в свой
    // <g data-anim-suffix=".<ключ>"> (рантайм вешает animation-hidden, когда
    // значение тега не совпадает). Порядок: база → состояния (анимируемое поверх).
    const base = groupBody(all.filter((s) => (s.state || 'always') === 'always'))
    groups = base ? `  <g>\n${base}\n  </g>\n` : '  <g></g>\n'
    for (const key of stateKeys(meta)) {
      const body = groupBody(all.filter((s) => s.state === key))
      if (body) groups += `  <g ${ATTR_SUFFIX}=".${key}">\n${body}\n  </g>\n`
    }
  } else {
    const body = groupBody(all)
    groups = body ? `  <g>\n${body}\n  </g>\n` : '  <g></g>\n'
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
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

function elementToShape(el) {
  const n = (a) => Number.parseFloat(el.getAttribute(a))
  const fill = el.getAttribute('fill') || 'none'
  switch (el.tagName.toLowerCase()) {
    case 'rect':
      return {
        type: 'rect',
        x: n('x'),
        y: n('y'),
        w: n('width'),
        h: n('height'),
        fill,
        ...readStroke(el),
      }
    case 'line':
      return { type: 'line', x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2'), ...readStroke(el) }
    case 'circle':
      return { type: 'circle', cx: n('cx'), cy: n('cy'), r: n('r'), fill, ...readStroke(el) }
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
    default:
      return null
  }
}

// Собирает фигуры рекурсивно: заходит внутрь `<g>` (наш формат и рукописные
// стенсилы держат примитивы в группе). Порядок — DFS в порядке документа.
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
      // state пишем только для непустого состояния; always — дефолт (поле не
      // заводим, чтобы статика парсилась байт-в-байт и round-trip не разъезжался).
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

// id стенсила = имя папки в definitions/, поэтому та же маска, что у dev-плагина
// (анти-traversal): только латиница в нижнем регистре, цифры и подчёркивание.
const STENCIL_ID_RE = /^[a-z0-9_]+$/

/**
 * Проверка черновика перед сохранением. Чистая: uniqueness сверяем по
 * переданному списку существующих id (реестр знает caller). Возвращает массив
 * человекочитаемых проблем; пустой — можно сохранять.
 */
export function stencilDraftIssues(meta, shapes, existingIds = []) {
  const issues = []
  const id = (meta.id || '').trim()
  if (!id) issues.push('Укажите id')
  else if (!STENCIL_ID_RE.test(id)) issues.push('id: только латиница в нижнем регистре, цифры и _')
  else if (existingIds.includes(id)) issues.push(`id «${id}» уже занят`)
  if (!(meta.label || '').trim()) issues.push('Укажите название')
  if (!(meta.category || '').trim()) issues.push('Укажите категорию')
  if (!shapes?.length) issues.push('Добавьте хотя бы одну фигуру')
  if (!(meta.width >= 10) || meta.width % 10 !== 0) issues.push('Ширина кратна 10')
  if (!(meta.height >= 10) || meta.height % 10 !== 0) issues.push('Высота кратна 10')
  return issues
}

// Карточка animationTemplate для состояния: элемент виден только в «своём»
// значении тега, т.е. получает animation-hidden на КАЖДОМ из чужих значений
// (hideOn). Булев режим: одно чужое значение (.true прячется на 'false'). Режим
// значения: перечисляем коды остальных состояний — на любом из них группа
// прячется, на своём (нет case) остаётся видимой. Обобщение той же механики.
function stateCard(idSuffix, tag, hideOn) {
  const list = Array.isArray(hideOn) ? hideOn : [hideOn]
  const cases = {}
  for (const v of list) cases[String(v)] = { apply: { addClass: 'animation-hidden' } }
  return {
    idSuffix,
    type: 'shape',
    bindings: [{ tag, when: { source: 'value', type: 'map', cases } }],
    detailTags: [{ tag }],
  }
}

/**
 * Модель → объект stencil.json. ports включаем только непустыми — стенсил без
 * портов валиден (декор). Анимация состояния (при `stateful`) — по режиму:
 * булев (slot onoff + карточки `.true`/`.false`) либо «по значению» (slot value +
 * `states` + карточки `.<ключ>`), см. buildBooleanState/buildValueState. Иначе
 * стенсил статичен (разреженный json). Метку редактируемости НЕ пишем: по
 * умолчанию редактируем/удаляем, нередактируемые — `locked: true` в definitions.
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
  // Декл-флаги пишем только когда включены (json чище; отсутствие = false).
  // `static` в редакторе не задаётся (только у встроенных text/value в их json).
  if (meta.noRotate) json.noRotate = true
  if (meta.quality) json.quality = true
  if (ports?.length) {
    json.ports = ports.map((p) => ({ name: p.name, x: p.x, y: p.y }))
  }
  if (meta.stateful) {
    if (meta.stateMode === 'value') buildValueState(json, meta, shapes)
    else buildBooleanState(json, meta, shapes)
    // Цвета состояний (перекрас всего символа) — непустые, только для объявленных
    // состояний. Рантайм-биндинг и CSS строит exporter по этому полю + slots/states.
    const keys =
      meta.stateMode === 'value' ? (meta.states || []).map((s) => s.key) : ['true', 'false']
    const stateColors = {}
    for (const k of keys) {
      const c = meta.stateColors?.[k]
      if (c) stateColors[k] = c
    }
    if (Object.keys(stateColors).length) json.stateColors = stateColors
  }
  return json
}

// Булев режим (частный случай): слот onoff + карточки `.true`/`.false`, каждая
// прячется на противоположном значении. Пишем только при наличии таких фигур.
function buildBooleanState(json, meta, shapes) {
  const states = new Set(
    (shapes || []).map((s) => s.state).filter((st) => st === 'true' || st === 'false')
  )
  // Слот нужен и без state-фигур, если задан цвет состояния (символ реагирует на
  // тег только перекраской) — иначе тег некуда привязать и цвет ничем не драйвится.
  const hasColor = !!(meta.stateColors?.true || meta.stateColors?.false)
  if (!states.size && !hasColor) return
  const key = meta.stateSlot?.key || 'onoff'
  const tag = `{slot.${key}}`
  json.slots = [{ key, type: 'Boolean' }]
  const cards = []
  if (states.has('true')) cards.push(stateCard('.true', tag, ['false']))
  if (states.has('false')) cards.push(stateCard('.false', tag, ['true']))
  if (cards.length) json.animationTemplate = cards
}

// Режим «по значению»: слот value + список состояний (states — редакторные
// подписи/коды для round-trip, рантайм игнорит) + по карточке на каждое состояние
// С ФИГУРАМИ (прячется на кодах остальных). Слот/states пишем при любых
// объявленных состояниях (чтобы канвас мог привязать тег), карточки — только когда
// есть что анимировать. Смена кода → другой список cases, суффиксы/фигуры не трогаются.
function buildValueState(json, meta, shapes) {
  const declared = meta.states || []
  if (!declared.length) return
  const key = meta.stateSlot?.key || 'value'
  const tag = `{slot.${key}}`
  json.slots = [{ key, type: 'Value' }]
  json.states = declared.map((s) => ({ key: s.key, label: s.label || '', code: s.code ?? '' }))
  const shapeStates = new Set((shapes || []).map((s) => s.state).filter(Boolean))
  const coded = declared.filter((s) => s.code !== '' && s.code != null)
  const cards = declared
    .filter((s) => shapeStates.has(s.key))
    .map((st) =>
      stateCard(
        `.${st.key}`,
        tag,
        coded.filter((o) => o.key !== st.key).map((o) => o.code)
      )
    )
  if (cards.length) json.animationTemplate = cards
}
