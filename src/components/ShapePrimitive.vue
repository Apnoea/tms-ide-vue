<script setup>
/**
 * Одна фигура редактора символов: halo выделения (под фигурой, в её слое) и сам
 * примитив — геометрия считается один раз на оба.
 *
 * Halo линии и ломаной УДЛИНЯЕТСЯ на запас: обводка расширяется только
 * перпендикулярно, поэтому рамка равной толщины со всех сторон получается только так
 * (`square`/`round` выступили бы на половину толщины halo).
 *
 * Подпись (`text`) — отдельная ветка: обводки нет, цвет в `fill`, halo — рамка по
 * замеренному bbox (широкий stroke дал бы контур вокруг глифов). У ПУСТОЙ подписи
 * вместо глифов — иконка текстового блока и прозрачная область попадания: у пустого
 * `<text>` её нет, а такая подпись штатна (текст приходит с холста параметром).
 *
 * РОЛЬ подписи (значение тега / правится на холсте) помечается у самой фигуры — по
 * галкам её видно только у выделенной. Иконка и маркеры только в редакторе, в
 * `shape.svg` не уезжают.
 *
 * Мышь работает по HIT-СЛОЮ — прозрачной копии геометрии с широкой обводкой и
 * `fill="transparent"`: у контурной фигуры (`fill="none"`) иначе ловится только сама
 * линия. Рисунок для мыши прозрачен.
 *
 * Двухкорневой шаблон держит DOM плоским: interact.js цепляется по глобальному
 * `[data-se-move]`, а z-порядок фигур совпадает с порядком экспорта.
 */
import { computed } from 'vue'
import {
  ROUND_RX,
  TEXT_LINE_HEIGHT,
  TEXT_SHAPE_SIZE,
  radii,
  textAnchorOf,
  textLines,
  textShapeBox,
} from '../utils/stencilSvg'
import { normalizeFont } from '../utils/textMetrics'
import { TEXT_ICON } from '../constants/icons'

/** Служебный серый (zinc-400): иконка — подсказка редактора, а не часть рисунка. */
const EMPTY_TEXT_COLOR = '#a1a1aa'

const props = defineProps({
  shape: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  /** Толщина halo (обводка выделения) в user-координатах. */
  haloWidth: { type: Number, default: 3 },
  /** Цвет halo — токен темы, приходит от редактора (SVG-атрибут var() не резолвит). */
  haloStroke: { type: String, default: '' },
  /** null — обычный хит-тест; 'none' — фигура прозрачна для мыши (режим рисования). */
  pointerEvents: { type: String, default: null },
  /** CSS-курсор фигуры: намерение должно читаться ДО нажатия (тело — перемещение). */
  cursor: { type: String, default: null },
  /** Запас hit-обводки в user-координатах (вызывающий знает масштаб). */
  hitWidth: { type: Number, default: 6 },
})

const emit = defineEmits(['select'])

const isText = computed(() => props.shape.type === 'text')

/** Тег и геометрические атрибуты примитива (общие для halo и самой фигуры). */
const geom = computed(() => {
  const s = props.shape
  if (s.type === 'rect') {
    return {
      tag: 'rect',
      attrs: { x: s.x, y: s.y, width: s.w, height: s.h, rx: s.rounded ? ROUND_RX : null },
    }
  }
  if (s.type === 'line') {
    return { tag: 'line', attrs: { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 } }
  }
  if (s.type === 'circle') {
    // Круг и эллипс — один тип модели, тег выбирается по радиусам, как в экспорте.
    const { rx, ry } = radii(s)
    return rx === ry
      ? { tag: 'circle', attrs: { cx: s.cx, cy: s.cy, r: rx } }
      : { tag: 'ellipse', attrs: { cx: s.cx, cy: s.cy, rx, ry } }
  }
  if (s.type === 'text') {
    return {
      tag: 'text',
      attrs: {
        x: s.x,
        y: s.y,
        // Якорь — из `align` фигуры (тем же textAnchorOf, что в serializeShape):
        // превью редактора и `shape.svg` обязаны совпадать до атрибута.
        'text-anchor': textAnchorOf(s),
        'font-size': s.fontSize ?? TEXT_SHAPE_SIZE,
        'font-family': normalizeFont(s.fontFamily),
        'font-weight': s.bold ? 'bold' : null,
      },
    }
  }
  const points = s.points.map((p) => p.join(',')).join(' ')
  return { tag: s.closed ? 'polygon' : 'polyline', attrs: { points } }
})

