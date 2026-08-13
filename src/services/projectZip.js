// Проект ↔ ZIP-архив — единственный формат ввода-вывода проекта. Раскладка внутри
// архива: forms/<id>/{view.svg,animations.json}, library/<id>/{stencil.json,
// shape.svg}, taglist.csv, hierarchy.json. Экспорт → скачивание Blob, импорт →
// выбор .zip (FSA-picker) → распаковка в структуру для оркестрации (useProject).
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'

/**
 * Собирает ZIP проекта из экспортного бандла (см. useProject.buildAndDeliverBundle).
 *
 * @param {{
 *   forms: { id: string, viewSvg: string, animationsJson: string }[],
 *   stencils?: { id: string, stencilJson: object, shapeSvg: string }[],
 *   tagsText?: string | null,
 *   hierarchy?: Array | null
 * }} bundle
 * @returns {Blob}
 */
export function buildProjectZipBlob({ forms, stencils, tagsText, hierarchy }) {
  const files = {}
  for (const f of forms) {
    files[`forms/${f.id}/view.svg`] = strToU8(f.viewSvg)
    files[`forms/${f.id}/animations.json`] = strToU8(f.animationsJson)
  }
  if (stencils?.length) {
    for (const s of stencils) {
      files[`library/${s.id}/stencil.json`] = strToU8(JSON.stringify(s.stencilJson, null, 2) + '\n')
      files[`library/${s.id}/shape.svg`] = strToU8(s.shapeSvg)
    }
  }
  if (tagsText != null) files['taglist.csv'] = strToU8(tagsText)
  if (hierarchy?.length)
    files['hierarchy.json'] = strToU8(JSON.stringify(hierarchy, null, 2) + '\n')
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' })
}

/** Скачивание Blob под именем (эфемерный object-URL, сразу отзываем). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Picker .zip (FSA). null при отмене. Возвращает File — вызывать из user-gesture.
 */
export async function pickProjectArchive() {
  if (typeof window === 'undefined' || typeof window.showOpenFilePicker !== 'function')
    throw new Error('Браузер не поддерживает File System Access API')
  let handle
  try {
    ;[handle] = await window.showOpenFilePicker({
      types: [{ description: 'ZIP-архив проекта', accept: { 'application/zip': ['.zip'] } }],
      multiple: false,
    })
  } catch (e) {
    if (e?.name === 'AbortError') return null
    throw e
  }
  return handle.getFile()
}

/**
 * Читает .zip проекта → структура-бандл для applyImportedBundle (см. useProject).
 * Структуру не валидирует жёстко: отсутствующие/битые части — пустые/пропущены.
 *
 * @param {File} file
 * @returns {Promise<{
 *   forms: { id: string, svgText: string }[],
 *   stencils: { id: string, stencilJson: object, shapeSvg: string }[],
 *   tagsText: string | null,
 *   hierarchy: Array | null
 * }>}
 */
export async function readProjectZipFile(file) {
  let entries
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error('Не удалось прочитать архив (повреждён или не ZIP)')
  }
  const text = (path) => (entries[path] ? strFromU8(entries[path]) : null)

  // Id форм/стенсилов достаём из путей — порядок в архиве не гарантирован.
  const formIds = new Set()
  const stencilIds = new Set()
  for (const path of Object.keys(entries)) {
    let m
    if ((m = path.match(/^forms\/([^/]+)\/view\.svg$/))) formIds.add(m[1])
    else if ((m = path.match(/^library\/([^/]+)\/stencil\.json$/))) stencilIds.add(m[1])
  }

  const forms = []
  for (const id of formIds) {
    const svgText = text(`forms/${id}/view.svg`)
    if (svgText != null) forms.push({ id, svgText })
  }

  const stencils = []
  for (const id of stencilIds) {
    const jsonText = text(`library/${id}/stencil.json`)
    if (jsonText == null) continue
    let stencilJson
    try {
      stencilJson = JSON.parse(jsonText)
    } catch {
      continue // битый stencil.json — пропускаем
    }
    stencils.push({ id, stencilJson, shapeSvg: text(`library/${id}/shape.svg`) ?? '' })
  }

  const tagsText = text('taglist.csv') ?? text('taglist.txt')

  let hierarchy = null
  const hierarchyText = text('hierarchy.json')
  if (hierarchyText) {
    try {
      hierarchy = JSON.parse(hierarchyText)
    } catch {
      hierarchy = null
    }
  }

  return { forms, stencils, tagsText, hierarchy }
}

/** Уникальные stencilId, используемые формами (по graphJson). Для GC бандла. */
export function collectUsedStencilIds(formGraphs) {
  const ids = new Set()
  for (const g of formGraphs) {
    for (const cell of g?.cells || []) {
      const id = cell?.tms?.stencilId
      if (id) ids.add(id)
    }
  }
  return [...ids]
}
