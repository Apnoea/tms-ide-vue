<script setup>
import Dialog from 'primevue/dialog'
import { useUiStore } from '../stores/useUiStore'

const ui = useUiStore()

// Клавиши И жесты: { keys: [...], desc }; keysAlt — альтернативный аккорд, через «/».
// Возможности без хоткея (врезка в провод, ресайз шины, перенос анимаций) в UI
// обнаруживаются только случайно, поэтому живут здесь наравне с клавишами; `keys`
// для них — короткий ярлык жеста, иначе правая колонка разъезжается.
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
      { keys: ['ЛКМ', 'по символу/проводу'], desc: 'Выделить (свойства — в инспекторе справа)' },
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
      { keys: ['Двойной ЛКМ', 'по подписи'], desc: 'Редактировать текст подписи на месте' },
      { keys: ['R'], keysAlt: ['Shift', 'R'], desc: 'Повернуть выделенное по / против часовой' },
      {
        keys: ['Shift', 'H'],
        keysAlt: ['Shift', 'V'],
        desc: 'Отразить по горизонтали / вертикали',
      },
      { keys: ['Кнопки', '↺ / ↻'], desc: 'Повернуть выделенный символ (по углам выделения)' },
      { keys: ['←↑→↓'], desc: 'Сдвинуть выделение на 1 клетку сетки' },
      { keys: ['Shift', '←↑→↓'], desc: 'Сдвинуть выделение на 5 клеток' },
      { keys: ['Del'], keysAlt: ['Backspace'], desc: 'Удалить выделенное' },
    ],
  },
  {
    title: 'Группы, слои, замок',
    items: [
      { keys: ['Ctrl', 'G'], desc: 'Сгруппировать выделенные символы' },
      { keys: ['Ctrl', 'Shift', 'G'], desc: 'Разгруппировать' },
      { keys: ['ЛКМ', 'по члену группы'], desc: 'Выделяется вся группа целиком' },
      {
        keys: ['Ctrl', ']'],
        keysAlt: ['Ctrl', '['],
        desc: 'Слой: выше / ниже (символы всегда над проводами)',
      },
      {
        keys: ['Ctrl', 'Shift', ']'],
        keysAlt: ['Ctrl', 'Shift', '['],
        desc: 'На передний / задний план',
      },
      {
        keys: ['Ctrl', ']', 'на проводе'],
        desc: 'На пересечении мостик рисует верхний провод — так выбирается, кто поверх',
      },
      {
        keys: ['Кнопка', 'замок'],
        desc: 'Символ read-only: не двигается, не удаляется, не правится',
      },
      {
        keys: ['ПКМ', '→ Заблокировать'],
        desc: 'Замок на всё выделение или группу целиком (кнопка — только у одиночного)',
      },
    ],
  },
  {
    title: 'Символы и провода',
    items: [
      {
        keys: ['Drop', 'на провод'],
        desc: 'Врезать символ с двумя портами в разрыв: провод делится, анимации наследуются',
      },
      { keys: ['Del', 'символа-прохода'], desc: 'Два его провода срастаются в один' },
      {
        keys: ['Drag', 'по выделенному проводу'],
        keysAlt: ['Двойной ЛКМ'],
        desc: 'Добавить излом маршрута (ручки — у выделенного провода)',
      },
      {
        keys: ['Drag', 'края шины'],
        desc: 'Длина шины; при сжатии провода прижимаются к крайнему слоту',
      },
    ],
  },
  {
    title: 'Формы',
    items: [
      { keys: ['ЛКМ', 'по форме'], desc: 'Открыть форму (история отмены начинается заново)' },
      { keys: ['Кнопка', '+'], desc: 'Новая пустая форма' },
      { keys: ['Кнопка', 'копия'], desc: 'Дублировать форму (копия встанет рядом)' },
      { keys: ['Drag', 'в дереве'], desc: 'Перенести или вложить форму в другую' },
    ],
  },
  {
    title: 'Анимации',
    items: [
      {
        keys: ['Копировать', '/ Вставить'],
        desc: 'Перенести настройки блока на другие элементы (в мультивыделении — на все)',
      },
      { keys: ['Иконка', 'глаза'], desc: 'Подсветить на схеме все элементы с этим тегом' },
      { keys: ['Мультивыделение'], desc: 'Блоки анимаций применяются ко всему выделению' },
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
    title: 'Редактор символов',
    items: [
      { keys: ['ЛКМ-drag', 'по пустому'], desc: 'Рамочное выделение фигур (порты не берёт)' },
      { keys: ['Ctrl', 'ЛКМ'], desc: 'Добавить/убрать фигуру из выделения' },
      { keys: ['Ctrl', 'A'], desc: 'Выделить все фигуры' },
      { keys: ['ЛКМ-drag', 'выделенного'], desc: 'Двигать все выделенные фигуры вместе' },
      { keys: ['←↑→↓'], desc: 'Сдвинуть выделенные фигуры на 1 px' },
      { keys: ['Shift', '←↑→↓'], desc: 'Сдвинуть фигуры на 5 px (шаг портов)' },
      { keys: ['Ctrl', 'C'], keysAlt: ['Ctrl', 'V'], desc: 'Копировать / вставить выделенные' },
      { keys: ['Del'], desc: 'Удалить выделенные фигуры' },
      { keys: ['Ручки'], desc: 'Ресайз — у одной выделенной фигуры (при нескольких скрыты)' },
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
    header="Клавиши и приёмы"
    :style="{ width: '560px' }"
    :close-on-escape="true"
    :dismissable-mask="true"
    :draggable="false"
  >
    <!-- Скролл внутри: секций много, иначе на 768px-экране диалог вылезает за окно. -->
    <div class="space-y-5 max-h-[68vh] overflow-y-auto pr-1">
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
