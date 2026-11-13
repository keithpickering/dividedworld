# GPT-2 vocabulary for the token counter

`bpe.json` is GPT-2's byte-level BPE vocabulary, vendored for `engine/system/tokens.ts`. GPT-2, GPT-Neo and GPT-J
share it. It is data, never code, and only edge code reads it (see the doc comment in `tokens.ts`).

- **Source:** `vocab.json` and `merges.txt` from `https://huggingface.co/openai-community/gpt2` (the files
  `resolve/main/vocab.json` and `resolve/main/merges.txt`), the published OpenAI GPT-2 vocabulary. The same two files
  are `encoder.json` and `vocab.bpe` at `https://openaipublic.blob.core.windows.net/gpt-2/encodings/main/`.
- **Fetched:** 2026-11-12.
- **License:** OpenAI's GPT-2 license (a modified MIT license) is in `LICENSE`, copied from `openai/gpt-2`.
- **How `bpe.json` was made:** `encoder` is `vocab.json` as it is (50,257 entries, token to id). `merges` is
  `merges.txt` without its `#version` header line and its blank lines, one `"left right"` string per merge in file
  order, so a merge's index is its rank (50,000 merges). The result is written with `JSON.stringify({ encoder, merges })`.
  The counter reads `merges` for ranks; the ids in `encoder` are kept so the file stays the whole vocabulary.
- **Checked against:** Python's `tokenizers` `ByteLevelBPETokenizer` loaded from the same two files, whose counts are
  the golden table in `engine/system/tokens.test.ts`.
