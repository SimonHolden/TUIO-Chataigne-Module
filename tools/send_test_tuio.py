#!/usr/bin/env python3
"""Send fake TUIO 1.1 from two "frames" so the Chataigne TUIO module can be
tested without hardware. No dependencies.

  python3 send_test_tuio.py [host] [port]
"""
import math, socket, struct, sys, time

host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
port = int(sys.argv[2]) if len(sys.argv) > 2 else 3333
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


def pad(b):
    return b + b"\0" * (4 - len(b) % 4)


def msg(addr, *args):
    tags = ","
    data = b""
    for a in args:
        if isinstance(a, str):
            tags += "s"; data += pad(a.encode())
        elif isinstance(a, int):
            tags += "i"; data += struct.pack(">i", a)
        else:
            tags += "f"; data += struct.pack(">f", a)
    m = pad(addr.encode()) + pad(tags.encode()) + data
    return struct.pack(">i", len(m)) + m


def bundle(*msgs):
    return pad(b"#bundle") + struct.pack(">Q", 1) + b"".join(msgs)


fseq = 0
next_sid = 1
frames = {"LeftBar": {"sid": None}, "RightBar": {"sid": None}}
print(f"Sending TUIO 1.1 to {host}:{port}, Ctrl+C to stop")
t0 = time.time()
try:
    while True:
        t = time.time() - t0
        for i, (name, st) in enumerate(frames.items()):
            down = ((t + i * 1.7) % 4) < 2.8          # lift every few seconds
            if down and st["sid"] is None:
                st["sid"] = next_sid; next_sid += 1
            if not down:
                st["sid"] = None
            fseq += 1
            parts = [msg("/tuio/2Dcur", "source", f"{name}@{host}")]
            if st["sid"] is None:
                parts.append(msg("/tuio/2Dcur", "alive"))
            else:
                a = t * (1.0 + i * 0.4)
                x, y = 0.5 + 0.35 * math.cos(a), 0.5 + 0.35 * math.sin(a)
                vx, vy = -0.35 * math.sin(a), 0.35 * math.cos(a)
                parts.append(msg("/tuio/2Dcur", "alive", st["sid"]))
                parts.append(msg("/tuio/2Dcur", "set", st["sid"], x, y, vx, vy, 0.0))
            parts.append(msg("/tuio/2Dcur", "fseq", fseq))
            sock.sendto(bundle(*parts), (host, port))
        time.sleep(1 / 30)
except KeyboardInterrupt:
    pass
