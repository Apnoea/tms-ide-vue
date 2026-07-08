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
 * (булево состояние): фигуры группируются по state (always/on/off) в
 * <g data-anim-suffix>, из них же строится animationTemplate.
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

function serializeShape(shape) {
  switch (shape.type) {
    case 'rect':
      return (
        `<rect x="${num(shape.x)}" y="${num(shape.y)}" ` +
        `width="${num(shape.w)}" height="${num(shape.h)}" ` +
        `${fillAttr(shape)} ${strokeAttrs(shape)}/>`
      )
    case 'line':
      return (
        `<line x1="${num(shape.x1)}" y1="${num(shape.y1)}" ` +
        `x2="${num(shape.x2)}" y2="${num(shape.y2)}" ${strokeAttrs(shape)}/>`
      )
    case 'circle':
      return (
        `<circle cx="${num(shape.cx)}" cy="${num(shape.cy)}" r="${num(shape.r)}" ` +
        `${fillAttr(shape)} ${strokeAttrs(shape)}/>`
      )
    case 'polyline': {
      const pts = (shape.points || []).map(([x, y]) => `${num(x)},${num(y)}`).join(' ')
      // Замкнутая ломаная — это <polygon> (сам соединяет конец с началом).
      const tag = shape.closed ? 'polygon' : 'polyline'
      return `<${tag} points="${pts}" ${fillAttr(shape)} ${strokeAttrs(shape)}/>`
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
 * всё в группе) и задел под v2-анимацию (там на группу вешается data-anim-suffix).
 */
// Тело группы: сериализованные фигуры с отступом (пустая строка, если фигур нет).
function groupBody(shapes) {
  return (shapes || [])
    .map(serializeShape)
    .filter(Boolean)
    .map((el) => `    ${el}`)
    .join('\n')
}

export function serializeSvg(shapes, meta) {
  const w = num(meta.width)
  const h = num(meta.height)
  const all = shapes || []
  let groups
  if (meta?.stateful) {
    // Внутренняя анимация: статику — в базовую группу, true/false — каждое в свой
    // <g data-anim-suffix> (рантайм вешает animation-hidden на противоположное
    // значение тега). Суффикс = значение тега, при котором элемент виден. Порядок:
    // база → .true → .false (анимируемое поверх статики).
    const base = groupBody(all.filter((s) => (s.state || 'always') === 'always'))
    const onTrue = groupBody(all.filter((s) => s.state === 'true'))
    const onFalse = groupBody(all.filter((s) => s.state === 'false'))
    groups = base ? `  <g>\n${base}\n  </g>\n` : '  <g></g>\n'
    if (onTrue) groups += `  <g ${ATTR_SUFFIX}=".true">\n${onTrue}\n  </g>\n`
    if (onFalse) groups += `  <g ${ATTR_SUFFIX}=".false">\n${onFalse}\n  </g>\n`
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
      // Суффикс состояния = значение тега (.true/.false) → state фигуры; прочие
      // суффиксы редактор не моделит — наследуем родительское (по умолчанию always).
      const suffix = el.getAttribute(ATTR_SUFFIX)
      const childState = suffix === '.true' ? 'true' : suffix === '.false' ? 'false' : state
      collectShapes(el, out, childState)
      continue
    }
    const shape = elementToShape(el)
    // state пишем только для true/false; always — дефолт (поле не заводим, чтобы
    // статика парсилась байт-в-байт как раньше и round-trip'ы не разъезжались).
    if (shape) out.push(state === 'always' ? shape : { ...shape, state })
  }
}

/**
 * Обратный парсинг shape.svg → массив примитивов модели (инверсия serializeSvg).
 * Рекурсит в `<g>`, поэтому читает и наш формат (фигуры в группе), и плоский
 * legacy, и статические рукописные (tv2/tv3). `data-anim-suffix=".on"/".off"` на
 * группе → state фигуры (внутренняя анимация); прочие суффиксы/атрибуты групп
 * (`transform`) и незнакомые элементы (`path`, `text`) — пропускаются.
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
// значении тега, т.е. получает animation-hidden на противоположном (hideOn).
function stateCard(idSuffix, tag, hideOn) {
  return {
    idSuffix,
    type: 'shape',
    bindings: [
      {
        tag,
        when: {
          source: 'value',
          type: 'map',
          cases: { [hideOn]: { apply: { addClass: 'animation-hidden' } } },
        },
      },
    ],
    detailTags: [{ tag }],
  }
}

/**
 * Модель → объект stencil.json. ports включаем только непустыми — стенсил без
 * портов валиден (декор). slots/animationTemplate — только при включённом
 * `stateful` И наличии true/false-фигур (слот без реагирующих элементов бессмыслен):
 * булев слот-драйвер + карточки видимости `.true`/`.false`. Иначе стенсил статичен
 * (разреженный json — как у рукописных). Метку редактируемости НЕ пишем:
 * по умолчанию редактируем/удаляем, нередактируемые — `locked: true` в definitions.
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
  if (meta.noRotate) json.noRotate = true
  if (meta.layoutOnly) json.layoutOnly = true
  if (meta.quality) json.quality = true
  if (ports?.length) {
    json.ports = ports.map((p) => ({ name: p.name, x: p.x, y: p.y }))
  }
  if (meta.stateful) {
    const states = new Set(
      (shapes || []).map((s) => s.state).filter((st) => st === 'true' || st === 'false')
    )
    if (states.size) {
      const key = meta.stateSlot?.key || 'onoff'
      const tag = `{slot.${key}}`
      // label не пишем: редакторная подпись (SwitchBlock даёт фолбэк), не рантайм.
      json.slots = [{ key, type: 'Boolean', required: false }]
      json.animationTemplate = []
      // Суффикс = значение тега, при котором виден; скрываем на противоположном.
      if (states.has('true')) json.animationTemplate.push(stateCard('.true', tag, 'false'))
      if (states.has('false')) json.animationTemplate.push(stateCard('.false', tag, 'true'))
    }
  }
  return json
}
