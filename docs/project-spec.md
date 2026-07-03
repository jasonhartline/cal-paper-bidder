# Cal Paper Bidder Project Spec

## Goal

Build a local-first web app that helps conference reviewers bid on too-large paper lists using continuous active learning (CAL). The reviewer scores papers as high-interest, low-interest, conflict/skip, or neutral; the system retrains on demand and reranks the remaining papers.

The first target is a HotCRP-style reviewer-preferences CSV. HotCRP API integration can follow after the local CSV loop is working.

## Source Baseline

### Continuous active learning

CAL was developed for high-recall e-discovery: repeatedly rank the unlabeled corpus, ask the user to judge top candidates, then retrain on all judgments. For paper bidding, "relevant" means "this reviewer should probably bid positively on this paper."

Practical implementation choices:

- Use the Cormack/Grossman technology-assisted-review workflow as the conceptual baseline: continuously train on reviewer judgments, rank the remaining collection, review the highest-priority next papers, and repeat.
- Implement the first prototype directly rather than depending on a full e-discovery stack. The core algorithm is small enough to keep transparent.
- Start with a simple model: topic-rating seed scores for the initial ordering, then TF-IDF over title, abstract, and topics with logistic regression or naive Bayes after paper scores exist.
- Treat ASReview as an optional implementation reference because it is active, Apache-2.0 licensed, Python-based, and implements active learning over textual records.
- Add uncertainty/diversity sampling only after the top-probability CAL loop is working.

Useful references:

- ASReview repository: https://github.com/asreview/asreview
- ASReview docs: https://asreview.readthedocs.io/
- Cormack/Grossman CAL paper: https://arxiv.org/abs/1504.06868

### HotCRP integration

HotCRP is open source and documents a REST API. For MVP, the concrete format target is the reviewer-preferences CSV:

```csv
paper,title,preference,abstract,topics
```

The app should preserve this shape on import and export. Relevant API facts as of the 2026-06-26 OpenAPI spec:

- API calls live under `/api` and generally return JSON with an `ok` field and optional `message_list`.
- External applications authenticate with bearer tokens from Account settings > Developer.
- Many endpoints accept HotCRP search parameters `q`, `t`, `qt`, `sort`, `scoresort`, and `reviewer`; `/papers` is the natural import endpoint for a search-selected paper set.
- `/{p}/paper` retrieves one submission object.
- `/document` retrieves a paper PDF or other submission document.
- `/{p}/revpref` gets or sets a review preference; the value is a signed integer with optional expertise letter, such as `10X`, `-5`, or empty to clear.

Useful references:

- HotCRP repository: https://github.com/kohler/hotcrp
- HotCRP OpenAPI spec: https://raw.githubusercontent.com/kohler/hotcrp/master/devel/openapi.json
- HotCRP API docs: https://hotcrp.com/help/api

## Product Shape

### Primary user

A PC member or reviewer who has access to a HotCRP conference and needs to bid on hundreds to tens of thousands of submissions.

### Core workflow

1. Reviewer creates a project.
2. Reviewer sets the project preference range. Default: `-20` to `20`, with `0` neutral.
3. Reviewer imports a HotCRP-style preference CSV with columns `paper,title,preference,abstract,topics`.
4. System normalizes records into a local paper table.
5. System extracts the distinct topic list from the CSV's semicolon-separated `topics` field.
6. Reviewer rates conference topics with sliders before or while viewing papers. These topic ratings are created by the app; they are not present in the imported CSV.
7. System sorts papers by topic-match score.
8. Reviewer scores papers with per-paper sliders, updating per-paper `preference` values.
9. Reviewer clicks a re-rank button.
10. System retrains from user-scored papers and reorders the paper list using a blend of topic scores and learned paper relevance scores.
11. Reviewer repeats score papers, re-rank until they decide to stop.
12. System exports the same CSV shape with updated `preference` values.

### Reviewer labels

For the local UI, use labels that map cleanly to HotCRP preference scores:

- strong yes
- yes
- weak yes
- neutral
- weak no
- no
- strong no
- conflict/skip

