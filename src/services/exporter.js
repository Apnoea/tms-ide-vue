import { getStencilById, getAllStencils } from '../stencils/registry'
import { instantiate } from '../stencils/parser'
import {
  buildBusExportSvg,
  buildTextExportSvg,
  buildValueExportSvg,
  flipTransform,
} from '../stencils/svgInjector'
import {
  CLASS_OFF,
  CLASS_HIDDEN,
  buildVoltageCssRules,
  buildStateColorCssRules,
  stateColorClass,
} from '../constants/animation'
import {
  outerKey,
  innerPrefix,
  wireKey,
  valueTextKey,
  ATTR_META,
  ATTR_STENCIL,
  CELL_META_FIELDS,
  LINK_META_FIELDS,
} from '../constants/ids'
import { SVG_NS, escapeAttr } from '../utils/xml'
import { getCellTagsFromTms } from '../utils/cellSearch'
import { normalizeSwitchSources, switchSourceTags } from '../utils/switchSources'

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
function getEndpointPos(end, graph, warnings) {
  const cell = graph.getCell(end.id)
  if (!cell) return null

  const pos = cell.get('position')
  if (!pos) return null // битая ячейка без позиции — линк пропустим (не роняем экспорт)

  if (end.port) {
    const ports = cell.get('ports')?.items || []
    const port = ports.find((p) => p.id === end.port)
    if (port) {
      return {
        x: pos.x + (port.args?.x ?? 0),
        y: pos.y + (port.args?.y ?? 0),
      }
    }
    // Порт не найден (рассинхрон портов после ресайза шины и т.п.) — уходим в
    // центр ячейки, но сигналим: тихий сдвиг провода заметить трудно. В warnings
    // (доходит до пользователя), а не только в консоль.
    const msg = `Провод: порт "${end.port}" у символа ${end.id} не найден — конец уехал в центр`
    console.warn(`[Export] ${msg}`)
    warnings?.push(msg)
  }
  // fallback: центр ячейки
  const size = cell.get('size')
  if (!size) return null
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
          cases: (vs.ranges || []).map((r) => ({
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
 * Shape-карточка switch: на каждый тег — bool-биндинг (false → animation-off).
 * Union биндингов = AND «любой false → серый». Для не-multi случая (чистая
 * цепочка / одиночный параллельный тег). Принимает плоский список тегов.
 */
function buildSwitchCard(tags) {
  return {
    animation: 'shape',
    bindings: tags.map((tag) => ({
      tag,
      when: {
        source: 'value',
        type: 'map',
        cases: { false: { apply: { addClass: CLASS_OFF } } },
      },
    })),
  }
}

/** Нужна ли multi-карточка: ≥2 групп switchSources (ИЛИ-агрегация невыразима
 *  union-биндингами shape-карточки). Одна группа (чистое И) / нет групп → дешёвый
 *  shape (buildSwitchCard: любой тег группы false → animation-off). */
function needsMulti(c) {
  return normalizeSwitchSources(c.switchSources).groups.length >= 2
}

/** Условие «выключатель открыт» (value=false). ConditionEvaluator(map) вернёт
 *  cases['false']=true → MultiConditionEvaluator трактует результат как true. */
function openCondition(id, tag) {
  return { id, tag, source: 'value', when: { type: 'map', cases: { false: true } } }
}

/** multi-биндинг с ОДНИМ условием (expression='c'): тег под source/when →
 *  apply addClass. Для слоёв voltage-range / onoff / quality в multi-карточке. */
function singleMultiBinding(tag, source, when, addClass) {
  return {
    multiCondition: {
      expression: 'c',
      conditions: [{ id: 'c', tag, source, when }],
      apply: { addClass },
    },
  }
}

/**
 * Outer-карточка типа `multi` — рантайм-тип с булевым `expression` по нескольким
 * тегам (единственный способ выразить ИЛИ-агрегацию групп switchSources, где
 * union-биндинги дают только AND). Несёт ВСЕ outer-эффекты слоями (бинды
 * независимы, ActionApplier складывает классы): voltage по диапазонам, группы
 * switchSources, quality. Кладётся на outer-id; на потомков классы каскадят через
 * CSS, поэтому merge во внутренние shape-карточки не нужен. Генерируется напрямую
 * из tms — только здесь есть семантика «какие теги в какой группе».
 */
function buildMultiCard(c) {
  const stencil = getStencilById(c.stencilId)
  const bindings = []

  const vs = c.voltageSource
  if (vs?.tag && vs.ranges?.length) {
    for (const r of vs.ranges) {
      bindings.push(
        singleMultiBinding(
          vs.tag,
          'value',
          { type: 'range', cases: [{ min: r.min, max: r.max }] },
          r.class
        )
      )
    }
  }

  // switchSources — группы условий: активен, если ЛЮБАЯ группа выполнена целиком
  // (все теги замкнуты). Гасим (animation-off), когда НИ одна не выполнена =
  // в КАЖДОЙ группе хотя бы один тег открыт. Без отрицания (рантайм-expression его
  // не даёт): произведение сумм — И по группам ( ИЛИ «открыт» внутри группы ).
  const { groups } = normalizeSwitchSources(c.switchSources)
  const conditions = []
  const factors = []
  groups.forEach((group, gi) => {
    const ids = group.map((tag, ti) => {
      const id = `g${gi}t${ti}`
      conditions.push(openCondition(id, tag))
      return id
    })
    factors.push(`(${ids.join(' || ')})`)
  })
  if (conditions.length) {
    bindings.push({
      multiCondition: {
        expression: factors.join(' && '),
        conditions,
        apply: { addClass: CLASS_OFF },
      },
    })
  }

  if (stencil?.quality) {
    const qTags = [
      ...new Set([vs?.tag, c.slots?.onoff, ...switchSourceTags(c.switchSources)].filter(Boolean)),
    ]
    for (const tag of qTags) {
      bindings.push(
        singleMultiBinding(
          tag,
          'quality',
          { type: 'range', cases: [{ min: 0, max: 191 }] },
          CLASS_OFF
        )
      )
    }
  }

  return { animation: 'multi', bindings }
}

/**
 * Биндинг перекраса всего символа по состоянию (stateColors в stencil.json):
 * значение тега-слота состояния → класс `animation-color-<stencilId>-<ключ>` на outer, цвет
 * каскадит на потомков через CSS (см. inlineStyles). Кладётся слоем на outer
 * (assignOrMerge — уживается с voltage/switch/quality). Коды: режим значения —
 * из states, булев — сами ключи 'true'/'false'. null, если красить нечего или
 * тег слота не привязан. Обесточивание (animation-off) бьёт цвет в CSS.
 */
function buildStateColorCard(c) {
  const stencil = getStencilById(c.stencilId)
  const colors = stencil?.stateColors
  if (!colors || !Object.keys(colors).length) return null
  const slotKey = stencil.slots?.[0]?.key
  const tag = slotKey ? c.slots?.[slotKey] : null
  if (!tag) return null
  const cases = {}
  if (Array.isArray(stencil.states) && stencil.states.length) {
    for (const st of stencil.states) {
      const color = colors[st.key]
      if (color && st.code !== '' && st.code != null) {
        cases[String(st.code)] = { apply: { addClass: stateColorClass(c.stencilId, st.key) } }
      }
    }
  } else {
    for (const k of ['true', 'false']) {
      if (colors[k]) cases[k] = { apply: { addClass: stateColorClass(c.stencilId, k) } }
    }
  }
  if (!Object.keys(cases).length) return null
  return { animation: 'shape', bindings: [{ tag, when: { source: 'value', type: 'map', cases } }] }
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

// Алиасы под импортами outerKey/innerPrefix (constants/ids.js — единый источник
// id-формата). Нужны из-за шадовинга `outerKey`: ниже в нескольких блоках
// объявляется локальная `const outerKey = …`, которая перекрыла бы импорт — зовём
// через *For-алиас. innerPrefixFor — для симметрии.
const outerKeyFor = outerKey
const innerPrefixFor = innerPrefix

/**
 * Дублирует bindings новой карточки во ВСЕ стенсильные shape-карточки того же
 * animId (`animation-{stencilId}-{animId}.true`, `.false`, …). Так класс
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
 *   ортогональные пути (rightAngle-роутер), как видно на холсте.
 *   Без paper — линии экспортируются как прямые (fallback, см. ниже).
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
  // Предупреждения для caller'а (CanvasPane показывает toast). Console.warn
  // оставляем для DevTools — без UI-показа SCADA-инженер их не увидел бы.
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
      const msg = `символ "${tms.stencilId}" не найден в реестре — символ выпал из view.svg`
      warnings.push(msg)
      console.warn(`[Exporter] ${msg}`)
      continue
    }

    const pos = cell.get('position')
    const size = cell.get('size')

    // Для cell_value с тегом animId = САМ ТЕГ целиком, без укорачивания: рантайм
    // находит text-узел по id == тег. Иначе short-id из UUID cell.id (uniqueShortId
    // с расширением при коллизии). При ДУБЛЕ valueTag даём уникальный суффикс —
    // SVG обязан иметь уникальные id (иначе невалидный документ); по «чистому» тегу
    // рантайм обновит только первый символ, о чём предупреждаем.
    let animId
    if (tms.stencilId === 'cell_value' && tms.valueTag) {
      animId = tms.valueTag
      if (usedOuterKeys.has(outerKeyFor('cell_value', animId))) {
        const msg = `cell_value: дубль valueTag="${tms.valueTag}" — рантайм обновит только первый символ`
        warnings.push(msg)
        console.warn(`[Exporter] ${msg}`)
        let n = 2
        while (usedOuterKeys.has(outerKeyFor('cell_value', `${tms.valueTag}__${n}`))) n++
        animId = `${tms.valueTag}__${n}`
      }
    } else {
      animId = uniqueShortId(cell.id, (id) => usedOuterKeys.has(outerKeyFor(tms.stencilId, id)))
    }
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
        color: tms.color,
      })
    } else if (tms.stencilId === 'cell_value') {
      cellSvg = buildValueExportSvg(animId, tms.valueTag || '', size.width, size.height)
      if (tms.valueTag) {
        // text-id = animation-{animId}; animId дедуплицирован выше → ключ уникален
        // даже при двух cell_value с одним valueTag. Конвенция WebScada-рантайма:
        // пустой output.text = «взять значение из binding.tag» (того же тега).
        animations[valueTextKey(animId)] = {
          animation: 'text',
          bindings: [{ tag: tms.valueTag, output: { text: {}, decimals: 2 } }],
          detailTags: [{ tag: tms.valueTag }],
        }
      }
    } else {
      // parser.instantiate сделает интерполяцию {slot.X} → tms.slots[X] в
      // bindings и соберёт SVG с id="animation-{stencilId}-{animId}{suffix}".
      // Передаём КОРОТКИЙ animId — id стенсильных карточек короткие
      // (например animation-cell_qw-c1.true).
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
      color: tms.color,
      // align (якорь роста текста) влияет только на позицию блока в редакторе —
      // сама позиция уже в c.x/c.y; поле нужно, чтобы после reload правки текста
      // блок продолжал расти от того же края.
      align: tms.align,
      // locked — «замок» ячейки на холсте (read-only до снятия). Round-trip,
      // чтобы блокировка переживала экспорт/импорт.
      locked: tms.locked,
      // groupId — метка логической группы (общий id у членов). Round-trip, чтобы
      // группировка переживала экспорт/импорт.
      groupId: tms.groupId,
      valueTag: tms.valueTag,
      // Геометрический трансформ — для round-trip. angle применяется в SVG
      // как rotate вокруг центра ячейки на outer-`<g>`.
      angle: cell.angle ? cell.angle() : 0,
      // z-index (порядок наложения): document order SVG и так z-упорядочен, но
      // храним явно — точный z переживает round-trip, toFront/toBack имеют базу.
      z: cell.get('z'),
      // Отражение символа (flip) — визуал через transform на внутренней группе,
      // позиции портов уже отражены в живом paper (buildPortItems).
      flipH: tms.flipH,
      flipV: tms.flipV,
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
    // (с учётом rightAngle-роутинга и изломов). JointJS 4 standard.Link
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
      const source = getEndpointPos(link.get('source'), graph, warnings)
      const target = getEndpointPos(link.get('target'), graph, warnings)
      if (!source || !target) {
        const msg = `Провод ${link.id}: не удалось вычислить геометрию — пропущен (не попадёт в экспорт)`
        console.warn(`[Export] ${msg}`)
        warnings.push(msg)
        continue
      }
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
    const vertices = link.vertices?.() || []

    linkExports.push({
      id: wireId,
      linkId: link.id, // JointJS-id для round-trip восстановления редактором
      d: pathD,
      voltageSource: linkTms.voltageSource || null,
      switchSources: linkTms.switchSources || null,
      // Толщина/цвет линии. Дефолты (2 / #000) не тащим — meta пишет только нестандартные.
      strokeWidth: linkTms.strokeWidth || null,
      strokeColor: linkTms.strokeColor || null,
      // Endpoint-references для редактора: какие именно ячейки/порты соединены.
      // Эти данные ИЗ source/target в JointJS-модели, не из геометрии пути.
      source: sourceRef ? { id: sourceRef.id, port: sourceRef.port } : null,
      target: targetRef ? { id: targetRef.id, port: targetRef.port } : null,
      // Ручные изломы — иначе round-trip перерисовал бы провод по дефолтному
      // маршруту (геометрия пути в `d` рантайму, изломы редактору).
      vertices: vertices.length ? vertices.map((v) => ({ x: v.x, y: v.y })) : null,
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
  // Карточка на outer-id ячейки (+ merge во внутренние shape-карточки стенсила)
  // либо на wire-id линка. needsMulti-цели получают одну `multi` (voltage +
  // switch + quality слоями); остальные — shape (voltage + switch).
  // Единый список целей: ячейки (с stencilId/animId для inner-merge) и линки.
  const bindingTargets = [
    ...cellExports.map((c) => ({
      src: c,
      key: outerKeyFor(c.stencilId, c.animId),
      stencilId: c.stencilId,
      animId: c.animId,
    })),
    ...linkExports.map((l) => ({ src: l, key: l.id })),
  ]

  // buildMultiCard работает и для линка (нет stencilId → quality пропускается).
  for (const t of bindingTargets) {
    if (needsMulti(t.src)) animations[t.key] = buildMultiCard(t.src)
  }

  // Кладёт shape-карточку на key + (для ячеек) мержит во внутренние стенсильные.
  const addShapeCard = (t, card) => {
    assignOrMergeAnimation(animations, t.key, card)
    if (t.stencilId) mergeBindingsIntoStencilCards(animations, t.stencilId, t.animId, t.key, card)
  }
  // Не-multi shape-источники. voltage (range → класс) + switch (плоский список,
  // любой false → серый). needsMulti-цели пропускаем — их эффекты уже в multi.
  const shapeSources = [
    {
      has: (s) => !!s.voltageSource?.tag && s.voltageSource.ranges?.length > 0,
      build: (s) => buildVoltageCard(s.voltageSource),
    },
    {
      has: (s) => switchSourceTags(s.switchSources).length > 0,
      build: (s) => buildSwitchCard(switchSourceTags(s.switchSources)),
    },
  ]
  for (const { has, build } of shapeSources) {
    for (const t of bindingTargets) {
      if (needsMulti(t.src) || !has(t.src)) continue
      addShapeCard(t, build(t.src))
    }
  }

  // ─── State-color: перекрас всего символа по состоянию (stateColors стенсила) ───
  // Слой на outer (assignOrMerge уживается с voltage/switch/quality); на потомков
  // цвет каскадит через CSS. Работает и для needsMulti-целей (мержится в их multi).
  for (const c of cellExports) {
    const card = buildStateColorCard(c)
    if (card) assignOrMergeAnimation(animations, outerKeyFor(c.stencilId, c.animId), card)
  }

  // ─── cell_node наследует voltage от соединённого провода ───
  // Если у точки соединения нет своего voltageSource — берём первый connected
  // wire с voltage. Узел получает ту же range-карточку → визуально перекрасится
  // в тот же цвет что и провод в рантайме.
  for (const c of cellExports) {
    if (needsMulti(c)) continue
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
  // (slots, voltageSource.tag, switchSources) и кладём на outer-карточку
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
    if (getStencilById(c.stencilId)?.static) continue
    attachDetailTags(outerKeyFor(c.stencilId, c.animId), getCellTagsFromTms(c))
  }
  for (const l of linkExports) {
    attachDetailTags(l.id, getCellTagsFromTms(l))
  }

  // ─── Quality (OPC DA): non-good → animation-off ───
  // quality тега: 192-255 = good, 64-191 = uncertain, 0-63 = bad. Стенсилы с
  // флагом `quality: true` в stencil.json (cell_qk/qr/qf) получают range-кейс
  // [0, 191] → addClass: animation-off — cell станет серым, если данные
  // ненадёжны. WebScada сравнивает inclusive (>=min && <=max), поэтому
  // max=191 — последнее non-good значение, 192 уже good и в range не попадёт.
  //
  // Биндинги кладём ТОЛЬКО на outer-карточку — оттуда CSS-каскад
  // `.animation-off *:not(text) { stroke }` затемняет ВСЕ stroke-элементы
  // стенсила. На inner-карточках (.true / .false) серым стал бы только
  // текущий видимый рычаг — остальной корпус остался бы чёрным.
  //
  // Outer-карточку создаём если её ещё нет (аналогично navigation-логике
  // выше). text/value-карточки сюда не включаются — у них своя
  // quality-семантика в рантайме.
  for (const c of cellExports) {
    if (needsMulti(c)) continue
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
  // escapeAttr импортируется из utils/xml — один источник правды
  // для обоих писателей SVG-строк (exporter и svgInjector).
  //
  // Линии — первыми (фон), ячейки сверху, чтобы цеплялись к портам.
  const lines = linkExports
    .map((l) => {
      const meta = {
        id: l.linkId,
        source: l.source,
        target: l.target,
      }
      // tms-поля провода — по единому дескриптору (см. LINK_META_FIELDS), чтобы
      // запись и чтение (projectLoader) не разъезжались. vertices — отдельно
      // (поле верхнего уровня линка, не tms).
      for (const f of LINK_META_FIELDS) {
        if (f.keep(l[f.key])) meta[f.key] = l[f.key]
      }
      if (l.vertices) meta.vertices = l.vertices
      const metaAttr = escapeAttr(JSON.stringify(meta))
      // l.id и l.d сейчас составляются из UUID-производных и сгенерированных
      // path-данных — symbol-safe, но escapeAttr держит инвариант на случай
      // если JointJS-расширение когда-то засунет туда что-то экзотическое.
      return `  <path id="${escapeAttr(l.id)}" d="${escapeAttr(l.d)}" stroke="${escapeAttr(l.strokeColor || '#000')}" stroke-width="${l.strokeWidth ?? 2}" fill="none" ${ATTR_META}="${metaAttr}"/>`
    })
    .join('\n')

  const serializer = new XMLSerializer()
  const groups = cellExports
    .map((c) => {
      const doc = new DOMParser().parseFromString(c.svgContent, 'image/svg+xml')
      const sourceRoot = doc.documentElement
      let inner = ''
      for (const child of Array.from(sourceRoot.children)) {
        inner += serializer.serializeToString(child)
      }
      // Flip: контент оборачиваем во внутреннюю flip-группу (позиция/поворот — на
      // outer, отражение внутри, как в редакторе). Порты в экспорт не идут.
      const flip = flipTransform(c.width, c.height, c.flipH, c.flipV)
      if (flip) inner = `<g transform="${flip}">${inner}</g>`
      const meta = {
        id: c.cellId,
        stencilId: c.stencilId,
        width: c.width,
        height: c.height,
      }
      // tms-поля — по единому дескриптору (см. CELL_META_FIELDS), чтобы запись и
      // чтение (projectLoader) не разъезжались. angle — отдельно (в JointJS-поле).
      for (const f of CELL_META_FIELDS) {
        const v = c[f.key]
        if (f.keep(v)) meta[f.key] = f.flag ? true : v
      }
      if (c.angle) meta.angle = c.angle
      if (c.z != null) meta.z = c.z
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
  // voltage по диапазонам (stroke + opt-in fill) + animation-off серым поверх.
  // Чистый SVG: без scope и без live-DOM исключений (см. buildVoltageCssRules).
  const voltageCss = buildVoltageCssRules()
    .map((r) => `    ${r}`)
    .join('\n')
  // State-color: перекрас символа по состоянию. Тот же генератор, что в симуляции.
  const stateColorCss = buildStateColorCssRules(getAllStencils())
    .map((r) => `    ${r}`)
    .join('\n')
  const inlineStyles = `  <style>
    <![CDATA[
    .${CLASS_HIDDEN} { display: none; }
${voltageCss}
${stateColorCss}
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
