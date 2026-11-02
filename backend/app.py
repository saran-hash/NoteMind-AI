

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

def get_openrouter_keys():
    backend_env = os.path.join(os.path.dirname(__file__), ".env")
    root_env = os.path.join(os.path.dirname(__file__), "..", ".env")
    for env_path in [backend_env, root_env]:
        if os.path.exists(env_path):
            try:
                load_dotenv(env_path, override=True)
            except Exception:
                pass

    keys = []
    for var in [
        "open_router_key_3", "OPEN_ROUTER_KEY_3", "OPENROUTER_API_KEY_3",
        "open_router_key_2", "OPEN_ROUTER_KEY_2", "OPENROUTER_API_KEY_2",
        "open_router_key", "OPEN_ROUTER_KEY", "OPENROUTER_API_KEY"
    ]:
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
        "Teach the student clearly and thoroughly based on their study material below. "
        "Answer the question directly with clear educational structure. "
        "Do NOT output any thinking process, meta-analysis, or internal planning. Start directly with your explanation."
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
        lines.append("[No retrieved chunks — Answer using foundational knowledge.]\n")

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
        "Provide your clear, well-structured educational answer below (no markdown asterisks, no internal monologue):"
    )

    return "\n".join(lines)


def get_gemini_key():
    backend_env = os.path.join(os.path.dirname(__file__), ".env")
    root_env = os.path.join(os.path.dirname(__file__), "..", ".env")
    for env_path in [backend_env, root_env]:
        if os.path.exists(env_path):
            try:
                load_dotenv(env_path, override=True)
            except Exception:
                pass
    return (
        os.getenv("GEMINI_API_KEY") or
        os.getenv("Gemini_api_key") or
        os.getenv("LLM_API_KEY") or
        ""
    ).strip()

def run_gemini(prompt: str, model_type: str = "chat") -> str:
    """
    Call Google Gemini Generative Language API.
    - model_type='chat': uses Gemini Flash-Lite (gemini-2.5-flash-lite / gemini-3.5-flash-lite) for instant, low-cost Q&A.
    - model_type='complex': uses Gemini Flash (gemini-2.5-flash / gemini-3.5-flash) for comprehensive Cheat Sheets and Quizzes.
    """
    key = get_gemini_key()
    if not key:
        raise RuntimeError("No Gemini API key configured")

    if model_type == "chat":
        candidate_models = ["gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.5-flash"]
        max_tokens = 2048
    else:
        candidate_models = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"]
        max_tokens = 4096

    for model in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": max_tokens
            }
        }
        try:
            resp = requests.post(url, json=payload, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates and "content" in candidates[0]:
                    parts = candidates[0]["content"].get("parts", [])
                    texts = [p.get("text", "") for p in parts if isinstance(p, dict)]
                    res_text = "\n".join(texts).strip()
                    if res_text:
                        print(f"[INFO] Gemini {model} ({model_type}) responded successfully", flush=True)
                        return strip_think_tags(res_text).replace("**", "")
            else:
                print(f"[WARN] Gemini model {model} returned status {resp.status_code}: {resp.text[:120]}", flush=True)
        except Exception as e:
            print(f"[WARN] Gemini request error with {model}: {e}", flush=True)

    raise RuntimeError("All Gemini candidate models failed")

def run_llm(prompt: str, model_type: str = "chat") -> str:
    # 1. Primary: Google Gemini API (Flash-Lite for chat, Flash for cheat sheet / complex)
    key = get_gemini_key()
    if key:
        try:
            return run_gemini(prompt, model_type=model_type)
        except Exception as gemini_err:
            print(f"[WARN] Gemini inference failed: {gemini_err}. Falling back to OpenRouter...", flush=True)

    # 2. Secondary fallback: OpenRouter API with automatic key rotation
    keys = get_openrouter_keys()
    models = [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free",
        "dots-studio/dots-3-note-preview:free",
        "google/gemma-4-26b-a4b-it:free",
        "nvidia/nemotron-3.5-lightning:free",
        "liquid/lfm-2.5-2.6b:free",
        "recursive/flint-v1.0:free"
    ]

    for k in keys:
        headers = {
            "Authorization": f"Bearer {k}",
            "Content-Type": "application/json",
        }
        for model in models:
            try:
                payload = {
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are NoteMind AI tutor. Provide a direct, well-structured explanation. Never output thinking processes or internal monologues."
                        },
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 2048
                }
                resp = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=40)
                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices and "message" in choices[0]:
                        msg = choices[0]["message"]
                        raw = msg.get("content") or msg.get("reasoning") or ""
                        cleaned = strip_think_tags(raw).replace("**", "").strip()
                        if cleaned:
                            return cleaned
                else:
                    print(f"[WARN] OpenRouter key {k[:14]}... model {model} status {resp.status_code}: {resp.text[:120]}", flush=True)
            except Exception as e:
                print(f"[WARN] OpenRouter request error with {model}: {e}", flush=True)

    raise RuntimeError("LLM inference failed. Check GEMINI_API_KEY or OPEN_ROUTER_KEY in backend/.env")

