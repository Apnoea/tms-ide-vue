/**
 * Перенос диапазонов с ЭЛЕМЕНТОВ в СИМВОЛЫ: схемы прошлых версий держат строки
 * «пороги → цвет» в `tms.rangeSource` каждой ячейки, а новый порядок — зоны в
 * определении символа (`stencil.ranges`) плюс тег в слоте `range` на ячейке.
 *
 * Переносим ТОЛЬКО когда у всех ячеек символа набор строк совпадает: расхождение
 * означает, что зоны подбирали под конкретный объект, и общий набор их бы переписал.
 * Символ с уже заданными зонами и залоченный (программные, кроме шины) не трогаем — у
 * первого есть свой набор, у второго зон в определении не бывает.
 *
 * План чистый: вход не мутируется, наружу уходят новые объекты форм и зоны символов.
 * Применяет их вызывающий (реестр + IDB + файлы) — здесь только решение.
 */

import { RANGE_SLOT } from '../constants/ids'
import { cleanRangeRows } from '../utils/rangeRows'
import { graphJsonAccess, inheritedRangeSource, isPassThrough } from '../utils/rangeSource'
import { isBusStencil } from '../stencils/registry'

/**
 * Очистка проводов и точек от собственных диапазонов, совпадающих с унаследованными:
 * провод у шины с тем же тегом и теми же строками настройки не требует — сняв её, он
 * начинает следовать за шиной (правка строк на шине красит и его). Настройка с ДРУГИМ
 * тегом или строками (ток фидера, замеренный на линии) остаётся: своё у провода больше
 * не создать, и молча терять его нельзя.
 *
 * Сравнение — по исходному графу формы: провод со своей настройкой сам служит
 * источником для соседей, и снимать его настройку можно лишь когда она равна тому, что
 * он унаследовал бы без неё. Вход не мутируется.
 *
 * @param {Array<{id: string, graphJson: object}>} forms
 * @param {(id: string) => object|undefined} getStencil
 * @returns {{forms: Array<{id: string, graphJson: object}>, cleared: number}}
 */
export function planWireRangeCleanup(forms, getStencil) {
  let cleared = 0
  const changedForms = []
  for (const form of forms || []) {
    const cells = form?.graphJson?.cells
    if (!Array.isArray(cells)) continue
    const access = graphJsonAccess(form.graphJson)
    let touched = false
    const next = cells.map((cell) => {
      const node = access.of(cell)
      const own = node?.tms?.rangeSource
      if (!isPassThrough(node) || !own?.tag) return cell
      const inherited = inheritedRangeSource(node, access, getStencil)
      if (!inherited || inherited.tag !== own.tag) return cell
      if (
        JSON.stringify(cleanRangeRows(inherited.ranges)) !==
        JSON.stringify(cleanRangeRows(own.ranges))
      ) {
        return cell
      }
      touched = true
      cleared++
      const nextTms = { ...node.tms }
      delete nextTms.rangeSource
      return { ...cell, tms: nextTms }
    })
    if (touched) changedForms.push({ id: form.id, graphJson: { ...form.graphJson, cells: next } })
  }
  return { forms: changedForms, cleared }
}

/**
 * @param {Array<{id: string, graphJson: object}>} forms — все формы проекта
 * @param {(id: string) => object|undefined} getStencil — реестр символов
 * @returns {{
 *   stencils: Array<{id: string, ranges: Array}>,
 *   forms: Array<{id: string, graphJson: object}>,
 *   moved: number,
 *   skipped: Array<{stencilId: string, reason: string}>
 * }}
 */
export function planRangeMigration(forms, getStencil) {
  const byStencil = new Map()
  for (const form of forms || []) {
    for (const cell of form?.graphJson?.cells || []) {
      const tms = cell?.tms
      const stencilId = tms?.stencilId
      if (!stencilId || !tms.rangeSource?.ranges?.length) continue
      const rows = cleanRangeRows(tms.rangeSource.ranges)
      if (!rows.length) continue // строки без цвета/порогов — переносить нечего
      const entry = byStencil.get(stencilId) || { keys: new Set(), rows }
      // Канонический JSON — ключ сравнения наборов между ячейками.
      entry.keys.add(JSON.stringify(rows))
      byStencil.set(stencilId, entry)
    }
  }

  const stencils = []
  const skipped = []
  const targets = new Set()
  for (const [stencilId, entry] of byStencil) {
    const stencil = getStencil?.(stencilId)
    if (!stencil) {
      skipped.push({ stencilId, reason: 'символа нет в реестре' })
      continue
    }
    // Программные символы зон не несут — кроме шины: у неё зоны в определении, как у всех.
    if (stencil.locked && !isBusStencil(stencil)) {
      skipped.push({ stencilId, reason: 'символ не редактируется' })
      continue
    }
    if (stencil.ranges?.length) {
      skipped.push({ stencilId, reason: 'зоны уже заданы' })
      continue
    }
    if (entry.keys.size > 1) {
      skipped.push({ stencilId, reason: `наборы расходятся (${entry.keys.size})` })
      continue
    }
    stencils.push({ id: stencilId, ranges: entry.rows })
    targets.add(stencilId)
  }

  return { stencils, ...migrateFormsRanges(forms, targets), skipped }
}

/**
 * Формы после переноса: у ячеек символов из `targets` строки снимаются, тег уезжает в
 * слот `range`. Отдельно от плана, потому что применять надо по символам, которые
 * РЕАЛЬНО приняли зоны — если регистрация одного из них не удалась, его ячейки
 * остаются с собственным источником, иначе цвет на них пропал бы.
 *
 * @param {Array<{id: string, graphJson: object}>} forms
 * @param {Set<string>} targets — id символов, получивших зоны
 * @returns {{forms: Array<{id: string, graphJson: object}>, moved: number}}
 */
export function migrateFormsRanges(forms, targets) {
  let moved = 0
  const changedForms = []
  for (const form of forms || []) {
    const cells = form?.graphJson?.cells
    if (!Array.isArray(cells)) continue
    let touched = false
    const next = cells.map((cell) => {
      const tms = cell?.tms
      if (!tms?.stencilId || !targets.has(tms.stencilId) || !tms.rangeSource?.ranges?.length) {
        return cell
      }
      touched = true
      moved++
      const nextTms = { ...tms }
      const tag = tms.rangeSource.tag
      if (tag) nextTms.slots = { ...(tms.slots || {}), [RANGE_SLOT]: tag }
      delete nextTms.rangeSource
      return { ...cell, tms: nextTms }
    })
    if (touched) changedForms.push({ id: form.id, graphJson: { ...form.graphJson, cells: next } })
  }
  return { forms: changedForms, moved }
}
