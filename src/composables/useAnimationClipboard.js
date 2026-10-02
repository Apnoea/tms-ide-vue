import { ref, computed } from 'vue'
import { getStencilById, isStaticTms, stateSlotKeyOf, textSlotOf } from '../stencils/registry'
import { injectStencilSvg } from '../stencils/svgInjector'
import { nplural } from '../utils/plural'

/**
 * Буфер настроек анимаций на сессию (singleton, как useCanvas): переживает смену
 * выделения и формы, поэтому копировать можно с одного элемента, а вставлять на другой
 * и на другой форме. Три независимых слота — тег состояния, карточка значения и
 * зависимости; каждый копируется кнопкой в шапке своего блока инспектора, ЦЕЛИКОМ,
 * вместе с тегом. Payload кладётся уже plain — reactive-прокси делили бы ссылки между
 * целями.
 */
const stateClip = ref(null) // { slotKey: string, tag: string } | null
const depsClip = ref(null) // { groups: string[][] } | null
// { slotKey, tag, decimals: number|null, params: { <ключ>: string } } | null
const valueClip = ref(null)

const hasState = computed(() => !!stateClip.value)
const hasDeps = computed(() => !!depsClip.value)
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

/**
 * @param {object} [deps] — нужны только вставке: буфер сам по себе живёт и без них
 * @param {object} [deps.canvas] — useCanvas: выделение, paper, снимок истории
 * @param {object} [deps.notify] — useNotify: итог вставки тостом
 */
export function useAnimationClipboard({ canvas = null, notify = null } = {}) {
  /**
   * Вставка на ВСЁ выделение: для каждой цели `apply(tms)` → новый tms либо null
   * (несовместимо → пропуск со счётчиком). Заблокированные отсекает `writableItems`,
   * пустой буфер — no-op.
   *
   * `reinject: true` обязателен, когда вставка меняет слоты: тег уходит в bindings
   * разметки, и без перерисовки они остались бы от прежнего.
   */
  function pasteOnSelection(clip, apply, title, { reinject = false } = {}) {
    if (!clip) return
    const paper = canvas.paperRef.value
    const sel = canvas.selection.value
    const writable = canvas.writableItems(sel)
    let applied = 0
    let skipped = sel.length - writable.length // заблокированные
    for (const cell of writable) {
      const next = apply(cell.get('tms') || {})
      if (!next) {
        skipped++
        continue
      }
      cell.set('tms', next)
      if (reinject) {
        const stencil = getStencilById(next.stencilId)
        const cellView = stencil && paper?.findViewByModel(cell)
        if (cellView) injectStencilSvg(cellView, stencil)
      }
      applied++
    }
    canvas.bumpVersion()
    canvas.requestSnapshot()
    const parts = [`Применено к ${nplural(applied, 'символ', 'символа', 'символов')}`]
    if (skipped) parts.push(`пропущено: ${skipped}`)
    const detail = parts.join(' · ')
    // Нулевой результат — не «успех».
    if (applied === 0) notify.warn('Настройки не применены', detail)
    else notify.success(title, detail)
  }

  return {
    hasState,
    hasDeps,
    hasValue,
    copyState(payload) {
      stateClip.value = payload
    },
    copyDeps(payload) {
      depsClip.value = payload
    },
    copyValue(payload) {
      valueClip.value = payload
    },
    /** Тег состояния — символам с тем же ключом слота-драйвера (см. applyStateClip). */
    pasteState() {
      const clip = stateClip.value
      pasteOnSelection(
        clip,
        (tms) =>
          applyStateClip(tms, clip, { isStatic: isStaticTms(tms), slotKey: stateSlotKeyOf(tms) }),
        'Тег состояния вставлен',
        { reinject: true }
      )
    },
    /** Карточка значения — символам с Text-слотом того же ключа, подписи — по их ключам. */
    pasteValue() {
      const clip = valueClip.value
      pasteOnSelection(
        clip,
        (tms) => {
          const stencil = getStencilById(tms.stencilId)
          return applyValueClip(tms, clip, {
            isStatic: isStaticTms(tms),
            slotKey: textSlotOf(stencil?.slots)?.key || null,
            paramKeys: (stencil?.params || []).map((p) => p.key),
          })
        },
        'Карточка значения вставлена',
        { reinject: true }
      )
    },
    /** Зависимости — любому не-static элементу, включая провод (замена групп целиком). */
    pasteDeps() {
      const clip = depsClip.value
      pasteOnSelection(
        clip,
        (tms) => applyDepsClip(tms, clip, { isStatic: isStaticTms(tms) }),
        'Зависимости вставлены'
      )
    },
  }
}