Preference values are numeric in the CSV. The public development fixture initializes every preference to `0`; the app should not assume this is the full scale. Preference mappings must be configurable per project.

The default preference range should be `-20` to `20`, because that appears to be common for conference bidding. The user can change the minimum, maximum, and neutral value during project setup.

### MVP scope

MVP should solve one-person bidding without conference-chair privileges:

- Import a HotCRP-style preference CSV.
- Configure the project preference range, defaulting to `-20..20`.
- Store records locally in SQLite.
- Use title + abstract + topics as text features.
- Provide a web interface for sequential bidding.
- Let the reviewer rate topics before paper bidding.
- Build the initial ordering from topic-match scores.
- Train a scikit-learn TF-IDF + logistic regression model.
- Rank unbid papers by a mix of learned relevance and exploration.
- Export the same CSV shape: `paper,title,preference,abstract,topics`.

MVP can defer:

- Multi-reviewer collaboration.
- PDF full-text extraction.
- Direct writeback to HotCRP.
- LLM summaries.
- Chair/admin dashboards.
- Assignment optimization across reviewers.

## Data Model

### Paper

- `id`: internal UUID
- `source`: `hotcrp_api`, `hotcrp_csv`, or `manual`
- `source_site`: HotCRP site URL when known
- `pid`: HotCRP submission ID
- `title`
- `abstract`
- `authors_text`: only if visible to the reviewer
- `topics`: normalized list
- `tags`: optional HotCRP tags visible to the reviewer
- `pdf_path`: optional local path
- `pdf_text`: optional extracted text
- `raw`: original JSON/CSV row for debugging and round-trip export

### Bid

- `paper_id`
- `label`: `strong_yes`, `yes`, `weak_yes`, `neutral`, `weak_no`, `no`, `strong_no`, `conflict`, `skip`
- `preference`: integer in the project preference range
- `hotcrp_pref`: nullable text such as `20X`, `10`, `0`, `-5`, `-20`, if expertise letters are enabled
- `created_at`
- `updated_at`
- `source`: manual, imported, or API

### Project settings

- `preference_min`: default `-20`
- `preference_max`: default `20`
- `preference_neutral`: default `0`
- `positive_threshold`: default first integer above neutral
- `negative_threshold`: default first integer below neutral
- `topic_min`: default `-3`
- `topic_max`: default `3`
- `topic_neutral`: default `0`

### Topic preference

- `topic`
- `rating`: signed integer, with positive meaning interest and negative meaning aversion
- `created_at`
- `updated_at`

Topic preferences are local reviewer inputs. They are derived from the imported topic vocabulary and are not imported from the reviewer-preferences CSV.

### Model run

- `id`
- `created_at`
- `feature_version`
- `model_type`
- `training_count`
- `positive_count`
- `negative_count`
- `metrics_json`

### Score

- `model_run_id`
- `paper_id`
- `score_positive`
- `score_uncertainty`
- `score_diversity`
- `rank`

### Ranking state

- `paper_id`
- `topic_score`: score implied by topic sliders
- `model_score`: score predicted from previously scored papers
- `combined_score`: score used for current ordering
- `rank_reason`: `topic_only`, `model_only`, or `blended`
- `updated_at`

## Architecture

### Recommended stack

- Backend: Python 3.12, FastAPI, SQLite, SQLAlchemy or SQLModel, scikit-learn.
- Frontend: React + TypeScript + Vite, or a simpler server-rendered UI if speed matters more than frontend richness.
- Jobs: in-process background tasks for MVP; move to a worker only if PDF extraction or large imports require it.
- Packaging: project-local `.venv`, `pyproject.toml`, and standard Python tooling.

### Components

- `hotcrp_client`: bearer-token API client for `/papers`, `/{p}/paper`, `/document`, and `/{p}/revpref`.
- `importers`: CSV/JSON parsers that map source fields into the internal paper schema.
- `features`: text normalization, TF-IDF vectorization, optional topic and author features.
- `learner`: model training, scoring, active selection policy.
- `app_api`: project, paper, bid, rank, import, export endpoints.
- `web_ui`: topic sliders, ranked paper list, paper scoring controls, re-rank action, export controls.

## UI Model

