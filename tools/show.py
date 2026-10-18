import sys
sys.path.insert(0, "tools")
import rdos, basic
HYP = [0,14,13,12,11,10,9,8,7,6,5,4,3,2,1,15]
def build(img, e, skew=HYP):
    out = bytearray()
    for n in range(e["nsec"]):
        t, s = divmod(e["start"] + n, 16)
        p = (t * 16 + skew[s]) * 256
        out += img[p:p + 256]
    return bytes(out)
if __name__ == "__main__":
    img = open(sys.argv[1], "rb").read()
    for e in rdos.catalog(img):
        if e["name"] == sys.argv[2]:
            print("\n".join(basic.detok(build(img, e), e["load"])))
