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
