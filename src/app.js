const REQUIRED_COLUMNS = ["paper", "title", "preference", "abstract", "topics"];

const state = {
  papers: [],
  topicRatings: new Map(),
  settings: {
    preferenceMin: -20,
    preferenceNeutral: 0,
    preferenceMax: 20,
  },
  classifier: "linearText",
  lastRankReason: "topic_only",
};

const els = {
  file: document.querySelector("#csv-file"),
  loadExample: document.querySelector("#load-example"),
  exportCsv: document.querySelector("#export-csv"),
  rerank: document.querySelector("#rerank"),
  prefMin: document.querySelector("#pref-min"),
  prefNeutral: document.querySelector("#pref-neutral"),
  prefMax: document.querySelector("#pref-max"),
  classifier: document.querySelector("#classifier"),
  emptyState: document.querySelector("#empty-state"),
  workspace: document.querySelector("#workspace"),
  topics: document.querySelector("#topics"),
  topicCount: document.querySelector("#topic-count"),
  papers: document.querySelector("#papers"),
  paperCount: document.querySelector("#paper-count"),
  rankSummary: document.querySelector("#rank-summary"),
  hideRated: document.querySelector("#hide-rated"),
};

els.file.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  await loadCsvText(await file.text(), file.name);
  event.target.value = "";
});

els.loadExample.addEventListener("click", async () => {
  const response = await fetch("examples/example-revprefs.csv");
  if (!response.ok) {
    alert("Could not load the example CSV. Try running a local web server.");
    return;
  }
  await loadCsvText(await response.text(), "example-revprefs.csv");
});

els.exportCsv.addEventListener("click", () => {
  const csv = serializeCsv(
    REQUIRED_COLUMNS,
    state.papers.map((paper) => ({
      paper: paper.paper,
      title: paper.title,
      preference: String(paper.preference),
      abstract: paper.abstract,
      topics: paper.topics.join("; "),
    })),
  );
  downloadText("revprefs-updated.csv", csv, "text/csv");
});

els.rerank.addEventListener("click", () => {
  readSettings();
  rerankPapers();
  renderPapers();
});

els.hideRated.addEventListener("change", renderPapers);
els.classifier.addEventListener("change", () => {
  state.classifier = els.classifier.value;
});

for (const input of [els.prefMin, els.prefNeutral, els.prefMax]) {
  input.addEventListener("change", () => {
    readSettings();
    renderPapers();
  });
}

async function loadCsvText(text, sourceName) {
  const rows = parseCsv(text);
  if (!rows.length) {
    alert("The CSV did not contain any rows.");
    return;
  }
  const missing = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  if (missing.length) {
    alert(`Missing required columns: ${missing.join(", ")}`);
    return;
  }

  state.papers = rows.map((row, index) => {
    const preference = parsePreference(row.preference);
    return {
      id: `${row.paper || index + 1}`,
      paper: row.paper || String(index + 1),
      title: row.title || "(untitled)",
      preference,
      abstract: row.abstract || "",
      topics: splitTopics(row.topics || ""),
      topicScore: 0,
      modelScore: 0,
      combinedScore: 0,
      rankReason: "topic_only",
    };
  });

  initializeTopicRatings();
  rerankPapers();
  renderAll(sourceName);
}

function readSettings() {
  const min = Number(els.prefMin.value);
  const neutral = Number(els.prefNeutral.value);
  const max = Number(els.prefMax.value);
  if (!Number.isFinite(min) || !Number.isFinite(neutral) || !Number.isFinite(max) || min >= max) {
    alert("Preference range must have a finite minimum below maximum.");
    return;
  }
  state.settings = {
    preferenceMin: min,
    preferenceNeutral: neutral,
    preferenceMax: max,
  };
  for (const paper of state.papers) {
    paper.preference = clamp(paper.preference, min, max);
  }
}

function initializeTopicRatings() {
  const topics = getTopics();
  const next = new Map();
  for (const topic of topics) {
    next.set(topic, state.topicRatings.get(topic) ?? 0);
  }
  state.topicRatings = next;
}

