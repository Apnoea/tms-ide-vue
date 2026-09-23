import { idbTryGet, idbSet } from '../utils/idb'

/**
 * Оверрайды символов в IndexedDB: правка живёт в рантайм-реестре, а файлы
 * definitions/ пишет dev-плагин, которого нет в prod — там правки терялись на
 * reload. Оверрайды поднимаются в реестр при старте, до отрисовки форм.
 *
 * Храним только реальные отклонения от кода (новые + изменённые встроенные):
 * иначе старый оверрайд маскировал бы обновление символа в коде. Запись —
 * массив `{ id, stencilJson, shapeSvg }`, как в бандле проекта.
 */
const KEY = 'project:stencils'

/**
 * Сигнатура символа для сравнения «изменился ли». Ключи сортируем рекурсивно:
 * порядок полей у glob-модуля и у распарсенного бандла разный, ложных расхождений
 * быть не должно.
 */
export function stencilSignature(json, svg) {
  return `${JSON.stringify(sortKeys(json ?? {}))}\u0000${svg || ''}`
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.keys(v)
      .sort()
      .reduce((o, k) => {
        o[k] = sortKeys(v[k])
        return o
      }, {})
  }
  return v
}

/**
 * Набор оверрайдов из IDB с признаком успеха чтения: `ok: false` — хранилище не
 * прочиталось, и это НЕ пустой набор. Отличать обязательно: правка символа пишет
 * набор целиком, поэтому «не прочитали → считаем пустым» затёрло бы все прежние
 * оверрайды одним новым.
 */
async function readOverrides() {
  const { ok, value } = await idbTryGet(KEY)
  if (!ok) return { ok: false, items: [] }
  if (!Array.isArray(value)) return { ok: true, items: [] }
  return { ok: true, items: value }
}

/** Все оверрайды из IDB. [] — если их нет или чтение упало. */
export async function loadStencilOverrides() {
  const { items } = await readOverrides()
  return items
}

/**
 * Добавить/заменить оверрайд по id (правка одного символа в редакторе).
 * Возвращает успех записи: при квоте/приватном режиме `idbSet` даёт false, и
 * вызывающий не должен обещать пользователю, что правка переживёт перезагрузку.
 * Не прочитали прежний набор — не пишем вовсе, иначе потеряли бы остальные правки.
 */
export async function upsertStencilOverride(item) {
  if (!item?.id) return false
  const { ok, items } = await readOverrides()
  if (!ok) return false
  const next = items.filter((s) => s.id !== item.id)
  next.push({ id: item.id, stencilJson: item.stencilJson, shapeSvg: item.shapeSvg || '' })
  return idbSet(KEY, next)
}

/**
 * Убрать оверрайд по id (удаление символа из палитры, сброс символа к набору). `false` —
 * хранилище не прочиталось или запись не прошла: оверрайд переживёт перезагрузку.
 */
export async function removeStencilOverride(id) {
  if (!id) return false
  const { ok, items } = await readOverrides()
  if (!ok) return false
  const next = items.filter((s) => s.id !== id)
  if (next.length === items.length) return true
  return idbSet(KEY, next)
}

/**
 * Заменить весь набор оверрайдов (импорт проекта = новый набор символов). Возвращает
 * успех записи: не записались — символы архива живут только до reload, и вызывающий
 * обязан сказать это прямо.
 */
export async function replaceStencilOverrides(items) {
  return idbSet(
    KEY,
    (items || []).map((s) => ({
      id: s.id,
      stencilJson: s.stencilJson,
      shapeSvg: s.shapeSvg || '',
    }))
  )
}