/** Ширина hit-обводки: обводка фигуры плюс запас — края толстой линии тоже ловятся. */
const hitStroke = computed(() => (props.shape.strokeWidth ?? 2) + props.hitWidth)

/** Пустая подпись: глифов нет, рисуем вместо них иконку текстового блока. */
const emptyText = computed(() => isText.value && !(props.shape.text || '').trim())

/** Габарит-заглушки: два знака кегля от точки привязки по якорю подписи. */
const emptyBox = computed(() => {
  const s = props.shape
  const size = s.fontSize ?? TEXT_SHAPE_SIZE
  const w = size * 2
  const anchor = textAnchorOf(s)
  const x = anchor === 'start' ? s.x : anchor === 'end' ? s.x - w : s.x - w / 2
  return { x, y: s.y - size, w, h: size * 1.25 }
})

// Иконка нарисована в сетке 16×16 (constants/icons), поэтому вписываем её по высоте
// заглушки и центрируем по ширине — пропорции глифа не искажаются.
const emptyIconTransform = computed(() => {
  const b = emptyBox.value
  const k = b.h / 16
  return `translate(${b.x + (b.w - 16 * k) / 2} ${b.y}) scale(${k})`
})

/** Запас halo с каждой стороны, он же величина удлинения торцов. */
const haloPad = computed(() => Math.max(0, (props.haloWidth - (props.shape.strokeWidth ?? 2)) / 2))

/** Точка, отодвинутая от `[bx, by]` в сторону `[ax, ay]` на `pad`. */
function extendPoint([ax, ay], [bx, by], pad) {
  const dx = ax - bx
  const dy = ay - by
  const len = Math.hypot(dx, dy)
  if (!len) return [ax, ay]
  return [ax + (dx / len) * pad, ay + (dy / len) * pad]
}

/**
 * Геометрия halo: у линии и НЕзамкнутой ломаной концы вынесены наружу на запас, у
 * остальных — та же, что у фигуры (у замкнутых торцов нет).
 */
const haloGeom = computed(() => {
  const s = props.shape
  const pad = haloPad.value
  if (!pad) return geom.value
  if (s.type === 'line') {
    const [x1, y1] = extendPoint([s.x1, s.y1], [s.x2, s.y2], pad)
    const [x2, y2] = extendPoint([s.x2, s.y2], [s.x1, s.y1], pad)
    return { tag: 'line', attrs: { x1, y1, x2, y2 } }
  }
  if (s.type === 'polyline' && !s.closed && (s.points || []).length > 1) {
    const pts = s.points.map((p) => [...p])
    pts[0] = extendPoint(pts[0], pts[1], pad)
    pts[pts.length - 1] = extendPoint(pts[pts.length - 1], pts[pts.length - 2], pad)
    return { tag: 'polyline', attrs: { points: pts.map((p) => p.join(',')).join(' ') } }
  }
  return geom.value
})

// Рамка выделения подписи — по тому же bbox, что учитывает cropToContent.
const textHalo = computed(() => {
  if (!isText.value) return null
  return emptyText.value ? emptyBox.value : textShapeBox(props.shape)
})

/**
 * Маркер роли по bbox подписи: решётка у значения тега (как у одноимённого блока
 * инспектора), пунктир у правимой на холсте. Роли взаимоисключающие.
 */
const roleMark = computed(() => {
  const box = textHalo.value
  if (!box) return null
  if (props.shape.valueText) return { kind: 'value', box }
  if (props.shape.param) return { kind: 'param', box }
  return null
})

// Заливка бессмысленна у линии (у ломаной — есть: замкнутая становится polygon).
// У текста fill — это его цвет, поэтому берём из `stroke` модели (единое поле цвета).
const fill = computed(() => {
  const s = props.shape
  if (s.type === 'line') return null
  if (s.type === 'text') return s.stroke || '#000'
  return s.fill
})

// Строки подписи и шаг вниз — та же геометрия, что у serializeShape: редактор и
// `view.svg` обязаны показывать одинаковый текст. Одну строку рисуем без tspan'ов.
const textRows = computed(() => {
  if (!isText.value) return null
  const lines = textLines(props.shape)
  if (lines.length < 2) return null
  const step = (props.shape.fontSize ?? TEXT_SHAPE_SIZE) * TEXT_LINE_HEIGHT
  return lines.map((line, i) => ({ line, dy: i === 0 ? 0 : step }))
})

