// Аналоговое значение (cell_value) — программный стенсил «карточка с полоской».
// Геометрия и цвета одни для экспорта (buildValueExportSvg) и редактора
// (buildValueContent), иначе превью расходится с view.svg.
import { valueTextKey } from '../constants/ids'
import { SVG_NS, escapeXml, escapeAttr, svgEl } from '../utils/xml'

function suffixOfTag(tag) {
  const dotIdx = (tag || '').indexOf('.')
  return dotIdx >= 0 ? tag.slice(dotIdx) : ''
}

/**
 * Подпись и единица карточки. Приоритет:
 *  1. выбранная пользователем пара (`tms.valueLabel` / `valueUnit`) — последнее слово
 *     за ним, имена тегов не во всех проектах следуют конвенции;
 *  2. пресет стенсила по суффиксу тега (`valuePresets` в stencil.json) — привычный
 *     электрический случай остаётся автоматическим;
 *  3. пусто — подпись не выдумываем: суффикс тега в роли подписи («WHATEVER») и «?»
 *     читались как сбой приложения.
 */
export function resolveValueDisplay(tag, tms = null, presets = []) {
  if (tms?.valueLabel) return { label: tms.valueLabel, unit: tms.valueUnit || '' }
  const suffix = suffixOfTag(tag)
  const preset = suffix ? presets.find((p) => p.suffix === suffix) : null
  return { label: preset?.label || '', unit: preset?.unit || '' }
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
 * (обычно = valueTag): рантайм обновляет его текст по этому id. `display` —
 * готовая пара от `resolveValueDisplay` (у вызывающего есть и tms, и пресеты).
 */
export function buildValueExportSvg(animId, width = 100, height = 20, display = {}) {
  const { label = '', unit = '' } = display
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
export function buildValueContent(cellView, presets = []) {
  const tms = cellView.model.get('tms') || {}
  const { label, unit } = resolveValueDisplay(tms.valueTag, tms, presets)
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
