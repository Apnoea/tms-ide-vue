/**
 * ConfirmPopup с проектным оформлением: warning-иконка, кнопка подтверждения
 * severity=danger (для «Открыть проект» — primary, действие не разрушающее) и
 * текстовая «Отмена». Стиль был скопирован в каждый вызов `confirm.require`;
 * здесь — одна точка, чтобы подтверждения выглядели одинаково.
 *
 * `confirm` — инстанс из `useConfirm()` (сервис можно взять только в setup-скоупе
 * компонента, поэтому передаём аргументом, а не резолвим внутри).
 *
 * @param {object} confirm — PrimeVue confirm-сервис
 * @param {object} opts — { target, message, acceptLabel, accept, reject?, onHide?, severity? }
 */
export function confirmDanger(confirm, { severity = 'danger', ...opts }) {
  confirm.require({
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Отмена',
    acceptProps: { severity, size: 'small' },
    rejectProps: { severity: 'secondary', text: true, size: 'small' },
    ...opts,
  })
}