// Скругление: у rect это rx (в geom), у линий — круглые торцы/стыки.
const capJoin = computed(() => {
  const s = props.shape
  if (!s.rounded) return {}
  if (s.type === 'line') return { 'stroke-linecap': 'round' }
  if (s.type === 'polyline') {
    return s.closed
      ? { 'stroke-linejoin': 'round' }
      : { 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
  }
  return {}
})
</script>

<template>
  <!-- Halo под фигурой: реальные цвет линии/заливка остаются видны поверх, а
       выделение читается по обводке вокруг + ручкам (их рисует редактор сверху). -->
  <rect
    v-if="selected && textHalo"
    pointer-events="none"
    fill="none"
    :style="{ stroke: haloStroke }"
    :stroke-width="haloWidth / 2"
    :x="textHalo.x"
    :y="textHalo.y"
    :width="textHalo.w"
    :height="textHalo.h"
  />
  <g
    v-else-if="selected"
    pointer-events="none"
    fill="none"
    :style="{ stroke: haloStroke }"
    :stroke-width="haloWidth"
    :stroke-linecap="shape.rounded ? 'round' : 'butt'"
    :stroke-linejoin="shape.rounded ? 'round' : 'miter'"
  >
    <component :is="haloGeom.tag" v-bind="haloGeom.attrs" />
  </g>
  <!-- Роль подписи: решётка у значения тега, пунктир у правимой на холсте. -->
  <template v-if="roleMark">
    <text
      v-if="roleMark.kind === 'value'"
      pointer-events="none"
      :x="roleMark.box.x"
      :y="roleMark.box.y"
      :font-size="roleMark.box.h * 0.5"
      font-family="sans-serif"
      :fill="EMPTY_TEXT_COLOR"
    >
      #
    </text>
    <line
      v-else
      pointer-events="none"
      :x1="roleMark.box.x"
      :y1="roleMark.box.y + roleMark.box.h"
      :x2="roleMark.box.x + roleMark.box.w"
      :y2="roleMark.box.y + roleMark.box.h"
      :stroke="EMPTY_TEXT_COLOR"
      stroke-width="0.5"
      stroke-dasharray="2 2"
    />
  </template>
  <!-- Пустая подпись: иконка и область попадания поверх неё. data-se-move на
       прямоугольнике — interact.js читает атрибут у самого target'а. -->
  <g v-if="emptyText" :transform="emptyIconTransform" pointer-events="none">
    <path
      v-for="(part, i) in TEXT_ICON"
      :key="i"
      :d="part.d"
      :fill="part.mode === 'fill' ? EMPTY_TEXT_COLOR : 'none'"
      :stroke="part.mode === 'stroke' ? EMPTY_TEXT_COLOR : 'none'"
      stroke-width="1.2"
    />
  </g>
  <rect
    v-if="emptyText"
    :x="emptyBox.x"
    :y="emptyBox.y"
    :width="emptyBox.w"
    :height="emptyBox.h"
    fill="transparent"
    stroke="none"
    data-se-move="shape"
    :data-id="shape.id"
    :pointer-events="pointerEvents"
    :style="cursor ? { cursor } : null"
    @pointerdown="emit('select', $event)"
  />
  <component
    v-else
    :is="geom.tag"
    v-bind="{ ...geom.attrs, ...capJoin }"
    :fill="fill"
    :stroke="isText ? null : shape.stroke"
    :stroke-width="isText ? null : shape.strokeWidth"
    pointer-events="none"
  >
    <template v-if="textRows">
      <tspan v-for="(row, i) in textRows" :key="i" :x="shape.x" :dy="row.dy">{{ row.line }}</tspan>
    </template>
    <template v-else-if="isText">{{ shape.text }}</template>
  </component>
  <component
    v-if="!emptyText"
    :is="geom.tag"
    v-bind="geom.attrs"
    data-se-move="shape"
    :data-id="shape.id"
    fill="transparent"
    stroke="transparent"
    :stroke-width="hitStroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    :pointer-events="pointerEvents === 'none' ? 'none' : 'all'"
    :style="cursor ? { cursor } : null"
    @pointerdown="emit('select', $event)"
  >
    <!-- Подпись ловится глифами: обводка hit-слоя дала бы контур вокруг букв. -->
    <template v-if="isText">{{ shape.text }}</template>
  </component>
</template>
