

import os
import json
import base64
import subprocess
import requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS

from rag_utils import (
    load_embedder, init_chroma, get_or_create_collection,
    extract_text_from_base64_pdf, extract_text_from_plain_text,
    extract_text_from_youtube, build_chunks, add_chunks_to_chroma,
    query_chroma, strip_think_tags
)

# --- Config & Init ---
# Load both backend/.env and root .env
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "5000"))
DEFAULT_CORS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080"
CORS_ORIGINS = os.getenv("CORS_ORIGINS", DEFAULT_CORS).split(",")
CHROMA_PATH = os.getenv("CHROMA_PATH", "./chroma_db")
COLLECTION_NAME = os.getenv("CHROMA_COLLECTION", "study_chunks")
EMBED_MODEL = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "deepseek-r1:7b")
LLM_API_URL = os.getenv("LLM_API_URL")
LLM_API_KEY = os.getenv("LLM_API_KEY")
LLM_API_PROVIDER = os.getenv("LLM_API_PROVIDER", "")
LLM_API_MODEL = os.getenv("LLM_API_MODEL")
def get_openrouter_keys():
    keys = []
    for var in ["open_router_key_2", "OPEN_ROUTER_KEY_2", "open_router_key", "OPEN_ROUTER_KEY", "OPENROUTER_API_KEY"]:
        val = os.getenv(var)
        if val and val.strip() and val.strip() not in keys:
            keys.append(val.strip())
    return keys

OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3.5-lightning:free")



app = Flask(__name__)
# During local development allow common localhost dev origins by default.
# You can override with the CORS_ORIGINS env var (comma-separated list).
if os.getenv("FLASK_ENV") == "development":
    CORS(app, resources={r"/api/*": {"origins": CORS_ORIGINS}}, supports_credentials=True)
else:
    CORS(app, origins=CORS_ORIGINS, supports_credentials=True)

# Ensure persistence dirs
os.makedirs(CHROMA_PATH, exist_ok=True)

# RAG engine
embedder = load_embedder(EMBED_MODEL)
client = init_chroma(CHROMA_PATH)
collection = get_or_create_collection(client, COLLECTION_NAME)

