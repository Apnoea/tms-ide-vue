import { FORM_ID_RE, FORM_ID_MAX, safeFormId } from '../constants/ids'

/**
 * Приведение имён форм чужого архива к безопасным id (маска — `FORM_ID_RE` в
 * constants/ids) + перенос всего, что этими id адресуется: навигация, иерархия, фон и
 * название формы. Формы переименовываются, а не отбрасываются.
 */

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
 * Названия форм из архива — в мету проекта. Приходят двумя путями: `project.json`
 * (всех форм, в том числе вне дерева) и `name` узлов `nav.json` — его видит и правит
 * сервер, поэтому он главнее. Форме, чьё имя пришлось заменить (кириллица, пробелы),
 * прежнее имя остаётся названием: иначе от «Главная схема» остался бы только `form_1`.
 * Ключи — имена из архива, на id их переносит `remapProjectMeta`.
 *
 * @param {object|null} project — `project.json` архива
 * @param {Record<string,string>|undefined} navTitles — из `nav.json`
 * @param {Array<[string,string]>} renamed — `renameFormIds(...).renamed`
 */
export function withImportedTitles(project, navTitles, renamed) {
  const own = project?.formTitle
  const formTitle = {
    ...Object.fromEntries((renamed || []).map(([from]) => [from, from])),
    ...(own && typeof own === 'object' ? own : {}),
    ...(navTitles || {}),
  }
  if (!Object.keys(formTitle).length) return project
  return { ...project, formTitle }
}

/** Поля `project.json`, адресованные id формы. */
const FORM_KEYED_META = ['formBg', 'formTitle']

/** Редакторная мета проекта (`project.json`): фон и название привязаны к id формы. */
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
