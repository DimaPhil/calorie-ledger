import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Language = "en" | "ru";
export const languageStorageKey = "calorie-ledger-language";
const LanguageContext = createContext({
  language: "en" as Language,
  setLanguage: (_language: Language) => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem(languageStorageKey) === "ru" ? "ru" : "en";
    } catch {
      return "en";
    }
  });
  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(languageStorageKey, language);
    } catch {
      /* Still works for this session. */
    }
  }, [language]);
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === languageStorageKey || event.key === null)
        setLanguage(event.newValue === "ru" ? "ru" : "en");
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n() {
  const { language, setLanguage } = useContext(LanguageContext);
  return {
    language,
    setLanguage,
    locale: language === "ru" ? "ru-RU" : "en-US",
    t: (en: string, ru: string) => (language === "ru" ? ru : en),
  };
}

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className="language-switcher">
      <span>{t("Language", "Язык")}</span>
      <select
        aria-label="Language / Язык"
        value={language}
        onChange={(event) =>
          setLanguage(event.target.value === "ru" ? "ru" : "en")
        }
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="ru" lang="ru">
          Русский
        </option>
      </select>
    </label>
  );
}

const labels: Record<string, string> = {
  Journal: "Дневник",
  Progress: "Прогресс",
  Foods: "Продукты",
  Dishes: "Блюда",
  Menu: "Меню",
  Settings: "Настройки",
  Day: "День",
  Week: "Неделя",
  Month: "Месяц",
  Custom: "Период",
  day: "день",
  "US fl oz": "жидк. унц. США",
  "US cup": "чашка США",
  Energy: "Энергия",
  Protein: "Белок",
  Carbs: "Углеводы",
  Fat: "Жиры",
  Fiber: "Клетчатка",
  Drinks: "Напитки",
  Sleep: "Сон",
  "Saturated fat": "Насыщенные жиры",
  "Trans fat": "Трансжиры",
  Sugar: "Сахар",
  "Added sugar": "Добавленный сахар",
  "Free sugars": "Свободные сахара",
  Sodium: "Натрий",
  Cholesterol: "Холестерин",
  Potassium: "Калий",
  Calcium: "Кальций",
  Iron: "Железо",
  Magnesium: "Магний",
  "Vitamin C": "Витамин C",
  "Vitamin D": "Витамин D",
  kcal: "ккал",
  g: "г",
  kg: "кг",
  mg: "мг",
  µg: "мкг",
  ml: "мл",
  l: "л",
  h: "ч",
  cm: "см",
  oz: "унц.",
  lb: "фунт",
  tsp: "ч. л.",
  tbsp: "ст. л.",
  cup: "чашка",
  fl_oz: "жидк. унц.",
  piece: "шт.",
  serving: "порция",
  breakfast: "завтрак",
  lunch: "обед",
  dinner: "ужин",
  snack: "перекус",
};

export function localizeLabel(label: string, language: Language): string {
  if (language === "en") return label;
  if (label === "Free sugars (g; not total sugars)")
    return "Свободные сахара (г; не общий сахар)";
  if (labels[label]) return labels[label];
  const nutrientAliases: Record<string, string> = {
    calories: "Energy",
    saturatedFat: "Saturated fat",
    transFat: "Trans fat",
    addedSugar: "Added sugar",
    freeSugar: "Free sugars",
  };
  const nutrient =
    nutrientAliases[label] ||
    label
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (value) => value.toUpperCase());
  if (labels[nutrient]) return labels[nutrient];
  const withUnit = label.match(/^(.+) \(([^)]+)\)$/);
  return withUnit && labels[withUnit[1]]
    ? `${labels[withUnit[1]]} (${labels[withUnit[2]] || withUnit[2]})`
    : label;
}

