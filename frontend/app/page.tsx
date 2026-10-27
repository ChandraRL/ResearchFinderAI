"use client";

import { useEffect, useState } from "react";

type Paper = {
  id: string;
  title: string;
  year: number | null;
  authors: string[];
  abstract: string;
  doi: string | null;
  url: string;
  cited_by_count: number;
  type: string;
  relevance_score?: number;
};

type SearchResponse = {
  query: string;
  page: number;
  per_page: number;
  total: number;
  ranking?: string;
  model?: string;
  papers: Paper[];
};

type AssistantEvidence = {
  text: string;
  similarity: number;
};

type AssistantResponse = {
  answer: string;
  evidence: AssistantEvidence[];
  source?: string;
  model?: string;
};

type SortOption = "relevance" | "citations";
type ViewMode = "discover" | "recent" | "saved";

type RecentSearch = {
  query: string;
  yearFrom: string;
  yearTo: string;
  timestamp: number;
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const FAVORITES_KEY = "researchfinder-favorite-papers";
const RECENT_KEY = "researchfinder-recent-searches";

const suggestions = [
  "Artificial Intelligence",
  "Machine Learning",
  "Computer Vision",
  "Large Language Models",
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [favorites, setFavorites] = useState<Paper[]>([]);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("discover");
  const [sortBy, setSortBy] = useState<SortOption>("relevance");
  const [storageReady, setStorageReady] = useState(false);

  const [assistantQuestions, setAssistantQuestions] = useState<
    Record<string, string>
  >({});
  const [assistantResults, setAssistantResults] = useState<
    Record<string, AssistantResponse>
  >({});
  const [assistantLoading, setAssistantLoading] = useState<string | null>(
    null
  );
  const [assistantErrors, setAssistantErrors] = useState<
    Record<string, string>
  >({});

  // Load saved data from the browser after the component mounts.
  useEffect(() => {
    try {
      const storedFavorites = localStorage.getItem(FAVORITES_KEY);
      const storedRecent = localStorage.getItem(RECENT_KEY);

      if (storedFavorites) {
        const parsed: unknown = JSON.parse(storedFavorites);
        if (Array.isArray(parsed)) setFavorites(parsed as Paper[]);
      }

      if (storedRecent) {
        const parsed: unknown = JSON.parse(storedRecent);
        if (Array.isArray(parsed)) setRecentSearches(parsed as RecentSearch[]);
      }
    } catch {
      console.warn("ResearchFinder: saved browser data could not be loaded.");
    } finally {
      setStorageReady(true);
    }
  }, []);

  // Persist favorites whenever the list changes.
  useEffect(() => {
    if (!storageReady) return;

    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {
      setError("Favorit gagal disimpan di browser.");
    }
  }, [favorites, storageReady]);

  // Persist recent searches whenever the history changes.
  useEffect(() => {
    if (!storageReady) return;

    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches));
    } catch {
      setError("Riwayat pencarian gagal disimpan di browser.");
    }
  }, [recentSearches, storageReady]);

  async function searchPapers(
    searchTerm = query,
    filters?: { from?: string; to?: string }
  ) {
    const term = searchTerm.trim();
    const from = filters?.from ?? yearFrom;
    const to = filters?.to ?? yearTo;

    if (term.length < 2) {
      setError("Masukkan minimal 2 karakter untuk mencari paper.");
      return;
    }

    if (from && to && Number(from) > Number(to)) {
      setError("Tahun awal tidak boleh lebih besar dari tahun akhir.");
      return;
    }

    setQuery(term);
    setYearFrom(from);
    setYearTo(to);
    setViewMode("discover");
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      q: term,
      per_page: "10",
      page: "1",
    });

    if (from) params.set("year_from", from);
    if (to) params.set("year_to", to);

    try {
      const response = await fetch(
        `${API_URL}/api/papers?${params.toString()}`
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.detail || `Pencarian gagal (${response.status}).`
        );
      }

      const data: SearchResponse = await response.json();
      setResults(data);

      const entry: RecentSearch = {
        query: term,
        yearFrom: from,
        yearTo: to,
        timestamp: Date.now(),
      };

      setRecentSearches((current) => [
        entry,
        ...current.filter(
          (item) =>
            !(
              item.query.toLowerCase() === term.toLowerCase() &&
              item.yearFrom === from &&
              item.yearTo === to
            )
        ),
      ].slice(0, 20));
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} Pastikan backend FastAPI berjalan di port 8000.`
          : "Terjadi kesalahan saat mencari paper."
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleFavorite(paper: Paper) {
    setFavorites((current) =>
      current.some((item) => item.id === paper.id)
        ? current.filter((item) => item.id !== paper.id)
        : [paper, ...current]
    );
  }

  function isFavorite(id: string) {
    return favorites.some((paper) => paper.id === id);
  }

  async function askAssistant(paper: Paper) {
    const question =
      assistantQuestions[paper.id]?.trim() ||
      "What are the main findings and limitations?";

    if (question.length < 3) {
      setAssistantErrors((current) => ({
        ...current,
        [paper.id]: "Pertanyaan minimal 3 karakter.",
      }));
      return;
    }

    if (!paper.abstract.trim()) {
      setAssistantErrors((current) => ({
        ...current,
        [paper.id]: "Abstrak paper tidak tersedia untuk dianalisis.",
      }));
      return;
    }

    setAssistantLoading(paper.id);
    setAssistantErrors((current) => ({ ...current, [paper.id]: "" }));

    try {
      const response = await fetch(`${API_URL}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: paper.title,
          abstract: paper.abstract,
          question,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail || `AI Assistant gagal (${response.status}).`
        );
      }

      if (!data || typeof data.answer !== "string") {
        throw new Error("Format respons AI Assistant tidak sesuai.");
      }

      setAssistantResults((current) => ({
        ...current,
        [paper.id]: {
          answer: data.answer,
          evidence: Array.isArray(data.evidence) ? data.evidence : [],
          source: data.source,
          model: data.model,
        },
      }));
    } catch (err) {
      setAssistantErrors((current) => ({
        ...current,
        [paper.id]:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat menghubungi AI Assistant.",
      }));
    } finally {
      setAssistantLoading((current) =>
        current === paper.id ? null : current
      );
    }
  }

  function clearRecentSearches() {
    setRecentSearches([]);
  }

  const currentPapers =
    viewMode === "saved"
      ? favorites
      : results?.papers ?? [];

  const papers = [...currentPapers].sort((a, b) => {
    if (sortBy === "citations") {
      return b.cited_by_count - a.cited_by_count;
    }

    return (
      (b.relevance_score ?? -Infinity) -
      (a.relevance_score ?? -Infinity)
    );
  });

  const pageTitle =
    viewMode === "saved"
      ? "Saved Papers"
      : viewMode === "recent"
        ? "Recent Search"
        : results
          ? "Papers matching your query"
          : "Start exploring";

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        {/* SIDEBAR */}
        <aside className="hidden w-[245px] shrink-0 border-r border-white/[0.07] px-5 py-7 lg:flex lg:flex-col">
          <button
            type="button"
            onClick={() => {
              setViewMode("discover");
              setError("");
              document.getElementById("search")?.scrollIntoView({
                behavior: "smooth",
              });
            }}
            className="mb-12 flex items-center gap-3 text-left"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-indigo-400/20 bg-[#0b1e3a]">
              <img
                src="/researchfinder-logo.png"
                alt="ResearchFinder AI"
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <div className="text-[15px] font-bold tracking-tight">
                ResearchFinder
              </div>
              <div className="text-xs text-indigo-300">AI Workspace</div>
            </div>
          </button>

          <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            Workspace
          </div>

          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setViewMode("discover");
                setError("");
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                viewMode === "discover"
                  ? "border border-indigo-400/15 bg-indigo-500/10 font-medium text-indigo-200"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              <span>⌕</span> Discover Papers
            </button>

            <button
              type="button"
              onClick={() => {
                setViewMode("recent");
                setError("");
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                viewMode === "recent"
                  ? "border border-indigo-400/15 bg-indigo-500/10 font-medium text-indigo-200"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              <span>◷</span> Recent Search
              <span className="ml-auto rounded-md bg-white/[0.06] px-2 py-0.5 text-xs">
                {recentSearches.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setViewMode("saved");
                setError("");
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                viewMode === "saved"
                  ? "border border-indigo-400/15 bg-indigo-500/10 font-medium text-indigo-200"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              <span>☆</span> Saved Papers
              <span className="ml-auto rounded-md bg-white/[0.06] px-2 py-0.5 text-xs">
                {favorites.length}
              </span>
            </button>
          </nav>

          <div className="mb-3 mt-10 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            Research tools
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-500">
              <span>✧</span> AI Discovery
              <span className="ml-auto text-[9px] text-indigo-300">API</span>
            </div>
            <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-500">
              <span>▤</span> Citation Explorer
              <span className="ml-auto text-[9px]">Soon</span>
            </div>
          </div>

          <div className="mt-auto rounded-2xl border border-indigo-400/15 bg-gradient-to-br from-indigo-500/10 to-violet-500/[0.03] p-4">
            <div className="mb-2 text-lg">✦</div>
            <div className="text-sm font-semibold">Research smarter</div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Temukan literatur akademik untuk mendukung penelitianmu.
            </p>
            <div className="mt-4 text-[10px] text-slate-500">
              POWERED BY OPENALEX
            </div>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <section className="min-w-0 flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-9">
          
          {/* MOBILE NAVIGATION */}
          <nav className="mb-6 grid grid-cols-3 gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => {
                setViewMode("discover");
                setError("");
              }}
              className={`rounded-xl border px-3 py-3 text-xs font-medium transition ${
                viewMode === "discover"
                  ? "border-indigo-400/30 bg-indigo-500/15 text-indigo-200"
                  : "border-white/10 bg-white/[0.03] text-slate-400"
              }`}
            >
              ⌕ Discover
            </button>

            <button
              type="button"
              onClick={() => {
                setViewMode("recent");
                setError("");
              }}
              className={`rounded-xl border px-3 py-3 text-xs font-medium transition ${
                viewMode === "recent"
                  ? "border-indigo-400/30 bg-indigo-500/15 text-indigo-200"
                  : "border-white/10 bg-white/[0.03] text-slate-400"
              }`}
            >
              ◷ Recent ({recentSearches.length})
            </button>

            <button
              type="button"
              onClick={() => {
                setViewMode("saved");
                setError("");
              }}
              className={`rounded-xl border px-3 py-3 text-xs font-medium transition ${
                viewMode === "saved"
                  ? "border-indigo-400/30 bg-indigo-500/15 text-indigo-200"
                  : "border-white/10 bg-white/[0.03] text-slate-400"
              }`}
            >
              ☆ Saved ({favorites.length})
            </button>
          </nav>

          <header className="mb-10 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs text-slate-500">
                WORKSPACE /{" "}
                {viewMode === "saved"
                  ? "SAVED PAPERS"
                  : viewMode === "recent"
                    ? "RECENT SEARCH"
                    : "DISCOVERY"}
              </div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                Research workspace
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400 sm:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                OpenAlex connected
              </div>
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-indigo-400/20 bg-[#0b1e3a]">
                <img
                  src="/researchfinder-logo.png"
                  alt="ResearchFinder AI"
                  className="h-full w-full object-contain p-1"
                />
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-5xl">
            {/* SEARCH HERO */}
            {viewMode === "discover" && (
              <>
                <div className="mb-8 text-center">
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/[0.08] px-3 py-1.5 text-xs text-indigo-200">
                    <span>✦</span> AI-powered research discovery
                  </div>
                  <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
                    Find your next
                    <br />
                    <span className="gradient-text">
                      research breakthrough.
                    </span>
                  </h2>
                  <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">
                    Jelajahi jutaan publikasi ilmiah dan temukan literatur
                    yang relevan untuk ide penelitianmu.
                  </p>
                </div>

                <div id="search" className="panel p-4 sm:p-5">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void searchPapers();
                    }}
                  >
                    <label
                      htmlFor="query"
                      className="mb-3 block text-xs font-medium text-slate-300"
                    >
                      What do you want to research?
                    </label>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-[#090e1a] px-4 transition focus-within:border-indigo-400/60">
                        <svg
                          viewBox="0 0 24 24"
                          width="20"
                          height="20"
                          fill="none"
                          stroke="#8b93aa"
                          strokeWidth="1.8"
                        >
                          <circle cx="10.5" cy="10.5" r="6.5" />
                          <path d="m15.5 15.5 5 5" />
                        </svg>
                        <input
                          id="query"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="e.g. artificial intelligence in healthcare"
                          className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"
                          minLength={2}
                          maxLength={200}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {loading ? "Searching..." : "⌕ Search papers"}
                      </button>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <span className="text-xs text-slate-500">
                        Publication year
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          aria-label="From year"
                          type="number"
                          min="1900"
                          max="2100"
                          value={yearFrom}
                          onChange={(event) => setYearFrom(event.target.value)}
                          placeholder="From"
                          className="w-24 rounded-lg border border-white/10 bg-[#090e1a] px-3 py-2 text-xs outline-none focus:border-indigo-400/60"
                        />
                        <span className="text-xs text-slate-600">to</span>
                        <input
                          aria-label="To year"
                          type="number"
                          min="1900"
                          max="2100"
                          value={yearTo}
                          onChange={(event) => setYearTo(event.target.value)}
                          placeholder="To"
                          className="w-24 rounded-lg border border-white/10 bg-[#090e1a] px-3 py-2 text-xs outline-none focus:border-indigo-400/60"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setYearFrom("");
                            setYearTo("");
                          }}
                          className="px-2 text-xs text-slate-500 hover:text-white"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </form>

                  <div className="mt-5 border-t border-white/[0.07] pt-4">
                    <div className="mb-3 text-[11px] text-slate-500">
                      POPULAR TOPICS
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => {
                            setQuery(suggestion);
                            void searchPapers(suggestion);
                          }}
                          className="rounded-full border border-white/[0.09] bg-white/[0.025] px-3 py-2 text-xs text-slate-300 transition hover:border-indigo-400/40 hover:bg-indigo-500/10 hover:text-indigo-200"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* RECENT SEARCH VIEW */}
            {viewMode === "recent" && (
              <div className="mb-8">
                <div className="mb-6">
                  <div className="text-xs font-medium text-indigo-300">
                    YOUR WORKSPACE
                  </div>
                  <h2 className="mt-2 text-3xl font-semibold">Recent Search</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Buka kembali pencarian yang pernah lu lakukan.
                  </p>
                </div>

                {recentSearches.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={clearRecentSearches}
                        className="text-xs text-rose-300 hover:text-rose-200"
                      >
                        Clear history
                      </button>
                    </div>

                    {recentSearches.map((item) => (
                      <div
                        key={`${item.query}-${item.timestamp}`}
                        className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <h3 className="break-words text-sm font-semibold text-slate-100">
                            {item.query}
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.yearFrom || item.yearTo
                              ? `Tahun: ${item.yearFrom || "awal"} – ${item.yearTo || "terbaru"}`
                              : "Semua tahun"}{" "}
                            ·{" "}
                            {new Date(item.timestamp).toLocaleString("id-ID")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void searchPapers(item.query, {
                              from: item.yearFrom,
                              to: item.yearTo,
                            })
                          }
                          disabled={loading}
                          className="shrink-0 rounded-lg bg-indigo-500/10 px-4 py-2.5 text-xs font-medium text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
                        >
                          Search again ↗
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="panel px-6 py-14 text-center">
                    <div className="text-3xl">◷</div>
                    <h3 className="mt-4 font-semibold">
                      Belum ada riwayat pencarian
                    </h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                      Pencarian yang berhasil akan muncul di sini secara
                      otomatis.
                    </p>
                    <button
                      type="button"
                      onClick={() => setViewMode("discover")}
                      className="mt-5 rounded-lg bg-indigo-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-400"
                    >
                      Discover papers
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* SAVED PAPERS VIEW */}
            {viewMode === "saved" && (
              <div className="mb-8">
                <div className="mb-6">
                  <div className="text-xs font-medium text-indigo-300">
                    YOUR LIBRARY
                  </div>
                  <h2 className="mt-2 text-3xl font-semibold">Saved Papers</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    {favorites.length} paper tersimpan di browser lu.
                  </p>
                </div>

                {favorites.length === 0 && (
                  <div className="panel px-6 py-14 text-center">
                    <div className="text-3xl">☆</div>
                    <h3 className="mt-4 font-semibold">
                      Library lu masih kosong
                    </h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                      Cari paper, lalu tekan tombol “☆ Save paper” untuk
                      menyimpannya ke sini.
                    </p>
                    <button
                      type="button"
                      onClick={() => setViewMode("discover")}
                      className="mt-5 rounded-lg bg-indigo-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-400"
                    >
                      Find papers
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ERROR MESSAGE */}
            {error && (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/[0.07] p-4 text-sm text-rose-200"
              >
                {error}
                <button
                  type="button"
                  onClick={() => setError("")}
                  className="ml-3 underline"
                >
                  Tutup
                </button>
              </div>
            )}

            {/* RESULTS HEADER */}
            {viewMode !== "recent" && (
              <div className="mb-4 mt-10 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-indigo-300">
                    {viewMode === "saved" ? "YOUR LIBRARY" : "DISCOVERY RESULTS"}
                  </div>
                  <h3 className="mt-2 text-xl font-semibold">{pageTitle}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {viewMode === "saved"
                      ? `${papers.length} paper tersimpan`
                      : results
                        ? `Showing ${papers.length} papers for “${results.query}”`
                        : "Hasil penelitian akan muncul di sini setelah pencarian."}
                  </p>
                </div>

                {(viewMode === "saved" ? favorites.length > 0 : results) && (
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      Sort by
                      <select
                        value={sortBy}
                        onChange={(event) =>
                          setSortBy(event.target.value as SortOption)
                        }
                        className="rounded-lg border border-white/10 bg-[#101525] px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-400/60"
                      >
                        <option value="relevance">AI Relevance</option>
                        <option value="citations">Most Cited</option>
                      </select>
                    </label>

                    {viewMode === "discover" && results && (
                      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
                        {formatNumber(results.total)} records found
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* LOADING */}
            {loading && (
              <div className="panel flex flex-col items-center px-6 py-16 text-center">
                <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-indigo-300/20 border-t-indigo-400" />
                <p className="text-sm font-medium">
                  Searching academic papers...
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Mengambil publikasi dari OpenAlex dan menghitung kemiripan
                  semantik.
                </p>
              </div>
            )}

            {/* PAPER CARDS */}
            {!loading &&
              papers.length > 0 &&
              viewMode !== "recent" && (
                <div className="space-y-4">
                  {papers.map((paper, index) => (
                    <article
                      key={paper.id}
                      className="panel p-5 transition duration-200 hover:border-indigo-400/30 sm:p-6"
                    >
                      <div className="flex items-start gap-4">
                        <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-sm font-semibold text-slate-400 sm:flex">
                          {String(index + 1).padStart(2, "0")}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="rounded-md border border-indigo-400/20 bg-indigo-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-200">
                              {paper.type || "Research paper"}
                            </span>
                            {paper.year && (
                              <span className="text-xs text-slate-400">
                                {paper.year}
                              </span>
                            )}
                            {typeof paper.relevance_score === "number" && (
                              <span className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-1 text-[10px] font-semibold text-emerald-300">
                                ✦ AI Similarity{" "}
                                {paper.relevance_score.toFixed(3)}
                              </span>
                            )}
                            <span className="text-slate-700">·</span>
                            <span className="text-xs text-slate-400">
                              {formatNumber(paper.cited_by_count)} citations
                            </span>
                          </div>

                          <h4 className="text-base font-semibold leading-7 tracking-tight text-slate-100 sm:text-lg">
                            {paper.title}
                          </h4>

                          <p className="mt-2 text-xs leading-5 text-slate-400">
                            {paper.authors.length > 0
                              ? paper.authors.slice(0, 5).join(", ") +
                                (paper.authors.length > 5 ? " et al." : "")
                              : "Author information unavailable"}
                          </p>

                          <p className="mt-4 text-sm leading-7 text-slate-400">
                            {paper.abstract
                              ? paper.abstract.length > 450
                                ? `${paper.abstract.slice(0, 450)}...`
                                : paper.abstract
                              : "Abstract tidak tersedia untuk publikasi ini."}
                          </p>

                          {/* AI RESEARCH ASSISTANT */}
                          <div className="mt-5 rounded-xl border border-indigo-400/20 bg-indigo-500/[0.04] p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-lg text-indigo-300">✦</span>
                              <h5 className="text-sm font-semibold text-indigo-200">
                                AI Research Assistant
                              </h5>
                              <span className="rounded-md border border-indigo-400/20 bg-indigo-500/10 px-2 py-1 text-[9px] text-indigo-300">
                                ABSTRACT-BASED
                              </span>
                            </div>

                            <p className="mt-2 text-xs leading-5 text-slate-400">
                              Ajukan pertanyaan untuk menemukan kalimat abstrak
                              yang paling relevan dengan pertanyaanmu.
                            </p>

                            <form
                              className="mt-3 flex flex-col gap-2 sm:flex-row"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void askAssistant(paper);
                              }}
                            >
                              <input
                                value={
                                  assistantQuestions[paper.id] ??
                                  "What are the main findings and limitations?"
                                }
                                onChange={(event) =>
                                  setAssistantQuestions((current) => ({
                                    ...current,
                                    [paper.id]: event.target.value,
                                  }))
                                }
                                placeholder="Ask something about this paper..."
                                maxLength={500}
                                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#090e1a] px-3 py-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-400/50"
                              />
                              <button
                                type="submit"
                                disabled={assistantLoading === paper.id}
                                className="rounded-lg bg-indigo-500 px-4 py-3 text-xs font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {assistantLoading === paper.id
                                  ? "Analyzing..."
                                  : "✦ Ask AI"}
                              </button>
                            </form>

                            {assistantErrors[paper.id] && (
                              <div
                                role="alert"
                                className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs leading-5 text-rose-200"
                              >
                                {assistantErrors[paper.id]}
                              </div>
                            )}

                            {assistantResults[paper.id] && (
                              <div className="mt-4 border-t border-white/[0.08] pt-4">
                                <div className="text-xs font-semibold text-emerald-300">
                                  AI Analysis
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                                  {assistantResults[paper.id].answer}
                                </p>

                                {assistantResults[paper.id].evidence.length >
                                  0 && (
                                  <div className="mt-4">
                                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                      Supporting evidence
                                    </div>
                                    <div className="space-y-2">
                                      {assistantResults[
                                        paper.id
                                      ].evidence.map((item, evidenceIndex) => (
                                        <div
                                          key={`${paper.id}-evidence-${evidenceIndex}`}
                                          className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3"
                                        >
                                          <p className="text-xs leading-6 text-slate-300">
                                            “{item.text}”
                                          </p>
                                          {typeof item.similarity ===
                                            "number" && (
                                            <p className="mt-2 text-[10px] text-slate-500">
                                              Semantic similarity:{" "}
                                              {item.similarity.toFixed(3)}
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <p className="mt-3 text-[10px] leading-5 text-slate-500">
                                  Hasil berdasarkan kemiripan semantik dengan
                                  abstrak, bukan jawaban yang dihasilkan LLM.
                                  Periksa kembali konteks paper asli.
                                </p>
                              </div>
                            )}
                          </div>

                          {/* PAPER ACTIONS */}
                          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/[0.07] pt-4">
                            {paper.url && (
                              <a
                                href={paper.url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
                              >
                                Read paper ↗
                              </a>
                            )}

                            <button
                              type="button"
                              onClick={() => toggleFavorite(paper)}
                              aria-pressed={isFavorite(paper.id)}
                              className={`rounded-lg border px-3 py-2 text-xs transition ${
                                isFavorite(paper.id)
                                  ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
                                  : "border-white/10 text-slate-400 hover:text-white"
                              }`}
                            >
                              {isFavorite(paper.id)
                                ? "★ Saved"
                                : "☆ Save paper"}
                            </button>

                            {paper.doi && (
                              <button
                                type="button"
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(paper.doi || "")
                                    .then(() => setError(""))
                                    .catch(() =>
                                      setError(
                                        "DOI gagal disalin ke clipboard."
                                      )
                                    )
                                }
                                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 transition hover:text-white"
                              >
                                Copy DOI
                              </button>
                            )}

                            {viewMode === "saved" && (
                              <button
                                type="button"
                                onClick={() => toggleFavorite(paper)}
                                className="rounded-lg border border-rose-400/20 px-3 py-2 text-xs text-rose-300 transition hover:bg-rose-400/10"
                              >
                                Remove from library
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

            {/* EMPTY STATES */}
            {!loading &&
              viewMode === "discover" &&
              !results && (
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  {[
                    {
                      icon: "⌕",
                      title: "Discover literature",
                      text: "Cari publikasi berdasarkan topik atau pertanyaan penelitian.",
                    },
                    {
                      icon: "◷",
                      title: "Explore by year",
                      text: "Persempit hasil berdasarkan rentang tahun publikasi.",
                    },
                    {
                      icon: "☆",
                      title: "Save useful papers",
                      text: "Simpan paper favorit dan buka kembali kapan saja.",
                    },
                  ].map((item) => (
                    <div key={item.title} className="panel p-5">
                      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-xl text-indigo-300">
                        {item.icon}
                      </div>
                      <h4 className="text-sm font-semibold">{item.title}</h4>
                      <p className="mt-2 text-xs leading-6 text-slate-400">
                        {item.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}

            {!loading &&
              viewMode === "discover" &&
              results &&
              papers.length === 0 && (
                <div className="panel px-6 py-14 text-center">
                  <div className="text-3xl">⌕</div>
                  <h4 className="mt-4 font-semibold">No papers found</h4>
                  <p className="mt-2 text-sm text-slate-400">
                    Coba kata kunci lain atau ubah filter tahun.
                  </p>
                </div>
              )}

            {!loading &&
              viewMode === "saved" &&
              favorites.length > 0 &&
              papers.length === 0 && (
                <div className="panel px-6 py-10 text-center">
                  <p className="text-sm text-slate-400">
                    Tidak ada paper yang cocok dengan pengurutan ini.
                  </p>
                </div>
              )}

            <footer className="mt-12 border-t border-white/[0.07] py-6 text-center text-[11px] text-slate-600">
              ResearchFinder AI · Academic discovery powered by OpenAlex
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
