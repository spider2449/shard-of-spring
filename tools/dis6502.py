"""Minimal 6502 disassembler: dis6502.py file load_addr [start_offset] [length]"""
import sys
OPS = {}
def add(op, name, mode): OPS[op] = (name, mode)
# (mnemonic, [(opcode, mode)...]) standard NMOS table
T = {
 "ADC":[(0x69,"imm"),(0x65,"zp"),(0x75,"zpx"),(0x6D,"abs"),(0x7D,"absx"),(0x79,"absy"),(0x61,"indx"),(0x71,"indy")],
 "AND":[(0x29,"imm"),(0x25,"zp"),(0x35,"zpx"),(0x2D,"abs"),(0x3D,"absx"),(0x39,"absy"),(0x21,"indx"),(0x31,"indy")],
 "ASL":[(0x0A,"acc"),(0x06,"zp"),(0x16,"zpx"),(0x0E,"abs"),(0x1E,"absx")],
 "BCC":[(0x90,"rel")],"BCS":[(0xB0,"rel")],"BEQ":[(0xF0,"rel")],"BMI":[(0x30,"rel")],"BNE":[(0xD0,"rel")],"BPL":[(0x10,"rel")],"BVC":[(0x50,"rel")],"BVS":[(0x70,"rel")],
 "BIT":[(0x24,"zp"),(0x2C,"abs")],"BRK":[(0x00,"imp")],
 "CLC":[(0x18,"imp")],"CLD":[(0xD8,"imp")],"CLI":[(0x58,"imp")],"CLV":[(0xB8,"imp")],
 "CMP":[(0xC9,"imm"),(0xC5,"zp"),(0xD5,"zpx"),(0xCD,"abs"),(0xDD,"absx"),(0xD9,"absy"),(0xC1,"indx"),(0xD1,"indy")],
 "CPX":[(0xE0,"imm"),(0xE4,"zp"),(0xEC,"abs")],"CPY":[(0xC0,"imm"),(0xC4,"zp"),(0xCC,"abs")],
 "DEC":[(0xC6,"zp"),(0xD6,"zpx"),(0xCE,"abs"),(0xDE,"absx")],"DEX":[(0xCA,"imp")],"DEY":[(0x88,"imp")],
 "EOR":[(0x49,"imm"),(0x45,"zp"),(0x55,"zpx"),(0x4D,"abs"),(0x5D,"absx"),(0x59,"absy"),(0x41,"indx"),(0x51,"indy")],
 "INC":[(0xE6,"zp"),(0xF6,"zpx"),(0xEE,"abs"),(0xFE,"absx")],"INX":[(0xE8,"imp")],"INY":[(0xC8,"imp")],
 "JMP":[(0x4C,"abs"),(0x6C,"ind")],"JSR":[(0x20,"abs")],
 "LDA":[(0xA9,"imm"),(0xA5,"zp"),(0xB5,"zpx"),(0xAD,"abs"),(0xBD,"absx"),(0xB9,"absy"),(0xA1,"indx"),(0xB1,"indy")],
 "LDX":[(0xA2,"imm"),(0xA6,"zp"),(0xB6,"zpy"),(0xAE,"abs"),(0xBE,"absy")],
 "LDY":[(0xA0,"imm"),(0xA4,"zp"),(0xB4,"zpx"),(0xAC,"abs"),(0xBC,"absx")],
 "LSR":[(0x4A,"acc"),(0x46,"zp"),(0x56,"zpx"),(0x4E,"abs"),(0x5E,"absx")],"NOP":[(0xEA,"imp")],
 "ORA":[(0x09,"imm"),(0x05,"zp"),(0x15,"zpx"),(0x0D,"abs"),(0x1D,"absx"),(0x19,"absy"),(0x01,"indx"),(0x11,"indy")],
 "PHA":[(0x48,"imp")],"PHP":[(0x08,"imp")],"PLA":[(0x68,"imp")],"PLP":[(0x28,"imp")],
 "ROL":[(0x2A,"acc"),(0x26,"zp"),(0x36,"zpx"),(0x2E,"abs"),(0x3E,"absx")],
 "ROR":[(0x6A,"acc"),(0x66,"zp"),(0x76,"zpx"),(0x6E,"abs"),(0x7E,"absx")],
 "RTI":[(0x40,"imp")],"RTS":[(0x60,"imp")],
 "SBC":[(0xE9,"imm"),(0xE5,"zp"),(0xF5,"zpx"),(0xED,"abs"),(0xFD,"absx"),(0xF9,"absy"),(0xE1,"indx"),(0xF1,"indy")],
 "SEC":[(0x38,"imp")],"SED":[(0xF8,"imp")],"SEI":[(0x78,"imp")],
 "STA":[(0x85,"zp"),(0x95,"zpx"),(0x8D,"abs"),(0x9D,"absx"),(0x99,"absy"),(0x81,"indx"),(0x91,"indy")],
 "STX":[(0x86,"zp"),(0x96,"zpy"),(0x8E,"abs")],"STY":[(0x84,"zp"),(0x94,"zpx"),(0x8C,"abs")],
 "TAX":[(0xAA,"imp")],"TAY":[(0xA8,"imp")],"TSX":[(0xBA,"imp")],"TXA":[(0x8A,"imp")],"TXS":[(0x9A,"imp")],"TYA":[(0x98,"imp")],
}
for n, l in T.items():
    for op, m in l: OPS[op] = (n, m)
LEN = {"imp":1,"acc":1,"imm":2,"zp":2,"zpx":2,"zpy":2,"rel":2,"indx":2,"indy":2,"abs":3,"absx":3,"absy":3,"ind":3}
def dis(buf, base, start=0, length=None):
    p = start; end = len(buf) if length is None else min(len(buf), start + length)
    out = []
    while p < end:
        op = buf[p]; a = base + p
        if op not in OPS:
            out.append(f"{a:04X}: {op:02X}        .byte ${op:02X}"); p += 1; continue
        n, m = OPS[op]; l = LEN[m]; b = buf[p:p + l]
        if len(b) < l: break
        v = b[1] if l == 2 else (b[1] | b[2] << 8 if l == 3 else 0)
        s = {"imp":"","acc":"A","imm":f"#${v:02X}","zp":f"${v:02X}","zpx":f"${v:02X},X","zpy":f"${v:02X},Y","rel":f"${a+2+(v-256 if v>127 else v):04X}",
             "indx":f"(${v:02X},X)","indy":f"(${v:02X}),Y","abs":f"${v:04X}","absx":f"${v:04X},X","absy":f"${v:04X},Y","ind":f"(${v:04X})"}[m]
        out.append(f"{a:04X}: {b.hex().upper():<8}  {n} {s}"); p += l
    return out
if __name__ == "__main__":
    d = open(sys.argv[1], "rb").read()
    base = int(sys.argv[2], 0); st = int(sys.argv[3], 0) if len(sys.argv) > 3 else 0
    ln = int(sys.argv[4], 0) if len(sys.argv) > 4 else None
    print("\n".join(dis(d, base, st, ln)))
