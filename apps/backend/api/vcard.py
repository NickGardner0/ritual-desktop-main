"""Serve a Ritual contact card (vCard) for SendBlue onboarding."""

import os

from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter()

SENDBLUE_FROM_NUMBER = os.getenv("SENDBLUE_FROM_NUMBER", "")


@router.get("/api/contact/ritual.vcf")
async def get_ritual_vcard():
    """Return a vCard that saves 'Ritual' as a contact with the SendBlue number."""
    phone = SENDBLUE_FROM_NUMBER or "+10000000000"
    vcard = (
        "BEGIN:VCARD\r\n"
        "VERSION:3.0\r\n"
        "FN:Ritual\r\n"
        "ORG:Ritual\r\n"
        f"TEL;TYPE=CELL:{phone}\r\n"
        "URL:https://ritual.app\r\n"
        "NOTE:Text this number to log habits.\r\n"
        "END:VCARD\r\n"
    )
    return Response(
        content=vcard,
        media_type="text/vcard",
        headers={
            "Content-Disposition": 'attachment; filename="Ritual.vcf"',
            "Cache-Control": "public, max-age=86400",
        },
    )
