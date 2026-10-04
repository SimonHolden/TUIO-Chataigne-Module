/*
  TUIO module for Chataigne
  -------------------------
  Receives TUIO 1.1 2D cursors (/tuio/2Dcur) from one or more sources and
  exposes them as Chataigne values:

    Status            Receiving, Frames Online, Total Touches
    All Frames        Active, Count, Touch 1..N  (every source combined)
    <Frame name>      Active, Online, Count, Touch 1..N  (one per source)
      Touch k         Active, ID, Position, Velocity

  Frames are told apart by the TUIO 1.1 "source" message
  (name:instance@address). Senders that don't send one are grouped by
  their IP address instead.

  A touch takes the lowest free slot when it lands and keeps that slot
  until it lifts, so "Touch 1" can be mapped reliably.

  TUIO 2.0 (/tuio2/frm, ptr, alv) is parsed too, but note that Chataigne's
  OSC parser rejects the OSC timetag argument that spec-compliant
  /tuio2/frm messages carry, so in practice send TUIO 1.1 to Chataigne.

  Written for plain ES3-style JavaScript (Chataigne's script engine).
*/

var ALL_NAME = "All Frames";
var RESERVED = ["Status", "All Frames"];

var sources = [];          // { key, name, cc, slots[], sessions[], lastSeen, online }
var currentSource = [];    // per sender IP: [ip, sourceKey]
var allCC = null;
var allSlots = [];         // slot refs for All Frames
var allTaken = [];         // per slot: null or { src, id }
var lastAny = -1000;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function init() {
	script.setUpdateRate(20);
	allCC = local.values.addContainer(ALL_NAME);
	buildFrameValues(allCC, false);
	allSlots = buildSlots(allCC, slotCount());
	allTaken = [];
	for (var i = 0; i < slotCount(); i++) allTaken.push(null);
	resetSlots(allSlots);
	setFrameSummary(allCC, 0);

	// Containers for frames from a previous session are kept in the saved
	// project (so mappings survive a reload). Mark them all as idle.
	var containers = local.values.getContainers();
	for (var c = 0; c < containers.length; c++) {
		var cc = containers[c];
		var nm = cc.niceName;
		if (nm == undefined || isReserved(nm)) continue;
		var online = cc.getChild("Online");
		if (online != undefined) online.set(false);
		var act = cc.getChild("Active");
		if (act != undefined) act.set(false);
		var cnt = cc.getChild("Count");
		if (cnt != undefined) cnt.set(0);
		for (var k = 1; k <= 20; k++) {
			var t = cc.getChild("Touch " + k);
			if (t == undefined) break;
			t.getChild("Active").set(false);
		}
	}
	updateStatus();
}

function moduleParameterChanged(param) {
	if (param.is(local.parameters.touchSlots)) {
		rebuildAllSlots();
	} else if (param.is(local.parameters.clearOfflineFrames)) {
		clearOfflineFrames();
	}
}

function update(deltaTime) {
	var now = util.getTime();
	var timeout = local.parameters.timeout.get();
	for (var i = 0; i < sources.length; i++) {
		var s = sources[i];
		if (s.online && now - s.lastSeen > timeout) {
			s.online = false;
			s.cc.getChild("Online").set(false);
			removeAllSessions(s);
		}
	}
	updateStatus();
}

// ---------------------------------------------------------------------------
// OSC input
// ---------------------------------------------------------------------------

function oscEvent(address, args, origin) {
	if (origin == undefined) origin = "unknown";

	if (address == "/tuio/2Dcur") {
		handleTuio11(args, origin);
	} else if (address == "/tuio2/frm") {
		// f_id, time, dim, source
		if (args.length >= 4) setCurrentSource(origin, sourceKeyFromString(args[3], origin));
	} else if (address == "/tuio2/ptr") {
		// s_id tu_id c_id x y a w h f [X Y m p]
		if (args.length >= 5) {
			var vx = args.length >= 11 ? args[9] : 0;
			var vy = args.length >= 11 ? args[10] : 0;
			setSession(getSourceFor(origin), args[0], args[3], args[4], vx, vy);
		}
	} else if (address == "/tuio2/alv") {
		applyAlive(getSourceFor(origin), args, 0);
		setCurrentSource(origin, defaultKey(origin));
	}
}

