import { ref, computed } from 'vue'
import { useProjectStore } from '../stores/useProjectStore'
import { normalizeSwitchSources } from '../utils/switchSources'

/**
 * Блок «Зависимость от других элементов» инспектора: `tms.switchSources` в
 * канонической форме `{ groups: [[tag,…],…] }` (DNF — внутри группы теги через И,
 * группы между собой через ИЛИ; элемент активен, если выполнена ЛЮБАЯ группа
 * целиком, иначе тускнеет). Экспорт: одна группа → дешёвый shape, ≥2 → multi.
 *
 * Вынесено из CanvasInspector — секция автономна: наружу нужны только
 * `switchGroups`/`switchRemovable` (props блока) и обработчики его эмитов.
 *
 * @param {object} deps
 * @param {import('vue').ComputedRef} deps.details — текущий выделенный элемент
 * @param {(updater: (tms: object) => object|undefined) => void} deps.mutateSelectedTms
 * @param {(config: object) => void} deps.openPicker — открыть единый tag-picker
 */
export function useSwitchGroups({ details, mutateSelectedTms, openPicker }) {
  const project = useProjectStore()

  // Цель добавления/замены тега: { groupIdx, tagIdx }.
  //   groupIdx=null           — новая группа (picker создаёт [tag]);
  //   groupIdx=число, tagIdx=null    — добавить тег в группу gi;
  //   groupIdx=число, tagIdx=число   — заменить тег по индексу.
  // groupIdx=undefined — пасс (cancel).
  const editingSwitch = ref({ groupIdx: undefined, tagIdx: null })

  // Канонические группы switchSources текущей ячейки (нормализует/чистит форму).
  const switchGroups = computed(() => normalizeSwitchSources(details.value?.switchSources).groups)

  // Показывать × «Удалить все зависимости» в шапке блока. У intrinsic-свитча
  // (cell_qw) блок виден всегда из-за slot.onoff — × имеет смысл ТОЛЬКО когда есть
  // группы-зависимости (иначе чистить нечего, клик был бы no-op'ом: slot.onoff им
  // не удаляется). У не-свитча блок появляется лишь при наличии switchSources, и ×
  // убирает его целиком (в т.ч. пустой) — там достаточно самого факта присутствия.
  const switchRemovable = computed(() =>
    details.value?.hasBoolSlot ? switchGroups.value.length > 0 : !!details.value?.switchSources
  )

  // Picker для switch-зависимостей исключает: основной тег ячейки (slot.onoff у
  // cell_qw) + теги ТЕКУЩЕЙ редактируемой группы (внутри группы тег уникален),
  // кроме редактируемого по индексу (его оставляем, чтобы юзер видел значение).
  // Теги других групп НЕ исключаем — тег свободно повторяется между группами.
  // Для новой группы (groupIdx=null) фильтруем только onoff-тег.
  const switchPickerTags = computed(() => {
    const d = details.value
    if (!d) return project.booleanTags
    const excluded = new Set()
    if (d.hasBoolSlot && d.onoffTag) excluded.add(d.onoffTag)
    const { groupIdx, tagIdx } = editingSwitch.value
    if (typeof groupIdx === 'number') {
      const group = normalizeSwitchSources(d.switchSources).groups[groupIdx] || []
      group.forEach((t, i) => {
        if (t && i !== tagIdx) excluded.add(t)
      })
    }
    return project.booleanTags.filter((t) => !excluded.has(t.name))
  })

  /** Полная замена switchSources на { groups }; нет групп → удаляем источник. */
  function writeSwitchGroups(groups) {
    const clean = groups.map((g) => [...new Set(g.filter(Boolean))]).filter((g) => g.length)
    mutateSelectedTms((tms) => ({
      ...tms,
      switchSources: clean.length ? { groups: clean } : null,
    }))
  }

  /** Открыть picker switch-зависимости. editingSwitch уже выставлен (add/replace),
   *  геттер читает switchPickerTags — фильтр исключений всегда актуален. */
  function openSwitchPicker() {
    openPicker({
      tags: () => switchPickerTags.value,
      header: 'Добавить булев тег',
      onSelect: onPickSwitchTag,
    })
  }

  /** «+ группа» — новая группа, рождается первым выбранным тегом (пустых нет). */
  function onAddGroup() {
    editingSwitch.value = { groupIdx: null, tagIdx: null }
    openSwitchPicker()
  }

  /** «+ тег (И)» внутри группы gi. */
  function onAddSwitchTag(gi) {
    editingSwitch.value = { groupIdx: gi, tagIdx: null }
    openSwitchPicker()
  }

  /** Клик по тегу-зависимости → замена по индексу (gi, ti). */
  function editSwitchTagAt(gi, ti) {
    editingSwitch.value = { groupIdx: gi, tagIdx: ti }
    openSwitchPicker()
  }

  function removeSwitchSources() {
    writeSwitchGroups([])
  }

  /**
   * Picker вернул тег. groupIdx=null → новая группа [tag]; иначе add (tagIdx=null)
   * или replace (tagIdx=число) внутри группы gi. Дубли ВНУТРИ группы игнорируем
   * (между группами тег повторяется свободно). Основной тег стенсила (slot.onoff)
   * в зависимости не допускаем.
   */
  function onPickSwitchTag(tag) {
    const d = details.value
    const { groupIdx, tagIdx } = editingSwitch.value
    editingSwitch.value = { groupIdx: undefined, tagIdx: null }
    if (groupIdx === undefined || !tag) return
    if (d?.hasBoolSlot && d.onoffTag === tag) return

    const groups = normalizeSwitchSources(d?.switchSources).groups
    if (groupIdx === null) {
      writeSwitchGroups([...groups, [tag]])
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
    writeSwitchGroups(next)
  }

  /** × на строке тега (gi, ti). Опустевшая группа отбрасывается (в writeSwitchGroups). */
  function removeSwitchTagAt(gi, ti) {
    const groups = normalizeSwitchSources(details.value?.switchSources).groups
    const next = groups.map((g, i) => (i === gi ? g.filter((_, j) => j !== ti) : g))
    writeSwitchGroups(next)
  }

  /** × в шапке группы — удалить группу целиком. */
  function removeSwitchGroup(gi) {
    const groups = normalizeSwitchSources(details.value?.switchSources).groups
    writeSwitchGroups(groups.filter((_, i) => i !== gi))
  }

  return {
    switchGroups,
    switchRemovable,
    onAddGroup,
    onAddSwitchTag,
    editSwitchTagAt,
    removeSwitchTagAt,
    removeSwitchGroup,
    removeSwitchSources,
  }
}
