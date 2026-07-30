// Аналоговое значение (cell_value) — программный стенсил «карточка с полоской».
// Геометрия и цвета одни для экспорта (buildValueExportSvg) и редактора
// (buildValueContent), иначе превью расходится с view.svg.
import { valueTextKey } from '../constants/ids'
import { SVG_NS, escapeXml, escapeAttr, svgEl } from '../utils/xml'

/** Суффикс тега → физическое имя и единица; неизвестный показываем как есть. */
const VALUE_LABEL_BY_SUFFIX = {
  '.IA': 'Ia',
  '.IB': 'Ib',
  '.IC': 'Ic',
  '.UA': 'Ua',
  '.UB': 'Ub',
  '.UC': 'Uc',
  '.UAB': 'Uab',
  '.UBC': 'Ubc',
  '.UCA': 'Uca',
  '.PW': 'P',
  '.QW': 'Q',
  '.SW': 'S',
  '.COSF': 'cosφ',
  '.F': 'f',
  '.T': 't',
}

const VALUE_UNIT_BY_SUFFIX = {
  '.IA': 'А',
  '.IB': 'А',
  '.IC': 'А',
  '.UA': 'В',
  '.UB': 'В',
  '.UC': 'В',
  '.UAB': 'В',
  '.UBC': 'В',
  '.UCA': 'В',
  '.PW': 'кВт',
  '.QW': 'квар',
  '.SW': 'кВА',
  '.COSF': '',
  '.F': 'Гц',
  '.T': '°C',
}

function suffixOfTag(tag) {
  const dotIdx = (tag || '').indexOf('.')
  return dotIdx >= 0 ? tag.slice(dotIdx) : ''
}

/** Лейбл и единица для cell_value по полному тегу. */
export function resolveValueDisplay(tag) {
  const suffix = suffixOfTag(tag)
  const label = VALUE_LABEL_BY_SUFFIX[suffix] ?? suffix.replace(/^\./, '')
  const unit = VALUE_UNIT_BY_SUFFIX[suffix] ?? ''
  return { label: label || '?', unit }
}

// Сетка карточки (100×20): [0..3] полоска, дальше фон, label с x=8, общая baseline
// y=height-5. UNIT_ZONE рассчитан на самый широкий unit («квар») + зазор.
const VALUE_STRIPE_W = 3
const VALUE_BG_COLOR = '#fafafa'
const VALUE_STRIPE_COLOR = '#000' // нейтральный — не конкурирует с цветами диапазонов и не выделяется по теме
const VALUE_LABEL_COLOR = '#71717a' // zinc-500
const VALUE_TEXT_COLOR = '#18181b' // zinc-900
const VALUE_UNIT_COLOR = '#a1a1aa' // zinc-400
const VALUE_PAD_LEFT = 8 // label-start от левого края
const VALUE_UNIT_RIGHT_PAD = 5 // unit-end от правого края
const VALUE_UNIT_ZONE = 32 // зарезервировано на unit + gap до value
const VALUE_BASELINE_PAD = 5 // расстояние от пола ячейки до общей baseline

/**
 * Экспортный SVG: label + value + единица. У value-узла id = `animation-<animId>`
 * (обычно = valueTag): рантайм обновляет его текст по этому id.
 */
export function buildValueExportSvg(animId, valueTag, width = 100, height = 20) {
  const { label, unit } = resolveValueDisplay(valueTag)
  const by = height - VALUE_BASELINE_PAD
  const stripe = `<rect x="0" y="0" width="${VALUE_STRIPE_W}" height="${height}" fill="${VALUE_STRIPE_COLOR}"/>`
  const bg = `<rect x="${VALUE_STRIPE_W}" y="0" width="${Math.max(0, width - VALUE_STRIPE_W)}" height="${height}" fill="${VALUE_BG_COLOR}"/>`
  const labelText = `<text x="${VALUE_PAD_LEFT}" y="${by}" font-size="10" font-family="sans-serif" fill="${VALUE_LABEL_COLOR}">${escapeXml(label)}</text>`
  // animId для cell_value = tms.valueTag, может содержать ", &, < — escapeAttr
  // обязателен, иначе невалидный XML и упадёт round-trip projectLoader'ом.
  const valueText = `<text id="${escapeAttr(valueTextKey(animId))}" x="${width - VALUE_UNIT_ZONE}" y="${by}" text-anchor="end" font-size="12" font-family="sans-serif" font-weight="bold" fill="${VALUE_TEXT_COLOR}">--</text>`
  const unitText = unit
    ? `<text x="${width - VALUE_UNIT_RIGHT_PAD}" y="${by}" text-anchor="end" font-size="9" font-family="sans-serif" fill="${VALUE_UNIT_COLOR}">${escapeXml(unit)}</text>`
    : ''
  return `<svg xmlns="${SVG_NS}">${stripe}${bg}${labelText}${valueText}${unitText}</svg>`
}

/**
 * Контент на холсте: полоска + фон + label/value/unit. Value показывает «--» —
 * реальное придёт в рантайме через text-анимацию.
 */
export function buildValueContent(cellView) {
  const tms = cellView.model.get('tms') || {}
  const { label, unit } = resolveValueDisplay(tms.valueTag)
  const { width, height } = cellView.model.size()
  // Общая baseline «по полу»; PAD взят с запасом под descender'ы (φ в cosφ).
  const by = height - VALUE_BASELINE_PAD

  const out = [
    // Stripe-маркер слева
    svgEl('rect', { x: 0, y: 0, width: VALUE_STRIPE_W, height, fill: VALUE_STRIPE_COLOR }),
    // Светлый фон до правого края (окраска по диапазонам — только в рантайме).
    svgEl('rect', {
      x: VALUE_STRIPE_W,
      y: 0,
      width: Math.max(0, width - VALUE_STRIPE_W),
      height,
      fill: VALUE_BG_COLOR,
    }),
    // Label — приглушённый, слева
    svgEl(
      'text',
      {
        x: VALUE_PAD_LEFT,
        y: by,
        'font-size': 10,
        'font-family': 'sans-serif',
        fill: VALUE_LABEL_COLOR,
      },
      label
    ),
    // Value — фокус блока: жирнее и крупнее label/unit
    svgEl(
      'text',
      {
        x: width - VALUE_UNIT_ZONE,
        y: by,
        'text-anchor': 'end',
        'font-size': 12,
        'font-family': 'sans-serif',
        'font-weight': 'bold',
        fill: VALUE_TEXT_COLOR,
      },
      '--'
    ),
  ]

  if (unit) {
    out.push(
      svgEl(
        'text',
        {
          x: width - VALUE_UNIT_RIGHT_PAD,
          y: by,
          'text-anchor': 'end',
          'font-size': 9,
          'font-family': 'sans-serif',
          fill: VALUE_UNIT_COLOR,
        },
        unit
      )
    )
  }

  return out
}