function handleTuio11(args, origin) {
	if (args.length < 1) return;
	var cmd = args[0];
	if (cmd == "source") {
		if (args.length >= 2) setCurrentSource(origin, sourceKeyFromString(args[1], origin));
	} else if (cmd == "alive") {
		applyAlive(getSourceFor(origin), args, 1);
	} else if (cmd == "set") {
		// set s x y X Y m
		if (args.length >= 4) {
			var vx = args.length >= 6 ? args[4] : 0;
			var vy = args.length >= 6 ? args[5] : 0;
			setSession(getSourceFor(origin), args[1], args[2], args[3], vx, vy);
		}
	} else if (cmd == "fseq") {
		// End of this bundle: the next bundle from this sender may be a
		// different source, or none at all.
		setCurrentSource(origin, defaultKey(origin));
	}
}

// ---------------------------------------------------------------------------
// Sources (frames)
// ---------------------------------------------------------------------------

function defaultKey(origin) {
	return "Source " + origin;
}

// "name:instance@address" -> display name
function sourceKeyFromString(str, origin) {
	str = "" + str;
	var at = str.indexOf("@");
	var namePart = at >= 0 ? str.substring(0, at) : str;
	var addr = at >= 0 ? str.substring(at + 1, str.length) : origin;
	var colon = namePart.indexOf(":");
	var name = colon >= 0 ? namePart.substring(0, colon) : namePart;
	var inst = colon >= 0 ? namePart.substring(colon + 1, namePart.length) : "";
	if (name == "") return "Source " + addr;
	if (inst != "" && inst != "0") name = name + " " + inst;
	if (isReserved(name)) name = name + " (frame)";
	return name;
}

function setCurrentSource(origin, key) {
	for (var i = 0; i < currentSource.length; i++) {
		if (currentSource[i][0] == origin) {
			currentSource[i][1] = key;
			return;
		}
	}
	currentSource.push([origin, key]);
}

function getSourceFor(origin) {
	var key = defaultKey(origin);
	for (var i = 0; i < currentSource.length; i++) {
		if (currentSource[i][0] == origin) {
			key = currentSource[i][1];
			break;
		}
	}
	var s = findSource(key);
	if (s == null) s = createSource(key);
	var now = util.getTime();
	s.lastSeen = now;
	lastAny = now;
	if (!s.online) {
		s.online = true;
		s.cc.getChild("Online").set(true);
	}
	return s;
}

function findSource(key) {
	for (var i = 0; i < sources.length; i++) {
		if (sources[i].key == key) return sources[i];
	}
	return null;
}

function createSource(key) {
	var cc = local.values.addContainer(key);
	buildFrameValues(cc, true);
	var s = {
		key: key,
		name: key,
		cc: cc,
		slots: buildSlots(cc, slotCount()),
		taken: [],
		sessions: [],
		lastSeen: util.getTime(),
		online: false
	};
	for (var i = 0; i < slotCount(); i++) s.taken.push(-1);
	resetSlots(s.slots);
	setFrameSummary(cc, 0);
	sources.push(s);
	script.log("TUIO: new frame '" + key + "'");
	return s;
}

function clearOfflineFrames() {
	var keep = [];
	for (var i = 0; i < sources.length; i++) {
		if (sources[i].online) {
			keep.push(sources[i]);
		} else {
			local.values.removeContainer(sources[i].key);
		}
	}
	sources = keep;
	// Also remove containers left over from a previous session that never
	// came back online.
	var containers = local.values.getContainers();
	for (var c = 0; c < containers.length; c++) {
		var nm = containers[c].niceName;
		if (nm == undefined || isReserved(nm)) continue;
		if (findSource(nm) == null) local.values.removeContainer(nm);
	}
}

// ---------------------------------------------------------------------------
// Sessions (touches)
// ---------------------------------------------------------------------------

function findSession(s, id) {
	for (var i = 0; i < s.sessions.length; i++) {
		if (s.sessions[i].id == id) return s.sessions[i];
	}
	return null;
}

function setSession(s, id, x, y, vx, vy) {
	if (local.parameters.invertY.get()) {
		y = 1 - y;
		vy = -vy;
	}
	var sess = findSession(s, id);
	if (sess == null) {
		sess = { id: id, slot: freeSlot(s.taken), allSlot: freeAllSlot() };
		if (sess.slot >= 0) s.taken[sess.slot] = id;
		if (sess.allSlot >= 0) allTaken[sess.allSlot] = { src: s.key, id: id };
		s.sessions.push(sess);
		if (sess.slot >= 0) {
			s.slots[sess.slot].id.set(id);
			s.slots[sess.slot].active.set(true);
		}
		if (sess.allSlot >= 0) {
			allSlots[sess.allSlot].id.set(id);
			allSlots[sess.allSlot].active.set(true);
		}
		setFrameSummary(s.cc, s.sessions.length);
		setFrameSummary(allCC, totalTouches());
	}
	if (sess.slot >= 0) {
		s.slots[sess.slot].position.set(x, y);
		s.slots[sess.slot].velocity.set(vx, vy);
	}
	if (sess.allSlot >= 0) {
		allSlots[sess.allSlot].position.set(x, y);
		allSlots[sess.allSlot].velocity.set(vx, vy);
	}
}

