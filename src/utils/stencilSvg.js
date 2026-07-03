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
 * Поддерживаемые примитивы (v1, статика): rect, line, circle, polyline.
 */

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
      return `<polyline points="${pts}" ${fillAttr(shape)} ${strokeAttrs(shape)}/>`
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
 * Формат совпадает с рукописными определениями: xml-декларация, 2-space отступ.
 */
export function serializeSvg(shapes, meta) {
  const w = num(meta.width)
  const h = num(meta.height)
  const body = (shapes || [])
    .map(serializeShape)
    .filter(Boolean)
    .map((el) => `  ${el}`)
    .join('\n')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n` +
    `${body}\n` +
    '</svg>\n'
  )
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

/**
 * Модель → объект stencil.json (v1: статика, без slots/animationTemplate).
 * ports включаем только непустыми — стенсил без портов валиден (декор).
 * `userCreated: true` — метка «нарисован в редакторе» (не из репозитория):
 * палитра по ней показывает кнопку удаления только у пользовательских стенсилов,
 * родные (в definitions/ без метки) удалить нельзя. Метка переживает reload.
 */
export function buildStencilJson(meta, ports) {
  const json = {
    id: meta.id,
    label: meta.label,
    category: meta.category,
    shapeFile: 'shape.svg',
    width: meta.width,
    height: meta.height,
    userCreated: true,
  }
  if (ports?.length) {
    json.ports = ports.map((p) => ({ name: p.name, x: p.x, y: p.y }))
  }
  return json
}
