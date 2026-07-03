# Development Notes

## 2026-07-03

### Project Direction

CAL Paper Bidder is a browser-only web app for bidding on conference papers using a continuous-active-learning workflow. Files are parsed in the browser and are not uploaded to a server.

The durable state is the CSV itself:

```csv
paper,title,preference,abstract,topics
```

No database for the MVP. Topic scores are session-only cold-start inputs. Once paper preferences exist, ranking should rely mostly on the paper preference data and learned model scores.

### Current App Shape

The first prototype is a dependency-free static browser app:

- `index.html`
- `src/app.js`
- `src/styles.css`
- `examples/example-revprefs.csv`

Current behavior:

- Upload a CSV with `paper,title,preference,abstract,topics`.
- Load the public example CSV.
- Extract semicolon-separated topics.
- Let the user rate topics with `-3..3` sliders.
- Let the user save/load topic scores as a small JSON helper file.
- Let the user score papers with a configurable preference range, default `-20..20`.
- Treat `0` as unranked/no ranking, not as a meaningful neutral label.
- Re-rank papers explicitly with a `Re-rank` button.
- Blend topic scores with text-model scores using a model-weight slider.
- Recommend the model weight from `min(positive_count, negative_count)`.
- Highlight up to five abstract sentences that most influence the current text-model score, with green/red intensity for positive/negative signal.
- Hide `Load Demo` once any CSV is loaded.
- Mark exported CSV state dirty when paper preferences change, warn before unload or replacement, and clear it after `Export CSV`.
- Track topic-score JSON dirty state separately from CSV dirty state, warn before replacing/discarding it, and clear it after `Save topic scores` or loading topic scores.
- Export the same CSV shape with updated `preference` values.

### Classifier Shape

The app has a pluggable classifier interface in `src/app.js`.

Current classifier:

- `linearText`: in-browser TF-IDF nearest-centroid model using title, abstract, and topics.

The text model scores each paper by similarity to positive papers minus similarity to negative papers, normalizes those scores across the current paper set, and displays them on the configured preference range.

Topic-only behavior is represented by a `0%` text-model weight, not by a classifier dropdown.

Classifier responsibilities:

1. Train from existing paper preferences.
2. Produce scores for unranked papers.
3. Let the UI rank highest predicted-score papers first.

### Verification So Far

Checked locally:

```sh
node --check src/app.js
python3 - <<'PY'
import csv
from pathlib import Path
with Path('examples/example-revprefs.csv').open(newline='', encoding='utf-8') as f:
    rows = list(csv.DictReader(f))
print(len(rows), list(rows[0].keys()))
PY
```

Results:

- JavaScript syntax check passes.
- Example CSV parses as 74 rows.
- Columns are `paper,title,preference,abstract,topics`.

Browser automation from the Green Mini Codex environment was flaky against localhost, so the app still needs ordinary manual browser testing on a laptop.

### Suggested Laptop Test

```sh
git fetch
git checkout dev/static-ui-mvp
python3 -m http.server 5173
```

Open:

```text
http://127.0.0.1:5173
```

Test path:

1. Click `Load Demo`.
2. Move a few topic sliders.
3. Click `Re-rank`.
4. Score a few papers positive and negative.
5. Click `Re-rank` again.
6. Export CSV.
7. Confirm exported CSV preserves the same columns and updated preferences.

### Next Work

- Debug UI behavior in a real browser.
- Improve the classifier once the interaction loop feels right.
- Consider adding keyboard shortcuts for paper scoring.
- Consider virtualizing the paper list before using thousands of rows.
- Merge to `main` only after laptop testing.
