// Чтение/запись папки проекта через File System Access API.
// Раскладка: forms/<id>/{view.svg, animations.json}, library/<id>/{stencil.json,
// shape.svg}, taglist.csv в корне. Парсинг view.svg → граф и применение
// стенсилов делает оркестрация импорта/экспорта (CanvasPane/ProjectActions);
// здесь — только байты ↔ структура папок.

import { idbGet, idbSet } from '../utils/idb'

// Handle папки проекта (для «сохранить туда же» без повторного выбора).
const DIR_HANDLE_KEY = 'project:dirHandle'

function fsaSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

async function getDir(parent, name) {
  try {
    return await parent.getDirectoryHandle(name)
  } catch {
    return null // нет такой подпапки
  }
}

async function ensureDir(parent, name) {
  return parent.getDirectoryHandle(name, { create: true })
}

async function readText(dirHandle, name) {
  try {
    const fh = await dirHandle.getFileHandle(name)
    return await (await fh.getFile()).text()
  } catch {
    return null // нет файла
  }
}

async function writeText(dirHandle, name, text) {
  const fh = await dirHandle.getFileHandle(name, { create: true })
  const writable = await fh.createWritable()
  try {
    await writable.write(text)
    await writable.close()
  } catch (e) {
    // Не оставляем открытый поток/недописанный swap-файл при сбое записи.
    await writable.abort?.()
    throw e
  }
}

async function listSubdirs(dirHandle) {
  const out = []
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'directory') out.push(entry)
  }
  return out
}

/**
 * Открывает папку проекта (picker) и читает её. Возвращает null, если юзер
 * отменил выбор. Структуру не валидирует жёстко — отсутствующие части пустые.
 *
 * @returns {Promise<{
 *   dirHandle: FileSystemDirectoryHandle,
 *   forms: { id: string, svgText: string }[],
 *   stencils: { id: string, stencilJson: object, shapeSvg: string }[],
 *   tagsText: string | null
 * } | null>}
 */
export async function readProjectFolder() {
  if (!fsaSupported()) throw new Error('Браузер не поддерживает File System Access API')
  let root
  try {
    root = await window.showDirectoryPicker()
  } catch (e) {
    if (e?.name === 'AbortError') return null
    throw e
  }

  const forms = []
  const formsDir = await getDir(root, 'forms')
  if (formsDir) {
    for (const entry of await listSubdirs(formsDir)) {
      const svgText = await readText(entry, 'view.svg')
      if (svgText != null) forms.push({ id: entry.name, svgText })
    }
  }

  const stencils = []
  const libDir = await getDir(root, 'library')
  if (libDir) {
    for (const entry of await listSubdirs(libDir)) {
      const jsonText = await readText(entry, 'stencil.json')
      if (jsonText == null) continue
      let stencilJson
      try {
        stencilJson = JSON.parse(jsonText)
      } catch {
        continue // битый stencil.json — пропускаем
      }
      stencils.push({
        id: entry.name,
        stencilJson,
        shapeSvg: (await readText(entry, 'shape.svg')) ?? '',
      })
    }
  }

  const tagsText = (await readText(root, 'taglist.csv')) ?? (await readText(root, 'taglist.txt'))

  return { dirHandle: root, forms, stencils, tagsText }
}

/** Picker папки для записи (нужен readwrite-доступ). null при отмене. */
export async function pickOutputFolder() {
  if (!fsaSupported()) throw new Error('Браузер не поддерживает File System Access API')
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    if (e?.name === 'AbortError') return null
    throw e
  }
}

/**
 * Пишет проект в папку (раскладка как в readProjectFolder).
 *
 * @param {FileSystemDirectoryHandle} root
 * @param {{
 *   forms: { id: string, viewSvg: string, animationsJson: string }[],
 *   stencils?: { id: string, stencilJson: object, shapeSvg: string }[],
 *   tagsText?: string | null
 * }} bundle
 */
export async function writeProjectFolder(root, { forms, stencils, tagsText }) {
  const formsDir = await ensureDir(root, 'forms')
  for (const f of forms) {
    const d = await ensureDir(formsDir, f.id)
    await writeText(d, 'view.svg', f.viewSvg)
    await writeText(d, 'animations.json', f.animationsJson)
  }
  if (stencils?.length) {
    const libDir = await ensureDir(root, 'library')
    for (const s of stencils) {
      const d = await ensureDir(libDir, s.id)
      await writeText(d, 'stencil.json', JSON.stringify(s.stencilJson, null, 2) + '\n')
      await writeText(d, 'shape.svg', s.shapeSvg)
    }
  }
  if (tagsText != null) await writeText(root, 'taglist.csv', tagsText)
}

/** Запомнить папку проекта (после импорта/экспорта) для «сохранить туда же». */
export async function rememberProjectDir(handle) {
  if (handle) await idbSet(DIR_HANDLE_KEY, handle)
}

/**
 * Запомненная папка проекта с readwrite-доступом, либо null. Permission
 * переспрашиваем (как у tag-list-handle) — вызывать из user-gesture.
 */
export async function getWritableProjectDir() {
  const handle = await idbGet(DIR_HANDLE_KEY)
  if (!handle) return null
  try {
    let perm = await handle.queryPermission?.({ mode: 'readwrite' })
    if (perm !== 'granted') perm = await handle.requestPermission?.({ mode: 'readwrite' })
    return perm === 'granted' ? handle : null
  } catch {
    return null
  }
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
