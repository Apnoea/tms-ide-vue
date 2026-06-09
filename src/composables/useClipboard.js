import { shapes } from '@joint/core'
import { useToast } from 'primevue/usetoast'
import { getStencilById } from '../stencils/registry'
import { injectStencilSvg, buildPortItems } from '../stencils/svgInjector'
import { TMSStencil } from '../stencils/tmsStencil'
import { LINK_DEFAULTS, buildLinkLabel } from '../stencils/linkDefaults'
import { nplural } from '../utils/plural'
import { snapToGrid } from '../utils/grid'
import { TOAST_LIFE } from '../constants/toast'
import { useCanvas } from './useCanvas'

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
  const toast = useToast()
  let clipboard = { cells: [], links: [] }

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
        // tms (voltageSource/switchSources) переносим.
        sourcePort: src.port || undefined,
        targetPort: tgt.port || undefined,
        sourceCellId: src.id,
        targetCellId: tgt.id,
        tms: link.get('tms') ? JSON.parse(JSON.stringify(link.get('tms'))) : null,
      })
    }
    return out
  }

  function pasteSnapshots(snaps) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper || !snaps.cells.length) {
      return { added: 0, skipped: 0, linksAdded: 0 }
    }
    const offset = 20
    const oldToNew = new Map()
    const newCellIds = []
    let skipped = 0

    for (const snap of snaps.cells) {
      const stencil = getStencilById(snap.stencilId)
      if (!stencil) {
        skipped++
        continue
      }

      const g = paper.options.gridSize
      const finalX = snapToGrid(snap.position.x + offset, g)
      const finalY = snapToGrid(snap.position.y + offset, g)

      const portItems = buildPortItems(stencil, snap.size.width, snap.size.height)

      // tms копируется полностью включая slots — paste должен сохранять привязки
      // тегов (две копии одного стенсила могут указывать на один и тот же объект,
      // это нормально для мнемосхем где много визуализаций одного агрегата).
      const cell = new TMSStencil({
        position: { x: finalX, y: finalY },
        size: snap.size,
        angle: snap.angle || 0,
        tms: { ...snap.tms, stencilId: snap.stencilId },
        ports: { items: portItems },
      })
      graph.addCell(cell)
      oldToNew.set(snap.oldId, cell.id)
      newCellIds.push(cell.id)

      const cellView = paper.findViewByModel(cell)
      if (cellView) injectStencilSvg(cellView, stencil)
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
      const labelText = linkSnap.tms?.label
      const linkModel = new shapes.standard.Link({
        ...LINK_DEFAULTS,
        source: { id: newSrcId, ...(linkSnap.sourcePort ? { port: linkSnap.sourcePort } : {}) },
        target: { id: newTgtId, ...(linkSnap.targetPort ? { port: linkSnap.targetPort } : {}) },
        ...(linkSnap.tms ? { tms: linkSnap.tms } : {}),
        // labels — derived от tms.label; на paste'е восстанавливаем визуал.
        ...(labelText ? { labels: [buildLinkLabel(labelText)] } : {}),
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

  /** Формирует строку для toast'а: «3 ячейки + 2 провода» или варианты. */
  function describePasted(added, linksAdded, skipped) {
    const parts = [nplural(added, 'ячейка', 'ячейки', 'ячеек')]
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
      toast.add({
        severity: 'info',
        summary: emptyLabel,
        detail: 'Выдели хотя бы одну ячейку',
        life: TOAST_LIFE.SHORT,
      })
      return null
    }
    return {
      cells: cellSel.map(snapshotCell).filter(Boolean),
      links: collectBridgeLinkSnaps(cellSel.map((s) => s.id)),
    }
  }

  /** Вставляет snapshots + показывает success/warn toast по результату. */
  function pasteWithToast(snaps, successLabel, failLabel) {
    const { added, skipped, linksAdded } = pasteSnapshots(snaps)
    if (added) {
      toast.add({
        severity: 'success',
        summary: successLabel,
        detail: describePasted(added, linksAdded, skipped),
        life: TOAST_LIFE.SHORT,
      })
    } else {
      toast.add({
        severity: 'warn',
        summary: failLabel,
        detail: 'Не удалось создать копии — стенсилы не найдены в реестре',
        life: TOAST_LIFE.NORMAL,
      })
    }
  }

  function copySelection() {
    const snaps = snapshotSelection('Нечего копировать')
    if (!snaps) return
    clipboard = snaps
    toast.add({
      severity: 'success',
      summary: 'Скопировано',
      detail: snaps.links.length
        ? `${nplural(snaps.cells.length, 'ячейка', 'ячейки', 'ячеек')} + ${nplural(snaps.links.length, 'провод', 'провода', 'проводов')}`
        : nplural(snaps.cells.length, 'ячейка', 'ячейки', 'ячеек'),
      life: TOAST_LIFE.SHORT,
    })
  }

  function pasteClipboard() {
    if (!clipboard.cells.length) {
      toast.add({
        severity: 'info',
        summary: 'Буфер пуст',
        detail: 'Скопируй ячейки через Ctrl+C',
        life: TOAST_LIFE.SHORT,
      })
      return
    }
    pasteWithToast(clipboard, 'Вставлено', 'Не удалось вставить')
  }

  function duplicateSelection() {
    const snaps = snapshotSelection('Нечего дублировать')
    if (snaps) pasteWithToast(snaps, 'Дублировано', 'Не удалось дублировать')
  }

  function hasClipboard() {
    return clipboard.cells.length > 0
  }

  return { copySelection, pasteClipboard, duplicateSelection, hasClipboard }
}
