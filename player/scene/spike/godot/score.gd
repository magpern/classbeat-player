extends Control
# The flat sideways score: intervals above, songs below, under a fixed "now" line.
# Bar heights are constant: nothing here takes a slope or height from an interval.

const WINDOW_S := 150.0
const NOW_X := 0.28
const SONG_COLOR := Color("#2c2f45")

var class_def: Dictionary = {}
var zones: Dictionary = {}
var elapsed_s := 0.0


func set_data(def: Dictionary, zone_defs: Dictionary, elapsed: float) -> void:
	class_def = def
	zones = zone_defs
	elapsed_s = elapsed
	queue_redraw()


func _draw() -> void:
	if class_def.is_empty():
		return
	var w := size.x
	var h := size.y
	var px := w / WINDOW_S
	var lane_h := h * 0.06
	var base := h * 0.03
	var now_x := w * NOW_X
	for item in class_def["intervals"]:
		var color := Color.html(zones[str(int(item["zone"]))]["color"])
		_bar(item, now_x, px, h - (base + lane_h * 1.15 + lane_h), lane_h, color, w)
	for item in class_def["songs"]:
		_bar(item, now_x, px, h - (base + lane_h), lane_h, SONG_COLOR, w)
	draw_rect(Rect2(now_x - 1.5, h - base - lane_h * 2.4, 3.0, lane_h * 2.6), Color.WHITE)


func _bar(item: Dictionary, now_x: float, px: float, y: float, lane_h: float, color: Color, w: float) -> void:
	var x0 := now_x + (float(item["start"]) / 1000.0 - elapsed_s) * px
	var x1 := now_x + (float(item["end"]) / 1000.0 - elapsed_s) * px
	if x1 <= 0.0 or x0 >= w:
		return
	draw_rect(Rect2(x0, y, maxf(0.0, x1 - x0 - 3.0), lane_h), color)
