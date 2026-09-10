import { ref, computed } from 'vue'
import { toPlain } from '../utils/plain'

/**
 * Буфер настроек анимаций на сессию (singleton, как useCanvas): переживает смену
 * выделения и формы, поэтому копировать можно с одного элемента, а вставлять на другой
 * и на другой форме. Блоки копируются раздельно, кнопками своих блоков инспектора.
 * Payload кладётся уже plain — reactive-прокси делили бы ссылки между целями.
 */
const stateClip = ref(null) // { slotKey: string, tag: string } | null
const depsClip = ref(null) // { groups: string[][] } | null
const rangeClip = ref(null) // { tag: string, ranges: Array<{min,max,color}> } | null
// { slotKey, tag, decimals: number|null, params: { <ключ>: string } } | null
const valueClip = ref(null)

const hasState = computed(() => !!stateClip.value)
const hasDeps = computed(() => !!depsClip.value)
const hasRange = computed(() => !!rangeClip.value)
const hasValue = computed(() => !!valueClip.value)

/**
 * Тег состояния → новый tms (null = цель несовместима, вызывающий считает это
 * пропуском). Пишем только символу с ТЕМ ЖЕ ключом слота-драйвера: `onoff` и `value` —
 * разные режимы анимации, и булев тег в символ «по значению» не годится (у него другой
 * тип и другие коды состояний).
 */
export function applyStateClip(tms, clip, { isStatic = false, slotKey = null } = {}) {
  if (!clip?.tag || isStatic || !slotKey || slotKey !== clip.slotKey) return null
  return { ...tms, slots: { ...(tms.slots || {}), [clip.slotKey]: clip.tag } }
}

/**
 * Группы-зависимости → новый tms. Применимы к любому не-static элементу, включая
 * провод. Копировать пустой буфер блок не даёт (× у него для очистки), поэтому вставка
 * зависимости только ЗАДАЁТ — молча снять их у цели она не может.
 */
export function applyDepsClip(tms, clip, { isStatic = false } = {}) {
  const groups = (clip?.groups || []).filter((g) => g.length)
  if (!groups.length || isStatic) return null
  return { ...tms, boolSource: { groups: groups.map((g) => [...g]) } }
}

/**
 * Карточка значения → новый tms: тег подписи, точность и правимые подписи. Пишем только
 * символу с ТЕМ ЖЕ ключом Text-слота. Из подписей берём лишь ОБЪЯВЛЕННЫЕ у цели ключи
 * (`paramKeys`): у другого символа подписи свои, и чужие ключи остались бы мусором.
 * Вставка заменяет карточку целиком — незаданное в буфере снимается у цели.
 */
export function applyValueClip(
  tms,
  clip,
  { isStatic = false, slotKey = null, paramKeys = [] } = {}
) {
  if (!clip || isStatic || !slotKey || slotKey !== clip.slotKey) return null
  const next = { ...tms }
  const slots = { ...(tms.slots || {}) }
  if (clip.tag) slots[clip.slotKey] = clip.tag
  else delete slots[clip.slotKey]
  // Опустевший набор слотов не оставляем: `{}` уехал бы в meta мусором.
  if (Object.keys(slots).length) next.slots = slots
  else delete next.slots
  if (Number.isFinite(clip.decimals)) next.decimals = clip.decimals
  else delete next.decimals
  const params = {}
  for (const key of paramKeys) {
    if (clip.params?.[key]) params[key] = clip.params[key]
  }
  if (Object.keys(params).length) next.params = params
  else delete next.params
  return next
}

/** Буфер диапазонов → новый tms (null у статичного). Клон на каждую цель. */
export function applyRangeClip(tms, clip, { isStatic = false } = {}) {
  if (!clip || isStatic) return null
  return { ...tms, rangeSource: toPlain(clip) }
}

export function useAnimationClipboard() {
  return {
    stateClip,
    depsClip,
    rangeClip,
    valueClip,
    hasState,
    hasDeps,
    hasRange,
    hasValue,
    copyState(payload) {
      stateClip.value = payload
    },
    copyDeps(payload) {
      depsClip.value = payload
    },
    copyRange(payload) {
      rangeClip.value = payload
    },
    copyValue(payload) {
      valueClip.value = payload
    },
  }
}
