"""Dedicated Metadata Manager for OriginClean.

Supports inspecting, comparing, selectively removing, preserving, and editing metadata
across Image, Document/Container, Audio, and Video formats while protecting C2PA
and cryptographic provenance by default.
"""

from __future__ import annotations

import io
import re
import struct
import tempfile
import xml.etree.ElementTree as ET
import zipfile
import zlib
from pathlib import Path
from typing import Any

import backend  # noqa: F401 — ensures service/scripts is on sys.path
from av_meta import clean_av, detect_av_format, inspect_av
from container_meta import clean_container, detect_container_format, inspect_container
from format_dispatch import classify_bytes
from image_meta import (
    C2PA_MARKERS,
    JPEG_SOI,
    PNG_SIG,
    WEBP_RIFF,
    WEBP_SIG,
    _build_isobmff_box,
    _parse_isobmff_boxes,
    _png_chunk,
    clean_image,
    detect_format as detect_image_format,
    inspect_image,
)


class ProvenanceAuthorizationError(PermissionError):
    """Raised when attempting to remove or alter C2PA/authenticity provenance without explicit authorization."""


def _safe_ascii(b: bytes, max_len: int = 240) -> str:
    text = b.decode("utf-8", errors="replace").replace("\x00", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return text[:max_len]


def _extract_xmp_tags(xmp_bytes: bytes) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    text = xmp_bytes.decode("utf-8", errors="replace")
    tag_patterns = [
        ("xmp:CreatorTool", r"<xmp:CreatorTool[^>]*>(.*?)</xmp:CreatorTool>|xmp:CreatorTool=\"([^\"]+)\""),
        ("xmp:CreateDate", r"<xmp:CreateDate[^>]*>(.*?)</xmp:CreateDate>|xmp:CreateDate=\"([^\"]+)\""),
        ("xmp:ModifyDate", r"<xmp:ModifyDate[^>]*>(.*?)</xmp:ModifyDate>|xmp:ModifyDate=\"([^\"]+)\""),
        ("photoshop:Credit", r"<photoshop:Credit[^>]*>(.*?)</photoshop:Credit>|photoshop:Credit=\"([^\"]+)\""),
        ("dc:format", r"<dc:format[^>]*>(.*?)</dc:format>|dc:format=\"([^\"]+)\""),
        (
            "DigitalSourceType",
            r"digitalSourceType[=\">]+([^<\"\s]+)",
        ),
        ("dcterms:provenance", r"<dcterms:provenance[^>]*>(.*?)</dcterms:provenance>|dcterms:provenance=\"([^\"]+)\""),
    ]
    for label, pat in tag_patterns:
        m = re.search(pat, text, flags=re.IGNORECASE | re.DOTALL)
        if m:
            val = next((g for g in m.groups() if g), "").strip()
            if val:
                is_prov = "c2pa" in val.lower() or label == "dcterms:provenance"
                fields.append(
                    {
                        "key": f"xmp.{label}",
                        "label": label,
                        "category": "Provenance" if is_prov else "XMP",
                        "value": val[:240],
                        "removable": True,
                        "editable": False,
                        "is_provenance": is_prov,
                    }
                )
    if not fields and b"xmpmeta" in xmp_bytes.lower():
        fields.append(
            {
                "key": "xmp.packet",
                "label": "XMP Packet",
                "category": "XMP",
                "value": f"Embedded XMP metadata ({len(xmp_bytes)} bytes)",
                "removable": True,
                "editable": False,
                "is_provenance": any(m in xmp_bytes for m in C2PA_MARKERS),
            }
        )
    return fields


def _extract_exif_tiff_tags(tiff_bytes: bytes) -> list[dict[str, Any]]:
    """Parse classic TIFF header + IFD0 tags (Make, Model, Software, Artist, Copyright, DateTime, EXIF, GPS)."""
    fields: list[dict[str, Any]] = []
    if len(tiff_bytes) < 8:
        return fields
    endian = "<" if tiff_bytes[:2] == b"II" else (">" if tiff_bytes[:2] == b"MM" else "")
    if not endian:
        return fields
    try:
        magic, ifd_offset = struct.unpack(f"{endian}HI", tiff_bytes[2:8])
        if magic != 42 or ifd_offset + 2 > len(tiff_bytes):
            return fields
        num_entries = struct.unpack(f"{endian}H", tiff_bytes[ifd_offset : ifd_offset + 2])[0]
        tag_map = {
            0x010E: ("ImageDescription", "EXIF"),
            0x010F: ("CameraMake", "Camera"),
            0x0110: ("CameraModel", "Camera"),
            0x0112: ("Orientation", "Image Properties"),
            0x0131: ("Software", "EXIF"),
            0x0132: ("DateTime", "EXIF"),
            0x013B: ("Artist", "EXIF"),
            0x8298: ("Copyright", "EXIF"),
            0x8769: ("ExifIFDPointer", "EXIF"),
            0x8825: ("GPSInfoIFDPointer", "GPS"),
            0x02BC: ("XMPPacket", "XMP"),
            0x83BB: ("IPTCNAA", "IPTC"),
        }
        pos = ifd_offset + 2
        for _ in range(min(num_entries, 128)):
            if pos + 12 > len(tiff_bytes):
                break
            tag, ftype, count, val_off = struct.unpack(f"{endian}HHII", tiff_bytes[pos : pos + 12])
            pos += 12
            if tag not in tag_map:
                continue
            name, cat = tag_map[tag]
            if tag == 0x8825:
                fields.append(
                    {
                        "key": "gps.ifd",
                        "label": "GPS Coordinates / IFD",
                        "category": "GPS",
                        "value": f"Present (offset 0x{val_off:x})",
                        "removable": True,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif tag == 0x8769:
                fields.append(
                    {
                        "key": "exif.subifd",
                        "label": "EXIF SubIFD",
                        "category": "EXIF",
                        "value": f"Present (offset 0x{val_off:x})",
                        "removable": True,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif ftype == 2 and count > 0:  # ASCII
                if count <= 4:
                    raw_bytes = tiff_bytes[pos - 4 : pos - 4 + count]
                elif val_off + count <= len(tiff_bytes):
                    raw_bytes = tiff_bytes[val_off : val_off + count]
                else:
                    continue
                val_str = _safe_ascii(raw_bytes)
                if val_str:
                    fields.append(
                        {
                            "key": f"exif.{name}",
                            "label": name,
                            "category": cat,
                            "value": val_str,
                            "removable": True,
                            "editable": False,
                            "is_provenance": False,
                        }
                    )
            elif ftype in (3, 4):  # SHORT or LONG
                fields.append(
                    {
                        "key": f"exif.{name}",
                        "label": name,
                        "category": cat,
                        "value": str(val_off),
                        "removable": True,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
    except struct.error:
        pass
    return fields


def _inspect_image_metadata_fields(data: bytes, fmt: str) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    if fmt == "png" and data.startswith(PNG_SIG):
        pos = 8
        while pos + 8 <= len(data):
            length = struct.unpack(">I", data[pos : pos + 4])[0]
            ctype = data[pos + 4 : pos + 8]
            chunk_end = pos + 8 + length
            if chunk_end + 4 > len(data):
                break
            payload = data[pos + 8 : chunk_end]
            pos = chunk_end + 4
            cname = ctype.decode("latin-1", errors="replace")
            if ctype == b"IHDR" and len(payload) >= 13:
                w, h, bit_depth, color_type = struct.unpack(">IIBB", payload[:10])
                fields.append(
                    {
                        "key": "prop.dimensions",
                        "label": "Dimensions",
                        "category": "Image Properties",
                        "value": f"{w} x {h} px ({bit_depth}-bit, colorType={color_type})",
                        "removable": False,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif ctype == b"eXIf":
                exif_items = _extract_exif_tiff_tags(payload)
                if exif_items:
                    fields.extend(exif_items)
                else:
                    fields.append(
                        {
                            "key": "exif.chunk",
                            "label": "PNG eXIf Chunk",
                            "category": "EXIF",
                            "value": f"{len(payload)} bytes",
                            "removable": True,
                            "editable": False,
                            "is_provenance": False,
                        }
                    )
            elif ctype in (b"caBX", b"c2pa") or cname.lower().startswith("c2"):
                fields.append(
                    {
                        "key": f"c2pa.{cname}",
                        "label": f"C2PA Manifest Chunk ({cname})",
                        "category": "Provenance (C2PA)",
                        "value": f"Cryptographic Content Credentials ({len(payload)} bytes)",
                        "removable": True,
                        "editable": False,
                        "is_provenance": True,
                    }
                )
            elif ctype in (b"tEXt", b"iTXt", b"zTXt"):
                nul = payload.find(b"\x00")
                k_name = _safe_ascii(payload[:nul]) if nul != -1 else cname
                raw_val = payload[nul + 1 :] if nul != -1 else payload
                if ctype == b"zTXt" and len(raw_val) > 1:
                    try:
                        raw_val = zlib.decompress(raw_val[1:])
                    except zlib.error:
                        pass
                if b"XML:com.adobe.xmp" in payload:
                    fields.extend(_extract_xmp_tags(raw_val))
                else:
                    val_str = _safe_ascii(raw_val)
                    is_prov = any(m in payload for m in C2PA_MARKERS)
                    fields.append(
                        {
                            "key": f"png.text.{k_name}",
                            "label": f"PNG {cname}: {k_name}",
                            "category": "Provenance (C2PA)" if is_prov else "EXIF / Text Chunks",
                            "value": val_str,
                            "removable": True,
                            "editable": not is_prov,
                            "is_provenance": is_prov,
                        }
                    )
            if ctype == b"IEND":
                break

    elif fmt == "jpeg" and data.startswith(JPEG_SOI):
        i = 2
        n = len(data)
        while i + 4 <= n:
            if data[i] != 0xFF:
                break
            while i < n and data[i] == 0xFF:
                i += 1
            if i >= n:
                break
            marker = data[i]
            i += 1
            if marker in (0xD9, 0xDA):
                break
            if 0xD0 <= marker <= 0xD8:
                continue
            if i + 2 > n:
                break
            seglen = struct.unpack(">H", data[i : i + 2])[0]
            if seglen < 2 or i + seglen > n:
                break
            payload = data[i + 2 : i + seglen]
            i += seglen
            if marker in (0xC0, 0xC1, 0xC2) and len(payload) >= 6:
                prec, h, w, comps = struct.unpack(">BHHB", payload[:6])
                fields.append(
                    {
                        "key": "prop.dimensions",
                        "label": "Dimensions",
                        "category": "Image Properties",
                        "value": f"{w} x {h} px ({prec}-bit, {comps} components)",
                        "removable": False,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif marker == 0xE1:  # APP1 EXIF or XMP
                if payload.startswith(b"Exif\x00\x00"):
                    exif_items = _extract_exif_tiff_tags(payload[6:])
                    if exif_items:
                        fields.extend(exif_items)
                    else:
                        fields.append(
                            {
                                "key": "exif.app1",
                                "label": "JPEG APP1 EXIF",
                                "category": "EXIF",
                                "value": f"{len(payload)} bytes",
                                "removable": True,
                                "editable": False,
                                "is_provenance": False,
                            }
                        )
                elif b"ns.adobe.com/xap" in payload or b"xmpmeta" in payload:
                    fields.extend(_extract_xmp_tags(payload))
            elif marker == 0xEB or any(m in payload for m in (b"c2pa", b"jumb", b"JUMB")):
                fields.append(
                    {
                        "key": "c2pa.app11",
                        "label": "JPEG APP11 (JUMBF / C2PA)",
                        "category": "Provenance (C2PA)",
                        "value": f"C2PA Content Credentials ({len(payload)} bytes)",
                        "removable": True,
                        "editable": False,
                        "is_provenance": True,
                    }
                )
            elif marker == 0xED:  # APP13 IPTC
                fields.append(
                    {
                        "key": "iptc.app13",
                        "label": "JPEG APP13 (IPTC / Photoshop)",
                        "category": "IPTC",
                        "value": _safe_ascii(payload, 140) or f"{len(payload)} bytes",
                        "removable": True,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif marker == 0xFE:  # COM
                fields.append(
                    {
                        "key": "jpeg.comment",
                        "label": "JPEG Comment (COM)",
                        "category": "EXIF",
                        "value": _safe_ascii(payload),
                        "removable": True,
                        "editable": True,
                        "is_provenance": False,
                    }
                )

    elif fmt == "webp" and len(data) >= 12 and data[:4] == WEBP_RIFF and data[8:12] == WEBP_SIG:
        pos = 12
        while pos + 8 <= len(data):
            fourcc = data[pos : pos + 4]
            sz = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
            payload = data[pos + 8 : pos + 8 + sz]
            pos += 8 + sz + (sz & 1)
            cname = fourcc.decode("latin-1", errors="replace").strip()
            if fourcc == b"VP8X" and len(payload) >= 10:
                w = 1 + int.from_bytes(payload[4:7], "little")
                h = 1 + int.from_bytes(payload[7:10], "little")
                fields.append(
                    {
                        "key": "prop.dimensions",
                        "label": "Dimensions",
                        "category": "Image Properties",
                        "value": f"{w} x {h} px",
                        "removable": False,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif fourcc == b"EXIF":
                tiff_start = payload[6:] if payload.startswith(b"Exif\x00\x00") else payload
                exif_items = _extract_exif_tiff_tags(tiff_start)
                fields.extend(
                    exif_items
                    or [
                        {
                            "key": "webp.exif",
                            "label": "WebP EXIF Chunk",
                            "category": "EXIF",
                            "value": f"{len(payload)} bytes",
                            "removable": True,
                            "editable": False,
                            "is_provenance": False,
                        }
                    ]
                )
            elif fourcc == b"XMP ":
                fields.extend(_extract_xmp_tags(payload))
            elif fourcc.upper() == b"C2PA":
                fields.append(
                    {
                        "key": "c2pa.webp",
                        "label": "WebP C2PA Chunk",
                        "category": "Provenance (C2PA)",
                        "value": f"C2PA Manifest ({len(payload)} bytes)",
                        "removable": True,
                        "editable": False,
                        "is_provenance": True,
                    }
                )
            elif fourcc == b"ICCP":
                fields.append(
                    {
                        "key": "webp.iccp",
                        "label": "ICC Color Profile",
                        "category": "Image Properties",
                        "value": f"{len(payload)} bytes",
                        "removable": True,
                        "editable": False,
                        "is_provenance": False,
                    }
                )

    elif fmt in ("avif", "heic"):
        boxes, _ = _parse_isobmff_boxes(data)
        for fourcc, payload, _sz, _hdr in boxes:
            bname = fourcc.decode("latin-1", errors="replace")
            if fourcc == b"ftyp" and len(payload) >= 4:
                brand = payload[:4].decode("latin-1", errors="replace")
                fields.append(
                    {
                        "key": "prop.brand",
                        "label": "ISOBMFF Major Brand",
                        "category": "Image Properties",
                        "value": brand,
                        "removable": False,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif fourcc in (b"jumb", b"c2pa") or bname.lower().startswith("c2"):
                fields.append(
                    {
                        "key": f"c2pa.{bname}",
                        "label": f"ISOBMFF {bname} Box (C2PA)",
                        "category": "Provenance (C2PA)",
                        "value": f"C2PA JUMBF Box ({len(payload)} bytes)",
                        "removable": True,
                        "editable": False,
                        "is_provenance": True,
                    }
                )
            elif fourcc == b"uuid":
                is_c2pa = b"c2pa" in payload.lower() or b"jumb" in payload.lower()
                fields.append(
                    {
                        "key": "isobmff.uuid",
                        "label": "UUID Metadata Box",
                        "category": "Provenance (C2PA)" if is_c2pa else "XMP",
                        "value": _safe_ascii(payload[16:], 160) or f"{len(payload)} bytes",
                        "removable": True,
                        "editable": False,
                        "is_provenance": is_c2pa,
                    }
                )

    elif fmt == "tiff":
        fields.extend(_extract_exif_tiff_tags(data))

    elif fmt == "bmp" and len(data) >= 26:
        w, h = struct.unpack("<ii", data[18:26])
        fields.append(
            {
                "key": "prop.dimensions",
                "label": "Dimensions",
                "category": "Image Properties",
                "value": f"{w} x {abs(h)} px",
                "removable": False,
                "editable": False,
                "is_provenance": False,
            }
        )

    elif fmt == "gif" and len(data) >= 10:
        w, h = struct.unpack("<HH", data[6:10])
        fields.append(
            {
                "key": "prop.dimensions",
                "label": "Dimensions",
                "category": "Image Properties",
                "value": f"{w} x {h} px ({data[:6].decode('ascii', errors='replace')})",
                "removable": False,
                "editable": False,
                "is_provenance": False,
            }
        )
    return fields


def _inspect_document_metadata_fields(data: bytes, fmt: str) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    if fmt == "pdf":
        m_ver = re.match(rb"%PDF-(\d+\.\d+)", data[:16])
        if m_ver:
            fields.append(
                {
                    "key": "pdf.version",
                    "label": "PDF Specification",
                    "category": "Document Properties",
                    "value": f"PDF {m_ver.group(1).decode('ascii')}",
                    "removable": False,
                    "editable": False,
                    "is_provenance": False,
                }
            )
        for key_bytes in (
            b"Title",
            b"Author",
            b"Subject",
            b"Keywords",
            b"Creator",
            b"Producer",
            b"CreationDate",
            b"ModDate",
        ):
            pat = rb"/" + key_bytes + rb"\s*\(([^)\\]*(?:\\.[^)\\]*)*)\)"
            m = re.search(pat, data)
            if m:
                val = _safe_ascii(m.group(1))
                key_str = key_bytes.decode("ascii")
                fields.append(
                    {
                        "key": f"pdf.{key_str}",
                        "label": f"PDF /{key_str}",
                        "category": "PDF Metadata",
                        "value": val,
                        "removable": True,
                        "editable": key_str in ("Title", "Author", "Subject", "Keywords", "Creator", "Producer"),
                        "is_provenance": False,
                    }
                )
        if b"<x:xmpmeta" in data or b"<?xpacket" in data:
            fields.extend(_extract_xmp_tags(data))
        if any(m in data for m in (b"/C2PA", b"c2pa.assertions", b"contentcredentials")):
            fields.append(
                {
                    "key": "c2pa.pdf",
                    "label": "PDF C2PA Content Credentials",
                    "category": "Provenance (C2PA)",
                    "value": "Embedded C2PA manifest detected",
                    "removable": True,
                    "editable": False,
                    "is_provenance": True,
                }
            )

    elif fmt in ("docx", "xlsx", "pptx"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
                if "docProps/core.xml" in names:
                    root = ET.fromstring(zf.read("docProps/core.xml"))
                    for elem in root:
                        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                        val = (elem.text or "").strip()
                        if val:
                            fields.append(
                                {
                                    "key": f"ooxml.core.{tag}",
                                    "label": f"Core: {tag}",
                                    "category": f"{fmt.upper()} Properties",
                                    "value": val,
                                    "removable": True,
                                    "editable": tag
                                    in ("title", "creator", "subject", "description", "keywords", "lastModifiedBy"),
                                    "is_provenance": False,
                                }
                            )
                if "docProps/app.xml" in names:
                    root = ET.fromstring(zf.read("docProps/app.xml"))
                    for elem in root:
                        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                        val = (elem.text or "").strip()
                        if val and tag in ("Application", "Company", "AppVersion", "TotalTime", "Template"):
                            fields.append(
                                {
                                    "key": f"ooxml.app.{tag}",
                                    "label": f"App: {tag}",
                                    "category": f"{fmt.upper()} Properties",
                                    "value": val,
                                    "removable": True,
                                    "editable": tag in ("Application", "Company"),
                                    "is_provenance": False,
                                }
                            )
                for n in names:
                    if "c2pa" in n.lower() or n.endswith(".jumbf"):
                        fields.append(
                            {
                                "key": f"c2pa.{n}",
                                "label": f"C2PA Package Part ({n})",
                                "category": "Provenance (C2PA)",
                                "value": "Embedded C2PA manifest part",
                                "removable": True,
                                "editable": False,
                                "is_provenance": True,
                            }
                        )
        except Exception:
            pass

    elif fmt == "odt":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                if "meta.xml" in zf.namelist():
                    root = ET.fromstring(zf.read("meta.xml"))
                    for elem in root.iter():
                        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                        val = (elem.text or "").strip()
                        if val and tag in (
                            "title",
                            "creator",
                            "initial-creator",
                            "subject",
                            "description",
                            "generator",
                            "creation-date",
                            "date",
                        ):
                            fields.append(
                                {
                                    "key": f"odt.{tag}",
                                    "label": f"ODT: {tag}",
                                    "category": "ODT Properties",
                                    "value": val,
                                    "removable": True,
                                    "editable": tag in ("title", "creator", "subject", "description", "generator"),
                                    "is_provenance": False,
                                }
                            )
        except Exception:
            pass

    elif fmt == "epub":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                for name in zf.namelist():
                    if name.endswith(".opf"):
                        root = ET.fromstring(zf.read(name))
                        for elem in root.iter():
                            tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                            val = (elem.text or "").strip()
                            if val and tag in ("title", "creator", "publisher", "language", "identifier", "description"):
                                fields.append(
                                    {
                                        "key": f"epub.{tag}",
                                        "label": f"EPUB: {tag}",
                                        "category": "EPUB Metadata",
                                        "value": val,
                                        "removable": tag not in ("title", "language", "identifier"),
                                        "editable": tag in ("title", "creator", "publisher", "description"),
                                        "is_provenance": False,
                                    }
                                )
        except Exception:
            pass

    elif fmt == "html":
        text = data.decode("utf-8", errors="replace")
        m_title = re.search(r"<title[^>]*>(.*?)</title>", text, flags=re.IGNORECASE | re.DOTALL)
        if m_title:
            fields.append(
                {
                    "key": "html.title",
                    "label": "HTML <title>",
                    "category": "HTML Metadata",
                    "value": m_title.group(1).strip(),
                    "removable": False,
                    "editable": True,
                    "is_provenance": False,
                }
            )
        for m in re.finditer(
            r"<meta\s+[^>]*?(?:name|property)=[\"']([^\"']+)[\"'][^>]*?content=[\"']([^\"']*)[\"'][^>]*>",
            text,
            flags=re.IGNORECASE,
        ):
            m_name, m_val = m.group(1).strip(), m.group(2).strip()
            fields.append(
                {
                    "key": f"html.meta.{m_name}",
                    "label": f"Meta: {m_name}",
                    "category": "HTML Metadata",
                    "value": m_val,
                    "removable": True,
                    "editable": m_name.lower() in ("author", "description", "keywords", "generator"),
                    "is_provenance": "c2pa" in m_name.lower(),
                }
            )

    elif fmt == "markdown":
        text = data.decode("utf-8", errors="replace")
        m_fm = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, flags=re.DOTALL)
        if m_fm:
            for line in m_fm.group(1).splitlines():
                if ":" in line and not line.startswith(" "):
                    k, v = line.split(":", 1)
                    k_clean = k.strip()
                    v_clean = v.strip().strip("\"'")
                    if k_clean:
                        fields.append(
                            {
                                "key": f"md.{k_clean}",
                                "label": f"Frontmatter: {k_clean}",
                                "category": "Markdown Frontmatter",
                                "value": v_clean,
                                "removable": True,
                                "editable": True,
                                "is_provenance": False,
                            }
                        )

    elif fmt == "svg":
        text = data.decode("utf-8", errors="replace")
        for tag in ("title", "desc"):
            m_tag = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", text, flags=re.IGNORECASE | re.DOTALL)
            if m_tag and m_tag.group(1).strip():
                fields.append(
                    {
                        "key": f"svg.{tag}",
                        "label": f"SVG <{tag}>",
                        "category": "SVG Metadata",
                        "value": m_tag.group(1).strip(),
                        "removable": True,
                        "editable": True,
                        "is_provenance": False,
                    }
                )
        if "<metadata" in text.lower():
            fields.append(
                {
                    "key": "svg.metadata",
                    "label": "SVG <metadata> Element",
                    "category": "SVG Metadata",
                    "value": "Embedded XML/RDF metadata block",
                    "removable": True,
                    "editable": False,
                    "is_provenance": "c2pa" in text.lower(),
                }
            )
    return fields


def _inspect_av_metadata_fields(data: bytes, fmt: str, ext: str) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    if fmt == "wav" and len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        pos = 12
        while pos + 8 <= len(data):
            cid = data[pos : pos + 4]
            csz = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
            payload = data[pos + 8 : pos + 8 + csz]
            pos += 8 + csz + (csz & 1)
            cname = cid.decode("latin-1", errors="replace")
            if cid == b"fmt " and len(payload) >= 16:
                _afmt, chans, srate, _brate, _align, bps = struct.unpack("<HHIIHH", payload[:16])
                fields.append(
                    {
                        "key": "wav.format",
                        "label": "WAV Audio Stream",
                        "category": "Audio Properties",
                        "value": f"{srate} Hz, {chans} ch, {bps}-bit",
                        "removable": False,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif cid == b"LIST" and payload[:4] == b"INFO":
                sub = 4
                info_names = {
                    b"INAM": "Title",
                    b"IART": "Artist",
                    b"IPRD": "Product / Album",
                    b"ICRD": "Creation Date",
                    b"ISFT": "Software",
                    b"ICMT": "Comment",
                    b"ICOP": "Copyright",
                }
                while sub + 8 <= len(payload):
                    scid = payload[sub : sub + 4]
                    scsz = struct.unpack("<I", payload[sub + 4 : sub + 8])[0]
                    spay = payload[sub + 8 : sub + 8 + scsz]
                    sub += 8 + scsz + (scsz & 1)
                    scname = scid.decode("latin-1", errors="replace")
                    label = info_names.get(scid, f"INFO {scname}")
                    fields.append(
                        {
                            "key": f"wav.info.{scname}",
                            "label": f"WAV {label} ({scname})",
                            "category": "WAV Metadata",
                            "value": _safe_ascii(spay),
                            "removable": True,
                            "editable": scid in info_names,
                            "is_provenance": False,
                        }
                    )
            elif cid.lower() == b"c2pa" or b"c2pa" in payload.lower():
                fields.append(
                    {
                        "key": f"c2pa.wav.{cname}",
                        "label": f"WAV C2PA Chunk ({cname})",
                        "category": "Provenance (C2PA)",
                        "value": f"C2PA Manifest ({len(payload)} bytes)",
                        "removable": True,
                        "editable": False,
                        "is_provenance": True,
                    }
                )

    elif fmt == "mp3" and data[:3] == b"ID3" and len(data) >= 10:
        ver_major = data[3]
        tag_size = (
            ((data[6] & 0x7F) << 21)
            | ((data[7] & 0x7F) << 14)
            | ((data[8] & 0x7F) << 7)
            | (data[9] & 0x7F)
        )
        pos = 10
        end = min(len(data), 10 + tag_size)
        id3_labels = {
            "TIT2": "Title",
            "TPE1": "Artist",
            "TALB": "Album",
            "TCON": "Genre",
            "TYER": "Year",
            "TDRC": "Recording Time",
            "TENC": "Encoded By",
            "TSSE": "Software / Encoder",
            "COMM": "Comment",
            "TXXX": "User Text (TXXX)",
            "PRIV": "Private Frame (PRIV)",
            "GEOB": "General Object (GEOB)",
        }
        while pos + 10 <= end and ver_major in (3, 4):
            fid = data[pos : pos + 4]
            if fid == b"\x00\x00\x00\x00":
                break
            f_str = fid.decode("latin-1", errors="replace")
            if ver_major == 4:
                fsz = (
                    ((data[pos + 4] & 0x7F) << 21)
                    | ((data[pos + 5] & 0x7F) << 14)
                    | ((data[pos + 6] & 0x7F) << 7)
                    | (data[pos + 7] & 0x7F)
                )
            else:
                fsz = struct.unpack(">I", data[pos + 4 : pos + 8])[0]
            if fsz <= 0 or pos + 10 + fsz > end:
                break
            fpay = data[pos + 10 : pos + 10 + fsz]
            pos += 10 + fsz
            is_prov = b"c2pa" in fpay.lower()
            fields.append(
                {
                    "key": f"id3.{f_str}",
                    "label": f"ID3v2.{ver_major} {id3_labels.get(f_str, f_str)}",
                    "category": "Provenance (C2PA)" if is_prov else "ID3 Audio Metadata",
                    "value": _safe_ascii(fpay[1:] if f_str.startswith("T") else fpay),
                    "removable": True,
                    "editable": f_str in ("TIT2", "TPE1", "TALB", "TENC", "TSSE"),
                    "is_provenance": is_prov,
                }
            )

    elif fmt == "flac":
        pos = 4 if data[:4] == b"fLaC" else 0
        while pos >= 4 and pos + 4 <= len(data):
            hdr = data[pos]
            is_last = bool(hdr & 0x80)
            btype = hdr & 0x7F
            bsz = int.from_bytes(data[pos + 1 : pos + 4], "big")
            bpay = data[pos + 4 : pos + 4 + bsz]
            pos += 4 + bsz
            if btype == 0 and len(bpay) >= 18:  # STREAMINFO
                sr = (bpay[10] << 12) | (bpay[11] << 4) | (bpay[12] >> 4)
                ch = ((bpay[12] >> 1) & 0x07) + 1
                bps = (((bpay[12] & 0x01) << 4) | (bpay[13] >> 4)) + 1
                fields.append(
                    {
                        "key": "flac.streaminfo",
                        "label": "FLAC StreamInfo",
                        "category": "Audio Properties",
                        "value": f"{sr} Hz, {ch} ch, {bps}-bit",
                        "removable": False,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif btype == 4 and len(bpay) >= 8:  # VORBIS_COMMENT
                vlen = struct.unpack("<I", bpay[:4])[0]
                p = 4 + vlen
                if p + 4 <= len(bpay):
                    ccount = struct.unpack("<I", bpay[p : p + 4])[0]
                    p += 4
                    for _ in range(min(ccount, 64)):
                        if p + 4 > len(bpay):
                            break
                        clen = struct.unpack("<I", bpay[p : p + 4])[0]
                        p += 4
                        cstr = bpay[p : p + clen].decode("utf-8", errors="replace")
                        p += clen
                        if "=" in cstr:
                            k, v = cstr.split("=", 1)
                            fields.append(
                                {
                                    "key": f"flac.vorbis.{k.upper()}",
                                    "label": f"Vorbis: {k.upper()}",
                                    "category": "FLAC Metadata",
                                    "value": v,
                                    "removable": True,
                                    "editable": True,
                                    "is_provenance": "c2pa" in cstr.lower(),
                                }
                            )
            elif btype == 2:  # APPLICATION
                app_id = _safe_ascii(bpay[:4])
                is_prov = b"c2pa" in bpay.lower()
                fields.append(
                    {
                        "key": f"flac.app.{app_id}",
                        "label": f"FLAC Application Block ({app_id})",
                        "category": "Provenance (C2PA)" if is_prov else "FLAC Metadata",
                        "value": f"{len(bpay)} bytes",
                        "removable": True,
                        "editable": False,
                        "is_provenance": is_prov,
                    }
                )
            if is_last:
                break

    elif fmt == "mp4":
        is_audio = ext.lower() == ".m4a"
        cat_label = "M4A Audio Metadata" if is_audio else "MP4 / MOV Video Metadata"
        boxes, _ = _parse_isobmff_boxes(data)
        for fourcc, payload, _sz, _hdr in boxes:
            bname = fourcc.decode("latin-1", errors="replace")
            if fourcc == b"ftyp" and len(payload) >= 4:
                brand = payload[:4].decode("latin-1", errors="replace")
                fields.append(
                    {
                        "key": "mp4.brand",
                        "label": "Container Brand (ftyp)",
                        "category": "Container Properties",
                        "value": brand,
                        "removable": False,
                        "editable": False,
                        "is_provenance": False,
                    }
                )
            elif fourcc == b"moov":
                sub_boxes, _ = _parse_isobmff_boxes(payload)
                for s_fourcc, s_payload, _ssz, _shdr in sub_boxes:
                    if s_fourcc == b"udta":
                        fields.append(
                            {
                                "key": "mp4.moov.udta",
                                "label": "QuickTime / MP4 User Data (moov/udta)",
                                "category": cat_label,
                                "value": _safe_ascii(s_payload, 180) or f"{len(s_payload)} bytes",
                                "removable": True,
                                "editable": False,
                                "is_provenance": b"c2pa" in s_payload.lower(),
                            }
                        )
            elif fourcc in (b"jumb", b"c2pa") or bname.lower().startswith("c2"):
                fields.append(
                    {
                        "key": f"c2pa.{bname}",
                        "label": f"MP4 C2PA Manifest ({bname})",
                        "category": "Provenance (C2PA)",
                        "value": f"C2PA JUMBF Box ({len(payload)} bytes)",
                        "removable": True,
                        "editable": False,
                        "is_provenance": True,
                    }
                )
            elif fourcc == b"uuid":
                is_c2pa = b"c2pa" in payload.lower() or b"jumb" in payload.lower()
                fields.append(
                    {
                        "key": "mp4.uuid",
                        "label": "UUID Metadata Box",
                        "category": "Provenance (C2PA)" if is_c2pa else cat_label,
                        "value": _safe_ascii(payload[16:], 160) or f"{len(payload)} bytes",
                        "removable": True,
                        "editable": False,
                        "is_provenance": is_c2pa,
                    }
                )
    return fields


def inspect_metadata_bytes(data: bytes, filename: str) -> dict[str, Any]:
    """Inspect all structured metadata fields, provenance markers, and edit capabilities for a file."""
    ext = Path(filename).suffix.lower()
    kind = classify_bytes(data, ext)
    detected_format = "unknown"
    fields: list[dict[str, Any]] = []
    has_c2pa = False
    has_ai_metadata = False
    raw_findings: list[str] = []

    with tempfile.TemporaryDirectory(prefix="oc-meta-") as tmp:
        tmp_path = Path(tmp) / (Path(filename).name or "input")
        tmp_path.write_bytes(data)
        if kind == "image":
            rep = inspect_image(tmp_path, data=data, run_synthid=False)
            detected_format = rep.format
            has_c2pa = rep.has_c2pa
            has_ai_metadata = rep.has_ai_metadata
            raw_findings = rep.findings
            fields = _inspect_image_metadata_fields(data, detected_format)
        elif kind == "container":
            rep_c = inspect_container(tmp_path, data=data)
            detected_format = rep_c.format
            has_c2pa = rep_c.has_c2pa
            has_ai_metadata = rep_c.has_ai_metadata
            raw_findings = rep_c.findings
            fields = _inspect_document_metadata_fields(data, detected_format)
        elif kind == "av":
            rep_av = inspect_av(tmp_path, data=data)
            detected_format = rep_av.format
            has_c2pa = rep_av.has_c2pa
            has_ai_metadata = rep_av.has_ai_metadata
            raw_findings = rep_av.findings
            fields = _inspect_av_metadata_fields(data, detected_format, ext)
        elif kind == "text":
            detected_format = ext.lstrip(".") or "txt"
            fields = [
                {
                    "key": "text.encoding",
                    "label": "Character Encoding",
                    "category": "Text Properties",
                    "value": "UTF-8",
                    "removable": False,
                    "editable": False,
                    "is_provenance": False,
                }
            ]

    for idx, f in enumerate(raw_findings):
        is_c2pa_finding = "c2pa" in f.lower() or "jumbf" in f.lower() or "contentcredentials" in f.lower()
        fields.append(
            {
                "key": f"finding.{idx}",
                "label": f"Detected Signal #{idx + 1}",
                "category": "Provenance (C2PA)" if is_c2pa_finding else "AI & Provenance Signals",
                "value": f,
                "removable": True,
                "editable": False,
                "is_provenance": is_c2pa_finding,
            }
        )

    editable_formats = {
        "docx",
        "xlsx",
        "pptx",
        "odt",
        "epub",
        "html",
        "markdown",
        "svg",
        "png",
        "jpeg",
        "wav",
        "mp3",
        "flac",
        "pdf",
    }

    return {
        "ok": True,
        "filename": Path(filename).name,
        "kind": kind,
        "format": detected_format,
        "has_c2pa": has_c2pa,
        "has_ai_metadata": has_ai_metadata,
        "supports_editing": detected_format in editable_formats,
        "fields": fields,
        "categories": sorted({item["category"] for item in fields}),
    }


def _restore_c2pa_chunks(original: bytes, cleaned: bytes, fmt: str) -> tuple[bytes, list[str]]:
    """Re-inject original C2PA chunks/boxes when C2PA preservation is active."""
    restored_notes: list[str] = []
    if fmt == "png" and original.startswith(PNG_SIG) and cleaned.startswith(PNG_SIG):
        c2pa_chunks: list[bytes] = []
        pos = 8
        while pos + 8 <= len(original):
            length = struct.unpack(">I", original[pos : pos + 4])[0]
            ctype = original[pos + 4 : pos + 8]
            end = pos + 8 + length + 4
            if end > len(original):
                break
            cname = ctype.decode("latin-1", errors="replace")
            if ctype in (b"caBX", b"c2pa") or cname.lower().startswith("c2"):
                c2pa_chunks.append(original[pos:end])
                restored_notes.append(f"preserved PNG C2PA chunk ({cname})")
            pos = end
        if c2pa_chunks and cleaned.endswith(b"\x00\x00\x00\x00IEND\xaeB`\x82"):
            iend_pos = len(cleaned) - 12
            return cleaned[:iend_pos] + b"".join(c2pa_chunks) + cleaned[iend_pos:], restored_notes

    elif fmt == "jpeg" and original.startswith(JPEG_SOI) and cleaned.startswith(JPEG_SOI):
        c2pa_segs: list[bytes] = []
        i = 2
        n = len(original)
        while i + 4 <= n and original[i] == 0xFF:
            while i < n and original[i] == 0xFF:
                i += 1
            if i >= n:
                break
            marker = original[i]
            i += 1
            if marker in (0xD9, 0xDA):
                break
            if 0xD0 <= marker <= 0xD8:
                continue
            seglen = struct.unpack(">H", original[i : i + 2])[0]
            seg_bytes = bytes([0xFF, marker]) + original[i : i + seglen]
            payload = original[i + 2 : i + seglen]
            if marker == 0xEB or any(m in payload for m in (b"c2pa", b"jumb", b"JUMB")):
                c2pa_segs.append(seg_bytes)
                restored_notes.append("preserved JPEG APP11 C2PA/JUMBF segment")
            i += seglen
        if c2pa_segs:
            return cleaned[:2] + b"".join(c2pa_segs) + cleaned[2:], restored_notes

    elif fmt in ("avif", "heic", "mp4"):
        orig_boxes, _ = _parse_isobmff_boxes(original)
        c2pa_boxes: list[bytes] = []
        for fourcc, payload, _sz, hdr in orig_boxes:
            bname = fourcc.decode("latin-1", errors="replace")
            if (
                fourcc in (b"jumb", b"c2pa")
                or bname.lower().startswith("c2")
                or (fourcc == b"uuid" and (b"c2pa" in payload.lower() or b"jumb" in payload.lower()))
            ):
                c2pa_boxes.append(_build_isobmff_box(fourcc, payload, hdr))
                restored_notes.append(f"preserved ISOBMFF C2PA box ({bname})")
        if c2pa_boxes:
            return cleaned + b"".join(c2pa_boxes), restored_notes

    return cleaned, restored_notes


def edit_metadata_bytes(
    data: bytes,
    filename: str,
    updates: dict[str, str],
    *,
    preserve_c2pa: bool = True,
    allow_c2pa_removal: bool = False,
) -> tuple[bytes, list[str]]:
    """Edit supported metadata fields in-memory and return (updated_bytes, actions)."""
    before_meta = inspect_metadata_bytes(data, filename)
    if before_meta["has_c2pa"] and not preserve_c2pa and not allow_c2pa_removal:
        raise ProvenanceAuthorizationError(
            "File contains C2PA Content Credentials. Explicit authorization (allow_c2pa_removal=True) "
            "is required before modifying provenance-signed metadata."
        )

    fmt = before_meta["format"]
    actions: list[str] = []
    normalized = {k.split(".")[-1].lower(): str(v) for k, v in updates.items() if v is not None}
    if not normalized:
        return data, ["no metadata updates requested"]

    if fmt in ("docx", "xlsx", "pptx"):
        out_buf = io.BytesIO()
        ns_cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
        ns_dc = "http://purl.org/dc/elements/1.1/"
        ET.register_namespace("cp", ns_cp)
        ET.register_namespace("dc", ns_dc)
        with zipfile.ZipFile(io.BytesIO(data), "r") as zin, zipfile.ZipFile(
            out_buf, "w", zipfile.ZIP_DEFLATED
        ) as zout:
            has_core = "docProps/core.xml" in zin.namelist()
            for item in zin.infolist():
                raw = zin.read(item.filename)
                if item.filename == "docProps/core.xml":
                    root = ET.fromstring(raw)
                    tag_ns_map = {
                        "title": f"{{{ns_dc}}}title",
                        "creator": f"{{{ns_dc}}}creator",
                        "subject": f"{{{ns_dc}}}subject",
                        "description": f"{{{ns_dc}}}description",
                        "keywords": f"{{{ns_cp}}}keywords",
                        "lastmodifiedby": f"{{{ns_cp}}}lastModifiedBy",
                    }
                    for key_l, qname in tag_ns_map.items():
                        if key_l in normalized:
                            el = root.find(qname)
                            if el is None:
                                el = ET.SubElement(root, qname)
                            el.text = normalized[key_l]
                            actions.append(f"updated {fmt.upper()} core.{key_l}")
                    raw = ET.tostring(root, encoding="utf-8", xml_declaration=True)
                zout.writestr(item, raw)
            if not has_core:
                root = ET.Element(f"{{{ns_cp}}}coreProperties")
                for key_l, local_name in (
                    ("title", "title"),
                    ("creator", "creator"),
                    ("subject", "subject"),
                    ("description", "description"),
                ):
                    if key_l in normalized:
                        el = ET.SubElement(root, f"{{{ns_dc}}}{local_name}")
                        el.text = normalized[key_l]
                        actions.append(f"created {fmt.upper()} core.{local_name}")
                zout.writestr(
                    "docProps/core.xml",
                    ET.tostring(root, encoding="utf-8", xml_declaration=True),
                )
        return out_buf.getvalue(), actions

    if fmt == "odt":
        out_buf = io.BytesIO()
        ns_dc = "http://purl.org/dc/elements/1.1/"
        ns_meta = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0"
        ns_office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
        with zipfile.ZipFile(io.BytesIO(data), "r") as zin, zipfile.ZipFile(
            out_buf, "w", zipfile.ZIP_DEFLATED
        ) as zout:
            for item in zin.infolist():
                raw = zin.read(item.filename)
                if item.filename == "meta.xml":
                    root = ET.fromstring(raw)
                    meta_node = root.find(f"{{{ns_office}}}meta") or root
                    tag_map = {
                        "title": f"{{{ns_dc}}}title",
                        "creator": f"{{{ns_dc}}}creator",
                        "subject": f"{{{ns_dc}}}subject",
                        "description": f"{{{ns_dc}}}description",
                        "generator": f"{{{ns_meta}}}generator",
                    }
                    for key_l, qname in tag_map.items():
                        if key_l in normalized:
                            el = meta_node.find(qname)
                            if el is None:
                                el = ET.SubElement(meta_node, qname)
                            el.text = normalized[key_l]
                            actions.append(f"updated ODT meta.{key_l}")
                    raw = ET.tostring(root, encoding="utf-8", xml_declaration=True)
                zout.writestr(item, raw)
        return out_buf.getvalue(), actions

    if fmt == "epub":
        out_buf = io.BytesIO()
        ns_dc = "http://purl.org/dc/elements/1.1/"
        with zipfile.ZipFile(io.BytesIO(data), "r") as zin, zipfile.ZipFile(
            out_buf, "w", zipfile.ZIP_DEFLATED
        ) as zout:
            for item in zin.infolist():
                raw = zin.read(item.filename)
                if item.filename.endswith(".opf"):
                    root = ET.fromstring(raw)
                    meta_el = next(
                        (e for e in root.iter() if e.tag.endswith("metadata")),
                        root,
                    )
                    for key_l in ("title", "creator", "publisher", "description"):
                        if key_l in normalized:
                            qname = f"{{{ns_dc}}}{key_l}"
                            el = meta_el.find(qname)
                            if el is None:
                                el = ET.SubElement(meta_el, qname)
                            el.text = normalized[key_l]
                            actions.append(f"updated EPUB {key_l}")
                    raw = ET.tostring(root, encoding="utf-8", xml_declaration=True)
                zout.writestr(item, raw)
        return out_buf.getvalue(), actions

    if fmt == "png" and data.startswith(PNG_SIG):
        iend_pos = data.rfind(b"\x00\x00\x00\x00IEND")
        if iend_pos == -1:
            raise ValueError("malformed PNG (missing IEND)")
        new_chunks: list[bytes] = []
        for k, v in updates.items():
            clean_key = k.split(".")[-1][:79].encode("latin-1", errors="ignore") or b"Comment"
            clean_val = str(v).encode("utf-8")
            new_chunks.append(_png_chunk(b"tEXt", clean_key + b"\x00" + clean_val))
            actions.append(f"set PNG tEXt chunk {clean_key.decode('latin-1')}")
        return data[:iend_pos] + b"".join(new_chunks) + data[iend_pos:], actions

    if fmt == "jpeg" and data.startswith(JPEG_SOI):
        comment_val = normalized.get("comment") or normalized.get("description") or next(iter(normalized.values()))
        com_bytes = comment_val.encode("utf-8")[:65500]
        com_seg = b"\xff\xfe" + struct.pack(">H", len(com_bytes) + 2) + com_bytes
        actions.append("set JPEG COM comment segment")
        return data[:2] + com_seg + data[2:], actions

    if fmt == "html":
        text = data.decode("utf-8", errors="surrogateescape")
        if "title" in normalized:
            if re.search(r"<title[^>]*>.*?</title>", text, flags=re.I | re.S):
                text = re.sub(
                    r"(<title[^>]*>).*?(</title>)",
                    rf"\g<1>{normalized['title']}\g<2>",
                    text,
                    count=1,
                    flags=re.I | re.S,
                )
            actions.append("updated HTML <title>")
        for meta_key in ("author", "description", "keywords"):
            if meta_key in normalized:
                pat = rf"(<meta\s+[^>]*?name=[\"']{meta_key}[\"'][^>]*?content=[\"'])[^\"']*([\"'][^>]*>)"
                if re.search(pat, text, flags=re.I):
                    text = re.sub(pat, rf"\g<1>{normalized[meta_key]}\g<2>", text, count=1, flags=re.I)
                else:
                    tag = f'<meta name="{meta_key}" content="{normalized[meta_key]}">\n'
                    if "</head>" in text:
                        text = text.replace("</head>", f"  {tag}</head>", 1)
                    else:
                        text = tag + text
                actions.append(f"updated HTML meta {meta_key}")
        return text.encode("utf-8", errors="surrogateescape"), actions

    if fmt == "markdown":
        text = data.decode("utf-8", errors="surrogateescape")
        m_fm = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, flags=re.DOTALL)
        fm_dict: dict[str, str] = {}
        body = text
        if m_fm:
            body = text[m_fm.end() :]
            for line in m_fm.group(1).splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    fm_dict[k.strip()] = v.strip()
        for k, v in updates.items():
            clean_k = k.split(".")[-1]
            fm_dict[clean_k] = str(v)
            actions.append(f"set Markdown frontmatter {clean_k}")
        fm_lines = ["---"] + [f"{k}: {v}" for k, v in fm_dict.items()] + ["---\n"]
        return ("\n".join(fm_lines) + body).encode("utf-8", errors="surrogateescape"), actions

    if fmt == "svg":
        text = data.decode("utf-8", errors="surrogateescape")
        for tag in ("title", "desc"):
            if tag in normalized:
                if re.search(rf"<{tag}[^>]*>.*?</{tag}>", text, flags=re.I | re.S):
                    text = re.sub(
                        rf"(<{tag}[^>]*>).*?(</{tag}>)",
                        rf"\g<1>{normalized[tag]}\g<2>",
                        text,
                        count=1,
                        flags=re.I | re.S,
                    )
                else:
                    text = re.sub(
                        r"(<svg[^>]*>)",
                        rf"\g<1><{tag}>{normalized[tag]}</{tag}>",
                        text,
                        count=1,
                        flags=re.I,
                    )
                actions.append(f"updated SVG <{tag}>")
        return text.encode("utf-8", errors="surrogateescape"), actions

    if fmt == "wav" and len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        info_map = {
            "inam": b"INAM",
            "title": b"INAM",
            "iart": b"IART",
            "artist": b"IART",
            "icmt": b"ICMT",
            "comment": b"ICMT",
            "icop": b"ICOP",
            "copyright": b"ICOP",
            "isft": b"ISFT",
            "software": b"ISFT",
        }
        subchunks = bytearray(b"INFO")
        for k_l, val in normalized.items():
            if k_l in info_map:
                fourcc = info_map[k_l]
                val_b = val.encode("utf-8") + b"\x00"
                subchunks.extend(fourcc + struct.pack("<I", len(val_b)) + val_b)
                if len(val_b) & 1:
                    subchunks.append(0)
                actions.append(f"set WAV INFO {fourcc.decode('ascii')}")
        if len(subchunks) > 4:
            # Strip existing LIST/INFO and append updated LIST/INFO
            out = bytearray(b"RIFF\x00\x00\x00\x00WAVE")
            pos = 12
            while pos + 8 <= len(data):
                cid = data[pos : pos + 4]
                csz = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
                payload = data[pos + 8 : pos + 8 + csz]
                if not (cid == b"LIST" and payload[:4] == b"INFO"):
                    out.extend(cid + struct.pack("<I", csz) + payload + (b"\x00" if csz & 1 else b""))
                pos += 8 + csz + (csz & 1)
            list_chunk = b"LIST" + struct.pack("<I", len(subchunks)) + bytes(subchunks)
            if len(subchunks) & 1:
                list_chunk += b"\x00"
            out.extend(list_chunk)
            struct.pack_into("<I", out, 4, len(out) - 8)
            return bytes(out), actions

    if fmt == "mp3":
        frame_map = {
            "tit2": b"TIT2",
            "title": b"TIT2",
            "tpe1": b"TPE1",
            "artist": b"TPE1",
            "talb": b"TALB",
            "album": b"TALB",
            "tenc": b"TENC",
            "tsse": b"TSSE",
            "software": b"TSSE",
        }
        frames = bytearray()
        for k_l, val in normalized.items():
            if k_l in frame_map:
                fid = frame_map[k_l]
                fpay = b"\x03" + val.encode("utf-8")  # 0x03 = UTF-8 in ID3v2.4
                sz = len(fpay)
                syncsafe_f = bytes(
                    [(sz >> 21) & 0x7F, (sz >> 14) & 0x7F, (sz >> 7) & 0x7F, sz & 0x7F]
                )
                frames.extend(fid + syncsafe_f + b"\x00\x00" + fpay)
                actions.append(f"set ID3v2.4 frame {fid.decode('ascii')}")
        if frames:
            audio_start = 0
            if data[:3] == b"ID3" and len(data) >= 10:
                old_sz = (
                    ((data[6] & 0x7F) << 21)
                    | ((data[7] & 0x7F) << 14)
                    | ((data[8] & 0x7F) << 7)
                    | (data[9] & 0x7F)
                )
                audio_start = 10 + old_sz
            tsz = len(frames)
            syncsafe_t = bytes(
                [(tsz >> 21) & 0x7F, (tsz >> 14) & 0x7F, (tsz >> 7) & 0x7F, tsz & 0x7F]
            )
            header = b"ID3\x04\x00\x00" + syncsafe_t
            return header + bytes(frames) + data[audio_start:], actions

    if fmt == "pdf":
        updated = data
        for pdf_key in ("Title", "Author", "Subject", "Keywords", "Creator", "Producer"):
            k_l = pdf_key.lower()
            if k_l in normalized:
                safe_val = normalized[k_l].replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
                pat = rb"(/" + pdf_key.encode("ascii") + rb"\s*\()[^)\\]*(?:\\.[^)\\]*)*(\))"
                if re.search(pat, updated):
                    updated = re.sub(
                        pat,
                        rb"\g<1>" + safe_val.encode("utf-8") + rb"\g<2>",
                        updated,
                        count=1,
                    )
                    actions.append(f"updated PDF /{pdf_key}")
        return updated, actions

    raise ValueError(f"Metadata editing is not supported for format: {fmt}")


def clean_metadata_bytes(
    data: bytes,
    filename: str,
    *,
    mode: str = "all_removable",
    preserve_keys: list[str] | None = None,
    preserve_c2pa: bool = True,
    allow_c2pa_removal: bool = False,
) -> dict[str, Any]:
    """Remove metadata from a file while respecting C2PA provenance and preserved fields."""
    before = inspect_metadata_bytes(data, filename)
    if before["has_c2pa"] and not preserve_c2pa and not allow_c2pa_removal:
        raise ProvenanceAuthorizationError(
            "File contains C2PA Content Credentials. Explicit user confirmation "
            "(allow_c2pa_removal=True) is required before stripping C2PA provenance."
        )

    keep_non_ai = mode == "ai_only"
    preserve_set = set(preserve_keys or [])
    preserved_values: dict[str, str] = {}
    for field in before["fields"]:
        if field["key"] in preserve_set and field.get("editable"):
            preserved_values[field["key"]] = str(field["value"])

    ext = Path(filename).suffix or f".{before['format']}"
    with tempfile.TemporaryDirectory(prefix="oc-metaclean-") as tmp:
        src = Path(tmp) / f"in{ext}"
        dest = Path(tmp) / f"out{ext}"
        src.write_bytes(data)

        kind = before["kind"]
        actions: list[str] = []
        if kind == "image":
            res = clean_image(src, dest, strip_all_metadata=not keep_non_ai)
            actions.extend(res.get("actions", []))
            cleaned = dest.read_bytes()
        elif kind == "container":
            res = clean_container(src, dest)
            actions.extend(res.get("actions", []))
            cleaned = dest.read_bytes()
        elif kind == "av":
            res = clean_av(src, dest, strip_all_metadata=not keep_non_ai)
            actions.extend(res.get("actions", []))
            cleaned = dest.read_bytes()
        else:
            cleaned = data
            actions.append("no container metadata applicable for plain text")

    if preserve_c2pa and before["has_c2pa"]:
        cleaned, c2pa_notes = _restore_c2pa_chunks(data, cleaned, before["format"])
        actions.extend(c2pa_notes)

    if preserved_values:
        try:
            cleaned, edit_actions = edit_metadata_bytes(
                cleaned,
                filename,
                preserved_values,
                preserve_c2pa=preserve_c2pa,
                allow_c2pa_removal=allow_c2pa_removal,
            )
            actions.extend([f"preserved field ({a})" for a in edit_actions])
        except Exception:
            pass

    after = inspect_metadata_bytes(cleaned, filename)
    after_keys = {f["key"] for f in after["fields"]}
    removed_fields = [f for f in before["fields"] if f["key"] not in after_keys]

    return {
        "ok": True,
        "filename": Path(filename).name,
        "kind": before["kind"],
        "format": before["format"],
        "bytes_in": len(data),
        "bytes_out": len(cleaned),
        "changed": cleaned != data,
        "c2pa_preserved": preserve_c2pa if before["has_c2pa"] else True,
        "actions": actions,
        "before_fields": before["fields"],
        "after_fields": after["fields"],
        "removed_fields": removed_fields,
        "cleaned_bytes": cleaned,
    }

