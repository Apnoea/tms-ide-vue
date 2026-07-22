import { ref, computed } from 'vue'
import { toPlain } from '../utils/plain'

/**
 * In-memory буфер «настроек анимаций» для копирования между элементами. Живёт
 * на сессию (singleton-ref, как useCanvas): переживает смену выделения и формы,
 * чтобы можно было скопировать с одного элемента и вставить на другой — в т.ч.
 * на другой форме.
 *
 * Два независимых слота, копируются/вставляются РАЗДЕЛЬНО (кнопки в шапке своего
 * блока инспектора):
 *  • boolClip  — булев блок: свой тег элемента (slot.onoff) + группы-зависимости
 *                switchSources → { onoffTag, groups };
 *  • rangeClip — диапазоны значений: voltageSource → { tag, ranges }.
 *
 * Payload'ы кладём уже plain (родитель делает toPlain) — reactive-прокси в
 * буфере делили бы ссылки между ячейками при вставке.
 */
const boolClip = ref(null) // { onoffTag: string|null, groups: string[][] } | null
const rangeClip = ref(null) // { tag: string, ranges: Array<{min,max,class}> } | null

const hasBool = computed(() => !!boolClip.value)
const hasRange = computed(() => !!rangeClip.value)

/**
 * Применить булев буфер к payload'у ячейки. Возвращает НОВЫЙ tms либо null, если
 * цель несовместима (вызывающий считает это пропуском). Группы-зависимости —
 * любому не-static элементу; свой булев тег (onoff) — только стенсилам с булевым
 * слотом (иначе некуда писать). Пустые группы отбрасываем; их отсутствие в буфере
 * снимает switchSources у цели (вставка = замена булева блока целиком).
 */
export function applyBoolClip(tms, clip, { isStatic = false, hasBoolSlot = false } = {}) {
  if (!clip || isStatic) return null
  const groups = (clip.groups || []).filter((g) => g.length)
  const next = { ...tms }
  if (groups.length) next.switchSources = { groups: groups.map((g) => [...g]) }
  else delete next.switchSources
  if (clip.onoffTag && hasBoolSlot) {
    next.slots = { ...(tms.slots || {}), onoff: clip.onoffTag }
  }
  return next
}

/**
 * Применить буфер диапазонов к payload'у ячейки. Возвращает НОВЫЙ tms либо null
 * для статичного стенсила (пропуск). voltageSource — свежий клон на каждую цель
 * (не делить ссылку).
 */
export function applyRangeClip(tms, clip, { isStatic = false } = {}) {
  if (!clip || isStatic) return null
  return { ...tms, voltageSource: toPlain(clip) }
}

export function useAnimationClipboard() {
  return {
    boolClip,
    rangeClip,
    hasBool,
    hasRange,
    copyBool(payload) {
      boolClip.value = payload
    },
    copyRange(payload) {
      rangeClip.value = payload
    },
  }
}
