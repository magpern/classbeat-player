import Foundation

// The page's named intents, split by mode (issue #895, ADR 0011 section 3): the Swift twin of
// Android's IntentPolicy.kt, tested with the same table (AppTests/IntentPolicyTests.swift). Pure:
// Foundation only, for telling a JavaScript boolean from a number.
enum IntentPolicy {
    enum Arg {
        case string, boolean, number
    }

    struct Spec {
        let mode: Mode
        let args: [String: Arg]

        init(_ mode: Mode, _ args: [String: Arg] = [:]) {
            self.mode = mode
            self.args = args
        }
    }

    /// Why a call was refused. The page hears only the one refused word, never which.
    enum Refusal: Equatable {
        case unknown, otherMode, switching, unexpectedArgument, missingArgument, wrongType
    }

    /// Every intent and its mode. Only two take arguments, both strings.
    static let intents: [String: Spec] = [
        "instructorWay": Spec(.rider),
        "askInstructorMode": Spec(.rider),
        "join": Spec(.rider, ["session": .string, "nickname": .string]),
        "open": Spec(.rider),
        "receive": Spec(.rider),
        "leave": Spec(.rider),
        "askRiderMode": Spec(.instructor),
        "listClasses": Spec(.instructor),
        "syncNow": Spec(.instructor),
        "getClass": Spec(.instructor, ["id": .string]),
        "unpair": Spec(.instructor),
        "pairAgain": Spec(.instructor),
        "followAccess": Spec(.instructor),
        "openFollowSetting": Spec(.instructor),
        "follow": Spec(.instructor),
        "unfollow": Spec(.instructor),
        "reading": Spec(.instructor),
        "sendPlay": Spec(.instructor),
        "sendPause": Spec(.instructor),
        "sendNext": Spec(.instructor),
    ]

    /// The intents of `mode`.
    static func of(_ mode: Mode, _ table: [String: Spec] = intents) -> Set<String> {
        Set(table.filter { $0.value.mode == mode }.keys)
    }

    /// Nil when `name` may run with `args`, from `plugin`'s plugin, while the app is in `current`
    /// (nil between modes); otherwise why not.
    static func check(
        _ current: Mode?,
        _ plugin: Mode,
        _ name: String,
        _ args: [String: Any],
        _ table: [String: Spec] = intents
    ) -> Refusal? {
        guard let spec = table[name] else { return .unknown }
        if spec.mode != plugin { return .otherMode }
        guard let current = current else { return .switching }
        if current != plugin { return .otherMode }
        if args.keys.contains(where: { spec.args[$0] == nil }) { return .unexpectedArgument }
        for (key, type) in spec.args {
            guard let value = args[key] else { return .missingArgument }
            if !fits(value, type) { return .wrongType }
        }
        return nil
    }

    /// A JavaScript boolean arrives as a CFBoolean NSNumber; a number as any other NSNumber.
    private static func fits(_ value: Any, _ type: Arg) -> Bool {
        switch type {
        case .string:
            return value is String
        case .boolean:
            return isBoolean(value)
        case .number:
            return value is NSNumber && !isBoolean(value)
        }
    }

    private static func isBoolean(_ value: Any) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return CFGetTypeID(number) == CFBooleanGetTypeID()
    }
}
