// Проект ↔ ZIP-архив — единственный формат ввода-вывода. Раскладка повторяет папку
// `projects/` сервера WebScada: архив распаковывается туда как есть.
//
//   projects-list.json          [{ id, name, description }] — список проектов сервера
//   user-projects.json          { "<логин>": ["<id проекта>"] } — доступ по пользователям
//   <id>/nav.json               дерево навигации [{ viewId, name, children }]
//   <id>/views/<viewId>/{view.svg, animations.json}
//   <id>/library/<id>/{stencil.json, shape.svg}   ─┐ читает только IDE,
//   <id>/taglist.csv | taglist.xml                 │ сервер эти файлы
//   <id>/project.json (редакторная мета)          ─┘ игнорирует
//
// Архивы прошлой раскладки (`forms/`, `hierarchy.json` в корне) читаются по-прежнему.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { FORM_ID_RE, FORM_ID_MAX } from '../constants/ids'
import { isXmlTagList } from './parsers'
import { pickFile } from './fileSystem'

/** Логин в `user-projects.json`: на боевом сервере файл правят руками. */
const DEFAULT_USER = 'test'

/** Путь формы в архиве: `views/` — текущая раскладка, `forms/` — прошлая. */
const VIEW_PATH_RE = /(?:views|forms)\/[^/]+\/view\.svg$/

/** Id, из которого строится путь внутри архива. Нарушитель = баг, а не данные. */
function assertPathSafeId(id, what) {
  const s = String(id ?? '')
  if (!FORM_ID_RE.test(s) || s.length > FORM_ID_MAX) {
    throw new Error(`Недопустимый id ${what} для архива: «${s}»`)
  }
}

const jsonFile = (value) => strToU8(JSON.stringify(value, null, 2) + '\n')

/**
 * Дерево форм IDE (`[{ id, children }]`) → навигация WebScada
 * (`[{ viewId, name, children }]`). `name` — подпись в дереве сервера; своего названия
 * у формы нет, поэтому это её id.
 */
function toNavTree(nodes) {
  return (nodes || []).map((n) => ({
    viewId: n.id,
    name: n.id,
    children: toNavTree(n.children),
  }))
}

/**
 * Обратное преобразование: навигация сервера → дерево форм IDE. Верхний уровень —
 * массив узлов ЛИБО один корневой узел: обе формы штатны для WebScada, и объект
 * пришлось бы иначе молча выбросить вместе со всей структурой схем.
 */
function fromNavTree(nodes) {
  const list = Array.isArray(nodes) ? nodes : nodes && typeof nodes === 'object' ? [nodes] : null
  if (!list) return null
  return list
    .filter((n) => n && (n.viewId || n.id))
    .map((n) => ({ id: n.viewId || n.id, children: fromNavTree(n.children) || [] }))
}

/**
 * Собирает ZIP проекта из экспортного бандла (см. useProject.buildAndDeliverBundle).
 *
 * @param {{
 *   projectId: string,
 *   forms: { id: string, viewSvg: string, animationsJson: string }[],
 *   stencils?: { id: string, stencilJson: object, shapeSvg: string }[],
 *   tagsText?: string | null,
 *   hierarchy?: Array | null,
 *   project?: object | null
 * }} bundle
 * @returns {Blob}
 */
export function buildProjectZipBlob({ projectId, forms, stencils, tagsText, hierarchy, project }) {
  assertPathSafeId(projectId, 'проекта')
  const files = {}
  const root = `${projectId}/`

  // Файлы уровня `projects/`: сервер по ним находит проект и решает, кому он виден.
  files['projects-list.json'] = jsonFile([{ id: projectId, name: projectId, description: '' }])
  files['user-projects.json'] = jsonFile({ [DEFAULT_USER]: [projectId] })
  // Дерево навигации пишем ВСЕГДА, даже пустым: без nav.json сервер не покажет проект.
  files[`${root}nav.json`] = jsonFile(toNavTree(hierarchy))

  for (const f of forms) {
    // Последний рубеж перед путём в архиве: `..` или слэш в id формы увели бы файл
    // за папку проекта при распаковке. Имена чинит импорт (utils/formIds), поэтому
    // здесь падаем, а не санируем молча.
    assertPathSafeId(f.id, 'формы')
    files[`${root}views/${f.id}/view.svg`] = strToU8(f.viewSvg)
    files[`${root}views/${f.id}/animations.json`] = strToU8(f.animationsJson)
  }
  if (stencils?.length) {
    for (const s of stencils) {
      // У символов id фильтрует реестр (STENCIL_ID_RE), но путь строится здесь.
      assertPathSafeId(s.id, 'символа')
      files[`${root}library/${s.id}/stencil.json`] = jsonFile(s.stencilJson)
      files[`${root}library/${s.id}/shape.svg`] = strToU8(s.shapeSvg)
    }
  }
  // Tag-list уезжает КАК ЕСТЬ, в своём формате: скадист открывает архив тем же файлом,
  // что дал нам, а разбор различает форматы сам (parsers.parseTagList).
  if (tagsText != null) {
    files[`${root}${isXmlTagList(tagsText) ? 'taglist.xml' : 'taglist.csv'}`] = strToU8(tagsText)
  }
  // project.json — редакторная мета проекта (фон холста по формам). Отдельным файлом,
  // а не полем nav.json: тот читает сервер, и лишние поля ему не нужны. Пустая мета
  // не пишется.
  if (project && Object.keys(project).length) files[`${root}project.json`] = jsonFile(project)
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
 * Picker .zip. null при отмене. Возвращает File — вызывать из user-gesture.
 * Handle архива не нужен: перезаписывать открытый файл мы не умеем, выгрузка идёт
 * скачиванием.
 */
export async function pickProjectArchive() {
  const picked = await pickFile({
    extensions: ['.zip'],
    mime: 'application/zip',
    description: 'ZIP-архив проекта',
  })
  return picked?.file || null
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
  const paths = Object.keys(entries)
  // Папка проекта: в раскладке WebScada всё лежит под `<id>/`, в прошлой — в корне.
  // Определяем по первой же форме, а не по nav.json: у проекта без дерева его нет.
  const viewPath = paths.find((p) => VIEW_PATH_RE.test(p)) || ''
  const prefix = viewPath.replace(VIEW_PATH_RE, '')
  const text = (path) => (entries[prefix + path] ? strFromU8(entries[prefix + path]) : null)

  // Id форм/символов достаём из путей — порядок в архиве не гарантирован. `views/` —
  // текущая раскладка, `forms/` — прошлая.
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const viewsRe = new RegExp(`^${esc}(?:views|forms)/([^/]+)/view\\.svg$`)
  const libRe = new RegExp(`^${esc}library/([^/]+)/stencil\\.json$`)
  const formIds = new Set()
  const stencilIds = new Set()
  for (const path of paths) {
    let m
    if ((m = path.match(viewsRe))) formIds.add(m[1])
    else if ((m = path.match(libRe))) stencilIds.add(m[1])
  }

  const forms = []
  for (const id of formIds) {
    const svgText = text(`views/${id}/view.svg`) ?? text(`forms/${id}/view.svg`)
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

  const tagsText = text('taglist.csv') ?? text('taglist.txt') ?? text('taglist.xml')

  // Дерево: `nav.json` (WebScada) либо `hierarchy.json` прошлых архивов. Формы узлов
  // разные, приводим к виду стора — `[{ id, children }]`.
  let hierarchy = null
  const navText = text('nav.json') ?? text('hierarchy.json')
  if (navText) {
    try {
      hierarchy = fromNavTree(JSON.parse(navText))
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
