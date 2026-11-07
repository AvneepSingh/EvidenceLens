import json
import re
from .common import DocumentError


def normalize(text):
    return " ".join(text.split())


def validate_answer(raw, documents, chunks):
    if not isinstance(raw, str):
        raise DocumentError("Answer must be a string.")
    try:
        value = json.loads(re.sub(r"\s*```$", "", re.sub(r"^```(?:json)?\s*", "", raw.strip())))
    except (ValueError, RecursionError) as error:
        raise DocumentError("The model did not return valid evidence JSON. No answer was accepted.") from error
    claims = value.get("claims") if isinstance(value, dict) else None
    if not isinstance(claims, list) or not 1 <= len(claims) <= 30:
        raise DocumentError("The answer must contain 1–30 evidence claims.")
    sources = {d["document_id"]: d for d in documents}
    allowed = {(c["documentId"], c["page"], n) for c in chunks for n in range(c["startLine"], c["endLine"] + 1)}
    for claim in claims:
        if not isinstance(claim, dict) or claim.get("kind") not in {"factual", "inferred", "thought"} or not isinstance(claim.get("text"), str) or not claim["text"].strip() or not isinstance(claim.get("citations"), list):
            raise DocumentError("Malformed evidence claim. No answer was accepted.")
        refs = claim["citations"]
        if claim["kind"] == "thought":
            if refs:
                raise DocumentError("Thought answers cannot claim document references.")
            continue
        if not refs:
            raise DocumentError("A supported claim has no source references.")
        for ref in refs:
            if not isinstance(ref, dict):
                raise DocumentError("Malformed citation.")
            if not isinstance(ref.get("documentId"), str):
                raise DocumentError("Citation needs a document ID string.")
            doc = sources.get(ref.get("documentId"))
            page, first, last = ref.get("page"), ref.get("startLine"), ref.get("endLine")
            if not doc or any(type(n) is not int for n in (page, first, last)) or not 1 <= page <= len(doc["pages"]):
                raise DocumentError("Citation refers to a nonexistent document or page.")
            lines = doc["pages"][page - 1]
            if not 1 <= first <= last <= len(lines):
                raise DocumentError("Citation refers to nonexistent source lines.")
            if any((doc["document_id"], page, n) not in allowed for n in range(first, last + 1)):
                raise DocumentError("Citation refers to text that was not in the retrieved context.")
            quote = ref.get("quote")
            if not isinstance(quote, str) or not normalize(quote) or normalize(quote) not in normalize(" ".join(lines[first - 1:last])):
                raise DocumentError("Citation quotation does not match the preserved extracted text.")
    return value
