import { getStencilById, getAllStencils } from '../stencils/registry'
import { instantiate } from '../stencils/parser'
import { buildBusExportSvg, buildTextExportSvg, buildValueExportSvg } from '../stencils/svgInjector'
import {
  ANIMATION_CLASS_COLORS,
  ANIMATION_OFF_COLOR,
  CLASS_OFF,
  CLASS_HIDDEN,
} from '../constants/animation'
import {
  outerKey,
  innerPrefix,
  wireKey,
  valueTextKey,
  ATTR_META,
  ATTR_STENCIL,
  ATTR_LINK_LABEL_OF,
} from '../constants/ids'
import { SVG_NS, escapeXml, escapeAttr } from '../utils/xml'
import { getCellTagsFromTms } from '../utils/cellSearch'
import {
  LINK_LABEL_FONT_SIZE,
  LINK_LABEL_FONT_FAMILY,
  LINK_LABEL_TEXT_COLOR,
  LINK_LABEL_BG_COLOR,
  LINK_LABEL_BORDER_COLOR,
  LINK_LABEL_PAD_X,
  LINK_LABEL_PAD_Y,
} from '../stencils/linkDefaults'

// Какие стенсилы получают quality-биндинги и CSS-override для bad-качества —
// определяется флагом `quality: true` в их stencil.json. См. cell_qk / cell_qr
// / cell_qf. CSS-override (показ обеих позиций рычага при animation-off) —
// конвенция «данные ненадёжны → показываем все возможные состояния».

/**
 * Короткий стабильный id из JointJS-UUID: берём первый сегмент (8 hex ≈ 4B
 * комбинаций), при коллизии в пределах одного экспорта расширяем следующим
 * сегментом UUID — и так до полной строки. Защита от тихого слияния двух
 * cell'ов с одинаковым префиксом UUID в одну animation-карточку.
 *
 * Стабильно между save/load для несталкивающихся id — тот же UUID даёт тот
 * же short-id. При коллизии порядок обхода может растянуть второй id чуть
 * длиннее — это нормально, round-trip держится на полном UUID в data-tms-meta.
 *
 * @param {string} fullId  — JointJS UUID (5 сегментов через '-')
 * @param {(candidate: string) => boolean} isTaken — занят ли кандидат-id
 */
function uniqueShortId(fullId, isTaken) {
  const segments = String(fullId).split('-')
  let candidate = segments[0]
  for (let i = 1; i < segments.length && isTaken(candidate); i++) {
    candidate = `${candidate}-${segments[i]}`
  }
  return candidate
}

/**
 * Возвращает абсолютную позицию endpoint'а линка (source/target).
 * linkPinning=false на paper'е запрещает свободные endpoint'ы, поэтому ждём
 * только { id, port } или { id } (центр ячейки).
 */
