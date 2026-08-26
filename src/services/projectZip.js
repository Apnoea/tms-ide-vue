// Проект ↔ ZIP-архив — единственный формат ввода-вывода проекта. Раскладка внутри
// архива: forms/<id>/{view.svg,animations.json}, library/<id>/{stencil.json,
// shape.svg}, taglist.csv, hierarchy.json, project.json (редакторная мета). Экспорт → скачивание Blob, импорт →
// выбор .zip (FSA-picker) → распаковка в структуру для оркестрации (useProject).
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { FORM_ID_RE, FORM_ID_MAX } from '../constants/ids'

/** Id, из которого строится путь внутри архива. Нарушитель = баг, а не данные. */
function assertPathSafeId(id, what) {
  const s = String(id ?? '')
  if (!FORM_ID_RE.test(s) || s.length > FORM_ID_MAX) {
    throw new Error(`Недопустимый id ${what} для архива: «${s}»`)
  }
}

/**
 * Собирает ZIP проекта из экспортного бандла (см. useProject.buildAndDeliverBundle).
 *
 * @param {{
 *   forms: { id: string, viewSvg: string, animationsJson: string }[],
 *   stencils?: { id: string, stencilJson: object, shapeSvg: string }[],
 *   tagsText?: string | null,
 *   hierarchy?: Array | null,
 *   project?: object | null
 * }} bundle
 * @returns {Blob}
 */
export function buildProjectZipBlob({ forms, stencils, tagsText, hierarchy, project }) {
  const files = {}
  for (const f of forms) {
    // Последний рубеж перед путём в архиве: id формы приходит из данных (проект в
    // IDB, импортированный архив), а `..` или слэш в нём уводят файл за папку
    // проекта при распаковке на объекте. Импорт такие имена уже чинит
    // (utils/formIds), поэтому здесь это «невозможное состояние» — падаем, а не
    // санируем молча: путь наружу не должен зависеть от проверки на входе.
    assertPathSafeId(f.id, 'формы')
    files[`forms/${f.id}/view.svg`] = strToU8(f.viewSvg)
    files[`forms/${f.id}/animations.json`] = strToU8(f.animationsJson)
  }
  if (stencils?.length) {
    for (const s of stencils) {
      // У символов id фильтрует реестр (STENCIL_ID_RE), но путь строится здесь —
      // проверяем на общих правах.
      assertPathSafeId(s.id, 'символа')
      files[`library/${s.id}/stencil.json`] = strToU8(JSON.stringify(s.stencilJson, null, 2) + '\n')
      files[`library/${s.id}/shape.svg`] = strToU8(s.shapeSvg)
    }
  }
  if (tagsText != null) files['taglist.csv'] = strToU8(tagsText)
  // project.json — редакторная мета проекта (сейчас фон холста по формам). Отдельным
  // файлом, а не полем в hierarchy.json: тот массив-дерево, и менять его форму значило
  // бы ломать чтение старых архивов. Пустую мету не пишем.
  if (project && Object.keys(project).length)
    files['project.json'] = strToU8(JSON.stringify(project, null, 2) + '\n')
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
 *   hierarchy: Array | null,
 *   project: object | null
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

  // Id форм/символов достаём из путей — порядок в архиве не гарантирован.
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

  // project.json — редакторная мета (фон холста по формам). Битую/отсутствующую
  // молча игнорируем: проект от неё не зависит, схемы откроются с дефолтным фоном.
  let project = null
  const projectText = text('project.json')
  if (projectText) {
    try {
      const parsed = JSON.parse(projectText)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) project = parsed
    } catch {
      project = null
    }
  }

  return { forms, stencils, tagsText, hierarchy, project }
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
