// Замена тегов в привязках проекта: имя тега впечатано в привязку, поэтому новый
// tag-list с другим префиксом или суффиксом сам по себе схему не обновит.
import { getCellTagsFromTms, renameTmsTags } from '../utils/cellSearch'

/**
 * Правило замены: каждое вхождение `find` в имени тега → `replace`. Имя целиком не
 * стирается — пустая привязка молча сняла бы анимацию.
 */
export function renameTagBy(find, replace) {
  return (tag) => tag.replaceAll(find, replace) || tag
}

/**
 * Привязанные теги проекта: тег → число привязок и формы, где он стоит.
 *
 * @param {{ id: string, json: { cells?: object[] } }[]} forms
 * @returns {{ counts: Map<string, number>, formsOf: Map<string, Set<string>> }}
 */
export function indexBoundTags(forms) {
  const counts = new Map()
  const formsOf = new Map()
  for (const { id, json } of forms) {
    for (const cell of json?.cells || []) {
      for (const tag of getCellTagsFromTms(cell?.tms)) {
        counts.set(tag, (counts.get(tag) || 0) + 1)
        if (!formsOf.has(tag)) formsOf.set(tag, new Set())
        formsOf.get(tag).add(id)
      }
    }
  }
  return { counts, formsOf }
}

/**
 * Что сделает замена: сколько привязок и тегов поменяется, в скольких формах и каких
 * тегов после неё не окажется в tag-list (пустой `tagNames` — проверку не делаем).
 *
 * @param {ReturnType<typeof indexBoundTags>} index
 * @param {(tag: string) => string} rename
 * @param {Set<string>} [tagNames]
 */
export function planRebind(index, rename, tagNames) {
  const forms = new Set()
  const missing = new Set()
  let bindings = 0
  let tags = 0
  for (const [tag, count] of index.counts) {
    const next = rename(tag)
    if (next !== tag) {
      tags++
      bindings += count
      for (const id of index.formsOf.get(tag) || []) forms.add(id)
    }
    if (tagNames?.size && !tagNames.has(next)) missing.add(next)
  }
  return { bindings, tags, forms: forms.size, missing: [...missing].sort() }
}

/** Границы сегментов имени: позиции после каждой точки (для префикса). */
function prefixCuts(name) {
  const cuts = []
  for (let i = name.indexOf('.'); i !== -1; i = name.indexOf('.', i + 1)) cuts.push(i + 1)
  return cuts
}

/** Позиции каждой точки (для суффикса: суффикс начинается с неё). */
function suffixCuts(name) {
  const cuts = []
  for (let i = name.indexOf('.'); i !== -1; i = name.indexOf('.', i + 1)) cuts.push(i)
  return cuts
}

const CANDIDATES_CHECKED = 5
// Хвост или начало, общие для многих имён (`.Status`, корень сервера), пару не
// подсказывают, а голосов дали бы по числу имён на каждый тег.
const FANOUT_MAX = 8
// Подсказка открывает диалог сама — одиночное совпадение скорее случайность.
const MATCHED_MIN = 2

/**
 * Угадать замену по новому tag-list: привязанные теги, которых в нём нет, сравниваются
 * с его именами по сегментам через точку. Совпал хвост — кандидат на смену префикса,
 * совпало начало — суффикса. Новая сторона может быть пустой (префикс сняли), старая —
 * нет: искать пустую строку нечего. Лучшие по голосам кандидаты проверяются честно —
 * сколько недостающих тегов замена находит и сколько найденных теряет; ломающая больше,
 * чем чинит, не предлагается.
 *
 * @param {Iterable<string>} boundTags
 * @param {Set<string>} tagNames
 * @returns {{ find: string, replace: string, matched: number, missing: number } | null}
 */
export function suggestRename(boundTags, tagNames) {
  const bound = [...new Set(boundTags)]
  const missing = bound.filter((t) => !tagNames.has(t))
  if (!missing.length || !tagNames.size) return null

  // Индексы имён tag-list: хвост → головы и голова → хвосты по границам сегментов.
  const headsByTail = new Map()
  const tailsByHead = new Map()
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(value)
  }
  for (const name of tagNames) {
    add(headsByTail, name, '')
    for (const i of prefixCuts(name)) add(headsByTail, name.slice(i), name.slice(0, i))
    add(tailsByHead, name, '')
    for (const i of suffixCuts(name)) add(tailsByHead, name.slice(0, i), name.slice(i))
  }

  const votes = new Map()
  const vote = (find, replace, seen) => {
    const key = `${find}\u0000${replace}`
    if (seen.has(key)) return
    seen.add(key)
    votes.set(key, (votes.get(key) || 0) + 1)
  }
  const lookup = (map, key) => {
    const list = map.get(key)
    return list && list.length <= FANOUT_MAX ? list : []
  }
  for (const tag of missing) {
    const seen = new Set()
    for (const i of prefixCuts(tag)) {
      for (const head of lookup(headsByTail, tag.slice(i))) vote(tag.slice(0, i), head, seen)
    }
    for (const i of suffixCuts(tag)) {
      for (const tail of lookup(tailsByHead, tag.slice(0, i))) vote(tag.slice(i), tail, seen)
    }
  }
  if (!votes.size) return null

  const top = [...votes]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, CANDIDATES_CHECKED)
  let best = null
  for (const [key] of top) {
    const [find, replace] = key.split('\u0000')
    const rename = renameTagBy(find, replace)
    let matched = 0
    let lost = 0
    for (const tag of bound) {
      const next = rename(tag)
      if (next === tag) continue
      const was = tagNames.has(tag)
      const now = tagNames.has(next)
      if (!was && now) matched++
      else if (was && !now) lost++
    }
    const score = matched - lost
    if (matched < MATCHED_MIN || score <= 0) continue
    if (!best || score > best.score) best = { find, replace, matched, score }
  }
  if (!best) return null
  return { find: best.find, replace: best.replace, matched: best.matched, missing: missing.length }
}

/**
 * Применить замену к графу формы. Возвращает новый граф и число изменённых привязок
 * либо null, если в форме менять нечего. Подпись символа (`tms.params`), равная его
 * же тегу, — это имя тега (так подписана форма проверки тегов), она едет вместе с ним.
 *
 * @param {{ cells?: object[] }} json
 * @param {(tag: string) => string} rename
 * @returns {{ json: object, changed: number } | null}
 */
export function renameFormTags(json, rename) {
  let changed = 0
  const cells = (json?.cells || []).map((cell) => {
    const res = renameTmsTags(cell?.tms, rename)
    if (!res) return cell
    changed += res.changed
    const tms = res.tms
    if (tms.params) {
      const own = new Set(getCellTagsFromTms(cell.tms))
      tms.params = Object.fromEntries(
        Object.entries(tms.params).map(([key, v]) => [key, own.has(v) ? rename(v) : v])
      )
    }
    return { ...cell, tms }
  })
  return changed ? { json: { ...json, cells }, changed } : null
}
