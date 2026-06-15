from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import tempfile
from typing import Any


@dataclass
class TempJmapAttachments:
    attachments: list[dict[str, str]]
    _paths: list[Path]

    def cleanup(self) -> None:
        for path in self._paths:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                continue


def _coerce_blob(value: object, index: int) -> bytes:
    if isinstance(value, bytes):
        return value
    raise ValueError(f"attachments[{index}].blob must be bytes.")


def _optional_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _extract_attachment_fields(item: object, index: int) -> tuple[bytes, str | None, str | None, str | None]:
    if isinstance(item, dict):
        blob = _coerce_blob(item.get("blob"), index)
        filename = _optional_string(item.get("filename"))
        content_type = _optional_string(item.get("mime_type")) or _optional_string(item.get("contentType"))
        extension = _optional_string(item.get("extension"))
        return blob, filename, content_type, extension

    blob = _coerce_blob(getattr(item, "blob", None), index)
    filename = _optional_string(getattr(item, "filename", None))
    content_type = _optional_string(getattr(item, "mime_type", None)) or _optional_string(
        getattr(item, "contentType", None)
    )
    extension = _optional_string(getattr(item, "extension", None))
    return blob, filename, content_type, extension


def _temp_suffix(filename: str | None, extension: str | None) -> str:
    if filename:
        suffix = Path(filename).suffix
        if suffix:
            return suffix
    if extension:
        ext = extension if extension.startswith(".") else f".{extension}"
        if ext != ".":
            return ext
    return ""


def attachments_from_dify_files(files: object) -> TempJmapAttachments:
    if files is None:
        return TempJmapAttachments(attachments=[], _paths=[])
    if not isinstance(files, list):
        raise ValueError("attachments must be a list.")
    if not files:
        return TempJmapAttachments(attachments=[], _paths=[])

    converted: list[dict[str, str]] = []
    temp_paths: list[Path] = []
    try:
        for index, item in enumerate(files):
            blob, filename, content_type, extension = _extract_attachment_fields(item, index)
            with tempfile.NamedTemporaryFile(delete=False, suffix=_temp_suffix(filename, extension)) as tmp:
                tmp.write(blob)
                temp_path = Path(tmp.name)

            temp_paths.append(temp_path)
            payload: dict[str, str] = {"path": str(temp_path)}
            if filename:
                payload["filename"] = filename
            if content_type:
                payload["contentType"] = content_type
            converted.append(payload)
    except Exception:
        for path in temp_paths:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                continue
        raise

    return TempJmapAttachments(attachments=converted, _paths=temp_paths)
