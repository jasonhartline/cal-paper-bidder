# CAL Paper Bidder

Continuous Active Learning Paper Bidder is a tool concept for helping conference reviewers bid on large paper sets with far less manual browsing.

The intended workflow is:

1. Import papers from HotCRP or from exported files.
2. Show the reviewer a small stream of papers to bid on.
3. Train an active-learning ranker from those bids.
4. Continuously surface papers where the reviewer's next bid is most useful.
5. Export bids back to HotCRP review preferences.

See [docs/project-spec.md](docs/project-spec.md) for the initial product and engineering spec.

The CSV input/output format is described in [docs/input-format.md](docs/input-format.md). A checked-in public example is available at [examples/example-revprefs.csv](examples/example-revprefs.csv).

## Run Locally

This first version is a dependency-free static browser app. Files are parsed in the browser only; they are not uploaded to a server. From the repo root:

```sh
python3 -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173
```

The app keeps paper preferences in the CSV and all work happens in browser memory. Upload a CSV, adjust topic and paper sliders, click `Re-rank`, and export an updated CSV. Topic scores can optionally be saved to or loaded from a small JSON file.

## How To Use

1. Click `Load CSV` and choose a file with columns `paper,title,preference,abstract,topics`.
2. Optionally score the topic sliders to create the first topic-based ranking.
3. Click `Re-rank` to apply the current topic and text-model weights.
4. Score papers with the preference sliders. The default range is `-20` to `20`, with `0` meaning no ranking.
5. Click `Re-rank` again after adding paper scores. Once there are positive and negative scores, the text model joins the ranking.
6. Use the text-model weight slider if you want more or less influence from the learned model.
7. Click `Export CSV` when you want the updated preferences file.

`Load Demo` is available before a CSV is loaded. Topic scores can be saved and loaded separately as JSON, but the paper preferences themselves stay in the exported CSV.