# Alias run_ollama to run_llm for backward compatibility
run_ollama = run_llm

# --- API Endpoints ---

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

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

@app.route("/api/materials", methods=["DELETE"])
def clear_all_materials():
    """Clear all ingested chunks from ChromaDB."""
    global collection
    try:
        client = init_chroma(CHROMA_PATH)
        client.delete_collection(COLLECTION_NAME)
        collection = get_or_create_collection(client, COLLECTION_NAME)
        return jsonify({"ok": True, "message": "All materials and vector chunks cleared successfully", "count": 0})
    except Exception as e:
        print(f"[ERROR] Failed to clear materials: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/materials/<conversation_id>", methods=["DELETE"])
def delete_material_endpoint(conversation_id):
    """Delete chunks belonging to a specific conversation/material."""
    global collection
    try:
        collection.delete(where={"conversation_id": conversation_id})
        count = collection.count()
        return jsonify({"ok": True, "message": f"Material {conversation_id} deleted", "remaining": count})
    except Exception as e:
        print(f"[ERROR] Failed to delete material {conversation_id}: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

def generate_topical_response(clean_q: str, persona: str, hits: list) -> str:
    """Concise fallback if all external LLM providers are unreachable."""
    clean_q = clean_q.replace("**", "").strip()
    
    # Synthesize from local chunks if available
    if hits:
        excerpts = []
        for h in hits:
            c = h.get("content", "").strip()
            if c:
                lines = [l.strip() for l in c.split("\n") if len(l.strip()) > 15]
                excerpts.append("\n".join(lines[:3]) if lines else c[:250])
        combined_context = "\n\n".join(excerpts[:3]).replace("**", "")
        
        if persona == "eli5":
            return f"Here is the simple breakdown for {clean_q} from your notes:\n\n{combined_context}\n\nKey Takeaway: Think of this like a clear set of directions that tells the system how to handle information step-by-step!"
        elif persona == "professor":
            return f"Curriculum analysis for {clean_q}:\n\n{combined_context}\n\nAnalytical Overview: The material formalizes the structural mechanisms, constraints, and execution pipeline governing this domain."
        elif persona == "cram":
            return f"EXAM CRAM NOTES: {clean_q}\n\nHigh-Yield Excerpts:\n{combined_context}\n\nExam Trap: Review specific definitions and variables above to avoid syntax or conceptual errors on exams!"
        else:
            return f"Study Breakdown for {clean_q}:\n\n{combined_context}\n\nSummary: The retrieved course materials demonstrate the core rules and execution patterns for this topic."

    # General conceptual fallback
    if persona == "eli5":
        return f"Here is a simple way to understand {clean_q}:\n\nThink of it as taking in specific information, applying clear rules step-by-step, and producing a reliable output without unnecessary complexity."
    elif persona == "professor":
        return f"Academic Overview of {clean_q}:\n\nIn computational systems, this represents a fundamental conceptual paradigm governing state management, data representations, and execution flow."
    elif persona == "cram":
        return f"EXAM CRAM BREAKDOWN: {clean_q}\n\n1. Core Rule: Understand data flow, inputs, transformations, and outputs.\n2. Exam Trap: Do not confuse high-level specifications with low-level implementation details."
    else:
        return f"{clean_q} is a foundational concept in computing, responsible for coordinating system state, managing data structures, and ensuring reliable execution."


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
    top_k = int(data.get("topK", 3))  # Reduced from 6 to 3: cuts input tokens ~45%
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
        if not hits:
            allow_fallback = True
        
        # Debug: log retrieval results
        print(f"[DEBUG] Question: {question}")
        print(f"[DEBUG] Conversation IDs filter: {conversation_ids}")
        print(f"[DEBUG] Retrieved {len(hits)} chunks from ChromaDB")
        
        persona = data.get("persona", "standard")
        prompt = build_llm_prompt(hits, question, conversation=conversation, persona=persona)
        
        try:
            answer = run_llm(prompt, model_type="chat")
            # Remove double asterisks as requested
            answer = answer.replace("**", "")
        except Exception as llm_err:
            print(f"[WARN] LLM execution failed: {llm_err}. Synthesizing response from retrieved chunks.", flush=True)
            answer = generate_topical_response(question, persona, hits)
            answer = answer.replace("**", "")

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
        hits = query_chroma(collection, embedder, topic, top_k=3, conversation_id=conversation_ids)
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
        raw_res = run_llm(prompt, model_type="complex").strip()
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
        hits = query_chroma(collection, embedder, topic, top_k=3, conversation_id=conversation_ids)
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
        raw_res = run_llm(prompt, model_type="complex").strip()
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
