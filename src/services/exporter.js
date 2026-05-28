import { getStencilById } from '../stencils/registry'
import { instantiate } from '../stencils/parser'
import {
  buildBusExportSvg,
  buildTextExportSvg,
  buildValueExportSvg,
} from '../stencils/svgInjector'
import { ANIMATION_CLASS_COLORS } from '../constants/animation'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Из текущего состояния JointJS-графа собирает два артефакта:
 *  • view.svg        — целостный SVG со всеми ячейками
 *  • animations.json — объединённые карточки всех ячеек
 *
 * На каждой ячейке должна быть meta `tms = { stencilId, prefix }`,
 * которую CanvasPane проставляет в момент создания ячейки.
 *
 * В выходной SVG зашиваются data-tms-* атрибуты — для round-trip
 * (открыть view.svg обратно в IDE с восстановлением модели).
 *
 * @param {dia.Graph} graph
 * @returns {{ svgText: string, animationsJson: string, animations: object, count: number }}
 */
/**
 * Возвращает абсолютную позицию endpoint'а линка (source/target).
 * Поддерживает три формы привязки:
 *   { id, port }  — к конкретному порту ячейки
 *   { id }        — к центру ячейки
 *   { x, y }      — свободная позиция (если linkPinning отключён)
 */
function getEndpointPos(end, graph) {
  if (end.x !== undefined && end.y !== undefined) {
    return { x: end.x, y: end.y }
  }
  const cell = graph.getCell(end.id)
  if (!cell) return null

  const pos = cell.get('position')
  if (end.port) {
    const ports = cell.get('ports')?.items || []
    const port = ports.find((p) => p.id === end.port)
    if (port) {
      return {
        x: pos.x + (port.args?.x ?? 0),
        y: pos.y + (port.args?.y ?? 0),
      }
    }
  }
  // fallback: центр ячейки
  const size = cell.get('size')
  return {
    x: pos.x + size.width / 2,
    y: pos.y + size.height / 2,
  }
}

/**
 * Карточка анимации voltage-source: один range-биндинг, читающий выбранный тег
 * и добавляющий соответствующий класс в зависимости от диапазона значения.
 */
function buildVoltageCard(vs) {
  return {
    animation: 'shape',
    bindings: [
      {
        tag: vs.tag,
        when: {
          type: 'range',
          cases: vs.ranges.map((r) => ({
            min: r.min,
            max: r.max,
            apply: { addClass: r.class },
          })),
        },
      },
    ],
  }
}

/**
 * @param {dia.Graph} graph
 * @param {dia.Paper} [paper] — если передан, в SVG для линий пишутся РЕАЛЬНЫЕ
 *   ортогональные пути (manhattan-router), как видно на холсте.
 *   Без paper — линии экспортируются как прямые `<line>`.
 */