const errors: Record<string, string> = {
  "Could not complete the request. Try again.":
    "Не удалось выполнить запрос. Попробуйте ещё раз.",
  "Entry deleted.": "Запись удалена.",
  "Entry updated.": "Запись обновлена.",
  "Product deleted.": "Продукт удалён.",
  "Dish deleted.": "Блюдо удалено.",
  "Food saved to your collection.": "Продукт сохранён в коллекцию.",
  "Dish saved.": "Блюдо сохранено.",
  "Logged. You’re all set.": "Добавлено в дневник.",
  "Could not delete entry.": "Не удалось удалить запись.",
  "Could not save entry.": "Не удалось сохранить запись.",
  "Preferences saved.": "Настройки сохранены.",
  "Token copied.": "Токен скопирован.",
  "Token revoked.": "Токен отозван.",
  "Provide a food name, brand, or barcode.":
    "Укажите название продукта, бренд или штрихкод.",
  "Use preferredProductId without asking which product again. Alternatives are included; amount and portion still need validation.":
    "Показан ранее выбранный продукт и альтернативы. Проверьте количество и размер порции.",
  "Choose a product and check the brand and nutrition label. Save external candidates before logging.":
    "Выберите продукт и проверьте бренд и этикетку. Сохраните найденный продукт перед добавлением в дневник.",
  "No matching food found. Try a brand, barcode, or add a custom product.":
    "Продукт не найден. Попробуйте бренд или штрихкод либо добавьте продукт вручную.",
  "Custom food: add missing values from a verified label or reference.":
    "Продукт добавлен вручную: внесите недостающие значения с проверенной этикетки или из справочника.",
  "No valid exact provider ID; automatic enrichment skipped.":
    "Нет точного идентификатора продукта у источника; автоматическое дополнение пропущено.",
  "Provider unavailable; retry enrichment later.":
    "Источник недоступен. Повторите дополнение позже.",
  "Provider returned a different food ID; skipped.":
    "Источник вернул другой продукт; дополнение пропущено.",
  "Source nutrition could not be verified per 100 g; skipped.":
    "Не удалось подтвердить значения на 100 г; дополнение пропущено.",
  "The source has no additional verified nutrient values.":
    "У источника нет дополнительных проверенных значений.",
  "Notes have no room for source provenance; enrichment skipped.":
    "В заметках нет места для сведений об источнике; дополнение пропущено.",
  "Provider data unavailable or invalid; retry enrichment later.":
    "Данные источника недоступны или неверны; повторите дополнение позже.",
  "Username or password is incorrect.": "Неверное имя пользователя или пароль.",
  "Too many requests. Please wait a minute and retry.":
    "Слишком много запросов. Подождите минуту и попробуйте снова.",
  "Something went wrong. Please try again.":
    "Что-то пошло не так. Попробуйте снова.",
  "Please try again.": "Попробуйте снова.",
  "Failed to fetch":
    "Не удалось связаться с сервером. Проверьте подключение и повторите попытку.",
  "Load failed": "Не удалось загрузить данные. Проверьте подключение.",
  "Unable to load progress.": "Не удалось загрузить прогресс.",
  "Item not found.": "Объект не найден.",
  "Entry not found.": "Запись не найдена.",
  "This item no longer exists or belongs to another account.":
    "Объект удалён или принадлежит другому аккаунту.",
  "Remove this product from your dishes before deleting it.":
    "Перед удалением уберите этот продукт из ваших блюд.",
  "Ingredient overrides require a dish.":
    "Изменить ингредиенты можно только для блюда.",
  "Add calories per 100g before logging this product.":
    "Укажите калорийность на 100 г перед добавлением продукта в дневник.",
  "Use servings for this dish, or save its cooked weight before logging by weight. Ingredient overrides use servings.":
    "Выберите порции или сохраните вес готового блюда для учёта по весу. При изменении ингредиентов используйте порции.",
  "This request was already logged and later deleted. It will not be recreated by a retry.":
    "Эта запись уже была сохранена, а затем удалена. Повторный запрос её не восстановит.",
  "This request already saved different values. Review the journal and correct that entry before starting a new log.":
    "Этот запрос уже сохранил другие значения. Проверьте дневник и исправьте ту запись перед добавлением новой.",
  "Provide a food name.": "Укажите название продукта.",
  "Some information is missing or invalid. Please correct the listed fields.":
    "Некоторые данные отсутствуют или неверны. Проверьте заполненные поля.",
  "This entry changed elsewhere. Close this dialog and refresh the journal before editing again.":
    "Запись уже изменена в другом месте. Закройте окно и обновите дневник перед редактированием.",
  "Choose a valid IANA timezone.": "Выберите корректный часовой пояс IANA.",
  "Use a valid date in YYYY-MM-DD format.":
    "Укажите корректную дату в формате ГГГГ-ММ-ДД.",
  "Sign in or supply a valid API bearer token.":
    "Войдите в аккаунт или укажите действующий API-токен.",
};

export function localizeError(message: string, language: Language): string {
  if (language === "en") return message;
  if (errors[message]) return errors[message];
  let match = message.match(
    /^Add calories per 100g for (.+) before logging\.$/,
  );
  if (match)
    return `Укажите калорийность на 100 г для «${match[1]}» перед добавлением в дневник.`;
  match = message.match(
    /^How much does this (.+?) of (.+) weigh\? Choose a saved portion or provide grams\.$/,
  );
  if (match)
    return `Сколько весит ${localizeLabel(match[1], language)} продукта «${match[2]}»? Выберите сохранённую порцию или укажите граммы.`;
  match = message.match(
    /^Choose a date range of up to (\d+) days, with the end on or after the start\.$/,
  );
  if (match)
    return `Выберите период до ${match[1]} дней. Конец периода должен быть не раньше начала.`;
  match = message.match(
    /^(.+) lookup is temporarily unavailable\. Saved products still work; retry later or add a custom product from its label\.$/,
  );
  if (match)
    return `Поиск в ${match[1].replace(" and ", " и ")} временно недоступен. Сохранённые продукты доступны. Повторите позже или добавьте продукт по этикетке.`;
  // Preserve unfamiliar details instead of hiding actionable server/provider errors.
  return message;
}
