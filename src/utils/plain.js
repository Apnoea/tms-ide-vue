/**
 * Глубокий plain-JSON клон: снимает Vue reactive-прокси, на которых
 * `structuredClone` бросает DataCloneError. Нужен там, где значение уходит в
 * IndexedDB или под запись в JointJS-ячейку. Значение обязано быть
 * JSON-сериализуемым.
 */
export const toPlain = (v) => JSON.parse(JSON.stringify(v))
