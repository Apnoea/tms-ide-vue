// Восстанавливает структуру JointJS-граф'а из экспортированного view.svg.
// Опирается на data-tms-meta JSON-атрибут на каждой ячейке (<g>) и проводе (<path>),
// который пишется в exporter.js. svg-геометрия используется только для transform.

import { getStencilById } from '../stencils/registry'
import { buildPortItems } from '../stencils/svgInjector'
import { LINK_DEFAULTS, linkStyleAttrs, normalizeLinkZ } from '../stencils/linkDefaults'
import { ATTR_META, CELL_META_FIELDS, LINK_META_FIELDS } from '../constants/ids'

/**
 * Парсит SVG-текст и возвращает массив JointJS-cells (включая links),
 * готовый для graph.fromJSON.
 *
 * Возвращает { ok, cells, errors, stencilIds }.
 *  - ok: SVG успешно распарсился. Пустая форма (0 ячеек) — это ok=true: пустая
 *    схема ≠ битый файл, импорт обязан сохранить её (заготовка / цель навигации).
 *    ok=false только при реальном сбое парсинга (пустой ввод / parse error).
 *  - cells: массив JointJS-совместимых cell-JSON
 *  - errors: массив warning-строк (для toast'а пользователю)
 *  - stencilIds: все stencilId, встреченные в meta (включая выкинутые из-за
 *    незарегистрированного стенсила) — для подсчёта недостающих стенсилов
 */
export function parseSvgProject(svgText) {
  if (!svgText || !svgText.trim()) {
    return { ok: false, cells: [], errors: ['Пустой SVG'], stencilIds: [] }
  }
  let doc
  try {
    doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  } catch (e) {
    return { ok: false, cells: [], errors: [`SVG не распарсился: ${e.message}`], stencilIds: [] }
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, cells: [], errors: ['SVG не распарсился (parse error)'], stencilIds: [] }
  }

  const cells = []
  const errors = []
  const stencilIds = new Set()
  const elementIds = new Set() // id успешно собранных ячеек — для отсева висячих проводов

  // ─── Ячейки: <g> с data-tms-meta ───
  for (const g of doc.querySelectorAll(`g[${ATTR_META}]`)) {
    try {
      const meta = JSON.parse(g.getAttribute(ATTR_META))
      if (!meta.id || !meta.stencilId) {
        errors.push('Символ без id/stencilId — пропускаю')
        continue
      }

      // transform="translate(X,Y)" — координаты на холсте
      const tr = g.getAttribute('transform') || ''
      const m = tr.match(/translate\s*\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/)
      if (!m) {
        errors.push(`Символ ${meta.id}: нет transform`)
        continue
      }
      const x = parseFloat(m[1])
      const y = parseFloat(m[2])

      stencilIds.add(meta.stencilId)
      const stencil = getStencilById(meta.stencilId)
      if (!stencil) {
        errors.push(`Символ "${meta.stencilId}" не зарегистрирован — пропускаю`)
        continue
      }

      const width = meta.width ?? stencil.width
      const height = meta.height ?? stencil.height

      // Порты отражаем под flip символа (позиции x'=W-x / y'=H-y), чтобы провода
      // после загрузки сошлись с отражённым символом.
      const portItems = buildPortItems(stencil, width, height, {
        flipH: !!meta.flipH,
        flipV: !!meta.flipV,
      })

      // Собираем tms-payload по тому же дескриптору, что пишет exporter
      // (CELL_META_FIELDS) — единый список, не плодим undefined.
      // legacyKey — прежнее имя поля в старых архивах (см. services/legacyFormat):
      // читаем как fallback и записываем уже под новым именем.
      const tms = { stencilId: meta.stencilId }
      for (const f of CELL_META_FIELDS) {
        const raw = meta[f.key] ?? (f.legacyKey ? meta[f.legacyKey] : undefined)
        if (raw === undefined) continue
        const v = f.normalize ? f.normalize(raw) : raw
        // normalize отдал undefined = значение не спасти (нечисловой размер шрифта,
        // неизвестный якорь): ключ не пишем вовсе, иначе в tms поселился бы
        // undefined и уехал в следующий экспорт как «поле есть, значения нет».
        if (v === undefined) continue
        tms[f.key] = f.clone ? { ...v } : v
      }

      const cellJson = {
        type: 'tms.Stencil',
        id: meta.id,
        position: { x, y },
        size: { width, height },
        tms,
        ports: { items: portItems },
      }
      // JointJS пишет angle в верхнее поле cell.toJSON() — там же его и читает
      // в fromJSON. Применится автоматически как transform на outer-`<g>`.
      // Числа из чужого архива проверяем: NaN в z ломает сортировку коллекции,
      // «1e9» в angle — бессмысленный поворот. angle приводим к 0..359, z клампим
      // нулём снизу (отрицательный утащил бы символ под провода).
      const angle = Number.parseFloat(meta.angle)
      if (Number.isFinite(angle) && angle % 360 !== 0) cellJson.angle = ((angle % 360) + 360) % 360
      const z = Number.parseFloat(meta.z)
      if (Number.isFinite(z)) cellJson.z = Math.max(0, z)
      cells.push(cellJson)
      elementIds.add(meta.id)
    } catch (e) {
      errors.push(`Парсинг символа: ${e.message}`)
    }
  }

  // ─── Провода: <path> с data-tms-meta ───
  for (const p of doc.querySelectorAll(`path[${ATTR_META}]`)) {
    try {
      const meta = JSON.parse(p.getAttribute(ATTR_META))
      if (!meta.source?.id || !meta.target?.id) {
        errors.push('Провод без source/target — пропускаю')
        continue
      }
      // Оба конца должны ссылаться на собранную ячейку. Иначе висячий линк, и
      // graph.fromJSON бросит «invalid source/target cell» — а форма к этому моменту
      // уже в IDB → restoreProject падал бы на КАЖДОЙ загрузке (проект залипал).
      if (!elementIds.has(meta.source.id) || !elementIds.has(meta.target.id)) {
        errors.push(`Провод ${meta.id}: конец ссылается на отсутствующий символ — пропускаю`)
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
      // Ручные изломы: без них gridRightAngle-роутер перерисовал бы провод по
      // дефолтному маршруту, потеряв правки пользователя.
      if (Array.isArray(meta.vertices) && meta.vertices.length) link.vertices = meta.vertices
      // Порядок в полосе проводов. Нормализуем: meta из чужого архива, значение
      // вне полосы вынесло бы провод поверх символов.
      if (meta.z != null) link.z = normalizeLinkZ(meta.z)
      // tms-поля провода по тому же дескриптору, что пишет exporter (LINK_META_FIELDS).
      for (const f of LINK_META_FIELDS) {
        const v = meta[f.key] ?? (f.legacyKey ? meta[f.legacyKey] : undefined)
        if (v === undefined) continue
        link.tms = link.tms || {}
        link.tms[f.key] = v
      }
      // Стиль линии из tms → attrs.line (иначе провод нарисуется дефолтным).
      const styleAttrs = linkStyleAttrs(link.tms)
      if (styleAttrs) link.attrs = styleAttrs
      cells.push(link)
    } catch (e) {
      errors.push(`Парсинг провода: ${e.message}`)
    }
  }

  // ok = SVG распарсился (см. docstring). Пустой cells — валидная пустая форма.
  return { ok: true, cells, errors, stencilIds: [...stencilIds] }
}
