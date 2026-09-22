// Поставляемые наборы символов («пресеты»): библиотека принадлежит ПРИЛОЖЕНИЮ, а не
// проекту, поэтому ключ `app:` — импорт проекта его не трогает. Набор ставится и
// сносится целиком; отдельный символ из него не правится и не удаляется.
//
// Раскладка `.zip` набора (подмножество архива проекта):
//   preset.json                         { id, name, version, description? }
//   library/<stencilId>/stencil.json
//   library/<stencilId>/shape.svg
//
// Метку `preset` в символы проставляем ЗДЕСЬ, из манифеста: автор набора не дублирует
// её в каждом json, и версия в манифесте с версией в символах разойтись не может.
import { unzipSync, strFromU8 } from 'fflate'
import { PRESET_VERSION_RE, STENCIL_ID_RE } from '../constants/ids'
import { idbTryGet, idbSet } from '../utils/idb'
import { pickFile } from './fileSystem'

const KEY = 'app:presets'

const LIB_RE = /^library\/([^/]+)\/stencil\.json$/

/**
 * Сравнение версий наборов: покомпонентно ЧИСЛАМИ (строковое дало бы «10» < «9»).
 * Недостающие компоненты считаем нулями: `1.2` === `1.2.0`.
 *
 * @returns {number} отрицательное — `a` старее, 0 — равны, положительное — `a` новее
 */
export function comparePresetVersions(a, b) {
  const parts = (v) =>
    String(v || '')
      .split('.')
      .map(Number)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d
  }
  return 0
}

/** Символ набора несёт метку происхождения — по ней палитра прячет правку и удаление. */
export function stampPreset(stencilJson, preset) {
  return {
    ...stencilJson,
    preset: { id: preset.id, name: preset.name, version: preset.version },
  }
}

/**
 * Проверка набора ПО ФОРМЕ (чистая): манифест, состав, маски и префикс id. Конфликты с
 * реестром здесь не смотрим — для них нужен реестр, это дело вызывающего.
 *
 * Отчёт списком, а не первой ошибкой: набор ставится целиком, и автору нужен полный
 * перечень, а не по одной проблеме за прогон.
 *
 * @returns {string[]} пустой — набор годен
 */
export function validatePresetBundle(bundle) {
  const problems = []
  const id = String(bundle?.id ?? '')
  if (!STENCIL_ID_RE.test(id)) problems.push(`Id набора «${id}» вне маски [a-z0-9_]`)
  if (!String(bundle?.name ?? '').trim()) problems.push('У набора нет названия')
  if (!PRESET_VERSION_RE.test(String(bundle?.version ?? ''))) {
    problems.push(`Версия «${bundle?.version ?? ''}» не вида 1.2.3`)
  }
  const stencils = bundle?.stencils || []
  if (!stencils.length) problems.push('В наборе нет символов')
  for (const s of stencils) {
    const sid = String(s?.id ?? '')
    if (!STENCIL_ID_RE.test(sid)) {
      problems.push(`Id символа «${sid}» вне маски [a-z0-9_]`)
      continue
    }
    // Префикс — то, чем наборы разведены между собой: без него два набора рано или
    // поздно принесут одинаковый id.
    if (STENCIL_ID_RE.test(id) && !sid.startsWith(`${id}_`)) {
      problems.push(`Id символа «${sid}» без префикса «${id}_»`)
    }
    for (const field of ['label', 'category', 'width', 'height']) {
      if (s?.stencilJson?.[field] === undefined) problems.push(`У «${sid}» нет поля «${field}»`)
    }
    if (!s?.shapeSvg) problems.push(`У «${sid}» нет shape.svg`)
  }
  return problems
}

/** Picker .zip набора. null при отмене. Вызывать из user-gesture. */
export async function pickPresetArchive() {
  const picked = await pickFile({
    extensions: ['.zip'],
    mime: 'application/zip',
    description: 'ZIP-архив набора символов',
  })
  return picked?.file || null
}

/**
 * Читает `.zip` набора → бандл `{ id, name, version, description, stencils }`.
 * Бросает с внятным текстом, если архив не читается или в нём нет манифеста —
 * дальше по конвейеру бандл проверяет `validatePresetBundle`.
 *
 * @param {File} file
 */
export async function readPresetZipFile(file) {
  let entries
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error('Не удалось прочитать архив (повреждён или не ZIP)')
  }
  const text = (path) => (entries[path] ? strFromU8(entries[path]) : null)
  const manifestText = text('preset.json')
  if (!manifestText) throw new Error('В архиве нет preset.json — это не набор символов')
  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    throw new Error('preset.json не разбирается как JSON')
  }

  const stencils = []
  for (const path of Object.keys(entries)) {
    const m = path.match(LIB_RE)
    if (!m) continue
    const jsonText = text(path)
    let stencilJson
    try {
      stencilJson = JSON.parse(jsonText)
    } catch {
      throw new Error(`stencil.json символа «${m[1]}» не разбирается как JSON`)
    }
    stencils.push({
      id: m[1],
      stencilJson: { ...stencilJson, id: m[1] },
      shapeSvg: text(`library/${m[1]}/shape.svg`) ?? '',
    })
  }

  return {
    id: String(manifest?.id ?? ''),
    name: String(manifest?.name ?? '').trim(),
    version: String(manifest?.version ?? ''),
    description: String(manifest?.description ?? ''),
    stencils,
  }
}

/**
 * Установленные наборы с признаком успеха чтения: `ok: false` — хранилище не
 * прочиталось, и это НЕ пустой список. Различать обязательно: установка пишет список
 * целиком, поэтому «не прочитали → считаем пустым» снесло бы прежние наборы.
 */
async function readPresets() {
  const { ok, value } = await idbTryGet(KEY)
  if (!ok) return { ok: false, items: [] }
  if (!Array.isArray(value)) return { ok: true, items: [] }
  return { ok: true, items: value }
}

/** Все установленные наборы. [] — если их нет или чтение упало. */
export async function loadPresets() {
  const { items } = await readPresets()
  return items
}

/**
 * Записать набор (установка или обновление той же версии по id). Возвращает успех
 * записи: не прочитали прежний список — не пишем вовсе, иначе потеряли бы остальные
 * наборы.
 */
export async function savePreset(preset) {
  if (!preset?.id) return false
  const { ok, items } = await readPresets()
  if (!ok) return false
  const next = items.filter((p) => p.id !== preset.id)
  next.push(preset)
  return idbSet(KEY, next)
}

/** Снять набор по id. `false` — хранилище не прочиталось или запись не прошла. */
export async function removePreset(id) {
  const { ok, items } = await readPresets()
  if (!ok) return false
  const next = items.filter((p) => p.id !== id)
  if (next.length === items.length) return true
  return idbSet(KEY, next)
}
