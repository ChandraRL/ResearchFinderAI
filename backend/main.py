
import re
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer, util


# =========================================================
# CONFIGURATION
# =========================================================

OPENALEX_URL = "https://api.openalex.org/works"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# Model akan dimuat satu kali saat server mulai.
model: SentenceTransformer | None = None


# =========================================================
# APPLICATION LIFESPAN
# =========================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model

    print(f"Loading semantic search model: {MODEL_NAME}")

    model = SentenceTransformer(MODEL_NAME)

    print("Semantic search model is ready.")

    yield

    print("ResearchFinder AI is shutting down.")


# =========================================================
# FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="ResearchFinder AI",
    description=(
        "Academic paper discovery with semantic ranking "
        "and an evidence-based research assistant."
    ),
    version="2.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# REQUEST / RESPONSE MODELS
# =========================================================

class AssistantRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    abstract: str = Field(default="", max_length=15000)
    question: str = Field(min_length=3, max_length=500)


# =========================================================
# HELPER FUNCTIONS
# =========================================================

def get_model() -> SentenceTransformer:
    """Memastikan model tersedia sebelum digunakan."""
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="AI model is still loading. Please try again.",
        )

    return model


def reconstruct_abstract(
    inverted_index: dict[str, list[int]] | None,
) -> str:
    """Mengubah OpenAlex abstract inverted index menjadi teks biasa."""
    if not inverted_index:
        return ""

    words: dict[int, str] = {}

    for word, positions in inverted_index.items():
        for position in positions:
            words[position] = word

    if not words:
        return ""

    return " ".join(
        words[position] for position in sorted(words)
    )


def split_sentences(text: str) -> list[str]:
    """Memecah abstrak menjadi kalimat sederhana."""
    text = re.sub(r"\s+", " ", text).strip()

    if not text:
        return []

    return [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", text)
        if len(sentence.strip()) > 15
    ]


# =========================================================
# BASIC ENDPOINTS
# =========================================================

@app.get("/")
def home():
    return {
        "app": "ResearchFinder AI",
        "status": "ok",
        "semantic_search": True,
        "research_assistant": True,
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "model": MODEL_NAME,
    }


# =========================================================
# SEMANTIC PAPER SEARCH
# =========================================================

@app.get("/api/papers")
async def search_papers(
    q: str = Query(min_length=2, max_length=200),
    year_from: int | None = Query(
        default=None, ge=1900, le=2100
    ),
    year_to: int | None = Query(
        default=None, ge=1900, le=2100
    ),
    page: int = Query(default=1, ge=1, le=100),
    per_page: int = Query(default=10, ge=1, le=50),
):
    if year_from and year_to and year_from > year_to:
        raise HTTPException(
            status_code=400,
            detail="year_from cannot be greater than year_to",
        )

    embedding_model = get_model()

    filters = []

    if year_from is not None:
        filters.append(
            f"from_publication_date:{year_from}-01-01"
        )

    if year_to is not None:
        filters.append(
            f"to_publication_date:{year_to}-12-31"
        )

    params: dict[str, Any] = {
        "search": q,
        "page": page,
        "per-page": per_page,
    }

    if filters:
        params["filter"] = ",".join(filters)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                OPENALEX_URL,
                params=params,
            )
            response.raise_for_status()
            data = response.json()

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail="OpenAlex returned an unsuccessful response.",
        ) from exc

    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve papers from OpenAlex.",
        ) from exc

    papers = []

    for item in data.get("results", []):
        authors = [
            authorship.get("author", {}).get("display_name")
            for authorship in item.get("authorships", [])
            if authorship.get("author", {}).get("display_name")
        ]

        abstract = reconstruct_abstract(
            item.get("abstract_inverted_index")
        )

        papers.append({
            "id": item.get("id") or "",
            "title": item.get("title") or "Untitled",
            "year": item.get("publication_year"),
            "authors": authors,
            "abstract": abstract,
            "doi": item.get("doi"),
            "url": item.get("doi") or item.get("id") or "",
            "cited_by_count": item.get("cited_by_count", 0),
            "type": item.get("type") or "Research paper",
        })

    if papers:
        query_embedding = embedding_model.encode(
            q,
            convert_to_tensor=True,
            normalize_embeddings=True,
        )

        paper_texts = [
            f"{paper['title']}. {paper['abstract'][:1500]}"
            for paper in papers
        ]

        paper_embeddings = embedding_model.encode(
            paper_texts,
            convert_to_tensor=True,
            normalize_embeddings=True,
            batch_size=16,
            show_progress_bar=False,
        )

        similarities = util.cos_sim(
            query_embedding,
            paper_embeddings,
        )[0]

        for paper, score in zip(
            papers, similarities.tolist()
        ):
            paper["relevance_score"] = round(
                float(score), 4
            )

        papers.sort(
            key=lambda paper: paper["relevance_score"],
            reverse=True,
        )

    return {
        "query": q,
        "page": page,
        "per_page": per_page,
        "total": data.get("meta", {}).get("count", 0),
        "ranking": "semantic_similarity",
        "model": MODEL_NAME,
        "papers": papers,
    }


# =========================================================
# AI RESEARCH ASSISTANT
# =========================================================

@app.post("/api/assistant")
def research_assistant(request: AssistantRequest):
    embedding_model = get_model()

    abstract = request.abstract.strip()

    if not abstract:
        return {
            "answer": (
                "Abstrak tidak tersedia untuk paper ini. "
                "Buka publikasi asli untuk mendapatkan "
                "informasi yang dibutuhkan."
            ),
            "evidence": [],
            "source": "abstract",
            "model": MODEL_NAME,
        }

    sentences = split_sentences(abstract)

    if not sentences:
        return {
            "answer": (
                "Abstrak tidak memiliki kalimat yang cukup "
                "untuk dianalisis."
            ),
            "evidence": [],
            "source": "abstract",
            "model": MODEL_NAME,
        }

    question_embedding = embedding_model.encode(
        request.question,
        convert_to_tensor=True,
        normalize_embeddings=True,
    )

    sentence_embeddings = embedding_model.encode(
        sentences,
        convert_to_tensor=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    )

    scores = util.cos_sim(
        question_embedding,
        sentence_embeddings,
    )[0]

    ranked_indices = scores.argsort(
        descending=True
    ).tolist()

    best_score = float(scores[ranked_indices[0]].item())

    # Ambang heuristik awal, bukan probabilitas kebenaran.
    similarity_threshold = 0.20

    if best_score < similarity_threshold:
        return {
            "answer": (
                "Belum ditemukan kalimat abstrak yang cukup "
                "relevan untuk menjawab pertanyaan ini. "
                "Coba ubah pertanyaan atau periksa teks "
                "lengkap paper."
            ),
            "evidence": [],
            "source": "abstract",
            "model": MODEL_NAME,
        }

    evidence = []

    for index in ranked_indices[:3]:
        score = float(scores[index].item())

        if score < similarity_threshold:
            continue

        evidence.append({
            "text": sentences[index],
            "similarity": round(score, 4),
        })

    answer = (
        f"Berdasarkan abstrak paper \"{request.title}\", "
        "berikut kalimat yang paling relevan dengan "
        "pertanyaanmu. Hasil ini merupakan ekstraksi "
        "bukti dari abstrak, bukan kesimpulan otomatis "
        "dari keseluruhan isi paper."
    )

    return {
        "answer": answer,
        "evidence": evidence,
        "source": "abstract",
        "model": MODEL_NAME,
    }
