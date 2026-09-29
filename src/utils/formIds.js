import { FORM_ID_RE, FORM_ID_MAX, safeFormId } from '../constants/ids'

/**
 * Название и описание формы (нормализация) и имена форм чужого архива → безопасные id
 * (маска — `FORM_ID_RE` в constants/ids) + перенос всего, что этими id адресуется:
 * навигация, иерархия, фон, название и описание. Формы переименовываются, а не
 * отбрасываются.
 */

/** Предел длины названия формы: это подпись в дереве и заголовке окна, а не абзац. */
export const FORM_TITLE_MAX = 100

/**
 * Название формы — текст для людей, в отличие от id: подпись в дереве форм, заголовок
 * окна IDE, `name` узла в `nav.json` (его рантайм показывает в навигации). Одна строка
 * без краевых пробелов; '' — названия нет. Приходит и из чужого архива, отсюда проверка
 * типа.
 */
export function normalizeFormTitle(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, FORM_TITLE_MAX)
}

/** Предел длины описания формы. */
export const FORM_DESCRIPTION_MAX = 1000

/**
 * Описание формы — свободный текст, уезжает в `description` узла `nav.json`. Переносы
 * строк сохраняются, прочие управляющие символы и краевые пробелы — нет.
 */
export function normalizeFormDescription(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/(?!\n)\p{Cc}/gu, '')
    .trim()
    .slice(0, FORM_DESCRIPTION_MAX)
}

/**
 * @param {string[]} ids — имена форм как они лежат в архиве
 * @returns {{ map: Map<string,string>, renamed: Array<[string,string]> }} карта
 *   «имя в архиве → id в проекте» и список фактических переименований (для тоста)
 */
export function renameFormIds(ids) {
  const list = (ids || []).map((v) => String(v ?? ''))
  const taken = new Set()
  const map = new Map()
  // Первый проход — годные имена занимают себя: чинёное имя не должно вытеснять
  // настоящее.
  for (const s of list) {
    if (FORM_ID_RE.test(s) && s.length <= FORM_ID_MAX && !taken.has(s)) {
      taken.add(s)
      map.set(s, s)
    }
  }
  const renamed = []
  let seq = 0
  for (const s of list) {
    if (map.has(s)) continue
    let id = safeFormId(s)
    if (!id) {
      // Имя нечинимое (кириллица, `..`) — даём осмысленное запасное.
      do {
        seq += 1
        id = `form_${seq}`
      } while (taken.has(id))
    } else if (taken.has(id)) {
      // Коллизия чистки: «a b» и «a.b» дают одно имя — второму добавляем счётчик.
      let n = 2
      while (taken.has(`${id}_${n}`)) n += 1
      id = `${id}_${n}`
    }
    taken.add(id)
    map.set(s, id)
    renamed.push([s, id])
  }
  return { map, renamed }
}

/**
 * Ссылки навигации в ячейках формы → на новые имена. Цель вне архива (внешняя view)
 * в карте отсутствует и остаётся как была — это не битая ссылка, а внешний адрес.
 */
export function remapNavigation(cells, map) {
  if (!map?.size) return cells
  return (cells || []).map((c) => {
    const nav = c?.tms?.navigation
    const next = nav ? map.get(nav) : null
    if (!next || next === nav) return c
    return { ...c, tms: { ...c.tms, navigation: next } }
  })
}

/** Иерархия форм → на новые имена. Мусор не чиним: это делает normalizeTree в сторе. */
export function remapTree(nodes, map) {
  if (!Array.isArray(nodes) || !map?.size) return nodes
  return nodes.map((n) => {
    if (!n || typeof n !== 'object') return n
    const key = typeof n.id === 'string' || typeof n.id === 'number' ? String(n.id) : null
    return {
      ...n,
      id: (key !== null && map.get(key)) || n.id,
      children: remapTree(n.children, map),
    }
  })
}

/**
 * Названия и описания форм из архива — в мету проекта. Приходят двумя путями:
 * `project.json` (всех форм, в том числе вне дерева) и `name`/`description` узлов
 * `nav.json` — его видит и правит сервер, поэтому он главнее. Форме, чьё имя пришлось
 * заменить (кириллица, пробелы), прежнее имя остаётся названием: иначе от «Главная
 * схема» остался бы только `form_1`. Ключи — имена из архива, на id их переносит
 * `remapProjectMeta`.
 *
 * @param {object|null} project — `project.json` архива
 * @param {{ titles?: Record<string,string>, descriptions?: Record<string,string> }} nav —
 *   из `nav.json`
 * @param {Array<[string,string]>} renamed — `renameFormIds(...).renamed`
 */
export function withImportedFormText(project, nav, renamed) {
  const own = (field) =>
    project?.[field] && typeof project[field] === 'object' ? project[field] : {}
  const formTitle = {
    ...Object.fromEntries((renamed || []).map(([from]) => [from, from])),
    ...own('formTitle'),
    ...(nav?.titles || {}),
  }
  const formDescription = { ...own('formDescription'), ...(nav?.descriptions || {}) }
  const hasTitle = Object.keys(formTitle).length > 0
  const hasDescription = Object.keys(formDescription).length > 0
  if (!hasTitle && !hasDescription) return project
  return {
    ...project,
    ...(hasTitle ? { formTitle } : {}),
    ...(hasDescription ? { formDescription } : {}),
  }
}

/** Поля `project.json`, адресованные id формы. */
const FORM_KEYED_META = ['formBg', 'formTitle', 'formDescription']

/** Редакторная мета проекта (`project.json`): фон, название и описание привязаны к id формы. */
export function remapProjectMeta(project, map) {
  if (!project || typeof project !== 'object' || !map?.size) return project
  const out = { ...project }
  for (const field of FORM_KEYED_META) {
    const byId = project[field]
    if (!byId || typeof byId !== 'object') continue
    const next = {}
    for (const [id, value] of Object.entries(byId)) next[map.get(id) ?? id] = value
    out[field] = next
  }
  return out
}
