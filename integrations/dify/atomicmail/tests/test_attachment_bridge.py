from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from utils.attachment_bridge import attachments_from_dify_files


def test_bridge_handles_empty_input() -> None:
    temp = attachments_from_dify_files(None)
    assert temp.attachments == []
    temp.cleanup()


def test_bridge_creates_temp_files_from_file_like_objects() -> None:
    file_obj = SimpleNamespace(
        blob=b"hello from blob",
        filename="note.txt",
        mime_type="text/plain",
        extension="txt",
    )

    temp = attachments_from_dify_files([file_obj])
    assert len(temp.attachments) == 1
    item = temp.attachments[0]
    path = Path(item["path"])
    assert path.exists()
    assert path.read_bytes() == b"hello from blob"
    assert item["filename"] == "note.txt"
    assert item["contentType"] == "text/plain"

    temp.cleanup()
    assert not path.exists()


def test_bridge_supports_dict_items_and_cleanup() -> None:
    temp = attachments_from_dify_files(
        [
            {
                "blob": b"bin-1",
                "filename": "a.bin",
                "mime_type": "application/octet-stream",
            },
            {
                "blob": b"bin-2",
                "filename": "b.bin",
                "contentType": "application/octet-stream",
            },
        ]
    )
    paths = [Path(item["path"]) for item in temp.attachments]
    assert [path.read_bytes() for path in paths] == [b"bin-1", b"bin-2"]
    temp.cleanup()
    assert all(not path.exists() for path in paths)
