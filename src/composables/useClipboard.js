import { shallowRef } from 'vue'
import { shapes } from '@joint/core'
import { getStencilById } from '../stencils/registry'
import { materializeStencil } from '../stencils/svgInjector'
import { isShapeCell, materializeShape } from '../stencils/shapeElement'
import { translateShape } from '../utils/stencilSvg'
import { LINK_DEFAULTS, isFreeEnd, linkStyleAttrs, normalizeLinkZ } from '../stencils/linkDefaults'
import { isBackgroundZ } from '../utils/zOrder'
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
  // Шаг сдвига копии от того, к чему она цепляется, — иначе копии легли бы стопкой.
  const PASTE_STEP = 20
  // Ячейки ПОСЛЕДНЕЙ вставки: следующий Ctrl+V считает сдвиг от них в ИХ ТЕКУЩЕМ
  // месте, а не от снимка в буфере — иначе, отвезя копию в сторону, вторая вставка
  // легла бы рядом с её прежним местом. Сброс на copy; нет живых копий (удалили,
  // сменили форму) — отсчёт снова от оригинала. Duplicate буфер не трогает: он берёт
  // свежий снимок выделения, а выделением после дубля становится сама копия.
  let pasteAnchorIds = null

  function snapshotCell(item) {
    const graph = canvas.graphRef.value
    const c = graph?.getCell(item.id)
    if (!c) return null
    const tms = c.get('tms') || {}
    const pos = c.get('position')
    const size = c.get('size')
    return {
      oldId: c.id,
      // Фигура-разметка вместо символа несёт свою геометрию: у неё нет ни
      // stencilId, ни портов, поэтому и создаётся она иначе (см. pasteSnapshots).
      isShape: isShapeCell(c),
      stencilId: tms.stencilId,
      tms: { ...tms },
      position: { x: pos.x, y: pos.y },
      size: { width: size.width, height: size.height },
      angle: c.angle() || 0,
      // Не абсолютный z (вставка ложится сверху), а порядок материализации: addCell
      // даёт z = max+1, поэтому наложение копий = порядок обхода.
      z: c.get('z') ?? 0,
    }
  }

  /**
   * Снимок конца провода: привязка к ячейке (id переписывается на paste'е) либо
   * свободная точка — её копия сдвигается тем же вектором, что ячейки.
   */
  function endSnap(end) {
    if (end?.id) return { cellId: end.id, port: end.port || undefined }
    return { point: { x: end.x, y: end.y } }
  }

  /**
   * Собирает снимки всех bridge-линий набора cellIds — тем же правилом, что
   * `computeBridgeLinks` (оно решает, что попадёт в выделение): каждый конец либо в
   * наборе, либо свободен, и хотя бы один привязан. Свободный конец обязан
   * копироваться: иначе провод, у которого он есть, выделяется вместе с символом, но
   * молча не вставляется — а до появления свободных концов на его месте была ячейка
   * `cell_node`, и копия работала.
   */
  function collectBridgeLinkSnaps(cellIds) {
    const graph = canvas.graphRef.value
    if (!graph) return []
    const set = new Set(cellIds)
    const belongs = (end) => (end?.id ? set.has(end.id) : isFreeEnd(end))
    const out = []
    for (const link of graph.getLinks()) {
      const src = link.get('source')
      const tgt = link.get('target')
      if (!src?.id && !tgt?.id) continue
      if (!belongs(src) || !belongs(tgt)) continue
      out.push({
        // tms (rangeSource/boolSource) переносим.
        source: endSnap(src),
        target: endSnap(tgt),
        // Ручные изломы — иначе выправленный маршрут спрямился бы на paste'е.
        vertices: (link.get('vertices') || []).map((v) => ({ x: v.x, y: v.y })),
        // Место в полосе проводов. В отличие от ячеек (там копия ложится сверху)
        // z переносим абсолютным: полоса фиксирована, а «кто кого огибает» —
        // осознанный выбор автора, и копия обязана огибать так же.
        z: link.get('z'),
        tms: link.get('tms') ? JSON.parse(JSON.stringify(link.get('tms'))) : null,
      })
    }
    return out
  }

  function pasteSnapshots(snaps, shift = { dx: PASTE_STEP, dy: PASTE_STEP }) {
    const graph = canvas.graphRef.value
    const paper = canvas.paperRef.value
    if (!graph || !paper || !snaps.cells.length) {
      return { added: 0, skipped: 0, linksAdded: 0 }
    }
    const { dx, dy } = shift
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

    // Материализуем в порядке z оригиналов — см. snapshotCell.z. Сортируем копию
    // массива: буфер переиспользуется на каждый Ctrl+V.
    const ordered = [...snaps.cells].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
    for (const snap of ordered) {
      const stencil = snap.isShape ? null : getStencilById(snap.stencilId)
      if (!snap.isShape && !stencil) {
        skipped++
        continue
      }

      const tmsCopy = { ...snap.tms, ...(snap.isShape ? {} : { stencilId: snap.stencilId }) }
      // Закрепление на шине копия не наследует: она встаёт со сдвигом, то есть уже не
      // на шине, а ездила бы за ней (см. useBusSnap). Нужно — перетащат на шину сами.
      delete tmsCopy.busId
      if (tmsCopy.groupId) {
        if (groupCounts[tmsCopy.groupId] >= 2) {
          if (!groupIdMap.has(tmsCopy.groupId)) groupIdMap.set(tmsCopy.groupId, genGroupId())
          tmsCopy.groupId = groupIdMap.get(tmsCopy.groupId)
        } else {
          delete tmsCopy.groupId
        }
      }

      const g = paper.options.gridSize
      const finalX = snapToGrid(snap.position.x + dx, g)
      const finalY = snapToGrid(snap.position.y + dy, g)

      if (snap.isShape) {
        // Геометрия в tms локальная (прижата к 0,0) — materializeShape ждёт
        // абсолютную и сам пересчитает габарит с позицией.
        const cell = materializeShape(graph, paper, translateShape(tmsCopy.shape, finalX, finalY))
        if (!cell) {
          skipped++
          continue
        }
        // Замок и группу переносим как у символов; angle — поле верхнего уровня.
        const carried = { ...tmsCopy }
        delete carried.shape
        cell.set('tms', { ...cell.get('tms'), ...carried })
        if (snap.angle) cell.set('angle', snap.angle)
        // Копия ложится сверху (см. snapshotCell.z), но подложку сохраняем: иначе
        // вставленная плашка окажется поверх проводов, а не под ними.
        if (isBackgroundZ(snap.z)) cell.set('z', snap.z)
        oldToNew.set(snap.oldId, cell.id)
        newCellIds.push(cell.id)
        continue
      }

      // tms копируется полностью включая slots — paste должен сохранять привязки
      // тегов (две копии одного символа могут указывать на один и тот же объект,
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
    // port-id'ы остаются те же (новые ячейки того же символа имеют такие же
    // порты). Конструируем явно через new shapes.standard.Link(LINK_DEFAULTS) —
    // иначе graph.addCell(jsonSpec) теряет router/connector/attrs (factory
    // defaultLink на JSON-path не применяется), и линки получаются «голые».
    let linksAdded = 0
    const newLinkItems = []
    // Конец копии: привязанный садится на новую ячейку (порт тот же — у копии того же
    // символа порты называются так же), свободный уезжает на вектор вставки. Ячейка
    // не скопировалась (нет в oldToNew) — провод пропускаем, иначе конец повис бы.
    const pasteEnd = (snap) => {
      if (snap?.point) return { x: snap.point.x + dx, y: snap.point.y + dy }
      const id = oldToNew.get(snap?.cellId)
      return id ? { id, ...(snap.port ? { port: snap.port } : {}) } : null
    }
    for (const linkSnap of snaps.links) {
      const source = pasteEnd(linkSnap.source)
      const target = pasteEnd(linkSnap.target)
      if (!source || !target) continue
      const linkModel = new shapes.standard.Link({
        ...LINK_DEFAULTS,
        source,
        target,
        // Изломы сдвигаем на тот же вектор, что и ячейки — маршрут сохраняет форму.
        ...(linkSnap.vertices?.length
          ? { vertices: linkSnap.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })) }
          : {}),
        ...(linkSnap.tms ? { tms: linkSnap.tms } : {}),
        // Порядок в полосе (см. снимок): add-хендлер холста пропускает значение
        // из полосы как есть, всё прочее уводит на дно.
        z: normalizeLinkZ(linkSnap.z),
        // Стиль линии (толщина/цвет) живёт в tms — дублируем в attrs.line, иначе
        // копия рисуется дефолтной; концы нужны, чтобы у свободного появилась точка.
        ...(() => {
          const attrs = linkStyleAttrs(linkSnap.tms, source, target)
          return attrs ? { attrs } : {}
        })(),
      })
      graph.addCell(linkModel)
      newLinkItems.push({ kind: 'link', id: linkModel.id })
      linksAdded++
    }

    if (newCellIds.length) {
      canvas.setSelection([...newCellIds.map((id) => ({ kind: 'cell', id })), ...newLinkItems])
      scheduleSnapshot()
    }
    return { added: newCellIds.length, skipped, linksAdded, cellIds: newCellIds }
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

  /**
   * Левый-верхний угол набора: точка отсчёта и для снимка в буфере, и для живых
   * ячеек последней вставки. Берём минимум, а не bbox с размерами: сравниваем один
   * набор с его же копией, размеры у них одинаковые.
   */
  function originOfSnaps(snaps) {
    const xs = snaps.cells.map((s) => s.position.x)
    const ys = snaps.cells.map((s) => s.position.y)
    return { x: Math.min(...xs), y: Math.min(...ys) }
  }

  /** То же по живым ячейкам последней вставки. null — их больше нет в графе. */
  function originOfAnchor() {
    const graph = canvas.graphRef.value
    if (!graph || !pasteAnchorIds?.length) return null
    const cells = pasteAnchorIds.map((id) => graph.getCell(id)).filter(Boolean)
    if (!cells.length) return null
    const positions = cells.map((c) => c.get('position'))
    return {
      x: Math.min(...positions.map((p) => p.x)),
      y: Math.min(...positions.map((p) => p.y)),
    }
  }

  /** Вставляет snapshots + показывает success/warn toast по результату. */
  function pasteWithToast(snaps, successLabel, failLabel, shift) {
    const result = pasteSnapshots(snaps, shift)
    if (result.added) {
      notify.success(successLabel, describePasted(result.added, result.linksAdded, result.skipped))
    } else {
      notify.warn(failLabel, 'Не удалось создать копии — символы не найдены в реестре')
    }
    return result
  }

  function copySelection() {
    const snaps = snapshotSelection('Нечего копировать')
    if (!snaps) return
    clipboard.value = snaps
    pasteAnchorIds = null
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
    // Цепляемся к предыдущей копии там, где она СЕЙЧАС; если её нет (первый Ctrl+V,
    // копии удалили, сменили форму) — к оригиналу из буфера.
    const src = originOfSnaps(clipboard.value)
    const base = originOfAnchor() || src
    const shift = {
      dx: base.x - src.x + PASTE_STEP,
      dy: base.y - src.y + PASTE_STEP,
    }
    const { cellIds } = pasteWithToast(clipboard.value, 'Вставлено', 'Не удалось вставить', shift)
    if (cellIds?.length) pasteAnchorIds = cellIds
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