The MVP should be a single-page working interface, not a wizard.

### Topic Controls

Show all topics in a compact panel at the top of the page. Each topic has a slider, initially neutral.

Suggested slider:

- Range: `-3` to `+3`
- Labels: `avoid`, `neutral`, `want`
- Default: `0`

Moving topic sliders updates topic scores immediately, but does not have to reorder the paper list until the reviewer clicks `Re-rank`. This keeps the interface predictable for long lists.

### Paper List

Below the topic panel, show papers in the current ranked order. Each row should include:

- paper number
- title
- topics
- a short abstract preview with expansion
- current preference slider
- current ranking score or lightweight rank reason

The paper preference slider should be fast to adjust while scanning.

Suggested slider:

- Range: project `preference_min` to `preference_max`; default `-20` to `20`
- Labels: `bad`, `neutral`, `good`
- Default: imported `preference`, usually `0`

The UI should support keyboard movement and scoring later, but sliders are the first interaction model.

### Re-rank Action

Provide a clear `Re-rank` button. When clicked:

1. Save topic slider values and paper preference values.
2. Recompute topic scores for every paper.
3. If enough paper scores exist, train/update the relevance model.
4. Recompute combined scores.
5. Reorder the visible paper list.

Do not reorder continuously while the reviewer is dragging sliders; that would make the list slippery and unpleasant.

## Active Learning Policy

The workflow should follow the Cormack/Grossman continuous active learning pattern used in technology-assisted review and e-discovery: rank the collection, review the highest-priority items, add the new judgments to the training set, retrain, and repeat until the reviewer chooses to stop.

### Initial ordering

Before any paper scores exist, build a topic-interest seed model:

1. Extract the deduplicated topic list from imported CSV rows.
2. Ask the reviewer to rate each topic, for example from `-3` to `+3`.
3. Score each paper by summing or averaging its rated topic values.
4. Use title/abstract similarity only as a tie-breaker or diversity mechanism.
5. Sort the paper list by the highest topic-match scores, with a small diversity adjustment if needed.

This gives the reviewer a useful initial ordering without requiring keyword search or random cold-start browsing.

### Subsequent re-ranks

After the reviewer has scored some papers, train a text-and-topic relevance model:

1. Treat positive bids as relevant examples.
2. Treat negative bids as non-relevant examples.
3. Ignore neutral and conflict/skip labels for supervised training unless the project mapping says otherwise.
4. Use title, abstract, and topics as features.
5. Rank unlabeled papers by predicted relevance to the reviewer.
6. Reorder the list by combined relevance score, optionally with a small exploration adjustment.

For MVP, keep the policy simple:

- 80 percent highest predicted positive-bid probability.
- 10 percent uncertain papers near the decision boundary.
- 10 percent diverse papers from under-sampled topic areas.

This is simple enough to debug and close enough to the CAL spirit: continuous relevance feedback with repeated reranking.

## Ranking Formula

The ranking should start with topic scores and gradually shift toward learned relevance as paper-level preferences accumulate.

### Topic score

For paper `p` with topics `T(p)` and reviewer topic ratings `r(t)`:

```text
topic_score(p) = average over t in T(p) of r(t)
```

If a paper has no topics, use `0`.

### User preference labels

The per-paper slider writes directly to `preference` in the project preference range. By default:

```text
-20, ..., -1, 0, 1, ..., 20
```

Values above `positive_threshold` are positive training examples; values below `negative_threshold` are negative training examples; neutral values are unjudged/neutral for training.

### Combined ranking

Before there are enough user-scored papers:

```text
combined_score = topic_score
```

After enough positive and negative paper scores exist:

```text
combined_score = alpha * normalized_model_score + (1 - alpha) * normalized_topic_score
```

Start with `alpha = 0.7` after the model is active. If fewer than one positive and one negative paper preference exist, keep `alpha = 0`.

This gives topics control of the cold start, then lets user paper scores take over once they provide a better signal.

## HotCRP Preference Mapping

HotCRP review preferences have a signed integer value and optional expertise letter. HotCRP's REST API represents a preference as text in `pref`, such as `10`, `-5`, or `20X`, on the featured `/{p}/revpref` endpoint. It also supports bulk changes through `/assign` using HotCRP's assignment CSV/JSON format; that exact bulk format should be checked with `/assigners` for the target conference before writeback.

