<script setup>
import Dialog from 'primevue/dialog'
import { useUiStore } from '../stores/useUiStore'

const ui = useUiStore()

// Группированный список хоткеев. Каждая строка: { keys: [...], desc }.
// keys — основной аккорд (клавиши через «+»). keysAlt — альтернативный
// аккорд для того же действия, рисуется через «/» (напр. Del / Backspace).
const sections = [
  {
    title: 'Навигация',
    items: [
      { keys: ['Колесо мыши'], desc: 'Зум (центр — позиция курсора)' },
      { keys: ['Средняя кнопка'], keysAlt: ['Space', 'ЛКМ'], desc: 'Pan (двигать холст)' },
      { keys: ['Кнопка', 'Вписать'], desc: 'Вписать в экран (не больше 100%)' },
    ],
  },
  {
    title: 'Выделение',
    items: [
      { keys: ['ЛКМ', 'по символу/проводу'], desc: 'Выделить (Inspector справа)' },
      { keys: ['Ctrl', 'ЛКМ'], desc: 'Добавить/убрать из выделения' },
      { keys: ['Ctrl', 'A'], desc: 'Выделить всё на холсте' },
      { keys: ['ЛКМ-drag', 'по пустому'], desc: 'Рамочное выделение (lasso)' },
      { keys: ['Ctrl', 'ЛКМ-drag', 'по пустому'], desc: 'Добавить рамкой к выделению' },
      { keys: ['ПКМ'], desc: 'Контекстное меню (дублировать / удалить / …)' },
    ],
  },
  {
    title: 'Редактирование',
    items: [
      { keys: ['ЛКМ', 'на порту → drag'], desc: 'Нарисовать провод между символами' },
      { keys: ['ЛКМ-drag', 'выделенной группы'], desc: 'Двигать все выделенные символы вместе' },
      { keys: ['Двойной ЛКМ', 'по тексту'], desc: 'Редактировать содержимое cell_text inline' },
      { keys: ['R'], keysAlt: ['Shift', 'R'], desc: 'Повернуть выделенное по / против часовой' },
      { keys: ['Кнопки', '↺ / ↻'], desc: 'Повернуть выделенный символ (по углам выделения)' },
      { keys: ['←↑→↓'], desc: 'Сдвинуть выделение на 1 клетку сетки' },
      { keys: ['Shift', '←↑→↓'], desc: 'Сдвинуть выделение на 5 клеток' },
      { keys: ['Del'], keysAlt: ['Backspace'], desc: 'Удалить выделенное' },
    ],
  },
  {
    title: 'Буфер и отмена',
    items: [
      { keys: ['Ctrl', 'C'], desc: 'Скопировать выделенные символы' },
      { keys: ['Ctrl', 'V'], desc: 'Вставить из буфера (со сдвигом)' },
      { keys: ['Ctrl', 'D'], desc: 'Дублировать выделение' },
      { keys: ['Ctrl', 'Z'], desc: 'Отмена' },
      { keys: ['Ctrl', 'Y'], keysAlt: ['Ctrl', 'Shift', 'Z'], desc: 'Повтор' },
    ],
  },
  {
    title: 'Проект',
    items: [
      { keys: ['Ctrl', 'O'], desc: 'Открыть проект (.zip)' },
      { keys: ['Ctrl', 'S'], desc: 'Экспортировать проект (.zip)' },
    ],
  },
  {
    title: 'Поиск',
    items: [
      { keys: ['Ctrl', 'F'], desc: 'Найти символ по тегу или тексту' },
      { keys: ['Enter'], keysAlt: ['F3'], desc: 'Следующее совпадение' },
      { keys: ['Shift', 'Enter'], keysAlt: ['Shift', 'F3'], desc: 'Предыдущее совпадение' },
    ],
  },
  {
    title: 'Прочее',
    items: [
      { keys: ['?'], keysAlt: ['F1'], desc: 'Эта справка' },
      { keys: ['Enter'], desc: 'В окне выбора тега — подтвердить (поиск уже в фокусе)' },
      { keys: ['Esc'], desc: 'Снять выделение / закрыть диалог / погасить tag-подсветку' },
    ],
  },
]
</script>

<template>
  <Dialog
    :visible="ui.helpOpen"
    @update:visible="(v) => (v ? ui.openHelp() : ui.closeHelp())"
    modal
    header="Горячие клавиши"
    :style="{ width: '520px' }"
    :close-on-escape="true"
    :dismissable-mask="true"
    :draggable="false"
  >
    <div class="space-y-5">
      <div v-for="section in sections" :key="section.title">
        <div class="text-[11px] uppercase tracking-wider text-surface-500 mb-2">
          {{ section.title }}
        </div>
        <ul class="space-y-1.5">
          <li
            v-for="item in section.items"
            :key="item.desc"
            class="flex items-center justify-between gap-3 text-sm"
          >
            <span class="text-surface-700">
              {{ item.desc }}
            </span>
            <span class="flex items-center gap-1">
              <template v-for="(k, idx) in item.keys" :key="'k' + idx">
                <span v-if="idx > 0" class="text-surface-400 text-xs">+</span>
                <kbd
                  class="px-1.5 py-0.5 bg-surface-100 border border-surface-200 rounded text-[11px] font-mono text-surface-700"
                >
                  {{ k }}
                </kbd>
              </template>
              <!-- Альтернативный аккорд того же действия — через «/» -->
              <template v-if="item.keysAlt">
                <span class="text-surface-400 text-xs">/</span>
                <template v-for="(k, idx) in item.keysAlt" :key="'a' + idx">
                  <span v-if="idx > 0" class="text-surface-400 text-xs">+</span>
                  <kbd
                    class="px-1.5 py-0.5 bg-surface-100 border border-surface-200 rounded text-[11px] font-mono text-surface-700"
                  >
                    {{ k }}
                  </kbd>
                </template>
              </template>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </Dialog>
</template>
