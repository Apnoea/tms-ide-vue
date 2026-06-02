import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'
import Aura from '@primeuix/themes/aura'
import { definePreset } from '@primeuix/themes'
import 'primeicons/primeicons.css'

import './style.css'
import App from './App.vue'

// Сдвигаем primary с дефолтного Aura-emerald на cyan — зелёный занят семантикой
// напряжения (animation-low #10b981). Cyan визуально отделяет UI-акценты от
// power-flow цветов. Все компоненты (Button, Toggle, focus-ring, ...) и Tailwind
// `*-primary-*` утилиты автоматически подхватывают через CSS-токены `{cyan.*}`.
const TmsTheme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{cyan.50}',
      100: '{cyan.100}',
      200: '{cyan.200}',
      300: '{cyan.300}',
      400: '{cyan.400}',
      500: '{cyan.500}',
      600: '{cyan.600}',
      700: '{cyan.700}',
      800: '{cyan.800}',
      900: '{cyan.900}',
      950: '{cyan.950}',
    },
  },
})

const app = createApp(App)

app.use(createPinia())
app.use(PrimeVue, {
  theme: {
    preset: TmsTheme,
    options: {
      cssLayer: false,
    },
  },
})
app.use(ToastService)
app.use(ConfirmationService)
app.directive('tooltip', Tooltip)

app.mount('#app')