function applyAlive(s, args, start) {
	var alive = [];
	for (var i = start; i < args.length; i++) alive.push(args[i]);
	var remaining = [];
	for (var j = 0; j < s.sessions.length; j++) {
		var sess = s.sessions[j];
		if (alive.indexOf(sess.id) >= 0) {
			remaining.push(sess);
		} else {
			releaseSession(s, sess);
		}
	}
	if (remaining.length != s.sessions.length) {
		s.sessions = remaining;
		setFrameSummary(s.cc, s.sessions.length);
		setFrameSummary(allCC, totalTouches());
	}
}

function releaseSession(s, sess) {
	if (sess.slot >= 0) {
		s.taken[sess.slot] = -1;
		s.slots[sess.slot].active.set(false);
		s.slots[sess.slot].velocity.set(0, 0);
	}
	if (sess.allSlot >= 0) {
		allTaken[sess.allSlot] = null;
		allSlots[sess.allSlot].active.set(false);
		allSlots[sess.allSlot].velocity.set(0, 0);
	}
}

function removeAllSessions(s) {
	for (var i = 0; i < s.sessions.length; i++) releaseSession(s, s.sessions[i]);
	s.sessions = [];
	setFrameSummary(s.cc, 0);
	setFrameSummary(allCC, totalTouches());
}

function freeSlot(taken) {
	for (var i = 0; i < taken.length; i++) {
		if (taken[i] == -1) return i;
	}
	return -1;
}

function freeAllSlot() {
	for (var i = 0; i < allTaken.length; i++) {
		if (allTaken[i] == null) return i;
	}
	return -1;
}

function totalTouches() {
	var n = 0;
	for (var i = 0; i < sources.length; i++) n += sources[i].sessions.length;
	return n;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

function slotCount() {
	return local.parameters.touchSlots.get();
}

function isReserved(name) {
	for (var i = 0; i < RESERVED.length; i++) {
		if (RESERVED[i] == name) return true;
	}
	return false;
}

function buildFrameValues(cc, withOnline) {
	cc.addBoolParameter("Active", "At least one touch is down", false);
	if (withOnline) cc.addBoolParameter("Online", "This source is currently sending", false);
	cc.addIntParameter("Count", "Touches currently down", 0, 0, 100);
}

function buildSlots(cc, n) {
	var refs = [];
	for (var k = 1; k <= n; k++) {
		var t = cc.addContainer("Touch " + k);
		refs.push({
			cc: t,
			active: t.addBoolParameter("Active", "This slot has a touch down", false),
			id: t.addIntParameter("ID", "TUIO session ID of the touch in this slot", 0, 0, 2147483647),
			position: t.addPoint2DParameter("Position", "Normalized position, 0 to 1"),
			velocity: t.addPoint2DParameter("Velocity", "Normalized units per second")
		});
	}
	// Remove slots above the current count (when Touch Slots is lowered).
	for (var extra = n + 1; extra <= 20; extra++) {
		cc.removeContainer("Touch " + extra);
	}
	return refs;
}

function resetSlots(refs) {
	for (var i = 0; i < refs.length; i++) {
		refs[i].active.set(false);
		refs[i].velocity.set(0, 0);
	}
}

function setFrameSummary(cc, count) {
	cc.getChild("Count").set(count);
	cc.getChild("Active").set(count > 0);
}

function rebuildAllSlots() {
	var n = slotCount();
	// Drop every current touch; they get new slots on their next update.
	for (var i = 0; i < sources.length; i++) {
		removeAllSessions(sources[i]);
		sources[i].slots = buildSlots(sources[i].cc, n);
		sources[i].taken = [];
		for (var j = 0; j < n; j++) sources[i].taken.push(-1);
		resetSlots(sources[i].slots);
	}
	allSlots = buildSlots(allCC, n);
	allTaken = [];
	for (var k = 0; k < n; k++) allTaken.push(null);
	resetSlots(allSlots);
	setFrameSummary(allCC, 0);
}

function updateStatus() {
	var now = util.getTime();
	var timeout = local.parameters.timeout.get();
	var online = 0;
	for (var i = 0; i < sources.length; i++) if (sources[i].online) online++;
	local.values.status.receiving.set(now - lastAny <= timeout);
	local.values.status.framesOnline.set(online);
	local.values.status.totalTouches.set(totalTouches());
}
