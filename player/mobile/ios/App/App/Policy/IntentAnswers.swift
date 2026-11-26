// What an intent answers on iOS while the parts behind it are not built yet (issue #895): the same
// words Android answers when the part has nothing to give. Joining reaches no class, the saved
// class list is empty and unavailable, and following the music app is unavailable on iOS, so the
// reading and the three music commands answer as Android does when it is not following. An intent
// with no fixed answer here is refused. None of these answers carries a token, and the controller
// still puts every answer through AnswerPolicy. Pure: no import at all.
enum IntentAnswers {
    static func fixed(_ name: String) -> [String: Any]? {
        switch name {
        case "join": return ["result": "unreachable"]
        case "leave": return ["result": "left"]
        case "listClasses", "syncNow": return ["classes": [Any](), "status": "unavailable"]
        case "getClass": return ["error": "not_found"]
        case "followAccess": return ["granted": false, "state": "unavailable"]
        case "follow": return ["state": "unavailable"]
        case "unfollow", "reading", "sendPlay", "sendPause", "sendNext": return ["state": "stopped"]
        case "openFollowSetting": return ["state": "notOpened"]
        default: return nil
        }
    }
}
