"""Extract files from SSI RDOS 3.3 disk images (.dsk, 143360 bytes).

File sector n of a track lives at DOS-order image sector SKEW[n]; the catalog uses
the same mapping and spans track 1 (12 logical sectors, 32-byte entries).
"""
import sys, os, struct

SKEW = [0, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 15]

def sector(img, lin):
    t, s = divmod(lin, 16)
    p = (t * 16 + SKEW[s]) * 256
    return img[p:p + 256]

def catalog(img):
    out = []
    for lin in range(16, 28):
        sec = sector(img, lin)
        for i in range(0, 256, 32):
            e = sec[i:i + 32]
            if lin == 16 and i == 0:
                continue  # volume header
            if e[0] in (0, 0x80):
                continue
            name = bytes(b & 0x7F for b in e[:24]).decode("latin1").rstrip()
            ftype = chr(e[24] & 0x7F)
            nsec = e[25]
            load, length, start = struct.unpack("<HHH", e[26:32])
            out.append(dict(name=name, type=ftype, nsec=nsec, load=load, length=length, start=start))
    return out

def read_file(img, ent):
    data = b"".join(sector(img, ent["start"] + n) for n in range(ent["nsec"]))
    return data[: ent["length"]] if ent["length"] and ent["length"] <= len(data) else data

if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(__file__))
    import basic
    path, outdir = sys.argv[1], sys.argv[2]
    img = open(path, "rb").read()
    os.makedirs(outdir, exist_ok=True)
    for e in catalog(img):
        print(f'{e["name"]:<26}{e["type"]} sec={e["nsec"]:<4} load=${e["load"]:04X} len={e["length"]:<6} start={e["start"]}')
        safe = e["name"].replace("/", "_").replace("@", "at").replace(" ", "_")
        full = b"".join(sector(img, e["start"] + n) for n in range(e["nsec"]))
        open(os.path.join(outdir, safe + ".bin"), "wb").write(full)
        if e["type"] == "A":
            open(os.path.join(outdir, safe + ".bas.txt"), "w").write("\n".join(basic.detok(full, e["load"])))