function getEndpointPos(end, graph) {
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
          source: 'value',
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
 * Карточка switch-sources: для каждого тега из массива — отдельный bool-биндинг
 * (false → addClass animation-off). N биндингов = AND-семантика «любой false →
 * элемент тускнеет», без runtime-expressions.
 */
function buildSwitchCard(ss) {
  return {
    animation: 'shape',
    bindings: ss.tags.map((tag) => ({
      tag,
      when: {
        source: 'value',
        type: 'map',
        cases: { false: { apply: { addClass: CLASS_OFF } } },
      },
    })),
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

// outerKey/innerPrefix теперь живут в constants/ids.js — единственный
// источник правды для id-формата (используется и парсером, и симуляцией).
const outerKeyFor = outerKey
const innerPrefixFor = innerPrefix

/**
 * Дублирует bindings новой карточки во ВСЕ стенсильные shape-карточки того же
 * animId (`animation-{stencilId}-{animId}.QW`, `.QW-cross`, …). Так класс
 * ляжет не только на outer-wrapper, но и на внутренние shape-группы стенсила.
 * Text-карточки (вроде cell_value text-update) пропускаем — их раскрашивать
 * чужими классами не нужно.
 */
function mergeBindingsIntoStencilCards(animations, stencilId, animId, exceptKey, card) {
  const keyPrefix = innerPrefixFor(stencilId, animId)
  for (const key of Object.keys(animations)) {
    if (key === exceptKey) continue
    if (animations[key].animation === 'text') continue
    if (!key.startsWith(keyPrefix)) continue
    animations[key].bindings = [...(animations[key].bindings || []), ...card.bindings]
  }
}

/**
 * Из текущего состояния JointJS-графа собирает два артефакта:
 *  • view.svg        — целостный SVG со всеми ячейками
 *  • animations.json — объединённые карточки всех ячеек для WebScada-рантайма
 *
 * На каждой ячейке должна быть meta `tms = { stencilId, slots? }` —
 * CanvasPane проставляет её в момент создания. В выходной SVG зашиваются
 * data-tms-* атрибуты для round-trip (открыть view.svg обратно в IDE).
 *
 * @param {dia.Graph} graph
 * @param {dia.Paper} [paper] — если передан, в SVG для линий пишутся РЕАЛЬНЫЕ
 *   ортогональные пути (manhattan-router), как видно на холсте.
 *   Без paper — линии экспортируются как прямые `<line>`.
 * @returns {{
 *   svgText: string, animationsJson: string, animations: object,
 *   count: number, linkCount: number, warnings: string[]
 * }}
 */
export function exportProject(graph, paper = null) {
  const elements = graph.getElements()
  const links = graph.getLinks()

  const cellExports = []
  const linkExports = []
  const animations = {}
  // Защита от тихой коллизии short-id (UUID с одинаковым первым сегментом).
  // uniqueShortId растягивает префикс на следующий сегмент пока outer-key не
  // станет уникальным. Cell-key и wire-key живут в одном namespace —
  // `animation-{stencilId}-...` и `animation-wire-...` пересекаться не могут,
  // но один Set проще двух.
  const usedOuterKeys = new Set()
  // Список пред-/предупреждений для caller'а (CanvasPane показывает toast).
  // Console.warn оставляем для DevTools — но без UI-показа SCADA-инженер бы
  // их не увидел.
  const warnings = []

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

    // Для cell_value с тегом animId = САМ ТЕГ целиком, без укорачивания.
    // Иначе valueTag вида 'MY-TAG.IA' (с дефисом) split'нулся бы по '-' и
    // порезался до 'MY' — рантайм бы не нашёл text-карточку. У остальных —
    // short-id из UUID cell.id с дефолтом на первый сегмент и расширением
    // при коллизии (uniqueShortId).
    const animId =
      tms.stencilId === 'cell_value' && tms.valueTag
        ? tms.valueTag
        : uniqueShortId(cell.id, (id) => usedOuterKeys.has(outerKeyFor(tms.stencilId, id)))
    usedOuterKeys.add(outerKeyFor(tms.stencilId, animId))

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
        // Два cell_value с одинаковым valueTag дали бы одинаковый
        // `animation-{tag}` text-id — невалидный SVG (duplicate id) и рантайм
        // обновлял бы только первый из них. Предупреждаем, не молчим.
        const textKey = valueTextKey(animId)
        if (animations[textKey]) {
          const msg = `cell_value: дубль valueTag="${tms.valueTag}" — рантайм обновит только первую ячейку`
          warnings.push(msg)
          console.warn(`[Exporter] ${msg}`)
        }
        // Конвенция WebScada-рантайма: пустой output.text означает «взять
        // значение из binding.tag» (т.е. того же тега, что подписан).
        animations[textKey] = {
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
      // bindings и собёрет SVG с id="animation-{animId}{suffix}". Передаём
      // КОРОТКИЙ animId — стенсильные карточки тоже короткие (animation-c1.QW).
      const inst = instantiate(stencil, animId, tms.slots || {})
      cellSvg = inst.svg
      Object.assign(animations, inst.animations)
    }

    cellExports.push({
      cellId: cell.id, // полный JointJS-UUID — для data-tms-meta + связей в проводах
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      stencilId: tms.stencilId,
      animId,
      svgContent: cellSvg,
      slots: tms.slots || null,
      voltageSource: tms.voltageSource || null,
      switchSources: tms.switchSources || null,
      // navigation — имя другой view, на которую переходит рантайм при клике
      // (см. handler ниже: пишется в animation-entry как поле navigation).
      navigation: tms.navigation || null,
      // Cтенсило-специфичные поля для round-trip восстановления редактором
      text: tms.text,
      fontSize: tms.fontSize,
      bold: tms.bold,
      valueTag: tms.valueTag,
      // Геометрический трансформ — для round-trip. angle применяется в SVG
      // как rotate вокруг центра ячейки на outer-`<g>`.
      angle: cell.angle ? cell.angle() : 0,
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
    // (с учётом manhattan-роутинга и обходов ячеек). JointJS 4 standard.Link
    // имеет два <path> — wrapper (хитбокс) и line (видимая линия), оба с
    // одинаковым `d`. Берём именно line по `joint-selector="line"` — контракт,
    // не «по совпадению» (querySelector('path') вернул бы wrapper).
    if (paper) {
      const linkView = paper.findViewByModel(link)
      if (linkView?.el) {
        const pathEl = linkView.el.querySelector('path[joint-selector="line"]')
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

    // id провода — `animation-wire-{short}`. Стабильный short-id из link.id
    // (тот же UUID между save/load); round-trip держится на data-tms-meta.id
    // (полный JointJS-uuid линка). uniqueShortId защищает от тихого слияния
    // двух линков с одинаковым первым сегментом UUID.
    const wireShort = uniqueShortId(link.id, (id) => usedOuterKeys.has(wireKey(id)))
    const wireId = wireKey(wireShort)
    usedOuterKeys.add(wireId)

    const linkTms = link.get('tms') || {}
    const sourceRef = link.get('source')
    const targetRef = link.get('target')

    // Координаты лейбла берём у JointJS через linkView.getLabelCoordinates —
    // он знает реальную геометрию path'а (с учётом router'а/connector'а) и
    // умеет интерполировать distance 0..1 в (x,y). Без paper'а (headless) —
    // лейбл просто не рендерим в SVG (его текст всё равно сохранён в tms.label).
    let labelCoords = null
    if (linkTms.label && paper) {
      const linkView = paper.findViewByModel(link)
      if (linkView?.getLabelCoordinates) {
        try {
          const pt = linkView.getLabelCoordinates({ distance: 0.5 })
          if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
            labelCoords = { x: pt.x, y: pt.y }
          }
        } catch {
          // ignore — без координат не рендерим
        }
      }
    }

    linkExports.push({
      id: wireId,
      linkId: link.id, // JointJS-id для round-trip восстановления редактором
      d: pathD,
      voltageSource: linkTms.voltageSource || null,
      switchSources: linkTms.switchSources || null,
      label: linkTms.label || null,
      labelCoords,
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

  // ─── Voltage / switch sources ───
  // На ячейке: карточка на outer wrapper + дубль bindings во все стенсильные
  // shape-карточки (чтобы класс ложился и на внутренние группы). На линке —
  // карточка на link.id. При наличии обоих источников bindings мержатся.
  // hasValue — проверка наличия для разных схем (voltageSource={tag}, switchSources={tags[]}).
  const cellBindingSources = [
    { field: 'voltageSource', build: buildVoltageCard, hasValue: (v) => !!v?.tag },
    { field: 'switchSources', build: buildSwitchCard, hasValue: (v) => !!v?.tags?.length },
  ]
  for (const { field, build, hasValue } of cellBindingSources) {
    for (const c of cellExports) {
      if (!hasValue(c[field])) continue
      const card = build(c[field])
      const outerKey = outerKeyFor(c.stencilId, c.animId)
      assignOrMergeAnimation(animations, outerKey, card)
      mergeBindingsIntoStencilCards(animations, c.stencilId, c.animId, outerKey, card)
    }
    for (const l of linkExports) {
      if (!hasValue(l[field])) continue
      assignOrMergeAnimation(animations, l.id, build(l[field]))
    }
  }

  // ─── Intrinsic switch (cell_qw): slot.onoff неявно даёт animation-off ───
  // Привязав тег к слоту, юзер сразу получает И крестик-визуал (через .QW /
  // .QW-cross из стенсильного шаблона), И серость всей ячейки на false.
  // Без ручного дублирования в switchSources. switchSources остаётся для
  // дополнительных РОДИТЕЛЬСКИХ выключателей — их биндинги добавляются ПОВЕРХ
  // slot.onoff (AND-семантика).
  // Merge в стенсильные .QW / .QW-cross НЕ делаем: стенсильный шаблон уже
  // эмитит свой animation-off биндинг для slot.onoff в .QW — дубль не нужен,
  // да и CSS-cascade с outer-wrapper всё равно красит вложенные элементы.
  for (const c of cellExports) {
    if (!getStencilById(c.stencilId)?.intrinsicOnoff) continue
    const onoffTag = c.slots?.onoff
    if (!onoffTag) continue
    const card = buildSwitchCard({ tags: [onoffTag] })
    assignOrMergeAnimation(animations, outerKeyFor(c.stencilId, c.animId), card)
  }

  // ─── cell_node наследует voltage от соединённого провода ───
  // Если у точки соединения нет своего voltageSource — берём первый connected
  // wire с voltage. Узел получает ту же range-карточку → визуально перекрасится
  // в тот же цвет что и провод в рантайме.
  for (const c of cellExports) {
    if (c.stencilId !== 'cell_node') continue
    if (c.voltageSource?.tag) continue
    for (const l of linkExports) {
      if (!l.voltageSource?.tag) continue
      if (l.source?.id !== c.cellId && l.target?.id !== c.cellId) continue
      const card = buildVoltageCard(l.voltageSource)
      assignOrMergeAnimation(animations, outerKeyFor(c.stencilId, c.animId), card)
      break
    }
  }

  // ─── Navigation ───
  // Поле navigation в animation-entry outer wrapper'а. Если у ячейки нет
  // других анимаций — создаём пустую shape-карточку (рантайму нужна запись).
  for (const c of cellExports) {
    if (!c.navigation) continue
    const outerKey = outerKeyFor(c.stencilId, c.animId)
    if (!animations[outerKey]) {
      animations[outerKey] = { animation: 'shape', bindings: [] }
    }
    animations[outerKey].navigation = c.navigation
  }

  // ─── detailTags на outer-wrapper / wire-card ───
  // Рантайм открывает popup с подробностями при клике, читая detailTags
  // карточки внешней обёртки. У cell_value detailTags ставится на text-карточку
  // (`animation-{valueTag}`) — рантайм-конвенция (text-handler находит элемент
  // по id равному тегу). Для всех остальных собираем все привязанные теги
  // (slots, voltageSource.tag, switchSources.tags) и кладём на outer-карточку
  // (см. outerKeyFor) / wire.
  function attachDetailTags(key, tags) {
    if (!tags.length) return
    if (!animations[key]) {
      animations[key] = { animation: 'shape', bindings: [] }
    }
    const existing = animations[key].detailTags || []
    const seen = new Set(existing.map((d) => d.tag))
    const additions = []
    for (const t of tags) {
      if (!seen.has(t)) {
        seen.add(t)
        additions.push({ tag: t })
      }
    }
    if (additions.length) {
      animations[key].detailTags = [...existing, ...additions]
    }
  }
  // cellExports / linkExports structurally совместимы с tms-payload
  // (`slots`, `voltageSource`, `switchSources` на верхнем уровне), так что
  // тот же getCellTagsFromTms что и для поиска — без дубля сборки тегов.
  for (const c of cellExports) {
    if (getStencilById(c.stencilId)?.layoutOnly) continue
    attachDetailTags(outerKeyFor(c.stencilId, c.animId), getCellTagsFromTms(c))
  }
  for (const l of linkExports) {
    attachDetailTags(l.id, getCellTagsFromTms(l))
  }

  // ─── Quality (OPC DA): non-good → animation-off ───
  // У каждого тега в SCADA-payload есть quality (192-255 = good, 64-191 =
  // uncertain, 0-63 = bad). Для cell_qk/cell_qr эмитим один range-кейс
  // [0, 191] с addClass: animation-off — cell станет серым, юзер видит что
  // данные ненадёжны. При quality ≥ 192 в этот range не попадёт, animation-off
  // не накинется (рантайм auto-cleanup'ит классы при выходе из case-диапазона).
  // WebScada сравнивает inclusive (numValue >= min && numValue <= max), поэтому
  // max=191 — последнее non-good значение; 192 уже good и не попадает.
  //
  // Биндинги кладём ТОЛЬКО на outer-карточку — оттуда CSS-каскад
  // `.animation-off *:not(text) { stroke }` затемняет ВСЕ stroke-элементы
  // стенсила (хвосты, контакты, шарнир, рычаги, заземление). Если класть на
  // inner-карточки (.closed / .open), серым станет только текущий видимый
  // рычаг — остальной корпус останется чёрным.
  //
  // Outer-карточку создаём если её ещё нет (cell без voltage/switch — просто
  // голый стенсил со slot.onoff). Аналогично navigation-логике выше.
  //
  // Выпускаем quality для стенсилов с флагом `quality: true` в stencil.json
  // (сейчас — cell_qk / cell_qr / cell_qf). text/value-карточки рантайм
  // обрабатывает с собственной quality-семантикой и сюда не включаются.
  for (const c of cellExports) {
    if (!getStencilById(c.stencilId)?.quality) continue
    // Собираем уникальные теги из inner-карточек (slot.onoff) + outer (voltage,
    // switch). Без тегов quality-биндинги бессмысленны — пропускаем.
    const stencilPrefix = innerPrefixFor(c.stencilId, c.animId)
    const outerKey = outerKeyFor(c.stencilId, c.animId)
    const seen = new Set()
    for (const key of Object.keys(animations)) {
      if (key !== outerKey && !key.startsWith(stencilPrefix)) continue
      const card = animations[key]
      if (card?.animation !== 'shape') continue
      for (const b of card.bindings || []) {
        if (b.tag) seen.add(b.tag)
      }
    }
    if (!seen.size) continue
    if (!animations[outerKey]) animations[outerKey] = { animation: 'shape', bindings: [] }
    const outer = animations[outerKey]
    for (const tag of seen) {
      outer.bindings.push({
        tag,
        when: {
          source: 'quality',
          type: 'range',
          cases: [{ min: 0, max: 191, apply: { addClass: CLASS_OFF } }],
        },
      })
    }
  }

  // ─── SVG-фрагменты ───
  // data-tms-meta — авторитет для редактора при загрузке; рантайм игнорирует.
  // escapeAttr/escapeXml импортируются из utils/xml — один источник правды
  // для обоих писателей SVG-строк (exporter и svgInjector).
  //
  // Линии — первыми (фон), ячейки сверху, чтобы цеплялись к портам.
  // Лейбл (если есть) — <g> с <rect> подложкой и <text> поверх. Ширина rect'а
  // оценивается по character-count (DOMParser не умеет glyph-metrics);
  // ~6px/char для sans-serif 10px — кириллица/латиница умещаются с запасом.
  const APPROX_CHAR_WIDTH = 6
  const lines = linkExports
    .map((l) => {
      const meta = {
        id: l.linkId,
        source: l.source,
        target: l.target,
      }
      if (l.voltageSource) meta.voltageSource = l.voltageSource
      if (l.switchSources) meta.switchSources = l.switchSources
      if (l.label) meta.label = l.label
      const metaAttr = escapeAttr(JSON.stringify(meta))
      // l.id и l.d сейчас составляются из UUID-производных и сгенерированных
      // path-данных — symbol-safe, но escapeAttr держит инвариант на случай
      // если JointJS-расширение когда-то засунет туда что-то экзотическое.
      const pathTag = `  <path id="${escapeAttr(l.id)}" d="${escapeAttr(l.d)}" stroke="#000" stroke-width="2" fill="none" ${ATTR_META}="${metaAttr}"/>`
      if (!l.label || !l.labelCoords) return pathTag
      const textWidth = l.label.length * APPROX_CHAR_WIDTH
      const w = textWidth + LINK_LABEL_PAD_X * 2
      const h = LINK_LABEL_FONT_SIZE + LINK_LABEL_PAD_Y * 2
      const rx = 2
      const labelTag = `  <g ${ATTR_LINK_LABEL_OF}="${escapeAttr(l.id)}" transform="translate(${l.labelCoords.x},${l.labelCoords.y})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="${LINK_LABEL_BG_COLOR}" stroke="${LINK_LABEL_BORDER_COLOR}" stroke-width="1"/><text text-anchor="middle" dominant-baseline="middle" font-size="${LINK_LABEL_FONT_SIZE}" font-family="${LINK_LABEL_FONT_FAMILY}" fill="${LINK_LABEL_TEXT_COLOR}">${escapeXml(l.label)}</text></g>`
      return `${pathTag}\n${labelTag}`
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
      if (c.switchSources) meta.switchSources = c.switchSources
      if (c.navigation) meta.navigation = c.navigation
      if (c.angle) meta.angle = c.angle
      const metaAttr = escapeAttr(JSON.stringify(meta))
      // translate(x,y) ставит ячейку на холст; rotate (если есть) вращает
      // вокруг центра ячейки в её локальных координатах.
      let transform = `translate(${c.x},${c.y})`
      if (c.angle) transform += ` rotate(${c.angle} ${c.width / 2} ${c.height / 2})`
      // escapeAttr на outer-id: для cell_value c.animId = valueTag, который
      // может содержать ", &, < и т.п. — без эскейпа SVG становится невалидным.
      return `  <g id="${escapeAttr(outerKeyFor(c.stencilId, c.animId))}" transform="${transform}" ${ATTR_STENCIL}="${c.stencilId}" ${ATTR_META}="${metaAttr}">${inner}</g>`
    })
    .join('\n')

  // Инлайн-стили — рантайм только навешивает классы, CSS должен быть в SVG.
  // Descendant-селектор `* { stroke }` нужен из-за inline presentation-атрибутов
  // внутри ячеек. animation-off объявлен ПОСЛЕ voltage — перебивает по каскаду.
  const inlineStyles = `  <style>
    <![CDATA[
    .${CLASS_HIDDEN} { display: none; }
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
    .${CLASS_OFF}, .${CLASS_OFF} *:not(text) { stroke: ${ANIMATION_OFF_COLOR} !important; }
    .${CLASS_OFF} .tms-voltage-fill, .${CLASS_OFF}.tms-voltage-fill { fill: ${ANIMATION_OFF_COLOR} !important; }
    /* Quality-stencils: при bad-качестве (animation-off на outer) показываем
       обе позиции рычага одновременно — отменяем animation-hidden у потомков.
       Конвенция «данные ненадёжны → не врём про конкретное состояние». */
${getAllStencils()
  .filter((s) => s.quality)
  .map(
    (s) =>
      `    [${ATTR_STENCIL}="${s.id}"].${CLASS_OFF} .${CLASS_HIDDEN} { display: initial !important; }`
  )
  .join('\n')}
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
    warnings,
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