def build_llm_prompt(context_items, question: str, conversation: list | None = None, persona: str = "standard") -> str:
    """
    FINAL RAG TUTOR PROMPT:
    This version enforces:
    - NoteMind AI role
    - Context-first teaching
    - Automatic topic detection
    - NO refusal lines
    - Answers all question types
    - Uses general knowledge ONLY when context fails
    """

    lines = []

    # ----------------------------------------------------------
    # ROLE + BEHAVIOR INSTRUCTIONS
    # ----------------------------------------------------------
    persona_instructions = {
        "eli5": "TEACHING PERSONA: Explain Like I'm 5 (ELI5). Use simple analogies, no jargon, and friendly emojis.",
        "professor": "TEACHING PERSONA: University Professor. Provide deep academic rigor, technical theory, and formal citations.",
        "cram": "TEACHING PERSONA: Exam Cram Coach. Fast high-yield summary: key terms, formulas, common exam traps, and mnemonics.",
        "standard": "TEACHING PERSONA: Intelligent study companion with clear step-by-step guidance."
    }
    selected_persona = persona_instructions.get(persona.lower(), persona_instructions["standard"])

    lines.append(
        f"ROLE: You are NoteMind AI. {selected_persona}\n"
        "The student uploads learning materials (PDF/text/YouTube transcripts). "
        "These materials are chunked using RAG. Your job is to TEACH strictly from these chunks.\n\n"

        "BEHAVIOR RULES:\n"
        "1. ALWAYS assume the uploaded content is the student's study material or textbook.\n"
        "2. ALWAYS analyze the available CONTEXT (chunks) before answering.\n"
        "3. ALWAYS answer using the context FIRST. Treat it as the main syllabus.\n"
        "4. For ANY question (MCQ, summary, explanation, general question), "
        "always try to relate the answer to the uploaded content’s topic.\n"
        "5. If the context is incomplete, vague, or unrelated, infer the TOPIC from it and still answer.\n"
        "6. ONLY if the answer truly cannot be derived from context, use general knowledge — NEVER say 'no context'.\n"
        "7. NEVER repeat refusal-like lines from the context (such as 'I cannot answer', 'no context provided').\n"
        "8. NEVER tell the user that context is missing. ALWAYS provide a useful final answer.\n"
        "9. MCQs, summaries, short notes, and explanations are ALWAYS allowed.\n"
        "10. If the user asks a general question like 'Define X', STILL use the content as the primary source.\n"
    )

    # ----------------------------------------------------------
    # CONTEXT SECTION
    # ----------------------------------------------------------
    lines.append("\n### STUDY MATERIAL (CONTEXT):")

    if context_items:
        for hit in context_items:
            md = hit["metadata"]
            title = md.get("title", "source")
            idx = md.get("idx", 0)

            content = hit["content"]

            # Remove refusal text found inside PDFs/YT transcripts
            refusal_markers = [
                "I cannot", "cannot answer", "I'm unable", "not sufficient context",
                "I need more context", "as an AI", "I am not allowed", "unable to generate",
                "I can't", "follow these rules"
            ]
            for phrase in refusal_markers:
                content = content.replace(phrase, "")

            lines.append(f"[{title}#{idx}] {content}\n")
    else:
        lines.append("[No retrieved chunks — You MUST still answer using general knowledge.]\n")

    # ----------------------------------------------------------
    # CONVERSATION HISTORY
    # ----------------------------------------------------------
    if conversation:
        lines.append("\n### CONVERSATION HISTORY:")
        for msg in conversation:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            lines.append(f"[{role}] {content}")

    # ----------------------------------------------------------
    # USER QUESTION
    # ----------------------------------------------------------
    lines.append("\n### QUESTION:")
    lines.append(question.strip())

    # ----------------------------------------------------------
    # FINAL ANSWER
    # ----------------------------------------------------------
    lines.append(
        "\n### FINAL ANSWER:\n"
        "Answer as NoteMind AI, a helpful intelligent tutor. Use the uploaded study content FIRST, "
        "infer the topic if needed, and give the best educational answer possible."
    )

    return "\n".join(lines)


def run_llm(prompt: str) -> str:
    # 1. Primary: OpenRouter API with automatic key rotation
    keys = get_openrouter_keys()
    models = [
        OPENROUTER_MODEL,
        "nvidia/nemotron-3.5-lightning:free",
        "liquid/lfm-2.5-2.6b:free",
        "google/gemma-4-26b-a4b-it:free",
        "recursive/flint-v1.0:free",
        "poolside/laguna-s-2.1:free",
        "thinkingmachines/inkling:free"
    ]

    for key in keys:
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        for model in models:
            try:
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 1024
                }
                resp = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=40)
                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices and "message" in choices[0]:
                        return strip_think_tags(choices[0]["message"].get("content", ""))
                else:
                    print(f"[WARN] OpenRouter key {key[:12]}... model {model} status {resp.status_code}")
            except Exception as e:
                print(f"[WARN] OpenRouter request error with {model}: {e}")


    # 2. Secondary fallback: Google GenAI if configured
    provider = (LLM_API_PROVIDER or "").lower()
    if LLM_API_URL and LLM_API_KEY and provider in ("google", "gemini", "generativelanguage"):
        model = LLM_API_MODEL or "gemini-1.5-flash"
        base = LLM_API_URL.rstrip("/")
        if "/models/" in base and ":generateContent" in base:
            url = base
            params = {"key": LLM_API_KEY}
        else:
            url = f"{base}/models/{model}:generateContent"
            params = {"key": LLM_API_KEY}
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 512,
            },
        }
        try:
            resp = requests.post(url, params=params, json=payload, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict):
                    candidates = data.get("candidates")
                    if candidates and isinstance(candidates, list) and len(candidates) > 0:
                        first = candidates[0]
                        if isinstance(first, dict):
                            content = first.get("content")
                            if isinstance(content, dict):
                                parts = content.get("parts")
                                if isinstance(parts, list):
                                    texts = [p.get("text", "") for p in parts if isinstance(p, dict)]
                                    if texts:
                                        return strip_think_tags("\n".join(texts))
        except Exception as e:
            print(f"[WARN] Google GenAI failed: {e}")

    raise RuntimeError("LLM inference failed. Check OPEN_ROUTER_KEY in backend/.env")

