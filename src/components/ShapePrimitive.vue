<script setup>
/**
 * Одна фигура редактора символов: halo выделения (под фигурой, в её же слое) +
 * сам примитив. Пять типов (rect / line / circle / polygon / polyline) отличаются
 * только набором геометрических атрибутов, поэтому геометрия считается один раз
 * и переиспользуется halo и фигурой — раньше в шаблоне StencilEditor лежали пять
 * почти одинаковых блоков, и каждый новый атрибут приходилось дублировать в оба.
 *
 * Двухкорневой шаблон (halo + фигура) — DOM остаётся плоским: interact.js цепляется
 * по глобальному `[data-se-move]`, а z-порядок фигур = порядок экспорта.
 */
import { computed } from 'vue'
import { ROUND_RX } from '../utils/stencilSvg'

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
  const points = s.points.map((p) => p.join(',')).join(' ')
  return { tag: s.closed ? 'polygon' : 'polyline', attrs: { points } }
})

// Заливка бессмысленна у линии (у ломаной — есть: замкнутая становится polygon).
const fill = computed(() => (props.shape.type === 'line' ? null : props.shape.fill))

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
  <g
    v-if="selected"
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
    :stroke="shape.stroke"
    :stroke-width="shape.strokeWidth"
    :pointer-events="pointerEvents"
    @pointerdown="emit('select')"
  />
</template>
