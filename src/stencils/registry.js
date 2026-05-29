/**
 * Stencil registry
 * ────────────────
 *
 * Собирает все определения стенсилов из src/stencils/definitions/<id>/ через
 * Vite glob imports (eager). Каждый стенсил состоит из двух файлов:
 *   • stencil.json   — метаданные + animationTemplate
 *   • shape.svg      — SVG-разметка с data-anim-suffix-атрибутами
 *
 * Регистрация автоматическая — добавили папку, файл подхватился.
 *
 * Публичное API:
 *   getAllStencils()         — массив всех стенсилов
 *   getStencilById(id)       — один стенсил по id или undefined
 *   getCategories()          — список уникальных категорий
 */

const jsonModules = import.meta.glob(
  './definitions/*/stencil.json',
  { eager: true, import: 'default' }
)

const svgModules = import.meta.glob(
  './definitions/*/shape.svg',
  { eager: true, query: '?raw', import: 'default' }
)

/**
 * Минимальная schema-валидация stencil.json. Возвращает массив проблем
 * (строки) — pure-функция, без side-effect'ов. Caller сам решает что делать
 * (логировать в console, бросать ошибку и т.п.). Защищает от опечаток
 * (`slts` вместо `slots`), пропусков required-полей и неправильных структур.
 *
 * Не блокирует загрузку — реестр всё равно подхватит стенсил, но юзер увидит
 * предупреждения в console (см. init code ниже).
 *
 * @param {string} path  Путь к stencil.json (для prefix'а сообщений)
 * @param {object} json  Содержимое stencil.json
 * @returns {string[]}   Массив строк-предупреждений, пустой если всё ок
 */
export function validateStencilJson(path, json) {
  const issues = []

  const required = ['id', 'label', 'category', 'version', 'width', 'height', 'shapeFile']
  for (const key of required) {
    if (json[key] === undefined || json[key] === null) {
      issues.push(`[stencils] ${path}: отсутствует поле "${key}"`)
    }
  }

  // Известные поля верхнего уровня. Опечатки типа `slts` / `slosts` вылавливаем.
  const known = new Set([
    'id', 'label', 'category', 'version',
    'width', 'height', 'minWidth', 'resizable',
    'shapeFile', 'ports', 'slots', 'animationTemplate',
    'defaultText'  // cell_text-only
  ])
  for (const key of Object.keys(json)) {
    if (!known.has(key)) {
      issues.push(`[stencils] ${path}: неизвестное поле "${key}" (опечатка?)`)
    }
  }

  // Слоты — все должны иметь key и label
  if (Array.isArray(json.slots)) {
    for (const [i, slot] of json.slots.entries()) {
      if (!slot.key) issues.push(`[stencils] ${path}: slots[${i}] без "key"`)
      if (!slot.label) issues.push(`[stencils] ${path}: slots[${i}] без "label"`)
    }
  }

  // animationTemplate — каждая карточка должна иметь idSuffix и type
  if (Array.isArray(json.animationTemplate)) {
    for (const [i, tpl] of json.animationTemplate.entries()) {
      if (tpl.idSuffix === undefined) {
        issues.push(`[stencils] ${path}: animationTemplate[${i}] без "idSuffix"`)
      }
      if (!tpl.type) {
        issues.push(`[stencils] ${path}: animationTemplate[${i}] без "type"`)
      }
    }
  }

  return issues
}

/**
 * Собранный реестр: id → объект стенсила со встроенным svgText.
 */
const registry = (() => {
  const out = new Map()

  for (const [path, json] of Object.entries(jsonModules)) {
    const folderMatch = path.match(/\/definitions\/([^/]+)\/stencil\.json$/)
    if (!folderMatch) continue
    const folder = folderMatch[1]

    if (!json?.id) {
      console.warn(`[stencils] Пропускаю ${path}: отсутствует поле "id"`)
      continue
    }

    for (const issue of validateStencilJson(path, json)) console.warn(issue)

    const svgPath = path.replace('/stencil.json', '/shape.svg')
    const svgText = svgModules[svgPath]

    if (!svgText) {
      console.warn(`[stencils] У стенсила "${json.id}" не найден shape.svg по пути ${svgPath}`)
    }

    out.set(json.id, {
      ...json,
      _folder: folder,
      svgText: svgText || '',
    })
  }

  return out
})()

export function getAllStencils() {
  return Array.from(registry.values())
}

export function getStencilById(id) {
  return registry.get(id)
}

export function getCategories() {
  const cats = new Set()
  for (const stencil of registry.values()) cats.add(stencil.category)
  return Array.from(cats)
}
