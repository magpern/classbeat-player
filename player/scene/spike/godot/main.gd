extends Node3D
# Spike 2, Godot variant: the same rough light show as the web 3D scene. No road, no terrain, no
# world, no riders: an abstract body of light (zone colour, pulsing on the BPM) and a flat sideways
# score. Nothing takes a slope or height from an interval. Colour is the planned zone only.
# Native build: draws the text too (the shell sends only the clock state).
# Web build: no text here; the shell's page lays HTML text over the canvas.

const HB_EVERY := 0.5

@onready var _body: Node3D = $Body
@onready var _beams: Node3D = $Beams
@onready var _score: Control = $Hud/Score
@onready var _texts: Control = $Hud/Text
@onready var _link: Node = Link

var _draw_text := not OS.has_feature("web")
var _state: Dictionary = {}
var _state_at := 0
var _glows: Array[MeshInstance3D] = []
var _beam_nodes: Array[MeshInstance3D] = []
var _frames := 0
var _fps_t := 0.0
var _hb_t := 0.0
var _beat_phase := 0.0
var _last_size := Vector2.ZERO


func _ready() -> void:
	_texts.visible = _draw_text
	_build_light()
	_link.state_received.connect(_on_state)
	_link.capture_requested.connect(_capture)
	get_window().title = "classbeat spike scene"
	if _draw_text and not Engine.is_editor_hint():
		# The presenter keeps the keyboard: the room's screen never takes focus.
		get_window().unfocusable = true


func _build_light() -> void:
	for i in 5:
		var m := MeshInstance3D.new()
		var s := SphereMesh.new()
		s.radius = 1.0 + i * 0.55
		s.height = s.radius * 2.0
		s.radial_segments = 32
		s.rings = 24
		m.mesh = s
		m.material_override = _additive()
		_body.add_child(m)
		_glows.append(m)
	for i in 14:
		var b := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(0.12, 22.0)
		b.mesh = q
		b.material_override = _additive()
		b.rotation.z = float(i) / 14.0 * PI
		_beams.add_child(b)
		_beam_nodes.append(b)


func _additive() -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	return mat


func _on_state(s: Dictionary) -> void:
	_state = s
	_state_at = Time.get_ticks_msec()


func _elapsed_s() -> float:
	var e := float(_state["elapsedMs"])
	if _state["running"]:
		e += float(Time.get_ticks_msec() - _state_at)
	return clampf(e, 0.0, float(_state["totalMs"])) / 1000.0


func _process(delta: float) -> void:
	_tick_fps(delta)
	if _state.is_empty():
		return
	var iv: Dictionary = _state["interval"]
	var zones: Dictionary = _state["zones"]
	var zone: Dictionary = zones[str(int(iv["zone"]))]
	var color := Color.html(zone["color"])
	var el := _elapsed_s()
	var beat := el * float(iv["bpm"]) / 60.0 # beat phase, driven by the clock
	var pulse := exp(-fmod(beat, 1.0) * 4.5)
	var intensity := 0.55 + 0.1 * float(iv["zone"]) # brightness only, never shape
	for i in _glows.size():
		var mat := _glows[i].material_override as StandardMaterial3D
		mat.albedo_color = Color(color, (0.5 / (i + 1)) * intensity * (0.7 + 0.5 * pulse))
	_body.scale = Vector3.ONE * (1.0 + 0.18 * pulse)
	for b in _beam_nodes:
		(b.material_override as StandardMaterial3D).albedo_color = Color(color, 0.18)
	_beams.rotation.z = el * 0.15
	_beams.scale = Vector3.ONE * (1.0 + 0.1 * pulse)
	_score.set_data(_state["classDef"], zones, el)
	if _draw_text:
		_update_text(iv, zone, color)


func _tick_fps(delta: float) -> void:
	_frames += 1
	_fps_t += delta
	_hb_t += delta
	if _fps_t >= 1.0:
		_link.send({"type": "fps", "v": _frames / _fps_t})
		_frames = 0
		_fps_t = 0.0
	if _hb_t >= HB_EVERY:
		_hb_t = 0.0
		_link.send({"type": "hb", "textH": _text_ratios() if _draw_text else {}})


# Text layout mirrors the web variant: sizes as a share of the window height.
func _update_text(iv: Dictionary, zone: Dictionary, color: Color) -> void:
	var win := _texts.size
	var h := win.y
	_put($Hud/Text/Zone, "ZONE %d %s" % [zone["number"], zone["name"]], h * 0.09, 0.10, win, color)
	_put($Hud/Text/Name, str(iv["name"]), h * 0.06, 0.20, win, Color.WHITE)
	var left := ceili((float(iv["end"]) - _elapsed_s() * 1000.0) / 1000.0)
	left = maxi(left, 0)
	_put($Hud/Text/Left, "%d:%02d" % [left / 60, left % 60], h * 0.22, 0.27, win, Color.WHITE)
	var r: Array = iv["rpm"]
	_put($Hud/Text/Cadence, "%d-%d rpm" % [r[0], r[1]], h * 0.10, 0.52, win, Color.WHITE, 0.0, 0.5)
	_put($Hud/Text/Bpm, "%d bpm" % int(iv["bpm"]), h * 0.10, 0.52, win, Color.WHITE, 0.5, 1.0)
	var nxt: Variant = _state["next"]
	var nz: Dictionary = {}
	if nxt != null:
		nz = _state["zones"][str(int(nxt["zone"]))]
	var nxt_text := "Last interval" if nxt == null else "Next: %s, zone %d %s" % [nxt["name"], nxt["zone"], nz["name"]]
	_put($Hud/Text/Next, nxt_text, h * 0.05, 0.66, win, Color.WHITE)
	_put($Hud/Text/Tag, "godot-native", h * 0.02, 0.01, win, Color(1, 1, 1, 0.5), 0.0, 1.0, HORIZONTAL_ALIGNMENT_RIGHT)


func _put(l: Label, text: String, font_px: float, y_share: float, win: Vector2, color: Color,
		x0 := 0.0, x1 := 1.0, align := HORIZONTAL_ALIGNMENT_CENTER) -> void:
	if l.text != text:
		l.text = text
	l.add_theme_font_size_override("font_size", int(font_px))
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	l.add_theme_constant_override("outline_size", maxi(2, int(font_px * 0.08)))
	l.horizontal_alignment = align
	l.position = Vector2(win.x * x0, win.y * y_share)
	l.size = Vector2(win.x * (x1 - x0), 0)


# The height of each main number as a share of the window height (the 8 % rule is checked by the shell).
func _text_ratios() -> Dictionary:
	var h := _texts.size.y
	if h <= 0.0:
		return {}
	var out := {}
	for n in ["Zone", "Left", "Cadence", "Bpm"]:
		out[n.to_lower()] = ($Hud/Text.get_node(n) as Label).get_minimum_size().y / h
	return out


# Godot's own viewport capture to PNG (the native variant's screenshot).
func _capture() -> void:
	var dir := OS.get_environment("SPIKE_CAPTURE_DIR")
	if dir.is_empty():
		return
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var name := "godot-native-%d.png" % Time.get_ticks_msec()
	if img.save_png(dir.path_join(name)) == OK:
		_link.send({"type": "captured", "name": name})