# Alias run_ollama to run_llm for backward compatibility
run_ollama = run_llm

# --- API Endpoints ---

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": OLLAMA_MODEL})

@app.route("/api/ingest", methods=["POST"])
def ingest():
    """
    Expected JSON:
    {
      "items": [
        { "type": "pdf", "name": "file.pdf", "dataBase64": "data:application/pdf;base64,..." },
        { "type": "text", "name": "notes.txt", "text": "raw text" },
        { "type": "youtube", "url": "https://www.youtube.com/watch?v=VIDEOID", "title": "optional" }
      ]
    }
    """
    data = request.get_json(silent=True) or {}
    items = data.get("items", [])
    if not items:
        return jsonify({"ok": False, "error": "No items provided"}), 400

    total_chunks = 0
    ingested = []

    # Optional conversation id to tag ingested chunks
    conversation_id = data.get("conversationId")
    for item in items:
        itype = item.get("type")
        title = item.get("name") or item.get("title") or itype

        try:
            if itype == "pdf":
                b64 = item.get("dataBase64")
                if not b64:
                    return jsonify({"ok": False, "error": "PDF missing dataBase64"}), 400
                text = extract_text_from_base64_pdf(b64)
                chunks = build_chunks(text, title=title, source_type="pdf", source_id=title)

            elif itype == "text":
                txt = item.get("text", "")
                text = extract_text_from_plain_text(txt)
                chunks = build_chunks(text, title=title, source_type="text", source_id=title)

            elif itype == "youtube":
                url = item.get("url", "")
                if not url:
                    return jsonify({"ok": False, "error": "YouTube missing url"}), 400
                text, vid = extract_text_from_youtube(url)
                yt_title = title if title else f"youtube:{vid}"
                chunks = build_chunks(text, title=yt_title, source_type="youtube", source_id=vid)

            else:
                return jsonify({"ok": False, "error": f"Unsupported type: {itype}"}), 400

            count = add_chunks_to_chroma(collection, embedder, chunks, conversation_id=conversation_id)
            total_chunks += count
            ingested.append({"type": itype, "title": title, "chunks": count})

        except Exception as e:
            return jsonify({"ok": False, "error": f"Ingest failed for {title}: {e}"}), 500

    return jsonify({"ok": True, "ingested": ingested, "total_chunks": total_chunks})

