"""Create a minimal stored RAR4 fixture without proprietary creation tools."""
from pathlib import Path
import struct
import sys
import zlib

name = '路径 with spaces/payload.txt'.encode()
data = b'packaged archive extraction\n'

def block(kind, flags, payload):
    body = struct.pack('<BHH', kind, flags, 7 + len(payload)) + payload
    return struct.pack('<H', zlib.crc32(body) & 0xffff) + body

main = block(0x73, 0, b'\0' * 6)
file = block(0x74, 0x8000, struct.pack('<IIBIIBBHI', len(data), len(data), 3,
    zlib.crc32(data), 0, 20, 0x30, len(name), 0o100644) + name)
Path(sys.argv[1]).write_bytes(b'Rar!\x1a\x07\x00' + main + file + data + block(0x7b, 0, b''))
