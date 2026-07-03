# Input Format

The MVP input and output format is a HotCRP-style reviewer-preferences CSV:

```csv
paper,title,preference,abstract,topics
```

Columns:

- `paper`: paper number
- `title`: paper title
- `preference`: current per-paper review preference/bid
- `abstract`: abstract text, possibly with embedded newlines in quoted CSV fields
- `topics`: semicolon-separated topic labels

The CSV does not contain topic scores. The app creates topic scores by extracting all distinct topics from `topics` and asking the reviewer to rate them. These topic ratings seed the first batch.

The app should preserve this CSV shape on export, changing only `preference` values unless the user explicitly asks for another output.

## Public Checked-In Example

The checked-in public example is:

- [examples/example-revprefs.csv](../examples/example-revprefs.csv)

It has the exact MVP CSV shape, uses public arXiv paper metadata, and initializes all `preference` values to `0`.
