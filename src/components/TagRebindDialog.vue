<script setup>
/**
 * «Замена в привязках»: текст в именах привязанных тегов → другой текст во всех формах
 * (новый tag-list сменил префикс или суффикс). Открывается кнопкой у tag-list или сам,
 * с подсказкой, после загрузки tag-list (`useTagRebind.offerRebind`). Превью считается
 * по индексу привязок, снятому при открытии: пока окно модально, схема не меняется.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import { useUiStore } from '../stores/useUiStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useCanvas } from '../composables/useCanvas'
import { useTagRebind } from '../composables/useTagRebind'
import { planRebind, renameTagBy } from '../services/tagRebind'
import { nplural } from '../utils/plural'

const MISSING_SHOWN = 5

const ui = useUiStore()
const project = useProjectStore()
const canvas = useCanvas()
const { boundTagIndex } = useTagRebind()

const find = ref('')
const replace = ref('')
const index = shallowRef(null)

watch(
  () => ui.tagRebind,
  (init) => {
    if (!init) return
    find.value = init.find
    replace.value = init.replace
    index.value = boundTagIndex()
  },
  { immediate: true }
)

const tagNames = computed(() => project.tagNames)
const hasTagList = computed(() => tagNames.value.size > 0)

const missingNow = computed(() => {
  if (!index.value || !hasTagList.value) return 0
  let n = 0
  for (const tag of index.value.counts.keys()) if (!tagNames.value.has(tag)) n++
  return n
})

const plan = computed(() => {
  if (!index.value || !find.value || find.value === replace.value) return null
  return planRebind(index.value, renameTagBy(find.value, replace.value), tagNames.value)
})

const missingShown = computed(() => plan.value?.missing.slice(0, MISSING_SHOWN) || [])
const missingRest = computed(() => Math.max(0, (plan.value?.missing.length || 0) - MISSING_SHOWN))

const canApply = computed(() => !!plan.value?.bindings && !ui.projectBusy)

async function apply() {
  if (!canApply.value) return
  const from = find.value
  const to = replace.value
  ui.closeTagRebind()
  await canvas.rebindTags(from, to)
}
</script>

<template>
  <Dialog
    :visible="!!ui.tagRebind"
    modal
    header="Замена в привязках"
    :style="{ width: '520px' }"
    :close-on-escape="true"
    :dismissable-mask="true"
    :draggable="false"
    @update:visible="(v) => !v && ui.closeTagRebind()"
  >
    <div class="space-y-3">
      <p v-if="ui.tagRebind?.suggested" class="tms-hint">
        Часть привязанных тегов не нашлась в tag-list — замена подобрана по его именам. Проверь
        перед применением.
      </p>
      <p v-else class="tms-hint">
        Текст в именах привязанных тегов меняется во всех формах — например, префикс после
        обновления tag-list.
      </p>

      <div class="space-y-1">
        <label for="tms-rebind-find" class="tms-field-label">Найти в имени тега</label>
        <InputText
          id="tms-rebind-find"
          v-model="find"
          class="w-full font-mono"
          size="small"
          autofocus
          @keydown.enter="apply"
        />
      </div>
      <div class="space-y-1">
        <label for="tms-rebind-replace" class="tms-field-label">Заменить на</label>
        <InputText
          id="tms-rebind-replace"
          v-model="replace"
          class="w-full font-mono"
          size="small"
          placeholder="пусто — убрать"
          @keydown.enter="apply"
        />
      </div>

      <div class="text-sm text-surface-700">
        <template v-if="!find">Впиши, что искать в именах тегов</template>
        <template v-else-if="!plan">Замена ничего не меняет</template>
        <template v-else-if="!plan.bindings">Привязок с этим текстом нет</template>
        <template v-else>
          Изменится: {{ nplural(plan.bindings, 'привязка', 'привязки', 'привязок') }} ({{
            nplural(plan.tags, 'тег', 'тега', 'тегов')
          }}) · форм: {{ plan.forms }}
        </template>
      </div>

      <div v-if="plan?.bindings && hasTagList" class="space-y-1">
        <div class="tms-hint">
          Нет в tag-list: сейчас {{ missingNow }} → после замены {{ plan.missing.length }}
        </div>
        <ul v-if="missingShown.length" class="space-y-0.5">
          <li
            v-for="tag in missingShown"
            :key="tag"
            class="truncate font-mono text-xs text-surface-500"
          >
            {{ tag }}
          </li>
          <li v-if="missingRest" class="text-xs text-surface-400">и ещё {{ missingRest }}</li>
        </ul>
      </div>

      <Message severity="warn" :closable="false" size="small">
        Ctrl+Z замену не отменит — для страховки сначала сделай экспорт проекта.
      </Message>
    </div>

    <template #footer>
      <Button label="Отмена" severity="secondary" text size="small" @click="ui.closeTagRebind()" />
      <Button
        label="Заменить"
        icon="pi pi-check"
        size="small"
        :disabled="!canApply"
        @click="apply"
      />
    </template>
  </Dialog>
</template>
