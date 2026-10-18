"""Applesoft BASIC detokenizer: list a program stored at a given linear sector."""
import sys, struct

TOK = ("END FOR NEXT DATA INPUT DEL DIM READ GR TEXT PR# IN# CALL PLOT HLIN VLIN HGR2 HGR HCOLOR= HPLOT "
       "DRAW XDRAW HTAB HOME ROT= SCALE= SHLOAD TRACE NOTRACE NORMAL INVERSE FLASH COLOR= POP VTAB HIMEM: "
       "LOMEM: ONERR RESUME RECALL STORE SPEED= LET GOTO RUN IF RESTORE & GOSUB RETURN REM STOP ON WAIT "
       "LOAD SAVE DEF POKE PRINT CONT LIST CLEAR GET NEW TAB( TO FN SPC( THEN AT NOT STEP + - * / ^ AND OR "
       "> = < SGN INT ABS USR FRE SCRN( PDL POS SQR RND LOG EXP COS SIN TAN ATN PEEK LEN STR$ VAL ASC "
       "CHR$ LEFT$ RIGHT$ MID$").split()

def detok(buf, load, maxlines=100000):
    p, out = 0, []
    while p + 4 <= len(buf) and len(out) < maxlines:
        nxt, ln = struct.unpack("<HH", buf[p:p + 4])
        if nxt == 0:
            break
        q, s, instr = p + 4, "", False
        while q < len(buf) and buf[q] != 0:
            b = buf[q]
            if b >= 0x80 and not instr:
                s += " " + (TOK[b - 0x80] if b - 0x80 < len(TOK) else f"<{b:02X}>") + " "
            else:
                c = b & 0x7F
                if c == 0x22:
                    instr = not instr
                s += chr(c) if 32 <= c < 127 else f"<{b:02X}>"
            q += 1
        out.append(f"{ln} {s.strip()}")
        p = nxt - load
        if p <= q - 1 or p < 0:
            break
    return out

if __name__ == "__main__":
    img = open(sys.argv[1], "rb").read()
    lin, load = int(sys.argv[2]), int(sys.argv[3], 0)
    nsec = int(sys.argv[4]) if len(sys.argv) > 4 else 80
    print("\n".join(detok(img[lin * 256:(lin + nsec) * 256], load)))
