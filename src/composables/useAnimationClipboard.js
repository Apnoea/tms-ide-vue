import { ref, computed } from 'vue'
import { toPlain } from '../utils/plain'

/**
 * Буфер настроек анимаций на сессию (singleton, как useCanvas): переживает смену
 * выделения и формы — копируем с одного элемента, вставляем на другой, в т.ч. на
 * другой форме. Два слота копируются раздельно, кнопками своего блока инспектора.
 * Payload кладём уже plain: reactive-прокси делили бы ссылки между целями вставки.
 */
const boolClip = ref(null) // { onoffTag: string|null, groups: string[][] } | null
const rangeClip = ref(null) // { tag: string, ranges: Array<{min,max,class}> } | null

const hasBool = computed(() => !!boolClip.value)
const hasRange = computed(() => !!rangeClip.value)

/**
 * Булев буфер → новый tms (null = цель несовместима, вызывающий считает пропуском).
 * Группы — любому не-static элементу, свой тег `onoff` — только стенсилу с булевым
 * слотом. Вставка заменяет блок целиком, поэтому пустой буфер снимает boolSource.
 */
export function applyBoolClip(tms, clip, { isStatic = false, hasBoolSlot = false } = {}) {
  if (!clip || isStatic) return null
  const groups = (clip.groups || []).filter((g) => g.length)
  const next = { ...tms }
  if (groups.length) next.boolSource = { groups: groups.map((g) => [...g]) }
  else delete next.boolSource
  if (clip.onoffTag && hasBoolSlot) {
    next.slots = { ...(tms.slots || {}), onoff: clip.onoffTag }
  }
  return next
}

/** Буфер диапазонов → новый tms (null у статичного). Клон на каждую цель. */
export function applyRangeClip(tms, clip, { isStatic = false } = {}) {
  if (!clip || isStatic) return null
  return { ...tms, rangeSource: toPlain(clip) }
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
