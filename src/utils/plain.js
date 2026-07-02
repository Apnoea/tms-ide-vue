/**
 * Глубокий plain-JSON клон. Снимает Vue reactive-прокси (ref/reactive) и любые
 * не-клонируемые поля — в отличие от `structuredClone`, который на Vue-прокси
 * бросает DataCloneError. Нужен там, где значение уходит в structured-clone
 * (IndexedDB.put) или клонируется под запись в чужой объект (JointJS cell).
 * Значение обязано быть JSON-сериализуемым (в проекте это всегда payload-данные).
 */
export const toPlain = (v) => JSON.parse(JSON.stringify(v))
