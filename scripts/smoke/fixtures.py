"""Create stored Unix RAR4 fixtures with executable and restricted modes."""
from pathlib import Path
import struct
import sys
import zlib


def block(kind, flags, payload):
    body = struct.pack('<BHH', kind, flags, 7 + len(payload)) + payload
    return struct.pack('<H', zlib.crc32(body) & 0xffff) + body


def entry(name, data, mode, directory=False):
    name = name.encode()
    return block(0x74, 0x80e0 if directory else 0x8000,
                 struct.pack('<IIBIIBBHI', len(data), len(data), 3,
                             zlib.crc32(data), 0, 20, 0x30, len(name), mode) + name) + data


root = '路径 with spaces'
archive = b'Rar!\x1a\x07\x00' + block(0x73, 0, b'\0' * 6)
archive += entry(root, b'', 0o040750, True)
archive += entry(root + '/payload.txt', b'packaged archive extraction\n', 0o100640)
archive += entry(root + '/run.sh', b'#!/bin/sh\nexit 0\n', 0o100751)
archive += entry(root + '/restricted', b'', 0o040750, True)
archive += entry(root + '/restricted/private.txt', b'private fixture\n', 0o100640)
Path(sys.argv[1]).write_bytes(archive + block(0x7b, 0, b''))
