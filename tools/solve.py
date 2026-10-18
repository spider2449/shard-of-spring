"""Greedy per-file sector-order solver for Applesoft files."""
import sys
sys.path.insert(0, "tools")
import rdos, basic

def solve(img, e, hyp):
    order, used = [], {}
    buf = b""
    for n in range(e["nsec"]):
        t, s = divmod(e["start"] + n, 16)
        u = used.setdefault(t, set())
        cands = [x for x in range(16) if x not in u]
        pref = hyp[s]
        best = None
        for x in cands:
            b = buf + img[(t * 16 + x) * 256:(t * 16 + x + 1) * 256]
            sc = (len(basic.detok(b, e["load"])), x == pref)
            if best is None or sc > best[0]:
                best = (sc, x)
        u.add(best[1]); order.append((t, best[1])); buf += img[(t * 16 + best[1]) * 256:(t * 16 + best[1] + 1) * 256]
    return order, buf

if __name__ == "__main__":
    img = open(sys.argv[1], "rb").read()
    HYP = [0,10,9,8,7,14,13,12,11,6,5,4,3,2,1,15]
    for e in rdos.catalog(img):
        if e["name"] == sys.argv[2]:
            order, buf = solve(img, e, HYP)
            print(order)
            print("\n".join(basic.detok(buf, e["load"]))[-600:])
