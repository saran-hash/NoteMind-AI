

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


def run_llm(prompt: str) -> str:
    # 1. Primary: OpenRouter API with automatic key rotation
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
                    print(f"[WARN] OpenRouter key {key[:14]}... model {model} status {resp.status_code}: {resp.text[:120]}", flush=True)
            except Exception as e:
                print(f"[WARN] OpenRouter request error with {model}: {e}", flush=True)


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

@app.route("/api/settings/key", methods=["POST"])
def update_api_key():
    """Save a new OpenRouter API key directly to backend env and memory."""
    import re
    data = request.get_json(silent=True) or {}
    key = (data.get("key") or "").strip()
    if not key or not key.startswith("sk-or-v1-"):
        return jsonify({"ok": False, "error": "Invalid OpenRouter key. Must start with 'sk-or-v1-'"}), 400

    backend_dir = os.path.dirname(__file__)
    env_paths = [
        os.path.join(backend_dir, ".env"),
        os.path.join(backend_dir, "..", ".env"),
    ]

    for env_path in env_paths:
        try:
            content = ""
            if os.path.exists(env_path):
                with open(env_path, "r", encoding="utf-8") as f:
                    content = f.read()
            if "open_router_key_3=" in content:
                content = re.sub(r"open_router_key_3=.*", f"open_router_key_3={key}", content)
            else:
                content += f"\nopen_router_key_3={key}\n"
            with open(env_path, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            print(f"[WARN] Error updating {env_path}: {e}", flush=True)

    os.environ["open_router_key_3"] = key
    os.environ["OPEN_ROUTER_KEY_3"] = key
    print(f"[INFO] 3rd OpenRouter key registered and active: {key[:14]}...", flush=True)
    return jsonify({"ok": True, "message": "Key saved and active!"})

def generate_topical_response(clean_q: str, persona: str, hits: list) -> str:
    clean_q = clean_q.replace("**", "").strip()
    
    # 1. If hits are available from student's study materials, synthesize from chunks
    if hits:
        excerpts = []
        for h in hits:
            c = h.get("content", "").strip()
            if c:
                lines = [l.strip() for l in c.split("\n") if len(l.strip()) > 15]
                if lines:
                    excerpts.append("\n".join(lines[:3]))
                else:
                    excerpts.append(c[:250])
        combined_context = "\n\n".join(excerpts[:3]).replace("**", "")
        
        if persona == "eli5":
            return f"Here is the simple breakdown for {clean_q} from your notes:\n\n{combined_context}\n\nKey Takeaway: Think of this like a clear set of directions that tells the system how to handle information step-by-step!"
        elif persona == "professor":
            return f"Curriculum analysis for {clean_q}:\n\n{combined_context}\n\nAnalytical Overview: The material formalizes the structural mechanisms, constraints, and execution pipeline governing this domain."
        elif persona == "cram":
            return f"EXAM CRAM NOTES: {clean_q}\n\nHigh-Yield Excerpts:\n{combined_context}\n\nExam Trap: Review specific definitions, variables, and sequence order above to avoid syntax or conceptual errors on exams!"
        else:
            return f"Study Breakdown for {clean_q}:\n\n{combined_context}\n\nSummary: The retrieved course materials demonstrate the core rules and execution patterns for this topic."

    # 2. If no chunks, provide accurate topic-specific educational content
    lower_q = clean_q.lower()
    
    # Topic: Source Code / Code / Programming
    if any(k in lower_q for k in ["source code", "source", "code", "coding", "program"]):
        if persona == "eli5":
            return (
                "Source code is like a written recipe that tells a computer what to do!\n\n"
                "1. Humans write the recipe in readable languages like Python, JavaScript, or C++.\n"
                "2. The computer has a translator (called a compiler or interpreter) that converts those human words into binary numbers (0s and 1s) that the computer hardware can run.\n"
                "3. Just like following cooking steps in order, the computer executes your instructions line by line to build games, websites, and apps!"
            )
        elif persona == "professor":
            return (
                f"Formal Analysis of {clean_q}:\n\n"
                "1. Definition: Source code is a human-readable sequence of instructions written in a formal programming language conforming to defined syntactic and semantic grammars.\n"
                "2. Translation Pipeline: High-level source code undergoes lexical analysis, syntactic parsing (abstract syntax tree generation), and optimization before compilation into machine code or translation into intermediate bytecode.\n"
                "3. Architectural Role: It encapsulates data structures, state machines, control flow logic, and algorithmic complexity across software systems."
            )
        elif persona == "cram":
            return (
                f"EXAM CRAM: {clean_q}\n\n"
                "1. Core Definition: Human-written plain text containing instructions in a programming language before compilation/interpretation.\n"
                "2. Source Code vs Machine Code: Source code = human readable (Python/C); Machine code = processor executable binary (0s and 1s).\n"
                "3. Key Translators: Compilers convert the whole file beforehand; Interpreters translate line-by-line during runtime.\n"
                "4. Exam Trap: Do NOT confuse source code (plain text files) with object code or binary bytecode."
            )
        else:
            return (
                f"Comprehensive Guide: {clean_q}\n\n"
                "Source code is the foundational human-readable instructions written by software developers using programming languages such as Python, JavaScript, C++, or Java.\n\n"
                "Key Concepts:\n"
                "- How It Works: Computers cannot directly understand human language. A compiler or interpreter translates high-level source code into low-level machine code (binary zeros and ones) that the CPU executes.\n"
                "- Core Structure: Typical source code includes declarations, variables, functions, conditional logic (if/else), loops, and algorithms.\n"
                "- Maintenance and Collaboration: Teams store source code in version control systems (like Git) to track changes, review pull requests, and deploy applications."
            )

    # Topic: Gradient Descent / Optimization
    if any(k in lower_q for k in ["gradient descent", "gradient", "optimization", "descent"]):
        if persona == "eli5":
            return (
                "Imagine you are blindfolded on a foggy hill and trying to reach the very bottom of the valley!\n\n"
                "1. You feel the slope beneath your feet with each step.\n"
                "2. You take a step in the direction that slopes downward the steepest.\n"
                "3. Step by step, you reach the lowest point! In AI, this is gradient descent: guiding the model step-by-step until its errors are as small as possible."
            )
        elif persona == "professor":
            return (
                f"Mathematical Formulation: {clean_q}\n\n"
                "1. Objective: Minimize a scalar cost function J(theta) over parameter space theta in R^d.\n"
                "2. Update Rule: theta_(t+1) = theta_t - alpha * grad(J(theta_t)), where alpha > 0 denotes the learning rate parameter.\n"
                "3. Convergence: For convex objectives with L-Lipschitz continuous gradients, convergence to the global optimum is guaranteed given appropriate step size constraints."
            )
        elif persona == "cram":
            return (
                f"EXAM CRAM: {clean_q}\n\n"
                "1. Core Formula: W_new = W_old - alpha * (dL/dW).\n"
                "2. Hyperparameter: alpha is the Learning Rate. Too high = overshoot/diverge; Too low = slow convergence.\n"
                "3. Types: Batch GD (full dataset), Stochastic GD (1 sample per step), Mini-Batch GD (balanced standard).\n"
                "4. Exam Trap: The negative sign is critical because we move OPPOSITE to the gradient to minimize loss."
            )
        else:
            return (
                f"Overview of {clean_q}:\n\n"
                "Gradient descent is an iterative first-order optimization algorithm used in machine learning to find the local minimum of a differentiable loss function.\n\n"
                "Key Mechanics:\n"
                "- The algorithm calculates the gradient (direction of steepest increase) of the loss function with respect to the model parameters.\n"
                "- It then updates parameters in the opposite direction (negative gradient) scaled by the learning rate.\n"
                "- Over successive epochs, this reduces predictive error and trains neural networks effectively."
            )

    # Topic: Neural Networks / Machine Learning / Deep Learning
    if any(k in lower_q for k in ["neural", "deep learning", "machine learning", "ai", "model"]):
        if persona == "eli5":
            return (
                f"Simple Explanation for {clean_q}:\n\n"
                "Think of machine learning like teaching a child through examples rather than rigid rules!\n"
                "- Instead of programming every single detail, you show the computer thousands of pictures of cats and dogs.\n"
                "- The computer looks for patterns (like pointy ears and whiskers) and learns to recognize them on its own over time."
            )
        elif persona == "professor":
            return (
                f"Theoretical Foundations: {clean_q}\n\n"
                "Machine learning provides computational methodologies to estimate functional mappings f: X -> Y parameterized by weights W, optimizing an empirical risk objective over sampled distributions.\n"
                "Deep architectures compose multiple non-linear transformations across successive layers, learning hierarchical representations directly from raw inputs."
            )
        elif persona == "cram":
            return (
                f"EXAM CRAM: {clean_q}\n\n"
                "1. Core Categories: Supervised (labeled data), Unsupervised (clustering/patterns), Reinforcement (rewards/penalties).\n"
                "2. Key Metric: Loss function measures error; Accuracy/F1-score evaluates predictive performance.\n"
                "3. Classic Exam Pitfall: High training accuracy with low validation accuracy indicates OVERFITTING."
            )
        else:
            return (
                f"Study Guide: {clean_q}\n\n"
                "This topic forms the basis of modern automated intelligence, allowing computer systems to learn patterns and infer decisions directly from data without explicit manual programming.\n\n"
                "Key Components:\n"
                "- Training Data: Inputs and targets used to optimize model parameters.\n"
                "- Architecture: The mathematical structure (e.g. layers, weights, activation functions) that processes signals.\n"
                "- Evaluation: Testing against unseen data to verify generalization and avoid overfitting."
            )

    # Universal structured response for any other topic
    if persona == "eli5":
        return (
            f"Here is a simple way to understand {clean_q}:\n\n"
            f"Think of {clean_q} like a specialized tool in a workshop. It takes in specific ingredients or information, applies clear rules step-by-step, and delivers the finished result reliably.\n\n"
            "Key Takeaway: Break it down into what goes in (input), what happens in the middle (processing), and what comes out (output)!"
        )
    elif persona == "professor":
        return (
            f"Academic Rigor and Theoretical Analysis: {clean_q}\n\n"
            "1. Formal Principle: This subject represents an established conceptual paradigm governed by foundational axioms and operational rules.\n"
            "2. Structural Dynamics: The interaction of parameters, state transitions, and evaluation criteria dictates system behavior.\n"
            "3. Application: Rigorous validation and testing are required to ensure correctness and optimal algorithmic complexity."
        )
    elif persona == "cram":
        return (
            f"EXAM CRAM: {clean_q}\n\n"
            f"1. Core Definition: Essential concept governing data processing, logic, and system behavior in this domain.\n"
            "2. Top Exam Trap: Pay attention to exact definitions, edge cases, and terminology so you do not lose easy points.\n"
            "3. FAST Strategy: Focus on the core objective, Analyze inputs/outputs, Synthesize the rule, and Test with an example."
        )
    else:
        return (
            f"Detailed Explanation: {clean_q}\n\n"
            f"{clean_q} is a key concept that coordinates system logic, structures data, and ensures reliable execution.\n\n"
            "Key Aspects:\n"
            "- Purpose: Solves specific operational problems by establishing clear guidelines and predictable outputs.\n"
            "- Mechanics: Operates through sequential stages, processing inputs and handling error states systematically.\n"
            "- Practical Importance: Understanding this concept allows you to design better architectures, debug effectively, and master exam problems."
        )


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
        if not hits:
            allow_fallback = True
        
        # Debug: log retrieval results
        print(f"[DEBUG] Question: {question}")
        print(f"[DEBUG] Conversation IDs filter: {conversation_ids}")
        print(f"[DEBUG] Retrieved {len(hits)} chunks from ChromaDB")
        
        persona = data.get("persona", "standard")
        prompt = build_llm_prompt(hits, question, conversation=conversation, persona=persona)
        
        try:
            answer = run_ollama(prompt)
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
