import { ref } from 'vue'
import {
  comparePresetVersions,
  loadPresets,
  pickPresetArchive,
  readPresetZipFile,
  removePreset,
  savePreset,
  stampPreset,
  validatePresetBundle,
} from '../services/presetLibrary'
import { getAllStencils, registerStencil, unregisterStencil } from '../stencils/registry'
import { reinjectAllStencils } from '../stencils/svgInjector'
import { removeStencilOverride } from '../services/stencilOverrides'
import { useCanvas } from './useCanvas'
import { useNotify } from './useNotify'
import { useStencilUsage } from './useStencilUsage'
import { nplural } from '../utils/plural'

/**
 * Установленные наборы символов. Список реактивен и общий на приложение (синглтон):
 * диалог наборов и палитра смотрят на одно состояние.
 */
const presets = ref([])
let loaded = false

export function usePresets() {
  const notify = useNotify()
  const canvas = useCanvas()
  const { stencilUsage } = useStencilUsage()

  /**
   * Экземпляры подтягивают новую версию символов набора: рисунок, порты, габарит. Без
   * этого обновлённый набор виден в палитре, а на схемах остаётся прежний рисунок.
   *
   * Закрытые формы — ОДНИМ проходом на весь набор (по прогону на символ каждая форма
   * читалась бы и писалась десятки раз), активная — общим reinject'ом: он обходит граф
   * один раз, тогда как `syncStencilInstances` — по разу на символ.
   */
  async function syncInstances(ids) {
    await canvas.syncStencilInClosedForms(ids)
    reinjectAllStencils(canvas.graphRef.value, canvas.paperRef.value, { sync: true })
    canvas.bumpVersion()
  }

  /** Поднять список из IDB (диалог зовёт при открытии). */
  async function refreshPresets() {
    presets.value = await loadPresets()
    loaded = true
    return presets.value
  }

  function presetById(id) {
    return presets.value.find((p) => p.id === id) || null
  }

  /**
   * Установка набора из `.zip`: проверки → реестр → IDB. Атомарно — набор ставится
   * целиком либо не ставится: частичный набор невозможно ни снять, ни обновить.
   *
   * Тот же id = обновление: символы прежней версии снимаются, их id конфликтом не
   * считаются, но исчезнувшие в новой версии не должны быть расставлены на схемах.
   *
   * @returns {Promise<boolean>} установлен ли набор
   */
  async function installPresetFromFile() {
    const file = await pickPresetArchive()
    if (!file) return false
    if (!loaded) await refreshPresets()

    let bundle
    try {
      bundle = await readPresetZipFile(file)
    } catch (e) {
      notify.error('Набор не установлен', e.message)
      return false
    }

    const problems = validatePresetBundle(bundle)
    if (problems.length) {
      notify.error('Набор не установлен', problems.slice(0, 5).join('; '))
      return false
    }

    const current = presetById(bundle.id)
    const own = new Set((current?.stencils || []).map((s) => s.id))
    const incoming = new Set(bundle.stencils.map((s) => s.id))
    const taken = getAllStencils()
      .map((s) => s.id)
      .filter((id) => incoming.has(id) && !own.has(id))
    if (taken.length) {
      notify.error('Набор не установлен', `Id уже заняты: ${taken.join(', ')}`)
      return false
    }

    // Обновление не должно осиротить ячейки: символ, исчезнувший в новой версии, но
    // стоящий на схемах, рисовать будет нечем.
    const dropped = [...own].filter((id) => !incoming.has(id))
    const droppedUsage = dropped.length ? stencilUsage(dropped) : { count: 0, formIds: [] }
    if (droppedUsage.count) {
      notify.warn(
        'Набор не обновлён',
        `В новой версии нет символов, расставленных в формах: ` +
          `${droppedUsage.formIds.join(', ')}. Сначала удалите их со схем.`
      )
      return false
    }

    const preset = {
      id: bundle.id,
      name: bundle.name,
      version: bundle.version,
      description: bundle.description,
      stencils: bundle.stencils.map((s) => ({
        id: s.id,
        stencilJson: stampPreset(s.stencilJson, bundle),
        shapeSvg: s.shapeSvg,
      })),
    }

    for (const id of dropped) {
      unregisterStencil(id)
      await removeStencilOverride(id)
    }
    for (const s of preset.stencils) registerStencil(s.stencilJson, s.shapeSvg)

    const saved = await savePreset(preset)
    presets.value = [...presets.value.filter((p) => p.id !== preset.id), preset]
    // Состав палитры изменился, а она целиком уезжает в `library/` архива.
    canvas.markDirty()
    // Обновление меняет уже расставленные экземпляры: рисунок, порты и габарит им
    // подтягивает та же сверка, что после правки символа в редакторе.
    if (current) await syncInstances(preset.stencils.map((s) => s.id))

    const older = current && comparePresetVersions(bundle.version, current.version) < 0
    const title = current ? (older ? 'Набор откачен' : 'Набор обновлён') : 'Набор установлен'
    const what = `${preset.name} ${preset.version}, ${nplural(preset.stencils.length, 'символ', 'символа', 'символов')}`
    if (saved) notify.success(title, what)
    else notify.warn(title, `${what}. Браузер отклонил запись — после перезагрузки набора не будет`)
    return true
  }

  /**
   * Снять набор целиком. Отказ, если его символы расставлены: удалять их по одному
   * нельзя, а осиротевшие ячейки рисовать нечем.
   *
   * @returns {Promise<boolean>} снят ли набор
   */
  async function removePresetById(id) {
    const preset = presetById(id)
    if (!preset) return false
    const usage = stencilUsage(preset.stencils.map((s) => s.id))
    if (usage.count) {
      notify.warn(
        'Набор используется',
        `${nplural(usage.count, 'символ', 'символа', 'символов')} в формах: ` +
          `${usage.formIds.join(', ')}. Сначала удалите их со схем.`
      )
      return false
    }
    for (const s of preset.stencils) {
      unregisterStencil(s.id)
      // Снять правку анимации, если она была: иначе оверрайд поднял бы символ снятого
      // набора обратно в палитру на следующем старте.
      await removeStencilOverride(s.id)
    }
    const ok = await removePreset(id)
    presets.value = presets.value.filter((p) => p.id !== id)
    canvas.markDirty()
    if (ok) notify.success('Набор удалён', preset.name)
    else notify.warn('Набор удалён', 'Браузер отклонил запись — после перезагрузки он вернётся')
    return true
  }

  return { presets, refreshPresets, installPresetFromFile, removePresetById }
}
