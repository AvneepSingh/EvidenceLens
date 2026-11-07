import json
import textwrap
import unicodedata


def numbered_lines(text):
    lines = []
    for raw in unicodedata.normalize("NFC", text).splitlines():
        clean = " ".join("".join(c for c in raw if c.isprintable() or c == "\t").split())
        # Bound pathological unbroken lines while preserving the resulting source indexes.
        if clean:
            lines.extend(textwrap.wrap(clean, width=400, break_long_words=True, break_on_hyphens=False))
    return lines


def format_text(document):
    filename = json.dumps(document["filename"], ensure_ascii=False)[1:-1]
    sections = []
    for number, lines in enumerate(document["pages"], 1):
        sections.append(f"[FILE: {filename}]\n[DOCUMENT_ID: {document['document_id']}]\n[PAGE: {number}]\n" +
                        "\n".join(f"[L{i}] {line}" for i, line in enumerate(lines, 1)))
    return "\n\n".join(sections) + "\n"
