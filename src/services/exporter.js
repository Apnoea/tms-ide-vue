import { getStencilById } from '../stencils/registry'
import { instantiate } from '../stencils/parser'
import { buildBusExportSvg, buildTextExportSvg, buildValueExportSvg } from '../stencils/svgInjector'
import { ANIMATION_CLASS_COLORS, ANIMATION_OFF_COLOR } from '../constants/animation'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Из текущего состояния JointJS-графа собирает два артефакта:
 *  • view.svg        — целостный SVG со всеми ячейками
 *  • animations.json — объединённые карточки всех ячеек
 *
 * На каждой ячейке должна быть meta `tms = { stencilId, slots? }`,
 * которую CanvasPane проставляет в момент создания ячейки. slots — карта
 * key→tag, заполняется юзером через инспектор.
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
 * Карточка анимации switch-source: bool-тег → класс animation-off при false.
 * Single-purpose: «выключатель выключился — группа потускнела». Структура
 * биндинга совместима с cell_vk's .VK template — те же поля source/type/cases
 * использует рантайм.
 */
function buildSwitchCard(ss) {
  return {
    animation: 'shape',
    bindings: [
      {
        tag: ss.tag,
        when: {
          source: 'value',
          type: 'map',
          cases: { false: { apply: { addClass: 'animation-off' } } },
        },
      },
    ],
  }
}

/**
 * Карточка под ключ либо создаётся, либо в существующую дописываются
 * bindings. Нужно потому что несколько источников (voltage + switch) могут
 * хотеть навесить биндинги на один и тот же outer-wrapper или link-id —
 * порядок добавления не должен затирать предыдущее.
 */
function assignOrMergeAnimation(animations, key, card) {
  if (animations[key]) {
    animations[key].bindings = [...(animations[key].bindings || []), ...card.bindings]
  } else {
    animations[key] = card
  }
}

/**
 * Дублирует bindings новой карточки во ВСЕ стенсильные shape-карточки того же
 * cellId (`animation-{cellId}.VK`, `.VK-cross`, …). Так класс ляжет не только
 * на outer-wrapper, но и на внутренние shape-группы стенсила. Text-карточки
 * (вроде cell_value text-update) пропускаем — их раскрашивать чужими классами
 * не нужно.
 */
