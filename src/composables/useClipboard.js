import { shallowRef } from 'vue'
import { shapes } from '@joint/core'
import { getStencilById } from '../stencils/registry'
import { materializeStencil } from '../stencils/svgInjector'
import { LINK_DEFAULTS, linkStyleAttrs } from '../stencils/linkDefaults'
import { nplural } from '../utils/plural'
import { snapToGrid } from '../utils/grid'
import { useCanvas, genGroupId } from './useCanvas'
import { useNotify, TOAST_LIFE } from './useNotify'

/**
 * Copy / Paste / Duplicate для cell-выделения + bridge-провода.
 *
 * Внутренний буфер: { cells: [...], links: [...] }. Не уходит в нативный
 * clipboard (не вставится в другую вкладку), теряется на F5. Достаточно для
 * «продублировал кусок схемы внутри одного сеанса».
 *
 * Bridge-провода — линии, у которых ОБА конца лежат в копируемом наборе ячеек.
 * Их source/target id'ы на paste'е перевешиваются на новые ячейки через
 * oldId → newId маппинг.
 *
 * Зависит от `scheduleSnapshot` — после paste'а snapshot в undo-stack.
 *
 * Возвращает: `copySelection`, `pasteClipboard`, `duplicateSelection`,
 * `hasClipboard()` (для disabled-state UI).
 */
