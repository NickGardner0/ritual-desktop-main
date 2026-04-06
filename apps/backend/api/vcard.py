"""Serve a Ritual contact card (vCard) for SendBlue onboarding."""

import base64
import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter()

SENDBLUE_FROM_NUMBER = os.getenv("SENDBLUE_FROM_NUMBER", "")

# Base64-encode the logo once at import time
_LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "ritual-logo.png"
_LOGO_B64 = ""
if _LOGO_PATH.exists():
    _LOGO_B64 = base64.b64encode(_LOGO_PATH.read_bytes()).decode("ascii")


def _fold_vcard_line(line: str, max_len: int = 75) -> str:
    """Fold a long vCard line per RFC 2426 (continuation lines start with a space)."""
    if len(line) <= max_len:
        return line
    parts = [line[:max_len]]
    pos = max_len
    while pos < len(line):
        parts.append(" " + line[pos : pos + max_len - 1])
        pos += max_len - 1
    return "\r\n".join(parts)


@router.get("/api/contact/ritual.vcf")
async def get_ritual_vcard():
    """Return a vCard that saves 'Ritual' as a contact with the SendBlue number."""
    phone = SENDBLUE_FROM_NUMBER or "+10000000000"
    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Ritual",
        "ORG:Ritual",
        f"TEL;TYPE=CELL:{phone}",
        "URL:https://ritual.app",
        "NOTE:Text this number to log habits.",
    ]
    if _LOGO_B64:
        lines.append(_fold_vcard_line(f"PHOTO;ENCODING=b;TYPE=PNG:{_LOGO_B64}"))
    lines.append("END:VCARD")

    vcard = "\r\n".join(lines) + "\r\n"
    return Response(
        content=vcard,
        media_type="text/vcard",
        headers={
            "Content-Disposition": 'attachment; filename="Ritual.vcf"',
            "Cache-Control": "public, max-age=86400",
        },
    )
