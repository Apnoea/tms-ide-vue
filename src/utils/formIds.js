import { FORM_ID_RE, FORM_ID_MAX, safeFormId } from '../constants/ids'

/**
 * Приведение имён форм ЧУЖОГО архива к безопасным id + перенос всего, что этими id
 * адресуется (навигация, иерархия, фон формы). Про саму маску и почему она не
 * косметика — см. `FORM_ID_RE` в constants/ids.
 *
 * Формы не отбрасываем, а переименовываем: схему потерять хуже, чем переназвать.
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
  // настоящее (иначе форма «form_1» из архива уехала бы в «form_1_2» из-за соседа).
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

/** Редакторная мета проекта (`project.json`): фон привязан к id формы. */
export function remapProjectMeta(project, map) {
  const bg = project?.formBg
  if (!bg || typeof bg !== 'object' || !map?.size) return project
  const formBg = {}
  for (const [id, color] of Object.entries(bg)) formBg[map.get(id) ?? id] = color
  return { ...project, formBg }
}