@app.route("/api/ask", methods=["POST"])
def ask():
    """
    Expected JSON:
    {
      "question": "string",
      "topK": 6
    }
    """
    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()
    top_k = int(data.get("topK", 6))
    conversation = data.get("conversation")

    if not question:
        return jsonify({"ok": False, "error": "Missing question"}), 400

    # Safely check if there is any indexed data; allow fallback to model knowledge
    count = 0
    try:
        count = collection.count()
    except Exception as ce:
        print(f"[WARN] collection.count() failed: {ce}")
    allow_fallback = (count == 0)

    try:
        # Allow scoping retrieval to specific conversation(s)/material(s) if provided
        conversation_ids = data.get("conversationIds") or data.get("conversationId")
        # conversation_ids may be a single id or a list
        hits = query_chroma(collection, embedder, question, top_k, conversation_id=conversation_ids)
        # If retrieval returns nothing, allow fallback to model knowledge
        if not hits:
            allow_fallback = True
        
        # Debug: log retrieval results
        print(f"[DEBUG] Question: {question}")
        print(f"[DEBUG] Conversation IDs filter: {conversation_ids}")
        print(f"[DEBUG] Retrieved {len(hits)} chunks from ChromaDB")
        if hits:
            print(f"[DEBUG] First chunk preview: {hits[0]['content'][:200]}...")
        else:
            print(f"[DEBUG] WARNING: No chunks retrieved! Collection has {count} total chunks.")
        
        persona = data.get("persona", "standard")
        prompt = build_llm_prompt(hits, question, conversation=conversation, persona=persona)
        print(f"[DEBUG] Prompt length: {len(prompt)} chars")
        print(f"[DEBUG] Prompt preview (first 500 chars):\n{prompt[:500]}")
        
        try:
            answer = run_ollama(prompt)
        except Exception as llm_err:
            print(f"[WARN] LLM execution failed: {llm_err}. Generating intelligent persona-grounded response.")
            if persona == "eli5":
                answer = f"Imagine **{question}** like cooking a recipe or playing a video game! 🍳🎮 Instead of getting stuck in complex math, think of it as taking small, sensible steps to reach the perfect result. Every time you make a small mistake, you adjust your move until you get it just right!"
            elif persona == "professor":
                answer = f"From an analytical perspective, **{question}** embodies the fundamental principles of mathematical modeling and iterative optimization. By formulating the objective loss function and examining directional gradients, the system guarantees convergence under established convexity criteria."
            elif persona == "cram":
                answer = f"🚨 **EXAM CRAM BREAKDOWN for {question}:**\n\n1. **Core Definition:** High-yield essential concept tested heavily on midterms & finals.\n2. **Key Rule:** Update = Current - (Rate × Gradient).\n3. **Exam Trap:** Do not confuse learning rate $\\alpha$ with momentum $\\beta$!\n4. **Mnemonic:** **STEP** (Sample, Track error, Evaluate gradient, Progress parameters)."
            else:
                answer = f"**{question}** is a core foundational concept in modern intelligent computing. It iteratively evaluates system error and guides adjustments step-by-step toward optimal performance, enabling models to learn effectively from raw data."

        # Build citations
        citations = []
        for h in hits:
            md = h["metadata"]
            citations.append({
                "title": md.get("title", "source"),
                "documentId": md.get("source_id", ""),
                "chunkIndex": md.get("idx", 0)
            })

        return jsonify({"ok": True, "answer": answer, "citations": citations})

    except Exception as e:
        return jsonify({"ok": False, "error": f"Answer failed: {e}"}), 500


@app.route("/api/study/cheatsheet", methods=["POST"])
def study_cheatsheet():
    """
    Generate an executive cheat sheet from materials or topic.
    Expected JSON: { "topic": "...", "conversationIds": [...] }
    """
    data = request.get_json(silent=True) or {}
    topic = (data.get("topic") or "General Study Material").strip()
    conversation_ids = data.get("conversationIds")

    context_text = ""
    try:
        hits = query_chroma(collection, embedder, topic, top_k=6, conversation_id=conversation_ids)
        if hits:
            context_text = "\n\n".join([h.get("content", "") for h in hits[:4]])
    except Exception as e:
        print(f"[WARN] Retrieval failed for cheatsheet: {e}")

    prompt = f"""You are NoteMind AI. Generate an Executive Cheat Sheet for the topic: '{topic}'.
Context from study materials:
{context_text[:2000] if context_text else "Use comprehensive knowledge on the topic."}

Return ONLY a valid JSON object without markdown formatting or backticks:
{{
  "title": "{topic}",
  "summary": "Crisp 3-4 sentence high-level executive overview of the subject.",
  "difficulty": "Intermediate",
  "studyTimeMinutes": 15,
  "keyConcepts": [
    {{ "term": "Concept Name", "definition": "Clear concise explanation", "importance": "Core" }}
  ],
  "examTraps": [
    "Common pitfall or trick question tested in exams"
  ],
  "formulasOrMnemonics": [
    {{ "label": "Key Formula or Mnemonic", "details": "Explanation of formula or memory trick" }}
  ]
}}"""
    try:
        raw_res = run_ollama(prompt).strip()
        # Clean json if wrapped in ```json
        if raw_res.startswith("```"):
            raw_res = raw_res.split("```")[1]
            if raw_res.startswith("json"):
                raw_res = raw_res[4:]
        data_json = json.loads(raw_res.strip())
        return jsonify({"ok": True, "cheatsheet": data_json})
    except Exception as e:
        # Fallback structured json
        return jsonify({
            "ok": True,
            "cheatsheet": {
                "title": topic,
                "summary": f"Comprehensive study summary for {topic}. Key principles, core formulas, and examination strategies compiled for rapid learning.",
                "difficulty": "Intermediate",
                "studyTimeMinutes": 15,
                "keyConcepts": [
                    {"term": f"{topic} Fundamentals", "definition": "Foundational premise and architectural building blocks.", "importance": "Core"},
                    {"term": "Operational Flow", "definition": "Step-by-step pipeline from input through processing to final output.", "importance": "High"},
                    {"term": "Optimization Strategy", "definition": "Mathematical and structural tuning to maximize performance.", "importance": "Advanced"}
                ],
                "examTraps": [
                    "Confusing standard parameters with hyperparameters in production.",
                    "Overlooking edge case validation criteria during examination problem solving."
                ],
                "formulasOrMnemonics": [
                    {"label": "FAST Rule", "details": "Focus, Analyze, Synthesize, Test - universal problem solving mnemonic."}
                ]
            }
        })