function mergeBindingsIntoStencilCards(animations, cellId, exceptKey, card) {
  const keyPrefix = `animation-${cellId}.`
  for (const key of Object.keys(animations)) {
    if (key === exceptKey) continue
    if (animations[key].animation === 'text') continue
    if (!key.startsWith(keyPrefix)) continue
    animations[key].bindings = [...(animations[key].bindings || []), ...card.bindings]
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
    if (!tms?.stencilId) continue

    const stencil = getStencilById(tms.stencilId)
    if (!stencil) {
      console.warn(`[Exporter] Стенсил "${tms.stencilId}" не найден в реестре, пропускаю`)
      continue
    }

    const pos = cell.get('position')
    const size = cell.get('size')

    // animId — идентификатор для внешних SVG-ids (animation-cell-{animId}).
    // Для cell_value с тегом — сам тег (рантайм-конвенция {prefix}.SUFFIX),
    // у остальных — cell.id (стабильный JointJS-uuid, переживает round-trip).
    const animId = tms.stencilId === 'cell_value' && tms.valueTag ? tms.valueTag : cell.id

    // Динамические стенсилы (шина, текст, значение) рендерятся по реальному
    // размеру/контенту и без редактор-only декораций; у остальных — обычный
    // svgText из шаблона + bindings из animationTemplate с подстановкой slots.
    let cellSvg
    if (tms.stencilId === 'cell_bus') {
      cellSvg = buildBusExportSvg(size.width, size.height)
    } else if (tms.stencilId === 'cell_text') {
      cellSvg = buildTextExportSvg(tms.text ?? '', size.height, {
        fontSize: tms.fontSize,
        bold: tms.bold,
      })
    } else if (tms.stencilId === 'cell_value') {
      cellSvg = buildValueExportSvg(animId, tms.valueTag || '', size.width, size.height)
      if (tms.valueTag) {
        // Конвенция WebScada-рантайма: пустой output.text означает «взять
        // значение из binding.tag» (т.е. того же тега, что подписан).
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
      // parser.instantiate сделает интерполяцию {slot.X} → tms.slots[X] в
      // bindings и собёрет SVG с id="animation-{cellId}{suffix}".
      const inst = instantiate(stencil, cell.id, tms.slots || {})
      cellSvg = inst.svg
      Object.assign(animations, inst.animations)
    }

    cellExports.push({
      cellId: cell.id, // нужен для data-tms-meta + связей в проводах
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      stencilId: tms.stencilId,
      animId,
      svgContent: cellSvg,
      slots: tms.slots || null,
      voltageSource: tms.voltageSource || null,
      switchSource: tms.switchSource || null,
      // navigation — имя другой view, на которую переходит рантайм при клике
      // (см. handler ниже: пишется в animation-entry как поле navigation).
      navigation: tms.navigation || null,
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
  for (const link of links) {
    let pathD = null

    // Если есть paper — забираем реальный путь, как он отрисовался на холсте
    // (с учётом manhattan-роутинга и обходов ячеек)
    if (paper) {
      const linkView = paper.findViewByModel(link)
      if (linkView?.el) {
        const pathEl =
          linkView.el.querySelector('path.joint-link-line') || linkView.el.querySelector('path')
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

    // id провода — `animation-wire-{linkId}`. linkId стабилен в рамках сессии и
    // переживает round-trip (хранится в data-tms-meta.id). Уникальность —
    // автоматически (JointJS-uuid), не нужны коллизионные суффиксы по парам.
    const wireId = `animation-wire-${link.id}`

    const linkTms = link.get('tms') || {}
    const sourceRef = link.get('source')
    const targetRef = link.get('target')
    linkExports.push({
      id: wireId,
      linkId: link.id, // JointJS-id для round-trip восстановления редактором
      d: pathD,
      voltageSource: linkTms.voltageSource || null,
      switchSource: linkTms.switchSource || null,
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

  // ─── Voltage/switch source ───
  // На ячейке: карточка на outer wrapper + дубль bindings во все стенсильные
  // shape-карточки (чтобы класс ложился и на внутренние группы). На линке —
  // карточка на link.id. При наличии обоих источников bindings мержатся.
  const cellBindingSources = [
    { field: 'voltageSource', build: buildVoltageCard },
    { field: 'switchSource', build: buildSwitchCard },
  ]
  for (const { field, build } of cellBindingSources) {
    for (const c of cellExports) {
      if (!c[field]?.tag) continue
      const card = build(c[field])
      const outerKey = `animation-cell-${c.animId}`
      assignOrMergeAnimation(animations, outerKey, card)
      mergeBindingsIntoStencilCards(animations, c.cellId, outerKey, card)
    }
    for (const l of linkExports) {
      if (!l[field]?.tag) continue
      assignOrMergeAnimation(animations, l.id, build(l[field]))
    }
  }

  // ─── Navigation ───
  // Поле navigation в animation-entry outer wrapper'а. Если у ячейки нет
  // других анимаций — создаём пустую shape-карточку (рантайму нужна запись).
  for (const c of cellExports) {
    if (!c.navigation) continue
    const outerKey = `animation-cell-${c.animId}`
    if (!animations[outerKey]) {
      animations[outerKey] = { animation: 'shape', bindings: [] }
    }
    animations[outerKey].navigation = c.navigation
  }

  // ─── SVG-фрагменты ───
  // data-tms-meta — авторитет для редактора при загрузке; рантайм игнорирует.
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
      if (l.switchSource) meta.switchSource = l.switchSource
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
        width: c.width,
        height: c.height,
      }
      if (c.slots) meta.slots = c.slots
      if (c.text !== undefined) meta.text = c.text
      if (c.fontSize !== undefined) meta.fontSize = c.fontSize
      if (c.bold !== undefined) meta.bold = c.bold
      if (c.valueTag !== undefined) meta.valueTag = c.valueTag
      if (c.voltageSource) meta.voltageSource = c.voltageSource
      if (c.switchSource) meta.switchSource = c.switchSource
      if (c.navigation) meta.navigation = c.navigation
      const metaAttr = escapeAttr(JSON.stringify(meta))
      return `  <g id="animation-cell-${c.animId}" transform="translate(${c.x},${c.y})" data-tms-stencil="${c.stencilId}" data-tms-meta="${metaAttr}">${inner}</g>`
    })
    .join('\n')

  // Инлайн-стили — рантайм только навешивает классы, CSS должен быть в SVG.
  // Descendant-селектор `* { stroke }` нужен из-за inline presentation-атрибутов
  // внутри ячеек. animation-off объявлен ПОСЛЕ voltage — перебивает по каскаду.
  const inlineStyles = `  <style>
    <![CDATA[
    .animation-hidden { display: none; }
    /* Stroke красим всем потомкам кроме text — у текста stroke=none по дефолту. */
${Object.entries(ANIMATION_CLASS_COLORS)
  .map(([cls, hex]) => `    .${cls}, .${cls} *:not(text) { stroke: ${hex} !important; }`)
  .join('\n')}
    /* Fill — opt-in через .tms-voltage-fill, чтобы не закрывать инфо-элементы. */
${Object.entries(ANIMATION_CLASS_COLORS)
  .map(
    ([cls, hex]) =>
      `    .${cls} .tms-voltage-fill, .${cls}.tms-voltage-fill { fill: ${hex} !important; }`
  )
  .join('\n')}
    /* animation-off — серый поверх voltage-классов. */
    .animation-off, .animation-off *:not(text) { stroke: ${ANIMATION_OFF_COLOR} !important; }
    .animation-off .tms-voltage-fill, .animation-off.tms-voltage-fill { fill: ${ANIMATION_OFF_COLOR} !important; }
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
