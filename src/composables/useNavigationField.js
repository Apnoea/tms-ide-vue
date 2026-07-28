import { ref, computed, watch } from 'vue'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

/**
 * Поле навигации инспектора: `tms.navigation` — id формы-цели (= view-id рантайма),
 * по клику в рантайме открывается другая view. AutoComplete даёт выбрать из форм
 * проекта ИЛИ ввести view-id вручную (ссылка на ещё не загруженную/внешнюю view
 * штатна).
 *
 * Ввод идёт в ЧЕРНОВИК `navInput`, в граф коммитим по blur/Enter/выбору: мутация на
 * каждый keystroke пересчитывала бы `details`, навязывала `:model-value` обратно и
 * сбрасывала ввод.
 *
 * @param {object} deps
 * @param {import('vue').ComputedRef} deps.details — текущий выделенный элемент
 * @param {(updater: (tms: object) => object|undefined) => void} deps.mutateSelectedTms
 */
export function useNavigationField({ details, mutateSelectedTms }) {
  const workspace = useWorkspaceStore()

  // Свич управляет видимостью инпута; пустое значение не пишется, при OFF — чистим.
  const navigationEnabled = ref(false)
  const navInput = ref('')
  // id ячейки, к которой относится черновик navInput. Нужен гард в commitNav: клик по
  // другой ячейке меняет selection синхронно (pointerdown) ДО blur поля, поэтому без
  // сверки blur записал бы черновик в только что выбранную ЧУЖУЮ ячейку (а пустое
  // поле — стёрло бы её навигацию).
  const navCellId = ref(null)
  // Подсказки выпадашки AutoComplete — формы проекта, фильтруются по вводу (@complete).
  const navSuggestions = ref([])

  // Источник watch'а — МАССИВ ГЕТТЕРОВ [id, navigation], а не один getter,
  // возвращающий [id, navigation]: одиночный getter отдаёт новый массив каждый
  // раз → Object.is всегда false → callback стрелял бы на каждый bumpVersion
  // (тумблер сбрасывался бы при любом движении ячейки). Массив геттеров даёт
  // поэлементный diff: ресинк только когда реально сменился id (другая ячейка)
  // или navigation (undo/redo на той же ячейке). navInput НЕ трогается на вводе
  // (navigation в графе меняется только по commit), поэтому ввод не перетирается.
  watch(
    [() => details.value?.id, () => details.value?.navigation],
    () => {
      navigationEnabled.value = !!details.value?.navigation
      navInput.value = details.value?.navigation || ''
      navCellId.value = details.value?.id ?? null
    },
    { immediate: true }
  )

  function patchNavigation(value) {
    if (details.value?.kind !== 'cell') return
    mutateSelectedTms((tms) => {
      const trimmed = String(value || '').trim()
      if ((tms.navigation || '') === trimmed) return undefined
      const next = { ...tms }
      if (trimmed) next.navigation = trimmed
      else delete next.navigation
      return next
    })
  }

  function toggleNavigationEnabled(value) {
    navigationEnabled.value = value
    if (!value) {
      navInput.value = ''
      patchNavigation('')
    }
  }

  // Формы-цели: все формы проекта кроме текущей (переход на себя бессмыслен).
  const otherFormIds = computed(() =>
    workspace.formIds.filter((id) => id !== workspace.activeFormId)
  )

  function onNavComplete(e) {
    const q = (e.query || '').toLowerCase()
    navSuggestions.value = otherFormIds.value.filter((id) => id.toLowerCase().includes(q))
  }

  /** Коммит черновика в граф. item-select даёт event.value (выбранная форма);
   *  blur/Enter — берём текущий navInput. Гард по navCellId: если выделение уже
   *  сменилось (клик по другой ячейке приходит ДО blur), черновик не наш — выбрасываем. */
  function commitNav(e) {
    if (!details.value || details.value.id !== navCellId.value) return
    patchNavigation(e && e.value !== undefined ? e.value : navInput.value)
  }

  // Цель вне загруженных форм — НЕ ошибка (внешняя view), лишь нейтральная пометка.
  const navBroken = computed(() => {
    const cur = details.value?.navigation
    return !!cur && !workspace.formIds.includes(cur)
  })

  return {
    navigationEnabled,
    navInput,
    navSuggestions,
    otherFormIds,
    navBroken,
    toggleNavigationEnabled,
    onNavComplete,
    commitNav,
  }
}
