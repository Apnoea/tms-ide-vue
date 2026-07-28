import { getStencilById, getAllStencils } from '../stencils/registry'
import { instantiate } from '../stencils/parser'
import { flipTransform } from '../stencils/svgInjector'
import { buildBusExportSvg } from '../stencils/busCell'
import { buildTextExportSvg } from '../stencils/textCell'
import { buildValueExportSvg } from '../stencils/valueCell'
import {
  CLASS_OFF,
  CLASS_HIDDEN,
  buildVoltageCssRules,
  buildStateColorCssRules,
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
// Билдеры animation-карточек (рантайм-протокол) — в отдельном модуле; здесь только
// оркестрация: обход графа → SVG-сборка + раскладка карточек по id.
import {
  buildVoltageCard,
  buildSwitchCard,
  buildMultiCard,
  buildStateColorCard,
  needsMulti,
  assignOrMergeAnimation,
  mergeBindingsIntoStencilCards,
} from './animationCards'
import { SVG_NS, escapeAttr } from '../utils/xml'
import { getCellTagsFromTms } from '../utils/cellSearch'
import { switchSourceTags } from '../utils/switchSources'

/**
 * Короткий id из UUID: первый сегмент, при коллизии добираем следующие. Без этого две
 * ячейки с одинаковым префиксом слились бы в одну карточку. Тот же UUID даёт тот же
 * short-id, а round-trip всё равно держится на полном UUID в data-tms-meta.
 *
 * @param {string} fullId — JointJS UUID
 * @param {(candidate: string) => boolean} isTaken
 */
function uniqueShortId(fullId, isTaken) {
  const segments = String(fullId).split('-')
  let candidate = segments[0]
  for (let i = 1; i < segments.length && isTaken(candidate); i++) {
    candidate = `${candidate}-${segments[i]}`
  }
  return candidate
}

/** Абсолютная позиция конца линка. linkPinning=false → ждём { id, port } или { id }. */
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
    // Порт не найден (рассинхрон после ресайза шины) — уходим в центр, но сигналим
    // пользователю: тихий сдвиг провода заметить трудно.
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

// Алиас: ниже в нескольких блоках объявляется локальная `outerKey`, которая
// перекрыла бы импорт.
const outerKeyFor = outerKey

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
  // Один Set на ячейки и провода: их префиксы не пересекаются, но два Set'а незачем.
  const usedOuterKeys = new Set()
  // Предупреждения уходят в toast: в консоли инженер их не увидит.
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
    const stencilPrefix = innerPrefix(c.stencilId, c.animId)
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