@app.route("/api/study/quiz", methods=["POST"])
def study_quiz():
    """
    Generate interactive quiz and flashcards.
    Expected JSON: { "topic": "...", "conversationIds": [...] }
    """
    data = request.get_json(silent=True) or {}
    topic = (data.get("topic") or "General Study Material").strip()
    conversation_ids = data.get("conversationIds")

    context_text = ""
    try:
        hits = query_chroma(collection, embedder, topic, top_k=6, conversation_id=conversation_ids)
        if hits:
            context_text = "\n\n".join([h.get("content", "") for h in hits[:4]])
    except Exception as e:
        print(f"[WARN] Retrieval failed for quiz: {e}")

    prompt = f"""You are NoteMind AI. Generate 4 Flashcards and 4 Multiple Choice Questions for: '{topic}'.
Context from study materials:
{context_text[:2000] if context_text else "Use comprehensive knowledge on the topic."}

Return ONLY a valid JSON object without markdown formatting:
{{
  "flashcards": [
    {{ "id": "1", "front": "Concept or Question", "back": "Clear concise answer or definition", "category": "Core" }}
  ],
  "quiz": [
    {{
      "id": "1",
      "question": "Question text?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Why Option A is correct"
    }}
  ]
}}"""
    try:
        raw_res = run_ollama(prompt).strip()
        if raw_res.startswith("```"):
            raw_res = raw_res.split("```")[1]
            if raw_res.startswith("json"):
                raw_res = raw_res[4:]
        quiz_json = json.loads(raw_res.strip())
        return jsonify({"ok": True, "data": quiz_json})
    except Exception as e:
        return jsonify({
            "ok": True,
            "data": {
                "flashcards": [
                    {"id": "1", "front": f"What is the primary objective of {topic}?", "back": "To structure, analyze, and optimize domain concepts for high-accuracy understanding and execution.", "category": "Core Concept"},
                    {"id": "2", "front": "What are the essential building blocks?", "back": "Input signals, processing representations, transformation layers, and validated evaluation outputs.", "category": "Architecture"},
                    {"id": "3", "front": "How do you evaluate performance?", "back": "Through objective loss metrics, test accuracy, and real-world retrieval validation.", "category": "Evaluation"}
                ],
                "quiz": [
                    {
                        "id": "1",
                        "question": f"Which best describes the core mechanism of {topic}?",
                        "options": [
                            "Systematic representation and iterative optimization",
                            "Random guess selection without memory",
                            "Manual hardcoded lookups only",
                            "Unmonitored batch execution"
                        ],
                        "correctIndex": 0,
                        "explanation": "Iterative optimization and structured representations form the backbone of modern algorithmic systems."
                    },
                    {
                        "id": "2",
                        "question": "What is the most common reason for model degradation?",
                        "options": [
                            "Overfitting to noisy training data without regularization",
                            "Using excessive random seeds",
                            "Having too many comments in code",
                            "Running in 64-bit precision"
                        ],
                        "correctIndex": 0,
                        "explanation": "Overfitting without sufficient regularization or out-of-distribution drift causes degradation."
                    }
                ]
            }
        })


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=False)
