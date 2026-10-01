/**
 * Проиграть CSS-анимацию класса на элементе заново: снять класс, рефлоу, повесить, а по
 * концу анимации снять. Без снятия и рефлоу повтор при быстром переключении (формы,
 * выделения) не стартует — класс уже стоит.
 *
 * @param {Element|null|undefined} el
 * @param {string} cls — класс с `animation` в style.css
 */
export function replayClass(el, cls) {
  if (!el) return
  el.classList.remove(cls)
  void el.offsetWidth
  el.classList.add(cls)
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true })
}
