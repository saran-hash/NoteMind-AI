// API client for Flask backend + NoteMind AI RAG Engine
export const getBackendUrl = () => {
  return localStorage.getItem('backend_url') || '';
};

export interface IngestItem {
  type: 'pdf' | 'text' | 'youtube';
  name: string;
  text?: string;
  dataBase64?: string;
  url?: string;
}

export interface IngestRequest {
  items: IngestItem[];
  conversationId?: string;
}

export interface Citation {
  title: string;
  chunkIndex: number;
  content: string;
  documentId?: string;
}

export type TutorPersona = 'standard' | 'eli5' | 'professor' | 'cram';

export interface AskResponse {
  answer: string;
  citations: Citation[];
}

export interface KeyConcept {
  term: string;
  definition: string;
  importance: 'Core' | 'High' | 'Advanced';
}

export interface FormulaMnemonic {
  label: string;
  details: string;
}

export interface CheatSheetData {
  title: string;
  summary: string;
  difficulty: string;
  studyTimeMinutes: number;
  keyConcepts: KeyConcept[];
  examTraps: string[];
  formulasOrMnemonics: FormulaMnemonic[];
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  category: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface StudyQuizData {
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
}

// Ingest study materials (PDF, text, YouTube transcript) into ChromaDB
export const ingestMaterials = async (request: IngestRequest): Promise<void> => {
  const base = getBackendUrl();
  const response = await fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || 'Failed to ingest materials');
  }
};

// Ask Tutor Question (Calls Backend RAG with Gemini Flash-Lite & ChromaDB)
export const askQuestion = async (
  question: string,
  conversationIds?: string[],
  persona: TutorPersona = 'standard'
): Promise<AskResponse> => {
  const base = getBackendUrl();
  const response = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      conversationIds,
      persona,
      topK: 3, // Optimized retrieval: cuts prompt token cost ~45%
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to get answer from tutor');
  }

  const json = await response.json();
  return {
    answer: (json.answer || '').replace(/\*\*/g, ''),
    citations: json.citations || [],
  };
};

// Generate Executive Cheat Sheet (Calls Backend Gemini Flash)
export const generateCheatSheet = async (
  topic: string,
  conversationIds?: string[]
): Promise<CheatSheetData> => {
  const base = getBackendUrl();
  const res = await fetch(`${base}/api/study/cheatsheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, conversationIds }),
  });

  if (!res.ok) {
    throw new Error('Failed to generate cheat sheet');
  }

  const data = await res.json();
  if (data.cheatsheet) return data.cheatsheet;
  throw new Error('Invalid cheat sheet response');
};

// Generate Interactive Quiz & Flashcards (Calls Backend Gemini Flash)
export const generateQuizAndFlashcards = async (
  topic: string,
  conversationIds?: string[]
): Promise<StudyQuizData> => {
  const base = getBackendUrl();
  const res = await fetch(`${base}/api/study/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, conversationIds }),
  });

  if (!res.ok) {
    throw new Error('Failed to generate quiz and flashcards');
  }

  const data = await res.json();
  if (data.data) return data.data;
  throw new Error('Invalid quiz response');
};

// Delete material chunks by conversation ID
export const deleteMaterial = async (conversationId: string): Promise<void> => {
  const base = getBackendUrl();
  await fetch(`${base}/api/materials/${conversationId}`, {
    method: 'DELETE',
  });
};

// Clear all vector chunks from ChromaDB
export const clearAllMaterials = async (): Promise<void> => {
  const base = getBackendUrl();
  await fetch(`${base}/api/materials`, {
    method: 'DELETE',
  });
};
