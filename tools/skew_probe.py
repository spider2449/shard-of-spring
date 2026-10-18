import sys, struct
sys.path.insert(0, "tools")
import rdos

DOS_L2P = [0,13,11,9,7,5,3,1,14,12,10,8,6,4,2,15]   # DOS logical -> physical
PO_L2P  = [0,2,4,6,8,10,12,14,1,3,5,7,9,11,13,15]   # ProDOS logical -> physical (inverse of below)
cands = {
    "hyp": [0,10,9,8,7,14,13,12,11,6,5,4,3,2,1,15],
    "desc": [0,10,9,8,7,6,5,4,3,2,1,15,14,13,12,11],
    "rdos": [0,10,11,12,13,14,15,1,2,3,4,5,6,7,8,9],
    "linear": list(range(16)),
    "dos": DOS_L2P,
    "dos_inv": [DOS_L2P.index(i) for i in range(16)],
    "po": PO_L2P,
    "po_inv": [PO_L2P.index(i) for i in range(16)],
}

def build(img, ent, skew):
    out = bytearray()
    for n in range(ent["nsec"]):
        lin = ent["start"] + n
        t, s = divmod(lin, 16)
        p = (t * 16 + skew[s]) * 256
        out += img[p:p + 256]
    return bytes(out)

def chain(buf, load):
    p, lines, last = 0, 0, -1
    while p + 4 <= len(buf):
        nxt, ln = struct.unpack("<HH", buf[p:p + 4])
        if nxt == 0:
            return lines, True
        if nxt - load <= p or nxt - load >= len(buf) + 2 or ln <= last:
            return lines, False
        last = ln; lines += 1; p = nxt - load
    return lines, False

if __name__ != "__main__": sys.exit  # noqa
img = open(sys.argv[1], "rb").read()
for e in rdos.catalog(img):
    if e["type"] != "A" or e["nsec"] < 3:
        continue
    res = {k: chain(build(img, e, v), e["load"]) for k, v in cands.items()}
    print(e["name"], e["nsec"], res)