The MVP import/export shape is:

```csv
paper,title,preference,abstract,topics
```

Preserve this shape for local imports and exports. The `topics` cell is semicolon-separated, and abstracts may contain embedded newlines in quoted CSV fields. Parsers must use a real CSV parser, not line-oriented splitting. Topic scores are not present in this CSV; the app creates them by asking the reviewer to rate the extracted topic list.

Default project preference range:

- minimum: `-20`
- neutral: `0`
- maximum: `20`

If the UI uses named quick buttons in addition to the slider, map them proportionally into the configured range. For the default `-20..20` range:

- `strong_yes` -> `20`
- `yes` -> `10`
- `weak_yes` -> `3`
- `neutral` -> `0`
- `weak_no` -> `-3`
- `no` -> `-10`
- `strong_no` -> `-20`
- `conflict` -> blank by default; do not overwrite HotCRP conflicts
- `skip` -> blank

Make this configurable per project because conferences and reviewers use preference scales differently. If expertise letters are later supported, append them only in HotCRP API/writeback paths, not in the numeric CSV unless the conference format explicitly expects them.

## Privacy And Security

The tool will handle unpublished papers. Treat privacy as a product requirement:

- Store HotCRP bearer tokens encrypted at rest or keep them session-only for MVP.
- Default to local-only operation.
- Do not send paper text to external LLM APIs without explicit opt-in.
- Do not log abstracts, PDFs, or tokens.
- Provide "delete project" and "purge token" commands.
- Keep imported paper data out of git by default.

## Evaluation Plan

Use three evaluation modes:

1. Retrospective reviewer data: if a reviewer has previous bids, hide most labels and measure how quickly CAL recovers high bids.
2. Synthetic conference data: simulate a reviewer interest profile over public paper metadata.
3. Live usage metrics: track number of papers reviewed before the reviewer feels the bid list is complete.

Metrics:

- Precision in top K recommendations.
- Recall of eventual positive bids after N inspected papers.
- Work saved versus random browsing.
- Calibration of predicted interest scores.
- User time to reach a satisfactory bid file.

## Implementation Phases

### Phase 0: Repository scaffold

- Add Python backend skeleton.
- Add frontend skeleton or server-rendered prototype.
- Add sample fixture import format.
- Add tests for import normalization and preference export.

### Phase 1: Local CSV MVP

- Upload HotCRP-style CSV.
- Normalize papers.
- Rate imported topics before paper bidding.
- Generate the initial ordering by topic match.
- Bid in a browser.
- Train and rerank with TF-IDF/logistic regression.
- Export HotCRP-compatible preference CSV.

### Phase 2: HotCRP API read integration

- Configure site URL and token.
- Import `/papers` search results.
- Retrieve individual paper details when needed.
- Optionally download PDFs with `/document`.

### Phase 3: Better bidding interface

- Keyboard-first paper triage.
- Search and seed selection.
- Progress dashboard.
- Explanation snippets showing terms that influenced ranking.

### Phase 4: HotCRP writeback

- Dry-run preference updates.
- Post `/{p}/revpref` values for selected papers.
- Show exact changes before commit.

### Phase 5: Advanced models

- PDF text extraction.
- Embeddings and semantic similarity.
- Topic-aware diversity.
- Optional LLM-generated paper summaries and reviewer-profile matching.

## Open Questions

- What exact CSV columns does HotCRP expose to ordinary PC members for the target conferences?
- Are reviewer preferences always writable through the API for PC members, or do some conferences disable this?
- Should the default user experience optimize for "find my likely positive bids" or "produce a complete calibrated preference file"?
- Should neutral labels train the model as weak negatives or remain ignored?
- Is chair/admin mode in scope, where one tool supports multiple reviewers?

## Near-Term Recommendation

Build the local CSV MVP first. It avoids API-token friction, gives us a real bidding loop quickly, and produces a useful export even when HotCRP API permissions vary by conference. Add HotCRP API import next, then writeback only after export behavior is trusted.
