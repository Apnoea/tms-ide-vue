<script setup>
/**
 * Одна фигура редактора символов: halo выделения (под фигурой, в её слое) + сам
 * примитив. Геометрия считается один раз и переиспользуется обоими.
 *
 * Подпись (`text`) — отдельная ветка: обводки нет, цвет в `fill`, halo — рамка по
 * замеренному bbox (широкий stroke дал бы контур вокруг глифов).
 *
 * Двухкорневой шаблон держит DOM плоским: interact.js цепляется по глобальному
 * `[data-se-move]`, а z-порядок фигур = порядок экспорта.
 */
import { computed } from 'vue'
import { ROUND_RX, TEXT_SHAPE_ANCHOR, TEXT_SHAPE_SIZE, textShapeBox } from '../utils/stencilSvg'
import { normalizeFont } from '../utils/textMetrics'

const props = defineProps({
  shape: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  /** Толщина halo (обводка выделения) в user-координатах. */
  haloWidth: { type: Number, default: 3 },
  /** Цвет halo — токен темы, приходит от редактора (SVG-атрибут var() не резолвит). */
  haloStroke: { type: String, default: '' },
  /** null — обычный хит-тест; 'none' — фигура прозрачна для мыши (режим рисования). */
  pointerEvents: { type: String, default: null },
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
    return { tag: 'circle', attrs: { cx: s.cx, cy: s.cy, r: s.r } }
  }
  if (s.type === 'text') {
    return {
      tag: 'text',
      attrs: {
        x: s.x,
        y: s.y,
        'text-anchor': TEXT_SHAPE_ANCHOR,
        'font-size': s.fontSize ?? TEXT_SHAPE_SIZE,
        'font-family': normalizeFont(s.fontFamily),
        'font-weight': s.bold ? 'bold' : null,
      },
    }
  }
  const points = s.points.map((p) => p.join(',')).join(' ')
  return { tag: s.closed ? 'polygon' : 'polyline', attrs: { points } }
})

// Рамка выделения подписи — по тому же bbox, что учитывает cropToContent.
const textHalo = computed(() => (isText.value ? textShapeBox(props.shape) : null))

// Заливка бессмысленна у линии (у ломаной — есть: замкнутая становится polygon).
// У текста fill — это его цвет, поэтому берём из `stroke` модели (единое поле цвета).
const fill = computed(() => {
  const s = props.shape
  if (s.type === 'line') return null
  if (s.type === 'text') return s.stroke || '#000'
  return s.fill
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
    :stroke-linecap="shape.rounded ? 'round' : null"
    :stroke-linejoin="shape.rounded ? 'round' : null"
  >
    <component :is="geom.tag" v-bind="geom.attrs" />
  </g>
  <component
    :is="geom.tag"
    v-bind="{ ...geom.attrs, ...capJoin }"
    data-se-move="shape"
    :data-id="shape.id"
    :fill="fill"
    :stroke="isText ? null : shape.stroke"
    :stroke-width="isText ? null : shape.strokeWidth"
    :pointer-events="pointerEvents"
    @pointerdown="emit('select', $event)"
  >
    <template v-if="isText">{{ shape.text }}</template>
  </component>
</template>
