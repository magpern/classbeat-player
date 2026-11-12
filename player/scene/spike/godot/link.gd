extends Node
# The only door between the shell and the scene.
#  - Native build: a WebSocket client to 127.0.0.1 only. The port and the per-launch token come in
#    the environment (SPIKE_LINK_PORT, SPIKE_LINK_TOKEN); the token goes in an Authorization header.
#    If the shell closes the link the scene quits, so it never lingers as an orphan.
#  - Web build: the page registers a callback (window.spikeRegister) and pushes state through it.
# Messages in: {"type":"state", ...the shell's state...} and {"type":"capture"}.
# Messages out: {"type":"hb", "textH":{...}}, {"type":"fps","v":n}, {"type":"captured","name":s}.

signal state_received(state: Dictionary)
signal capture_requested

const HOST := "127.0.0.1"

var _ws := WebSocketPeer.new()
var _web := OS.has_feature("web")
var _js: Variant = null
var _cb: Variant = null
var _native_on := false


func _ready() -> void:
	if _web:
		_js = JavaScriptBridge.get_interface("window")
		_cb = JavaScriptBridge.create_callback(_on_js_state)
		_js.spikeRegister(_cb)
		return
	var port := OS.get_environment("SPIKE_LINK_PORT")
	var token := OS.get_environment("SPIKE_LINK_TOKEN")
	if port.is_empty() or token.is_empty():
		push_warning("no link: SPIKE_LINK_PORT / SPIKE_LINK_TOKEN not set; waiting for nothing")
		return
	_ws.handshake_headers = PackedStringArray(["Authorization: Bearer " + token])
	_native_on = _ws.connect_to_url("ws://%s:%s/" % [HOST, port]) == OK
	if not _native_on:
		get_tree().quit(2)


func _process(_delta: float) -> void:
	if not _native_on:
		return
	_ws.poll()
	var st := _ws.get_ready_state()
	if st == WebSocketPeer.STATE_OPEN:
		while _ws.get_available_packet_count() > 0:
			_handle(JSON.parse_string(_ws.get_packet().get_string_from_utf8()))
	elif st == WebSocketPeer.STATE_CLOSED:
		get_tree().quit(3)


func send(msg: Dictionary) -> void:
	if _web:
		if msg.get("type") == "fps":
			_js.spikeFps(float(msg["v"]))
	elif _native_on and _ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_ws.send_text(JSON.stringify(msg))


func _on_js_state(args: Array) -> void:
	_handle(JSON.parse_string(str(args[0])))


func _handle(msg: Variant) -> void:
	if typeof(msg) != TYPE_DICTIONARY:
		return
	match msg.get("type"):
		"state":
			state_received.emit(msg)
		"capture":
			capture_requested.emit()
