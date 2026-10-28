import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Loader2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { askQuestion, deleteMaterial, type Citation, type TutorPersona } from '@/lib/api';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useTextToSpeech } from '@/hooks/useTextToSpeech';
import { useConversationHistory } from '@/hooks/useConversationHistory';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Link } from 'react-router-dom';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  persona?: TutorPersona;
}

const PERSONAS: { id: TutorPersona; label: string; desc: string }[] = [
  {
    id: 'standard',
    label: 'Standard Tutor',
    desc: 'Structured & comprehensive',
  },
  {
    id: 'eli5',
    label: 'ELI5 Mode',
    desc: 'Simple analogies & clear steps',
  },
  {
    id: 'professor',
    label: 'Professor Mode',
    desc: 'Academic rigor & theory',
  },
  {
    id: 'cram',
    label: 'Exam Cram Coach',
    desc: 'Traps, mnemonics & high-yield',
  },
];

const QUICK_PROMPTS = [
  'Explain the core mechanism with a real-world analogy',
  'What are the top 3 exam traps & formulas?',
  'Give me an ultra-condensed 5-bullet summary',
  'What is the mathematical formulation?',
];

export default function Ask() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [selectedCitations, setSelectedCitations] = useState<Citation[]>([]);
  const [currentPersona, setCurrentPersona] = useState<TutorPersona>('standard');

  const { isListening, transcript, isSupported: voiceSupported, startListening, stopListening, resetTranscript } = useVoiceInput();
  const { speak, stop, isSpeaking, isSupported: ttsSupported } = useTextToSpeech();
  const {
    conversations,
    setCurrentConversation,
    addMessageToCurrent,
    getCurrentConversation,
    currentConversationId,
    deleteConversation,
  } = useConversationHistory();

  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);

  const handleSelectConversation = (ev: React.ChangeEvent<HTMLSelectElement>) => {
    const opts = Array.from(ev.target.selectedOptions).map((o) => o.value);
    setSelectedConversationIds(opts);
    setCurrentConversation(opts.length > 0 ? opts[0] : null);
  };

  const handleDeleteCurrent = async () => {
    if (!currentConversationId) return;
    const confirm = window.confirm('Delete this material and its conversation? This cannot be undone.');
    if (!confirm) return;
    try {
      await deleteMaterial(currentConversationId);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete material on server');
    }
    deleteConversation(currentConversationId);
    setCurrentConversation(null);
    setSelectedConversationIds([]);
    toast.success('Material deleted');
  };

  useEffect(() => {
    const cur = getCurrentConversation();
    if (cur) setMessages(cur.messages as Message[]);
    else setMessages([]);
  }, [currentConversationId]);

  useEffect(() => {
    if (currentConversationId) setSelectedConversationIds([currentConversationId]);
  }, [currentConversationId]);

  const handleVoiceToggle = () => {
    if (isListening) {
      stopListening();
      setQuestion(transcript);
    } else {
      resetTranscript();
      startListening();
    }
  };

  const handleAsk = async (customPrompt?: string) => {
    const q = (customPrompt || (isListening ? transcript : question)).trim();
    if (!q) {
      toast.error('Please enter a question');
      return;
    }

    if (isListening) {
      stopListening();
    }

    setIsAsking(true);
    const userMessage: Message = { role: 'user', content: q };
    addMessageToCurrent(userMessage);
    setMessages((prev) => [...prev, userMessage]);
    setQuestion('');
    resetTranscript();

    try {
      const response = await askQuestion(
        q,
        selectedConversationIds.length > 0 ? selectedConversationIds : undefined,
        currentPersona
      );
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.answer,
        citations: response.citations,
        persona: currentPersona,
      };
      addMessageToCurrent(assistantMessage);
      setMessages((prev) => [...prev, assistantMessage]);

      // Auto-read in voice if user used voice
      if (isListening && ttsSupported) {
        speak(response.answer.slice(0, 200));
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to get answer');
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleSpeak = (text: string) => {
    if (isSpeaking) {
      stop();
    } else {
      speak(text);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            Ask NoteMind Tutor
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Multi-persona interactive study tutor with grounded source citations
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link to="/study-lab">
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Study Lab
            </Button>
          </Link>
          <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs">
            <label className="text-muted-foreground font-medium">Material:</label>
            <select
              value={currentConversationId || ''}
              onChange={handleSelectConversation}
              className="bg-transparent text-foreground font-medium text-xs focus:outline-none max-w-[150px] truncate"
            >
              <option value="" className="bg-card">(All Knowledge)</option>
              {conversations.map((c) => (
                <option value={c.id} key={c.id} className="bg-card">
                  {c.title}
                </option>
              ))}
            </select>
            {currentConversationId && (
              <button onClick={handleDeleteCurrent} title="Delete material" className="text-destructive hover:opacity-80 text-xs font-medium ml-1">
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AI Tutor Personas Selector */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <span>Tutor Mode:</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {PERSONAS.map((p) => {
            const isSelected = currentPersona === p.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setCurrentPersona(p.id);
                  toast.info(`Switched to ${p.label}!`);
                }}
                className={`p-3 rounded-lg border text-left transition-colors flex flex-col justify-between ${
                  isSelected
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <div>
                  <div className="text-xs font-semibold">{p.label}</div>
                  <div className={`text-[11px] mt-0.5 ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>{p.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Messages Feed */}
      <div className="space-y-4 min-h-[300px] max-h-[520px] overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
            <h3 className="font-semibold text-slate-900 text-sm">NoteMind Tutor</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Ask a question about your uploaded materials or select a prompt below.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <Card
                className={`max-w-[85%] border shadow-sm rounded-xl overflow-hidden ${
                  msg.role === 'user'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white border-slate-200 text-slate-900'
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      {msg.role === 'assistant' && msg.persona && (
                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                          {PERSONAS.find((p) => p.id === msg.persona)?.label || 'Tutor'}
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>

                      {/* Source Citations Badges */}
                      {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                        <div className="pt-2 border-t border-border/40 flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="text-[11px] font-medium text-slate-500">
                            Sources:
                          </span>
                          {msg.citations.map((c, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="text-[10px] cursor-pointer hover:bg-slate-200 font-normal"
                              onClick={() => setSelectedCitations(msg.citations || [])}
                            >
                              {c.title} · #{c.chunkIndex}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {msg.role === 'assistant' && (
                      <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                        {ttsSupported && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-500 hover:text-slate-900"
                            onClick={() => handleSpeak(msg.content)}
                            title="Read Aloud"
                          >
                            {isSpeaking ? (
                              <VolumeX className="h-3.5 w-3.5 text-rose-500" />
                            ) : (
                              <Volume2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        {msg.citations && msg.citations.length > 0 && (
                          <Sheet>
                            <SheetTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-slate-500 hover:text-slate-900 px-2 font-normal"
                                onClick={() => setSelectedCitations(msg.citations || [])}
                              >
                                Citations
                              </Button>
                            </SheetTrigger>
                            <SheetContent>
                              <SheetHeader>
                                <SheetTitle>Source Citations</SheetTitle>
                                <SheetDescription>Grounding chunks retrieved from vector store</SheetDescription>
                              </SheetHeader>
                              <div className="mt-4 space-y-4">
                                {selectedCitations.map((citation, i) => (
                                  <Card key={i} className="border-border/80">
                                    <CardContent className="p-4 space-y-1.5">
                                      <p className="font-semibold text-sm text-foreground flex items-center justify-between">
                                        <span>{citation.title}</span>
                                        <Badge variant="outline" className="text-xs">
                                          Chunk #{citation.chunkIndex}
                                        </Badge>
                                      </p>
                                      <p className="text-xs text-muted-foreground leading-relaxed">
                                        {citation.content}
                                      </p>
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                            </SheetContent>
                          </Sheet>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))
        )}
      </div>

      {/* Quick Prompts Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-slate-500">
          Prompts:
        </span>
        {QUICK_PROMPTS.map((prompt, i) => (
          <button
            key={i}
            onClick={() => handleAsk(prompt)}
            className="text-[11px] px-2.5 py-1 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Box with Voice Visualizer */}
      <Card className="border border-border/80 shadow-sm bg-white overflow-hidden">
        <CardContent className="p-3 sm:p-4 space-y-3">
          {/* Animated Waveform when listening */}
          {isListening && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 text-xs">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
              <span className="font-medium">Listening to your voice... Speak now!</span>
            </div>
          )}

          <Textarea
            placeholder={
              isListening
                ? 'Listening to your speech...'
                : `Ask NoteMind AI in ${PERSONAS.find((p) => p.id === currentPersona)?.label}...`
            }
            value={isListening ? transcript : question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isListening || isAsking}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
            }}
            className="min-h-[85px] border-slate-200 focus-visible:ring-slate-400 text-sm resize-none bg-white"
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {voiceSupported && (
                <Button
                  variant={isListening ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={handleVoiceToggle}
                  disabled={isAsking}
                  className="gap-1.5 text-xs h-9 border-slate-200"
                >
                  {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  {isListening ? 'Stop' : 'Voice'}
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                Press Enter to send
              </span>
            </div>

            <Button
              onClick={() => handleAsk()}
              disabled={isAsking || (!question && !transcript)}
              className="bg-slate-900 hover:bg-slate-800 text-white h-9 px-5 text-xs font-medium shadow-sm transition-colors"
            >
              {isAsking ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Reasoning...
                </>
              ) : (
                'Send Question'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
