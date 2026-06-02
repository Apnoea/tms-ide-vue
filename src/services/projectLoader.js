// Восстанавливает структуру JointJS-граф'а из экспортированного view.svg.
// Опирается на data-tms-meta JSON-атрибут на каждой ячейке (<g>) и проводе (<path>),
// который пишется в exporter.js. svg-геометрия используется только для transform.

import { getStencilById } from '../stencils/registry'
import { computeBusPorts } from '../stencils/svgInjector'
import { LINK_DEFAULTS } from '../stencils/linkDefaults'

/**
 * Парсит SVG-текст и возвращает массив JointJS-cells (включая links),
 * готовый для graph.fromJSON.
 *
 * Возвращает { ok, cells, errors }.
 *  - ok: общий success-флаг (true если хоть что-то распарсилось)
 *  - cells: массив JointJS-совместимых cell-JSON
 *  - errors: массив warning-строк (для toast'а пользователю)
 */
export function parseSvgProject(svgText) {
  let doc
  try {
    doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  } catch (e) {
    return { ok: false, cells: [], errors: [`SVG не распарсился: ${e.message}`] }
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, cells: [], errors: ['SVG не распарсился (parse error)'] }
  }

  const cells = []
  const errors = []

  // ─── Ячейки: <g> с data-tms-meta ───
  for (const g of doc.querySelectorAll('g[data-tms-meta]')) {
    try {
      const meta = JSON.parse(g.getAttribute('data-tms-meta'))
      if (!meta.id || !meta.stencilId) {
        errors.push('Ячейка без id/stencilId — пропускаю')
        continue
      }

      // transform="translate(X,Y)" — координаты на холсте
      const tr = g.getAttribute('transform') || ''
      const m = tr.match(/translate\s*\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/)
      if (!m) {
        errors.push(`Ячейка ${meta.id}: нет transform`)
        continue
      }
      const x = parseFloat(m[1])
      const y = parseFloat(m[2])

      const stencil = getStencilById(meta.stencilId)
      if (!stencil) {
        errors.push(`Стенсил "${meta.stencilId}" не зарегистрирован — пропускаю`)
        continue
      }

      const width = meta.width ?? stencil.width
      const height = meta.height ?? stencil.height

      // Порты восстанавливаем из определения стенсила. Для шины — динамически
      // по ширине, для остальных — из stencil.json.
      const portItems =
        meta.stencilId === 'cell_bus'
          ? computeBusPorts(width, height)
          : (stencil.ports || []).map((p) => ({
              id: p.name,
              group: 'port',
              args: { x: p.x, y: p.y },
            }))

      // Собираем tms-payload только из того, что было в meta (не плодим undefined)
      const tms = { stencilId: meta.stencilId }
      if (meta.slots) tms.slots = { ...meta.slots }
      if (meta.text !== undefined) tms.text = meta.text
      if (meta.fontSize !== undefined) tms.fontSize = meta.fontSize
      if (meta.bold !== undefined) tms.bold = meta.bold
      if (meta.valueTag !== undefined) tms.valueTag = meta.valueTag
      if (meta.voltageSource) tms.voltageSource = meta.voltageSource
      if (meta.switchSources) tms.switchSources = meta.switchSources
      // Backward-compat: старый формат `switchSource: { tag }` → массив.
      else if (meta.switchSource?.tag) tms.switchSources = { tags: [meta.switchSource.tag] }
      if (meta.navigation) tms.navigation = meta.navigation

      cells.push({
        type: 'tms.Stencil',
        id: meta.id,
        position: { x, y },
        size: { width, height },
        tms,
        ports: { items: portItems },
      })
    } catch (e) {
      errors.push(`Парсинг ячейки: ${e.message}`)
    }
  }

  // ─── Провода: <path> с data-tms-meta ───
  for (const p of doc.querySelectorAll('path[data-tms-meta]')) {
    try {
      const meta = JSON.parse(p.getAttribute('data-tms-meta'))
      if (!meta.source?.id || !meta.target?.id) {
        errors.push('Провод без source/target — пропускаю')
        continue
      }

      // Конфиг визуала (router/connector/attrs без стрелок) — из общего модуля,
      // тот же что у defaultLink в CanvasPane. Иначе восстановленный провод
      // получил бы дефолты JointJS со стрелкой на target.
      const link = {
        ...LINK_DEFAULTS,
        type: 'standard.Link',
        id: meta.id,
        source: meta.source,
        target: meta.target,
      }
      if (meta.voltageSource || meta.switchSources || meta.switchSource) {
        link.tms = {}
        if (meta.voltageSource) link.tms.voltageSource = meta.voltageSource
        if (meta.switchSources) link.tms.switchSources = meta.switchSources
        else if (meta.switchSource?.tag) link.tms.switchSources = { tags: [meta.switchSource.tag] }
      }
      cells.push(link)
    } catch (e) {
      errors.push(`Парсинг провода: ${e.message}`)
    }
  }

  return { ok: cells.length > 0, cells, errors }
}