export function useClipboard({ scheduleSnapshot }) {
  const canvas = useCanvas()
  const notify = useNotify()
  // shallowRef — а не обычная let-переменная — нужен для реактивности `hasClipboard()`.
  // Если буфер не reactive, computed-зависимости (например `ctxItems` в CanvasPane,
  // решающий показывать ли «Вставить» в context-menu) не пересчитываются на копирование.
  const clipboard = shallowRef({ cells: [], links: [] })
  // Сколько раз текущий буфер уже вставляли. Каждый следующий Ctrl+V из одного
  // буфера сдвигается дальше (offset × N), иначе копии легли бы стопкой в одну
  // точку. Сбрасывается на copy. Duplicate буфер не трогает — у него всегда
  // свежий снимок текущего выделения, шаг = 1.
  let pasteCount = 0

  function snapshotCell(item) {
    const graph = canvas.graphRef.value
    const c = graph?.getCell(item.id)
    if (!c) return null
    const tms = c.get('tms') || {}
    const pos = c.get('position')
    const size = c.get('size')
    return {
      oldId: c.id,
      stencilId: tms.stencilId,
      tms: { ...tms },
      position: { x: pos.x, y: pos.y },
      size: { width: size.width, height: size.height },
      angle: c.angle() || 0,
    }
  }

  /** Собирает снимки всех bridge-линий между cellIds (оба конца внутри набора). */
  function collectBridgeLinkSnaps(cellIds) {
    const graph = canvas.graphRef.value
    if (!graph) return []
    const set = new Set(cellIds)
    const out = []
    for (const link of graph.getLinks()) {
      const src = link.get('source')
      const tgt = link.get('target')
      if (!src?.id || !tgt?.id || !set.has(src.id) || !set.has(tgt.id)) continue
      out.push({
        // Только port — сами cell-id'ы переписываются на paste'е через oldToNew.
        // tms (rangeSource/boolSource) переносим.
        sourcePort: src.port || undefined,
        targetPort: tgt.port || undefined,
        sourceCellId: src.id,
        targetCellId: tgt.id,
        // Ручные изломы — иначе выправленный маршрут спрямился бы на paste'е.
        vertices: (link.get('vertices') || []).map((v) => ({ x: v.x, y: v.y })),
        tms: link.get('tms') ? JSON.parse(JSON.stringify(link.get('tms'))) : null,
      })
    }
    return out
  }

  function pasteSnapshots(snaps, offsetSteps = 1) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper || !snaps.cells.length) {
      return { added: 0, skipped: 0, linksAdded: 0 }
    }
    const offset = 20 * offsetSteps
    const oldToNew = new Map()
    const newCellIds = []
    let skipped = 0

    // Группы копий — своя новая метка (иначе копия слилась бы с оригинальной
    // группой). groupId переносим ТОЛЬКО если скопировано ≥2 членов той группы —
    // одиночную копию из группы разгруппировываем (группа из одного бессмысленна).
    const groupCounts = {}
    for (const s of snaps.cells) {
      const g = s.tms?.groupId
      if (g) groupCounts[g] = (groupCounts[g] || 0) + 1
    }
    const groupIdMap = new Map()

    for (const snap of snaps.cells) {
      const stencil = getStencilById(snap.stencilId)
      if (!stencil) {
        skipped++
        continue
      }

      const tmsCopy = { ...snap.tms, stencilId: snap.stencilId }
      if (tmsCopy.groupId) {
        if (groupCounts[tmsCopy.groupId] >= 2) {
          if (!groupIdMap.has(tmsCopy.groupId)) groupIdMap.set(tmsCopy.groupId, genGroupId())
          tmsCopy.groupId = groupIdMap.get(tmsCopy.groupId)
        } else {
          delete tmsCopy.groupId
        }
      }

      const g = paper.options.gridSize
      const finalX = snapToGrid(snap.position.x + offset, g)
      const finalY = snapToGrid(snap.position.y + offset, g)

      // tms копируется полностью включая slots — paste должен сохранять привязки
      // тегов (две копии одного стенсила могут указывать на один и тот же объект,
      // это нормально для мнемосхем где много визуализаций одного агрегата).
      // flip-порты берутся из tmsCopy внутри materializeStencil.
      const cell = materializeStencil(graph, paper, stencil, {
        position: { x: finalX, y: finalY },
        size: snap.size,
        angle: snap.angle || 0,
        tms: tmsCopy,
      })
      oldToNew.set(snap.oldId, cell.id)
      newCellIds.push(cell.id)
    }

    // Восстанавливаем bridge-линии: id ячеек перевешиваем через oldToNew,
    // port-id'ы остаются те же (новые ячейки того же стенсила имеют такие же
    // порты). Конструируем явно через new shapes.standard.Link(LINK_DEFAULTS) —
    // иначе graph.addCell(jsonSpec) теряет router/connector/attrs (factory
    // defaultLink на JSON-path не применяется), и линки получаются «голые».
    let linksAdded = 0
    const newLinkItems = []
    for (const linkSnap of snaps.links) {
      const newSrcId = oldToNew.get(linkSnap.sourceCellId)
      const newTgtId = oldToNew.get(linkSnap.targetCellId)
      if (!newSrcId || !newTgtId) continue
      const linkModel = new shapes.standard.Link({
        ...LINK_DEFAULTS,
        source: { id: newSrcId, ...(linkSnap.sourcePort ? { port: linkSnap.sourcePort } : {}) },
        target: { id: newTgtId, ...(linkSnap.targetPort ? { port: linkSnap.targetPort } : {}) },
        // Изломы сдвигаем на тот же offset, что и ячейки — маршрут сохраняет форму.
        ...(linkSnap.vertices?.length
          ? { vertices: linkSnap.vertices.map((v) => ({ x: v.x + offset, y: v.y + offset })) }
          : {}),
        ...(linkSnap.tms ? { tms: linkSnap.tms } : {}),
        // Стиль линии (толщина/цвет) живёт в tms — дублируем в attrs.line, иначе
        // копия рисуется дефолтной (см. linkStyleAttrs).
        ...(linkStyleAttrs(linkSnap.tms) ? { attrs: linkStyleAttrs(linkSnap.tms) } : {}),
      })
      graph.addCell(linkModel)
      newLinkItems.push({ kind: 'link', id: linkModel.id })
      linksAdded++
    }

    if (newCellIds.length) {
      canvas.setSelection([...newCellIds.map((id) => ({ kind: 'cell', id })), ...newLinkItems])
      scheduleSnapshot()
    }
    return { added: newCellIds.length, skipped, linksAdded }
  }

  /** Формирует строку для toast'а: «3 символа + 2 провода» или варианты. */
  function describePasted(added, linksAdded, skipped) {
    const parts = [nplural(added, 'символ', 'символа', 'символов')]
    if (linksAdded > 0) {
      parts.push(nplural(linksAdded, 'провод', 'провода', 'проводов'))
    }
    let out = parts.join(' + ')
    if (skipped > 0) out += ` · пропущено: ${skipped}`
    return out
  }

  /** Снимает snapshot выделенных ячеек + bridge-проводов. null + toast если пусто. */
  function snapshotSelection(emptyLabel) {
    const graph = canvas.graphRef.value
    if (!graph) return null
    const cellSel = canvas.selection.value.filter((s) => s.kind === 'cell')
    if (!cellSel.length) {
      notify.info(emptyLabel, 'Выдели хотя бы один символ', TOAST_LIFE.SHORT)
      return null
    }
    return {
      cells: cellSel.map(snapshotCell).filter(Boolean),
      links: collectBridgeLinkSnaps(cellSel.map((s) => s.id)),
    }
  }

  /** Вставляет snapshots + показывает success/warn toast по результату. */
  function pasteWithToast(snaps, successLabel, failLabel, offsetSteps = 1) {
    const { added, skipped, linksAdded } = pasteSnapshots(snaps, offsetSteps)
    if (added) {
      notify.success(successLabel, describePasted(added, linksAdded, skipped))
    } else {
      notify.warn(failLabel, 'Не удалось создать копии — стенсилы не найдены в реестре')
    }
  }

  function copySelection() {
    const snaps = snapshotSelection('Нечего копировать')
    if (!snaps) return
    clipboard.value = snaps
    pasteCount = 0
    notify.success(
      'Скопировано',
      snaps.links.length
        ? `${nplural(snaps.cells.length, 'символ', 'символа', 'символов')} + ${nplural(snaps.links.length, 'провод', 'провода', 'проводов')}`
        : nplural(snaps.cells.length, 'символ', 'символа', 'символов')
    )
  }

  function pasteClipboard() {
    if (!clipboard.value.cells.length) {
      notify.info('Буфер пуст', 'Скопируй символы через Ctrl+C', TOAST_LIFE.SHORT)
      return
    }
    pasteCount++
    pasteWithToast(clipboard.value, 'Вставлено', 'Не удалось вставить', pasteCount)
  }

  function duplicateSelection() {
    const snaps = snapshotSelection('Нечего дублировать')
    if (snaps) pasteWithToast(snaps, 'Дублировано', 'Не удалось дублировать')
  }

  function hasClipboard() {
    return clipboard.value.cells.length > 0
  }

  return { copySelection, pasteClipboard, duplicateSelection, hasClipboard }
}
