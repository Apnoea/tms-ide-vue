import { ref } from 'vue'
import {
  comparePresetVersions,
  loadPresets,
  pickPresetArchive,
  presetStencilBase,
  readPresetZipFile,
  rebaseOverrides,
  removePreset,
  savePreset,
  stampPreset,
  validatePresetBundle,
} from '../services/presetLibrary'
import { getAllStencils, registerStencil, unregisterStencil } from '../stencils/registry'
import { reinjectAllStencils } from '../stencils/svgInjector'
import {
  loadStencilOverrides,
  removeStencilOverride,
  replaceStencilOverrides,
} from '../services/stencilOverrides'
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

  /** Набор к установке: метка набора в каждом символе — из манифеста. */
  function presetOf(bundle) {
    return {
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
  }

  /**
   * Наборы, приехавшие с архивом проекта: ставим недостающие и более новые версии, а
   * символы ВСЕХ установленных наборов возвращаем к поставке — проект сменился, и
   * правки прежнего поверх них висеть не должны (правки нового наложит импорт).
   *
   * Гейтов установки из файла нет: проект заменяется целиком, спрашивать «расставлено
   * на схемах» не у кого, а проект, принёсший версию, на ней и собран. Старую версию из
   * архива не ставим никогда — откат только руками.
   *
   * @returns {Promise<{ installed: string[], updated: string[], older: string[],
   *   skipped: string[], saved: boolean }>} строки для отчёта импорта
   */
  async function adoptProjectPresets(bundles) {
    await refreshPresets()
    const report = { installed: [], updated: [], older: [], skipped: [], saved: true }
    for (const bundle of bundles || []) {
      const label = `«${bundle.name || bundle.id}»`
      if (validatePresetBundle(bundle).length) {
        report.skipped.push(label)
        continue
      }
      const current = presetById(bundle.id)
      const cmp = current ? comparePresetVersions(bundle.version, current.version) : 1
      if (cmp < 0) report.older.push(`${label} ${bundle.version} (у тебя ${current.version})`)
      if (cmp <= 0) continue
      // Символ с тем же id из ДРУГОГО набора: наборы не должны перекрывать друг друга.
      const clash = bundle.stencils.some((s) => {
        const owner = presetStencilBase(s.id)?.stencilJson?.preset?.id
        return owner && owner !== bundle.id
      })
      if (clash) {
        report.skipped.push(label)
        continue
      }
      const preset = presetOf(bundle)
      const incoming = new Set(preset.stencils.map((s) => s.id))
      for (const s of current?.stencils || []) if (!incoming.has(s.id)) unregisterStencil(s.id)
      if (!(await savePreset(preset))) report.saved = false
      presets.value = [...presets.value.filter((p) => p.id !== preset.id), preset]
      ;(current ? report.updated : report.installed).push(`${label} ${preset.version}`)
    }
    for (const p of presets.value) {
      for (const s of p.stencils) registerStencil(s.stencilJson, s.shapeSvg)
    }
    return report
  }

  /**
   * Установка набора из `.zip`: проверки → реестр → IDB. Атомарно — набор ставится
   * целиком либо не ставится: частичный набор невозможно ни снять, ни обновить.
   *
   * Тот же id = обновление: символы прежней версии снимаются, их id конфликтом не
   * считаются, но исчезнувшие в новой версии не должны быть расставлены на схемах.
   * Правки проекта у символов набора ложатся на новую версию (`rebaseOverrides`).
   *
   * @param {{ confirmDowngrade?: (bundle, current) => Promise<boolean> }} [opts] —
   *   спросить, ставить ли версию старше установленной; без него ставим
   * @returns {Promise<boolean>} установлен ли набор
   */
  async function installPresetFromFile({ confirmDowngrade } = {}) {
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
    const older = !!current && comparePresetVersions(bundle.version, current.version) < 0
    if (older && confirmDowngrade && !(await confirmDowngrade(bundle, current))) return false

    const own = new Set((current?.stencils || []).map((s) => s.id))
    const incoming = new Set(bundle.stencils.map((s) => s.id))
    // Символ с меткой ЭТОГО набора — свой, даже если набор ещё не стоит: он пришёл с
    // проектом, собранным на этом наборе.
    const inProject = getAllStencils()
      .filter((s) => s.preset?.id === bundle.id)
      .map((s) => s.id)
    const taken = getAllStencils()
      .filter((s) => incoming.has(s.id) && !own.has(s.id) && s.preset?.id !== bundle.id)
      .map((s) => s.id)
    if (taken.length) {
      notify.error('Набор не установлен', `Id уже заняты: ${taken.join(', ')}`)
      return false
    }

    // Обновление не должно осиротить ячейки: символ, исчезнувший в новой версии, но
    // стоящий на схемах, рисовать будет нечем.
    const dropped = [...new Set([...own, ...inProject])].filter((id) => !incoming.has(id))
    const droppedUsage = dropped.length ? stencilUsage(dropped) : { count: 0, formIds: [] }
    if (droppedUsage.count) {
      notify.warn(
        'Набор не обновлён',
        `В новой версии нет символов, расставленных в формах: ` +
          `${droppedUsage.formIds.join(', ')}. Сначала удали их со схем.`
      )
      return false
    }

    const preset = presetOf(bundle)

    for (const id of dropped) {
      unregisterStencil(id)
      await removeStencilOverride(id)
    }
    for (const s of preset.stencils) registerStencil(s.stencilJson, s.shapeSvg)
    const saved = await savePreset(preset)

    // Правки проекта — поверх новой версии: коды, цвета, диапазоны остаются своими.
    const rebased = rebaseOverrides(await loadStencilOverrides(), { presetId: preset.id })
    for (const s of rebased.items) {
      if (s.stencilJson?.preset?.id === preset.id) registerStencil(s.stencilJson, s.shapeSvg)
    }
    const overridesSaved = rebased.changed ? await replaceStencilOverrides(rebased.items) : true

    presets.value = [...presets.value.filter((p) => p.id !== preset.id), preset]
    // Состав палитры изменился, а она целиком уезжает в `library/` архива.
    canvas.markDirty()
    // Символы набора уже стояли (прежняя версия или пришли с проектом) — экземплярам
    // рисунок, порты и габарит подтягивает та же сверка, что после правки в редакторе.
    if (current || inProject.length) await syncInstances(preset.stencils.map((s) => s.id))

    const title = !current ? 'Набор установлен' : older ? 'Набор откачен' : 'Набор обновлён'
    reportInstall(title, preset, rebased.report, saved && overridesSaved)
    return true
  }

  /**
   * Итог установки одним тостом: что обновилось и где скадисту перенастраивать руками.
   * Сброшенная видимость и не перенёсшиеся правки — повод для warn: без этого символ
   * молча выглядит иначе, чем его настроили.
   */
  function reportInstall(title, preset, report, saved) {
    const what = [
      `${preset.name} ${preset.version}, ${nplural(preset.stencils.length, 'символ', 'символа', 'символов')}`,
    ]
    if (report.kept.length) {
      what.push(
        `настройки проекта сохранены у ${nplural(report.kept.length, 'символа', 'символов', 'символов')}`
      )
    }
    if (report.drawingReset.length) {
      what.push(`видимость фигур сброшена: ${report.drawingReset.join(', ')}`)
    }
    if (report.dropped.length)
      what.push(`часть настроек не перенеслась: ${report.dropped.join(', ')}`)
    if (!saved) what.push('браузер отклонил запись — после перезагрузки изменений не будет')
    const attention = !saved || report.drawingReset.length || report.dropped.length
    notify[attention ? 'warn' : 'success'](title, what.join('; '))
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
          `${usage.formIds.join(', ')}. Сначала удали их со схем.`
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

  return {
    presets,
    refreshPresets,
    installPresetFromFile,
    adoptProjectPresets,
    removePresetById,
  }
}
