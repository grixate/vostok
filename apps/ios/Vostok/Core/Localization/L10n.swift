import Foundation

/// Lightweight i18n module matching the web's `apps/web/src/lib/i18n.ts`.
///
/// Loads flat JSON dictionaries from the app bundle (`Locales/en.json`, `Locales/ru.json`).
/// Supports `{0}`, `{1}` interpolation and Russian 3-form plurals.
enum L10n {
    // MARK: – Public API

    /// Translate a key to the current locale.
    /// Supports positional interpolation: `L10n.t("start_chat_with", username)`
    static func t(_ key: String, _ args: Any...) -> String {
        let dict = dictionaries[currentLocale] ?? dictionaries[.en] ?? [:]
        let fallback = dictionaries[.en] ?? [:]
        var str = dict[key] ?? fallback[key] ?? key

        for (i, arg) in args.enumerated() {
            str = str.replacingOccurrences(of: "{\(i)}", with: "\(arg)")
        }
        return str
    }

    /// Russian-aware plural selection (3 forms: one / few / many).
    ///
    /// one:  1, 21, 31, ... (except 11)
    /// few:  2-4, 22-24, ... (except 12-14)
    /// many: 0, 5-20, 25-30, ...
    static func plural(_ n: Int, one: String, few: String, many: String) -> String {
        let abs = abs(n)
        let mod10 = abs % 10
        let mod100 = abs % 100

        if mod10 == 1 && mod100 != 11 { return one }
        if mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) { return few }
        return many
    }

    /// Localized plural with count prefix.
    /// Uses translation keys for each form, passing `n` as `{0}`.
    static func tp(_ n: Int, oneKey: String, fewKey: String, manyKey: String) -> String {
        let formKey = plural(n, one: oneKey, few: fewKey, many: manyKey)
        return t(formKey, n)
    }

    // MARK: – Locale management

    enum Locale: String, CaseIterable, Identifiable {
        case en, ru

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .en: return "English"
            case .ru: return "Русский"
            }
        }
    }

    static var currentLocale: Locale {
        get { _currentLocale }
        set {
            _currentLocale = newValue
            UserDefaults.standard.set(newValue.rawValue, forKey: localeStorageKey)
        }
    }

    // MARK: – Private

    private static let localeStorageKey = "vostok.locale"

    private static var _currentLocale: Locale = detectLocale()

    private static func detectLocale() -> Locale {
        if let stored = UserDefaults.standard.string(forKey: localeStorageKey),
           let locale = Locale(rawValue: stored) {
            return locale
        }

        let systemLang = Foundation.Locale.current.language.languageCode?.identifier ?? ""
        if systemLang.hasPrefix("ru") { return .ru }

        return .en
    }

    private static let dictionaries: [Locale: [String: String]] = {
        var result: [Locale: [String: String]] = [:]
        for locale in Locale.allCases {
            if let url = Bundle.main.url(forResource: locale.rawValue, withExtension: "json", subdirectory: "Locales"),
               let data = try? Data(contentsOf: url),
               let dict = try? JSONDecoder().decode([String: String].self, from: data) {
                result[locale] = dict
            }
        }
        return result
    }()
}