function getTopics() {
  const counts = new Map();
  for (const paper of state.papers) {
    for (const topic of paper.topics) {
      counts.set(topic, (counts.get(topic) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([topic]) => topic);
}

function rerankPapers() {
  computeTopicScores();
  const classifier = classifiers[state.classifier] || classifiers.linearText;
  const model = classifier.train(state.papers, state.settings);
  const modelActive = model.active;

  for (const paper of state.papers) {
    paper.modelScore = model.score(paper);
    const normalizedTopic = normalizeTopicScore(paper.topicScore);
    const normalizedModel = modelActive ? paper.modelScore : 0;
    const alpha = modelActive ? 0.7 : 0;
    paper.combinedScore = alpha * normalizedModel + (1 - alpha) * normalizedTopic;
    paper.rankReason = modelActive ? "blended" : "topic_only";
  }

  state.lastRankReason = modelActive ? "blended" : "topic_only";
  state.papers.sort((a, b) => {
    return (
      b.combinedScore - a.combinedScore ||
      b.preference - a.preference ||
      Number(a.paper) - Number(b.paper) ||
      a.title.localeCompare(b.title)
    );
  });
}

function computeTopicScores() {
  for (const paper of state.papers) {
    const ratings = paper.topics
      .map((topic) => state.topicRatings.get(topic) || 0)
      .filter((rating) => Number.isFinite(rating));
    paper.topicScore = ratings.length ? average(ratings) : 0;
  }
}

function normalizeTopicScore(score) {
  return (score + 3) / 6;
}

const classifiers = {
  topicOnly: {
    train() {
      return {
        active: false,
        score() {
          return 0;
        },
      };
    },
  },

  linearText: {
    train(papers, settings) {
      const positive = [];
      const negative = [];
      for (const paper of papers) {
        if (paper.preference > settings.preferenceNeutral) positive.push(paper);
        if (paper.preference < settings.preferenceNeutral) negative.push(paper);
      }
      if (!positive.length || !negative.length) {
        return inactiveModel;
      }

      const documentFrequency = new Map();
      const tokenized = new Map();
      for (const paper of papers) {
        const tokens = tokenize(paperToText(paper));
        tokenized.set(paper.id, tokens);
        for (const token of new Set(tokens)) {
          documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
        }
      }

      const weights = new Map();
      addClassWeights(weights, positive, tokenized, documentFrequency, papers.length, 1);
      addClassWeights(weights, negative, tokenized, documentFrequency, papers.length, -1);

      return {
        active: true,
        score(paper) {
          const tokens = tokenized.get(paper.id) || tokenize(paperToText(paper));
          let raw = 0;
          for (const token of tokens) {
            raw += weights.get(token) || 0;
          }
          return sigmoid(raw / Math.max(8, Math.sqrt(tokens.length || 1)));
        },
      };
    },
  },
};

const inactiveModel = {
  active: false,
  score() {
    return 0;
  },
};

function addClassWeights(weights, papers, tokenized, documentFrequency, totalDocuments, direction) {
  const counts = new Map();
  let total = 0;
  for (const paper of papers) {
    for (const token of tokenized.get(paper.id) || []) {
      counts.set(token, (counts.get(token) || 0) + 1);
      total += 1;
    }
  }
  if (!total) return;
  for (const [token, count] of counts) {
    const tf = count / total;
    const idf = Math.log((1 + totalDocuments) / (1 + (documentFrequency.get(token) || 0))) + 1;
    weights.set(token, (weights.get(token) || 0) + direction * tf * idf);
  }
}

function paperToText(paper) {
  return `${paper.title} ${paper.abstract} ${paper.topics.join(" ")}`;
}

function tokenize(text) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "are",
    "can",
    "into",
    "use",
    "using",
    "our",
    "we",
    "show",
    "paper",
    "study",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stop.has(token));
}

function renderAll(sourceName) {
  els.emptyState.classList.add("hidden");
  els.workspace.classList.remove("hidden");
  els.exportCsv.disabled = false;
  els.rerank.disabled = false;
  renderTopics();
  renderPapers();
  els.rankSummary.textContent = `Loaded ${state.papers.length} papers from ${sourceName}.`;
}

function renderTopics() {
  const topics = getTopics();
  els.topicCount.textContent = `${topics.length}`;
  els.topics.replaceChildren(
    ...topics.map((topic) => {
      const row = document.createElement("div");
      row.className = "topic-row";
      const label = document.createElement("label");
      label.className = "topic-label";
      label.innerHTML = `<strong>${escapeHtml(topic)}</strong><span>${state.topicRatings.get(topic) || 0}</span>`;
      const input = document.createElement("input");
      input.type = "range";
      input.min = "-3";
      input.max = "3";
      input.step = "1";
      input.value = String(state.topicRatings.get(topic) || 0);
      input.addEventListener("input", () => {
        state.topicRatings.set(topic, Number(input.value));
        label.querySelector("span").textContent = input.value;
      });
      row.append(label, input);
      return row;
    }),
  );
}

function renderPapers() {
  const hideRated = els.hideRated.checked;
  const neutral = state.settings.preferenceNeutral;
  const visible = hideRated
    ? state.papers.filter((paper) => paper.preference === neutral)
    : state.papers;
  const rated = state.papers.filter((paper) => paper.preference !== neutral).length;
  els.paperCount.textContent = `${state.papers.length} papers, ${rated} rated`;
  els.rankSummary.textContent = rankSummaryText();
  els.papers.replaceChildren(...visible.map(renderPaperCard));
}

function renderPaperCard(paper) {
  const article = document.createElement("article");
  article.className = "paper-card";

  const body = document.createElement("div");
  const title = document.createElement("h3");
  title.className = "paper-title";
  title.textContent = `#${paper.paper} ${paper.title}`;
  const meta = document.createElement("div");
  meta.className = "paper-meta";
  if (paper.topics.length) {
    for (const topic of paper.topics) {
      const chip = document.createElement("span");
      chip.className = "topic-chip";
      chip.textContent = topic;
      meta.append(chip);
    }
  } else {
    meta.textContent = "No topics";
  }
  const abstract = document.createElement("p");
  abstract.className = "abstract";
  abstract.textContent = truncate(paper.abstract, 560);
  body.append(title, meta, abstract);

  const controls = document.createElement("div");
  controls.className = "paper-controls";
  const scoreRow = document.createElement("div");
  scoreRow.className = "paper-score-row";
  const scoreLabel = document.createElement("label");
  scoreLabel.className = "score-label";
  scoreLabel.innerHTML = `<strong>Preference</strong><span>${paper.preference}</span>`;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(state.settings.preferenceMin);
  slider.max = String(state.settings.preferenceMax);
  slider.step = "1";
  slider.value = String(paper.preference);
  slider.addEventListener("input", () => {
    paper.preference = Number(slider.value);
    const value = scoreLabel.querySelector("span");
    value.textContent = slider.value;
    value.className = Number(slider.value) > state.settings.preferenceNeutral
      ? "positive"
      : Number(slider.value) < state.settings.preferenceNeutral
        ? "negative"
        : "";
  });
  scoreRow.append(scoreLabel, slider);

  const readout = document.createElement("div");
  readout.className = "score-readout";
  readout.innerHTML = `
    <span><b>Combined</b><em>${formatScore(paper.combinedScore)}</em></span>
    <span><b>Topic</b><em>${formatScore(paper.topicScore)}</em></span>
    <span><b>Model</b><em>${formatScore(paper.modelScore)}</em></span>
    <span><b>Reason</b><em>${paper.rankReason}</em></span>
  `;
  controls.append(scoreRow, readout);
  article.append(body, controls);
  return article;
}

function rankSummaryText() {
  const positive = state.papers.filter((paper) => paper.preference > state.settings.preferenceNeutral).length;
  const negative = state.papers.filter((paper) => paper.preference < state.settings.preferenceNeutral).length;
  const neutral = state.papers.length - positive - negative;
  const mode = state.lastRankReason === "blended" ? "topic + model ranking" : "topic-only ranking";
  return `${mode}. ${positive} positive, ${negative} negative, ${neutral} neutral.`;
}

function parsePreference(value) {
  const number = Number(String(value || "0").replace(/[A-Za-z]+$/, ""));
  return Number.isFinite(number) ? number : 0;
}

function splitTopics(value) {
  return value
    .split(";")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift()?.map((name) => name.trim()) || [];
  return rows
    .filter((values) => values.some((value) => value.trim() !== ""))
    .map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] || ""])));
}

function serializeCsv(columns, rows) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column] || "")).join(",")),
  ].join("\n") + "\n";
}

function csvEscape(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char];
  });
}