export function exportProject(graph, paper = null) {
  const elements = graph.getElements()
  const links = graph.getLinks()

  const cellExports = []
  const linkExports = []
  const animations = {}

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  // ─── Ячейки (стенсилы) ───
  for (const cell of elements) {
    const tms = cell.get('tms')
    if (!tms?.stencilId || !tms?.prefix) continue

    const stencil = getStencilById(tms.stencilId)
    if (!stencil) {
      console.warn(`[Exporter] Стенсил "${tms.stencilId}" не найден в реестре, пропускаю`)
      continue
    }

    const pos = cell.get('position')
    const size = cell.get('size')

    // Динамические стенсилы (шина, текст, значение) рендерятся по реальному
    // размеру/контенту и без редактор-only декораций; у остальных — обычный
    // svgText из шаблона.
    let cellSvg
    if (tms.stencilId === 'cell_bus') {
      cellSvg = buildBusExportSvg(size.width, size.height)
    } else if (tms.stencilId === 'cell_text') {
      cellSvg = buildTextExportSvg(tms.text ?? '', size.height, {
        fontSize: tms.fontSize,
        bold: tms.bold,
      })
    } else if (tms.stencilId === 'cell_value') {
      // Для cell_value с привязанным тегом используем САМ ТЕГ как идентификатор
      // SVG-элемента и ключа animations.json — это общая конвенция стенсилов
      // ({prefix}.SUFFIX). Без этого рантайм не цеплял text-update: id вида
      // `animation-cell_value_2` (auto-prefix) не соответствует ожиданиям.
      // Без тега fallback'имся на prefix — id всё равно нужен для уникальности.
      const animId = tms.valueTag || tms.prefix
      cellSvg = buildValueExportSvg(animId, tms.valueTag || '', size.width, size.height)
      if (tms.valueTag) {
        // Конвенция WebScada-рантайма: пустой output.text означает «взять
        // значение из binding.tag» (т.е. того же тега, что подписан). Поэтому
        // output.text.from не нужен — рантайм сам подставит. decimals выносим
        // на уровень output (форматтер вывода).
        animations[`animation-${animId}`] = {
          animation: 'text',
          bindings: [
            {
              tag: tms.valueTag,
              output: { text: {}, decimals: 2 },
            },
          ],
          detailTags: [{ tag: tms.valueTag }],
        }
      }
    } else {
      const inst = instantiate(stencil, tms.prefix)
      cellSvg = inst.svg
      Object.assign(animations, inst.animations)
    }

    // animId — идентификатор для внешних SVG-ids (animation-cell-{animId})
    // и для voltage-карточек. Для cell_value с привязкой = сам тег
    // (animation-cell-PS031VV001.IB), у остальных = prefix.
    const animId =
      tms.stencilId === 'cell_value' && tms.valueTag ? tms.valueTag : tms.prefix
    cellExports.push({
      cellId: cell.id, // нужен для data-tms-meta + связей в проводах
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      stencilId: tms.stencilId,
      prefix: tms.prefix,
      animId,
      svgContent: cellSvg,
      voltageSource: tms.voltageSource || null,
      // Cтенсило-специфичные поля для round-trip восстановления редактором
      text: tms.text,
      fontSize: tms.fontSize,
      bold: tms.bold,
      valueTag: tms.valueTag,
    })

    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + size.width)
    maxY = Math.max(maxY, pos.y + size.height)
  }

  // ─── Линии (links) ───
  // Для дисамбигуации id'ов нескольких проводов между одной парой ячеек
  const wireIdUsage = new Map() // baseId → count

  for (const link of links) {
    let pathD = null

    // Если есть paper — забираем реальный путь, как он отрисовался на холсте
    // (с учётом manhattan-роутинга и обходов ячеек)
    if (paper) {
      const linkView = paper.findViewByModel(link)
      if (linkView?.el) {
        const pathEl =
          linkView.el.querySelector('path.joint-link-line') ||
          linkView.el.querySelector('path')
        if (pathEl) {
          pathD = pathEl.getAttribute('d')
          // Заодно собираем bbox по реальной геометрии
          try {
            const bbox = linkView.getBBox()
            if (bbox) {
              minX = Math.min(minX, bbox.x)
              minY = Math.min(minY, bbox.y)
              maxX = Math.max(maxX, bbox.x + bbox.width)
              maxY = Math.max(maxY, bbox.y + bbox.height)
            }
          } catch {
            // ignore
          }
        }
      }
    }

    // Fallback: вычисляем source/target и строим прямую
    if (!pathD) {
      const source = getEndpointPos(link.get('source'), graph)
      const target = getEndpointPos(link.get('target'), graph)
      if (!source || !target) continue
      pathD = `M ${source.x},${source.y} L ${target.x},${target.y}`

      minX = Math.min(minX, source.x, target.x)
      minY = Math.min(minY, source.y, target.y)
      maxX = Math.max(maxX, source.x, target.x)
      maxY = Math.max(maxY, source.y, target.y)
    }

    // id провода = `animation-wire-{prefixA}-{prefixB}` (сортировка по алфавиту);
    // для параллельных проводов между той же парой добавляется суффикс `-2`, `-3`...
    const sId = link.get('source')?.id
    const tId = link.get('target')?.id
    const sPrefix = sId ? graph.getCell(sId)?.get('tms')?.prefix : null
    const tPrefix = tId ? graph.getCell(tId)?.get('tms')?.prefix : null
    let wireId
    if (sPrefix && tPrefix) {
      const [a, b] = [sPrefix, tPrefix].sort()
      const base = `animation-wire-${a}-${b}`
      const used = wireIdUsage.get(base) || 0
      wireIdUsage.set(base, used + 1)
      wireId = used === 0 ? base : `${base}-${used + 1}`
    } else {
      // У провода нет полноценных эндпоинтов — даём fallback-id по индексу
      wireId = `animation-wire-${linkExports.length}`
    }

    const linkTms = link.get('tms') || {}
    const sourceRef = link.get('source')
    const targetRef = link.get('target')
    linkExports.push({
      id: wireId,
      linkId: link.id, // JointJS-id для round-trip восстановления редактором
      d: pathD,
      voltageSource: linkTms.voltageSource || null,
      // Endpoint-references для редактора: какие именно ячейки/порты соединены.
      // Эти данные ИЗ source/target в JointJS-модели, не из геометрии пути.
      source: sourceRef ? { id: sourceRef.id, port: sourceRef.port } : null,
      target: targetRef ? { id: targetRef.id, port: targetRef.port } : null,
    })
  }

  // ─── ViewBox ───
  let viewBoxX, viewBoxY, viewBoxW, viewBoxH
  if (cellExports.length === 0 && linkExports.length === 0) {
    viewBoxX = 0
    viewBoxY = 0
    viewBoxW = 800
    viewBoxH = 600
  } else {
    const padding = 20
    viewBoxX = Math.floor(minX - padding)
    viewBoxY = Math.floor(minY - padding)
    viewBoxW = Math.ceil(maxX - minX + padding * 2)
    viewBoxH = Math.ceil(maxY - minY + padding * 2)
  }

  // ─── Карточки анимации voltage-source ───
  // Для каждого элемента с voltageSource эмитим range-биндинг.
  //
  // Для ячейки кладём в карточку на outer wrapper id="animation-cell-{prefix}" +
  // дублируем биндинг в стенсильные карточки этого prefix'а
  // (animation-{prefix}.RZ, animation-{prefix}.VK, animation-{prefix}.frame и т.д.).
  // Так класс ляжет на внутренние shape-группы. Карточки type="text" пропускаем,
  // чтобы текстовые значения не перекрашивались (рантайм бы по классу покрасил).
  for (const c of cellExports) {
    if (!c.voltageSource?.tag) continue
    const voltageCard = buildVoltageCard(c.voltageSource)
    animations[`animation-cell-${c.animId}`] = voltageCard

    // merge в стенсильные anim-cards с тем же prefix'ом (cell_vk's .VK и т.д.)
    const prefixKey = `animation-${c.prefix}`
    for (const key of Object.keys(animations)) {
      if (key === `animation-cell-${c.animId}`) continue
      if (animations[key].animation === 'text') continue
      if (!key.startsWith(prefixKey + '.')) continue
      animations[key].bindings = [
        ...(animations[key].bindings || []),
        ...voltageCard.bindings,
      ]
    }
  }
  for (const l of linkExports) {
    if (!l.voltageSource?.tag) continue
    animations[l.id] = buildVoltageCard(l.voltageSource)
  }

  // ─── SVG-фрагменты ───
  // data-tms-meta — авторитетный источник для редактора при обратной загрузке
  // SVG: содержит JointJS-id, source/target-refs для проводов, размеры и
  // tms-payload для ячеек. Рантайм атрибут игнорирует.
  const escapeAttr = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

  // Линии — первыми (фон), ячейки сверху, чтобы цеплялись к портам
  const lines = linkExports
    .map((l) => {
      const meta = {
        id: l.linkId,
        source: l.source,
        target: l.target,
      }
      if (l.voltageSource) meta.voltageSource = l.voltageSource
      const metaAttr = escapeAttr(JSON.stringify(meta))
      return `  <path id="${l.id}" d="${l.d}" stroke="#000" stroke-width="2" fill="none" data-tms-meta="${metaAttr}"/>`
    })
    .join('\n')

  const groups = cellExports
    .map((c) => {
      const doc = new DOMParser().parseFromString(c.svgContent, 'image/svg+xml')
      const sourceRoot = doc.documentElement
      let inner = ''
      for (const child of Array.from(sourceRoot.children)) {
        inner += new XMLSerializer().serializeToString(child)
      }
      const meta = {
        id: c.cellId,
        stencilId: c.stencilId,
        prefix: c.prefix,
        width: c.width,
        height: c.height,
      }
      if (c.text !== undefined) meta.text = c.text
      if (c.fontSize !== undefined) meta.fontSize = c.fontSize
      if (c.bold !== undefined) meta.bold = c.bold
      if (c.valueTag !== undefined) meta.valueTag = c.valueTag
      if (c.voltageSource) meta.voltageSource = c.voltageSource
      const metaAttr = escapeAttr(JSON.stringify(meta))
      return `  <g id="animation-cell-${c.animId}" transform="translate(${c.x},${c.y})" data-tms-stencil="${c.stencilId}" data-tms-object="${c.prefix}" data-tms-meta="${metaAttr}">${inner}</g>`
    })
    .join('\n')

  // Инлайн-стили для animation-классов.
  // Костыль: в WebScada рантайме CSS-правил для этих классов нет — animations.json
  // только навешивает класс, но без декларации он визуально ничего не делает.
  // Поэтому шьём стили прямо в SVG, чтобы файл был самодостаточен.
  //
  // Descendant-селектор `* { stroke; fill }` нужен потому, что внутренние path/rect
  // ячеек имеют свои presentation-атрибуты `fill="#000"` etc. — без `*` они бы
  // не перекрашивались. Для проводов id висит на самом <path>, поэтому базового
  // правила хватает.
  //
  // Порядок ВАЖЕН: animation-off объявлен ПОСЛЕ voltage-классов, поэтому при
  // равной specificity побеждает по каскаду — если у элемента есть и voltage,
  // и off, то off (серый/dim) перекрывает цвет напряжения.
  const inlineStyles = `  <style>
    <![CDATA[
    .animation-hidden { display: none; }
    /* Stroke красим всем потомкам КРОМЕ text — у текста stroke по дефолту "none",
       и добавление цветного контура на мелких шрифтах визуально читается как
       перекраска самого текста. Цвет текста управляется только через fill ниже. */
${Object.entries(ANIMATION_CLASS_COLORS)
  .map(([cls, hex]) => `    .${cls}, .${cls} *:not(text) { stroke: ${hex} !important; }`)
  .join('\n')}
    /* Fill — opt-in: красим только элементы с классом tms-voltage-fill, чтобы заливка
       не закрывала информационные элементы (текст значений, фоны рамок).
       Стенсилы, которым нужна цветная заливка (шина, текст), помечают свои элементы
       этим классом сами в экспортном SVG. */
${Object.entries(ANIMATION_CLASS_COLORS)
  .map(([cls, hex]) => `    .${cls} .tms-voltage-fill, .${cls}.tms-voltage-fill { fill: ${hex} !important; }`)
  .join('\n')}
    .animation-off { opacity: 0.4; }
    ]]>
  </style>`

  const svgText = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="${viewBoxW}" height="${viewBoxH}">
${inlineStyles}
${lines}
${groups}
</svg>
`

  const animationsObject = { animations }
  const animationsJson = JSON.stringify(animationsObject, null, 2)

  return {
    svgText,
    animationsJson,
    animations: animationsObject,
    count: cellExports.length,
    linkCount: linkExports.length,
  }
}

/**
 * Создаёт blob и триггерит download через временный <a download>.
 */
export function downloadFile(filename, content, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
