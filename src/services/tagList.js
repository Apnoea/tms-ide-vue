/** Тип тега из tag-list булев (Boolean/Bool/…). */
export const isBooleanType = (type) => /^bool/i.test(type || '')

/**
 * Типы, которые числом не сравнить: булевы, текстовые, бинарные, дата-время. Перечень
 * названий у SCADA свой, поэтому список ОТСЕИВАЮЩИЙ — незнакомый тип считается
 * числовым и остаётся доступен: спрятать нужный тег хуже, чем показать лишний.
 */
const NON_NUMERIC_TYPE_RE =
  /^(bool|str|text|char|bytearray|byte\s*array|blob|binary|guid|uuid|date|time)/i

/** Тип годится для порогов диапазонов (сравнение с min/max). */
export const isNumericType = (type) => !NON_NUMERIC_TYPE_RE.test((type || '').trim())

/**
 * Tag-list в формате XML-дерева — узнаём по первому непробельному символу: строчный
 * список с `<` не начинается. Формат нужен и упаковщику архива (имя файла внутри),
 * поэтому признак один на весь проект.
 */
export const isXmlTagList = (text) => /^\s*</.test(text || '')

/**
 * Tag-list проекта → `[{ name, type, description?, param?, origin?, path? }]`.
 * Обязательны только `name` и `type` — на них стоят пикеры и фильтр булевых.
 *
 * Форматов два, и различает их сам разбор: строчный (`TAG=Type;…`) и XML-дерево
 * объектов от SCADA. Точка входа одна, потому что через неё идут и загрузка файла, и
 * подъём сохранённого текста из IDB.
 */
export function parseTagList(text) {
  return isXmlTagList(text) ? parseTagTreeXml(text) : parseFlatTagList(text)
}

/**
 * Строчный формат: "TAG.NAME=Type;...". Пустые строки и комментарии (#) пропускаются —
 * в заголовке файла обычно пояснение формата.
 */
function parseFlatTagList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const [left, right] = line.split('=')
      const [type] = right.split(';')
      return { name: left.trim(), type: type.trim() }
    })
}

/**
 * XML-дерево SCADA: `<Object>` вкладываются произвольно, `<Tag>` лежат в объектах.
 *
 * ```xml
 * <Root><Object name="S17"><Object name="N70160">
 *   <Tag name="S17N70160Tag1" paramName="Tag1" description="…" type="Boolean" origin="in"/>
 * </Object></Object></Root>
 * ```
 *
 * Тег адресуется ПОЛНЫМ `name` — оно и есть тег для рантайма; `paramName` (имя внутри
 * объекта) и путь объектов идут рядом, для группировки и поиска в пикере. Имя тега
 * уникально: повтор — это два разных сигнала под одним адресом, и второй отбрасывается,
 * иначе привязка стала бы неоднозначной.
 *
 * Битый XML → пустой список: вызывающий скажет «файл не содержит валидных тегов».
 */
function parseTagTreeXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) return []
  const out = []
  const seen = new Set()

  const walk = (node, path) => {
    for (const child of node.children) {
      const tag = child.tagName
      const name = child.getAttribute('name') || ''
      if (tag === 'Tag') {
        if (!name || seen.has(name)) continue
        seen.add(name)
        const entry = { name, type: child.getAttribute('type') || '' }
        const description = child.getAttribute('description')
        const param = child.getAttribute('paramName')
        const origin = child.getAttribute('origin')
        if (description) entry.description = description
        if (param) entry.param = param
        if (origin) entry.origin = origin
        if (path.length) entry.path = [...path]
        out.push(entry)
      } else if (tag === 'Object') {
        // Объект без имени структуру не задаёт, но детей у него забирать нужно.
        walk(child, name ? [...path, name] : path)
      }
    }
  }

  walk(doc.documentElement, [])
  return out
}
