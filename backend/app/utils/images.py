"""Safe image upload handling.

* Only JPEG, PNG and WEBP are accepted, checked by the file's actual bytes
  (magic numbers), not just its name or the browser's claimed type.
* The size limit is enforced while reading, so a huge upload is never fully loaded.
* Images are processed in memory and never written to disk or stored permanently.
"""
from fastapi import UploadFile

from app.core.exceptions import AppError, PayloadTooLargeError, UnsupportedMediaError
from app.services.gemini_service import ImageInput


def detect_image_type(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


async def read_image_upload(file: UploadFile, max_bytes: int) -> ImageInput:
    if file is None:
        raise AppError("Attach an image file.", code="file_missing")
    chunks, size = [], 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > max_bytes:
            raise PayloadTooLargeError(f"The image is too large. The limit is {max_bytes // (1024 * 1024)} MB.")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise AppError("The uploaded file is empty.", code="file_empty")
    mime = detect_image_type(data[:16])
    if mime is None:
        raise UnsupportedMediaError("Only JPEG, PNG or WEBP images are supported.")
    return ImageInput(data=data, mime_type=mime)
