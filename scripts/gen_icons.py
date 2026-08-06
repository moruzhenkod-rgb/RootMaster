import struct, zlib, os

def make_png(path, size, bg=(59,130,246,255), fg=(255,255,255,255)):
    w = h = size
    r = size * 0.22  # corner radius
    cx = cy = size / 2
    truck_scale = size * 0.5

    def in_rounded_rect(x, y):
        if x >= r and x <= size - r:
            return 0 <= y < size
        if y >= r and y <= size - r:
            return 0 <= x < size
        cxs = [r, size - r]
        cys = [r, size - r]
        for ccx in cxs:
            for ccy in cys:
                if (x - ccx) ** 2 + (y - ccy) ** 2 <= r * r:
                    return True
        return False

    def in_circle(x, y, ccx, ccy, rad):
        return (x - ccx) ** 2 + (y - ccy) ** 2 <= rad * rad

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            if not in_rounded_rect(x, y):
                raw.extend((0, 0, 0, 0))
                continue
            # simple truck glyph: body rectangle + cab + two wheels, centered
            px = (x - cx) / truck_scale
            py = (y - cy) / truck_scale
            is_fg = False
            # body
            if -0.9 < px < 0.5 and -0.25 < py < 0.15:
                is_fg = True
            # cab
            if 0.35 < px < 0.75 and -0.05 < py < 0.15:
                is_fg = True
            # wheels
            if in_circle(px, py, -0.55, 0.28, 0.14):
                is_fg = True
            if in_circle(px, py, 0.35, 0.28, 0.14):
                is_fg = True
            color = fg if is_fg else bg
            raw.extend(color)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)

make_png('icons/icon-192.png', 192)
make_png('icons/icon-512.png', 512)
print('done')
