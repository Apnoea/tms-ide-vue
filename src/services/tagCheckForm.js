// Форма проверки тегов: на каждый тег tag-list — символ «Проверка тега» с привязкой.
// Нужна для проверки сигналов при наладке: выгрузил, выложил — и в рантайме видно, что
// приходит по каждому тегу (у булевых — цветом индикатора, у всех — значением текстом).
// Здесь только раскладка и сборка графа формы; создание формы — useForms.

import { createCanvasGraph } from '../stencils/canvasPaper'
import { materializeStencil } from '../stencils/svgInjector'
import { materializeShape } from '../stencils/shapeElement'
import { stateSlotOf, textSlotOf } from '../stencils/registry'
import { groupTags, isBooleanType } from './tagList'
import { nplural } from '../utils/plural'

/** Символ строки и id формы: повторный запуск строит эту же форму заново. */
export const TAG_CHECK_STENCIL_ID = 'cell_tag'
export const TAG_CHECK_FORM_ID = 'tag_check'
export const TAG_CHECK_TITLE = 'Проверка тегов'

// Строк в столбце: длинный tag-list растёт вправо, а не уходит на тысячи пикселей вниз.
const ROWS_PER_COLUMN = 40
// Шаг строки = высота символа (20): строки встык, как таблица. Кратно сетке.
const ROW = 20
const COLUMN_GAP = 40
const HEADER_FONT_SIZE = 12

/**
 * Описание формы — в поле «Описание» и в `description` узла `nav.json`, то есть видно и
 * в рантайме: поэтому без указаний на кнопки IDE. Дата сборки — чтобы было видно, свежая
 * ли форма относительно tag-list.
 */
export function tagCheckDescription(count, date = new Date()) {
  const tags = nplural(count, 'тег', 'тега', 'тегов')
  return (
    `Символ на каждый тег tag-list (${tags}) — проверка сигналов. ` +
    `Собрана автоматически ${date.toLocaleDateString('ru-RU')}`
  )
}

/**
 * Раскладка: группы tag-list подряд, как в окне выбора тега, у группы — заголовок строкой
 * выше. Группа с заголовком отбивается пустой строкой с обеих сторон: иначе одиночный тег
 * без заголовка (`solo`) после неё читался бы её частью, а подряд одиночные идут встык.
 * Столбцы по ROWS_PER_COLUMN строк; заголовок не остаётся последней строкой столбца —
 * переносится к своим тегам.
 *
 * @param {{ name: string, type: string, path?: string[] }[]} tags
 * @param {number} width — ширина символа строки
 * @returns {{ rows: {tag: object, x: number, y: number}[], headers: {text: string, x: number, y: number}[] }}
 *   x, y — левый верхний угол строки
 */
export function layoutTagCheck(tags, width) {
  const rows = []
  const headers = []
  let col = 0
  let line = 0
  const at = () => ({ x: col * (width + COLUMN_GAP), y: line * ROW })
  const nextColumn = () => {
    col += 1
    line = 0
  }
  const advance = () => {
    line += 1
    if (line >= ROWS_PER_COLUMN) nextColumn()
  }
  let prevHeaded = false
  for (const group of groupTags(tags)) {
    const headed = !group.solo
    if (line > 0 && (headed || prevHeaded)) advance() // пустая строка между группами
    if (headed) {
      if (line >= ROWS_PER_COLUMN - 1) nextColumn()
      headers.push({ text: group.name, ...at() })
      advance()
    }
    for (const tag of group.items) {
      rows.push({ tag, ...at() })
      advance()
    }
    prevHeaded = headed
  }
  return { rows, headers }
}

/**
 * Граф формы проверки тегов (JSON для стора форм). Строится на теневом графе: живой
 * холст держит открытую форму. Тег привязывается к подписи значения у любого тега, к
 * индикатору — только у булевых; слоты берутся из определения символа, чтобы правка
 * символа в редакторе генератор не ломала.
 *
 * @param {object[]} tags — tag-list проекта
 * @param {object} stencil — определение «Проверки тега» из реестра
 */
export function buildTagCheckGraph(tags, stencil) {
  const graph = createCanvasGraph()
  const stateKey = stateSlotOf(stencil.slots)?.key
  const textKey = textSlotOf(stencil.slots)?.key
  const paramKey = stencil.params?.[0]?.key
  const size = { width: stencil.width, height: stencil.height }
  const { rows, headers } = layoutTagCheck(tags, stencil.width)

  for (const h of headers) {
    // y подписи — базовая линия: текст стоит в своей строке, как имена тегов в символе.
    const shape = { type: 'text', x: h.x, y: h.y + 14, text: h.text, align: 'left' }
    materializeShape(graph, null, { ...shape, fontSize: HEADER_FONT_SIZE, bold: true })
  }
  for (const { tag, x, y } of rows) {
    const slots = {}
    if (textKey) slots[textKey] = tag.name
    if (stateKey && isBooleanType(tag.type)) slots[stateKey] = tag.name
    const tms = { stencilId: stencil.id, slots }
    if (paramKey) tms.params = { [paramKey]: tag.name }
    materializeStencil(graph, null, stencil, { position: { x, y }, size, tms })
  }
  return graph.toJSON()
}
