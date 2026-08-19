import { ref, computed } from 'vue'
import { useProjectStore } from '../stores/useProjectStore'
import { normalizeBoolSource } from '../utils/boolSource'

/**
 * Блок «Зависимость от других элементов» инспектора: `tms.boolSource` в
 * канонической форме `{ groups: [[tag,…],…] }` (DNF — внутри группы теги через И,
 * группы между собой через ИЛИ; элемент активен, если выполнена ЛЮБАЯ группа
 * целиком, иначе тускнеет). Экспорт: одна группа → дешёвый shape, ≥2 → multi.
 *
 * Вынесено из CanvasInspector — секция автономна: наружу нужны только
 * `boolGroups`/`boolRemovable` (props блока) и обработчики его эмитов.
 *
 * @param {object} deps
 * @param {import('vue').ComputedRef} deps.details — текущий выделенный элемент
 * @param {(updater: (tms: object) => object|undefined) => void} deps.mutateSelectedTms
 * @param {(config: object) => void} deps.openPicker — открыть единый tag-picker
 */
export function useBoolGroups({ details, mutateSelectedTms, openPicker }) {
  const project = useProjectStore()

  // Цель добавления/замены тега: { groupIdx, tagIdx }.
  //   groupIdx=null           — новая группа (picker создаёт [tag]);
  //   groupIdx=число, tagIdx=null    — добавить тег в группу gi;
  //   groupIdx=число, tagIdx=число   — заменить тег по индексу.
  // groupIdx=undefined — пасс (cancel).
  const editingBool = ref({ groupIdx: undefined, tagIdx: null })

  // Канонические группы boolSource текущей ячейки (нормализует/чистит форму).
  const boolGroups = computed(() => normalizeBoolSource(details.value?.boolSource).groups)

  // Показывать × «Удалить все зависимости» в шапке блока. У intrinsic-свитча
  // (cell_qw) блок виден всегда из-за slot.onoff — × имеет смысл ТОЛЬКО когда есть
  // группы-зависимости (иначе чистить нечего, клик был бы no-op'ом: slot.onoff им
  // не удаляется). У не-свитча блок появляется лишь при наличии boolSource, и ×
  // убирает его целиком (в т.ч. пустой) — там достаточно самого факта присутствия.
  const boolRemovable = computed(() =>
    details.value?.hasBoolSlot ? boolGroups.value.length > 0 : !!details.value?.boolSource
  )

  // Picker булевых зависимостей исключает: основной тег ячейки (slot.onoff у
  // cell_qw) + теги ТЕКУЩЕЙ редактируемой группы (внутри группы тег уникален),
  // кроме редактируемого по индексу (его оставляем, чтобы юзер видел значение).
  // Теги других групп НЕ исключаем — тег свободно повторяется между группами.
  // Для новой группы (groupIdx=null) фильтруем только onoff-тег.
  const boolPickerTags = computed(() => {
    const d = details.value
    if (!d) return project.booleanTags
    const excluded = new Set()
    if (d.hasBoolSlot && d.onoffTag) excluded.add(d.onoffTag)
    const { groupIdx, tagIdx } = editingBool.value
    if (typeof groupIdx === 'number') {
      const group = normalizeBoolSource(d.boolSource).groups[groupIdx] || []
      group.forEach((t, i) => {
        if (t && i !== tagIdx) excluded.add(t)
      })
    }
    return project.booleanTags.filter((t) => !excluded.has(t.name))
  })

  /** Полная замена boolSource на { groups }; нет групп → удаляем источник. */
  function writeBoolGroups(groups) {
    const clean = groups.map((g) => [...new Set(g.filter(Boolean))]).filter((g) => g.length)
    mutateSelectedTms((tms) => ({
      ...tms,
      boolSource: clean.length ? { groups: clean } : null,
    }))
  }

  /** Открыть picker булевой зависимости. editingBool уже выставлен (add/replace),
   *  геттер читает boolPickerTags — фильтр исключений всегда актуален. */
  function openBoolPicker() {
    openPicker({
      tags: () => boolPickerTags.value,
      header: 'Добавить булев тег',
      onSelect: onPickBoolTag,
    })
  }

  /** «+ группа» — новая группа, рождается первым выбранным тегом (пустых нет). */
  function onAddGroup() {
    editingBool.value = { groupIdx: null, tagIdx: null }
    openBoolPicker()
  }

  /** «+ тег (И)» внутри группы gi. */
  function onAddBoolTag(gi) {
    editingBool.value = { groupIdx: gi, tagIdx: null }
    openBoolPicker()
  }

  /** Клик по тегу-зависимости → замена по индексу (gi, ti). */
  function editBoolTagAt(gi, ti) {
    editingBool.value = { groupIdx: gi, tagIdx: ti }
    openBoolPicker()
  }

  function clearBoolGroups() {
    writeBoolGroups([])
  }

  /**
   * Picker вернул тег. groupIdx=null → новая группа [tag]; иначе add (tagIdx=null)
   * или replace (tagIdx=число) внутри группы gi. Дубли ВНУТРИ группы игнорируем
   * (между группами тег повторяется свободно). Основной тег стенсила (slot.onoff)
   * в зависимости не допускаем.
   */
  function onPickBoolTag(tag) {
    const d = details.value
    const { groupIdx, tagIdx } = editingBool.value
    editingBool.value = { groupIdx: undefined, tagIdx: null }
    if (groupIdx === undefined || !tag) return
    if (d?.hasBoolSlot && d.onoffTag === tag) return

    const groups = normalizeBoolSource(d?.boolSource).groups
    if (groupIdx === null) {
      writeBoolGroups([...groups, [tag]])
      return
    }
    const group = [...(groups[groupIdx] || [])]
    if (tagIdx !== null) {
      if (group[tagIdx] === tag) return
      group[tagIdx] = tag
    } else {
      if (group.includes(tag)) return
      group.push(tag)
    }
    const next = groups.map((g, i) => (i === groupIdx ? group : g))
    writeBoolGroups(next)
  }

  /** × на строке тега (gi, ti). Опустевшая группа отбрасывается (в writeBoolGroups). */
  function removeBoolTagAt(gi, ti) {
    const groups = normalizeBoolSource(details.value?.boolSource).groups
    const next = groups.map((g, i) => (i === gi ? g.filter((_, j) => j !== ti) : g))
    writeBoolGroups(next)
  }

  /** × в шапке группы — удалить группу целиком. */
  function removeBoolGroup(gi) {
    const groups = normalizeBoolSource(details.value?.boolSource).groups
    writeBoolGroups(groups.filter((_, i) => i !== gi))
  }

  return {
    boolGroups,
    boolRemovable,
    onAddGroup,
    onAddBoolTag,
    editBoolTagAt,
    removeBoolTagAt,
    removeBoolGroup,
    clearBoolGroups,
  }
}
