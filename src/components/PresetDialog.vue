<script setup>
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useConfirm } from 'primevue/useconfirm'
import { usePresets } from '../composables/usePresets'
import { useUiStore } from '../stores/useUiStore'
import { confirmDanger } from '../utils/confirmDanger'
import { nplural } from '../utils/plural'

const ui = useUiStore()
const confirm = useConfirm()
const { presets, refreshPresets, installPresetFromFile, removePresetById } = usePresets()

// Установка идёт из user-gesture (file-picker), поэтому кнопку гасим флагом, а не
// ожиданием: двойной клик открыл бы два пикера. На время проектной операции (импорт по
// Ctrl+O, экспорт по Ctrl+S) гаснут и установка, и удаление: диалог вынесен в body,
// `inert` области редактирования его не закрывает, а набор правит реестр и формы.
const busy = ref(false)

// Версия старше установленной — откат, о нём спрашиваем в самом диалоге. Всплывающему
// подтверждению не к чему якориться: к моменту вопроса файл выбран и прочитан, а клик
// по кнопке давно отработал.
const downgrade = ref(null)
function confirmDowngrade(bundle, current) {
  return new Promise((resolve) => {
    downgrade.value = { name: bundle.name, from: current.version, to: bundle.version, resolve }
  })
}
function answerDowngrade(yes) {
  downgrade.value?.resolve(yes)
  downgrade.value = null
}

watch(
  () => ui.presetsOpen,
  (open) => {
    if (open) refreshPresets()
    // Закрыли диалог с открытым вопросом — это «нет», установка не должна висеть.
    else answerDowngrade(false)
  }
)

async function install() {
  busy.value = true
  try {
    await installPresetFromFile({ confirmDowngrade })
  } finally {
    busy.value = false
  }
}

function confirmRemove(event, preset) {
  confirmDanger(confirm, {
    target: event.currentTarget,
    message: `Удалить набор «${preset.name}» целиком?`,
    acceptLabel: 'Удалить',
    accept: () => removePresetById(preset.id),
  })
}
</script>

<template>
  <Dialog
    :visible="ui.presetsOpen"
    @update:visible="(v) => (v ? ui.openPresets() : ui.closePresets())"
    modal
    header="Наборы символов"
    :style="{ width: '480px' }"
    :close-on-escape="true"
    :dismissable-mask="true"
    :draggable="false"
  >
    <div class="space-y-3">
      <p class="tms-hint">
        Набор ставится и снимается целиком. Его символы настраиваются в проекте — анимации,
        категория, галки, — и эти настройки переживают обновление набора; рисунок меняет только сам
        набор.
      </p>

      <Message v-if="downgrade" severity="warn" :closable="false">
        <div class="space-y-2">
          <p>
            В файле «{{ downgrade.name }}» {{ downgrade.to }} — старше установленной
            {{ downgrade.from }}. Откатить набор?
          </p>
          <div class="flex gap-2">
            <Button label="Откатить" size="small" severity="warn" @click="answerDowngrade(true)" />
            <Button
              label="Отмена"
              size="small"
              severity="secondary"
              text
              @click="answerDowngrade(false)"
            />
          </div>
        </div>
      </Message>

      <div v-if="!presets.length" class="tms-empty">
        <i class="pi pi-box text-3xl mb-3 opacity-60" />
        <div class="tms-empty-title">Наборы не установлены</div>
        <p class="tms-hint max-w-[220px]">Палитра собрана из встроенных и своих символов</p>
      </div>

      <ul v-else class="space-y-1">
        <li
          v-for="preset in presets"
          :key="preset.id"
          class="group flex items-center gap-3 rounded px-2 py-1.5 hover:bg-surface-100"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 min-w-0">
              <span class="truncate text-sm font-medium text-surface-900">{{ preset.name }}</span>
              <span class="shrink-0 text-[10px] font-mono text-surface-500">
                {{ preset.version }}
              </span>
            </div>
            <div class="tms-hint truncate">
              {{
                preset.description ||
                nplural(preset.stencils.length, 'символ', 'символа', 'символов')
              }}
            </div>
          </div>
          <!-- Удаление — по ховеру строки, как в палитре. Клик БЕЗ .stop: ConfirmPopup
               якорится по target в своём document-click листенере. -->
          <Button
            v-tooltip.bottom="'Удалить набор'"
            icon="pi pi-trash"
            severity="secondary"
            text
            size="small"
            class="tms-row-btn shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            :disabled="ui.projectBusy"
            @click="confirmRemove($event, preset)"
          />
        </li>
      </ul>
    </div>

    <template #footer>
      <Button
        label="Установить из файла"
        icon="pi pi-upload"
        size="small"
        :disabled="busy || ui.projectBusy"
        @click="install"
      />
    </template>
  </Dialog>
</template>
