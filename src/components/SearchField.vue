<script setup>
/**
 * Поле поиска — один вид во всех четырёх местах (палитра, симуляция, пикер тегов, поиск
 * по схеме): лупа слева, × справа, пока есть запрос (чистит его, фокус остаётся в поле),
 * общая высота полей и кегль 12px. Раньше каждое место собирало поле само, и они
 * разошлись по высоте, кеглю и иконкам.
 *
 * Атрибуты места использования (placeholder, обработчики клавиш, autofocus) уходят на
 * сам input, `class` — на обёртку: им задают ширину в раскладке.
 */
import { computed, ref, useAttrs } from 'vue'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'

defineOptions({ inheritAttrs: false })

const model = defineModel({ type: String, default: '' })
const attrs = useAttrs()
const inputAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})

const input = ref(null)
const inputEl = () => input.value?.$el

function clear() {
  model.value = ''
  inputEl()?.focus()
}

defineExpose({
  focus: () => inputEl()?.focus(),
  select: () => inputEl()?.select(),
})
</script>

<template>
  <IconField :class="attrs.class">
    <InputIcon class="pi pi-search" />
    <InputText
      ref="input"
      v-model="model"
      size="small"
      class="w-full text-xs!"
      v-bind="inputAttrs"
    />
    <InputIcon
      v-if="model"
      class="pi pi-times cursor-pointer hover:text-surface-700"
      @click="clear"
    />
  </IconField>
</template>
