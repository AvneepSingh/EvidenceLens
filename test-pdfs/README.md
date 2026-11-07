# Quick EvidenceLens checks

These PDFs contain fictional data. Each has one page and is deliberately small.
Upload them using **Upload files** in the main chat.

| Test | Files to attach | Question to ask | Expected result |
| --- | --- | --- | --- |
| Direct answer | `01-project-facts.pdf` | How many tasks are completed? | **Factual:** 9 completed tasks, with a page 1 and extracted-line reference. |
| Multiple documents | Both `01` and `02` | Who leads Northstar, and how many tasks are completed? | **Factual:** Mira Chen and 9 tasks; references from the two files. |
| Inference | Both `01` and `02` | Has Northstar met its completion target? Show the calculation. | **Inferred:** 9 / 12 = 75%, so it has met the 75% target. Cite the task counts in `01` and the target in `02`. |
| Missing information | Both `01` and `02` | What color is Northstar's logo? | Say the files do not specify it. Any outside-document speculation should be **Thought answer**, without invented references. |
| OCR | Only `03-scanned-receipt.pdf` | What is the receipt number, item, quantity, and total? | **Factual:** receipt 1042; Blue notebook; quantity 3; total 18 dollars. Citations point to page 1 and OCR-generated lines. |
| Abstract | Either text PDF; leave the message blank | Click Send | A brief abstract with checked supporting references. |

Start a **New chat** between tests when you want a fresh attachment collection.
For the OCR test, select **OCR: EN** before uploading. The receipt is image-only,
so OCR must run; the first two PDFs already contain searchable text and skip OCR.

Click a citation to inspect its numbered source lines. Line numbers are generated
by extraction and can differ across PDFs; do not expect a particular line number
in advance. Compare the displayed quote with the corresponding source text.

The small circular progress indicator has Stop in the center. These files may
finish extracting too quickly to test Stop reliably; it also appears while the
model answers. File extraction speed and model answer speed are separate.
