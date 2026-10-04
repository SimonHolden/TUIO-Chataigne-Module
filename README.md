# TUIO Chataigne Module

This module receives **TUIO 1.1** multitouch (`/tuio/2Dcur`) in [Chataigne](https://benjamin.kuperberg.fr/chataigne/). It handles several touch frames at once, keeps each touch in a stable slot so it maps reliably, and copes with lost packets.

It was built for the Trace Element IR Touch Frame Hub, but it works with any TUIO 1.1 sender (reacTIVision, TouchDesigner, and others).

## What you get

```
Status          Receiving, Frames Online, Total Touches
All Frames      Active, Count, Touch 1..N        every source combined
<Frame name>    Active, Online, Count, Touch 1..N
  Touch k       Active, ID, Position (x,y), Velocity (x,y)
```

**Frames.** Each sender gets its own container, named from the TUIO `source` message. For example, `LeftBar@192.168.1.88` shows up as **LeftBar**. A sender that doesn't send a `source` message is named by its IP address, e.g. "Source 10.0.0.5".

**Stable slots.** A new touch takes the lowest free slot and keeps it until it lifts. That means "LeftBar > Touch 1 > Position" stays mapped to one finger for the whole touch, even when other fingers come and go.

**No stuck touches.** The TUIO `alive` list removes lifted touches even when packets are dropped. If a source goes quiet for longer than **Timeout**, its touches are cleared and it shows as offline.

**Mappings survive a reload.** Frame containers are saved with the project, so mappings still work after reopening it, even before the frames have reconnected.

## Install

1. Download from https://github.com/SimonHolden/TUIO-Chataigne-Module (Code > Download ZIP), or clone it, and copy the folder into your Chataigne modules folder, usually `Documents/Chataigne/modules/`. The result should be `Documents/Chataigne/modules/TUIO-Chataigne-Module-master/module.json`.
2. Restart Chataigne.
3. Add the module from **Modules > Protocol > TUIO**.

It listens on UDP **3333**, the TUIO default. You can change the port under OSC Input.

## Parameters

| Parameter | Meaning |
|---|---|
| Touch Slots | Slots per frame and in All Frames (1 to 20, default 10) |
| Invert Y | TUIO puts y = 0 at the top. Tick this to put y = 0 at the bottom |
| Timeout | Seconds of silence before a source is marked offline and its touches cleared |
| Clear Offline Frames | Removes containers for frames that aren't currently sending |

## Testing without hardware

Two test senders are included. Both send two fake frames (LeftBar and RightBar) with touches that move and lift:

- `tools/send_test_tuio.ps1` for Windows, no installs needed:
  `powershell -ExecutionPolicy Bypass -File tools\send_test_tuio.ps1`
- `tools/send_test_tuio.py` for anywhere with Python 3:
  `python3 tools/send_test_tuio.py 127.0.0.1 3333`

## TUIO 2.0 note

The script also parses TUIO 2.0 (`/tuio2/frm`, `/tuio2/ptr`, `/tuio2/alv`), but Chataigne can't receive standard TUIO 2.0. Its OSC parser doesn't support the OSC timetag argument (`t`) that every `/tuio2/frm` message carries, and it drops the whole bundle. Send **TUIO 1.1** to Chataigne. TUIO 2.0 is fine for receivers that support it, such as TouchDesigner.

## License

MIT
