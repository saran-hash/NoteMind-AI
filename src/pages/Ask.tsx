import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Loader2,
  BookOpen,
  Trash2,
  Sparkles,
  GraduationCap,
  Zap,
  Lightbulb,
  ExternalLink,
  Bot,
  User,
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

const PERSONAS: { id: TutorPersona; label: string; icon: any; desc: string; color: string }[] = [
  {
    id: 'standard',
    label: 'Standard Tutor',
    icon: Bot,
    desc: 'Structured & comprehensive',
    color: 'border-blue-300 text-blue-800 bg-blue-50',
  },
  {
    id: 'eli5',
    label: 'ELI5 Mode',
    icon: Lightbulb,
    desc: 'Intuitive analogies & emojis',
    color: 'border-amber-300 text-amber-900 bg-amber-50',
  },
  {
    id: 'professor',
    label: 'Professor Mode',
    icon: GraduationCap,
    desc: 'Academic rigor & theory',
    color: 'border-purple-300 text-purple-900 bg-purple-50',
  },
  {
    id: 'cram',
    label: 'Exam Cram Coach',
    icon: Zap,
    desc: 'Traps, mnemonics & high-yield',
    color: 'border-emerald-300 text-emerald-900 bg-emerald-50',
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/80 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
            Ask NoteMind Tutor
            <Sparkles className="h-5 w-5 text-purple-400" />
          </h1>
          <p className="text-sm text-muted-foreground">
            Multi-persona interactive RAG tutor with grounded source citations
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link to="/study-lab">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs border-purple-500/40 text-purple-300 hover:bg-purple-500/10"
            >
              <Zap className="h-3.5 w-3.5 text-purple-400" />
              Open Study Lab
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
          <div className="flex items-center gap-1.5 bg-muted/60 px-2 py-1 rounded-lg border border-border text-xs">
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
              <button onClick={handleDeleteCurrent} title="Delete material" className="text-destructive hover:opacity-80">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AI Tutor Personas Selector */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <span>Tutor Persona:</span>
          <span className="text-[10px] lowercase text-purple-400 font-normal">
            (changes AI teaching tone & depth)
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {PERSONAS.map((p) => {
            const Icon = p.icon;
            const isSelected = currentPersona === p.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setCurrentPersona(p.id);
                  toast.info(`Switched to ${p.label}!`);
                }}
                className={`p-3 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between ${
                  isSelected
                    ? `${p.color} ring-2 ring-purple-500/50 shadow-md`
                    : 'bg-card/70 border-border/80 hover:border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <Icon className="h-4 w-4" />
                  {isSelected && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />}
                </div>
                <div>
                  <div className="text-xs font-bold">{p.label}</div>
                  <div className="text-[10px] opacity-75 truncate">{p.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Messages Feed */}
      <div className="space-y-4 min-h-[300px] max-h-[520px] overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-border/80 bg-card/30">
            <div className="h-12 w-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3">
              <Bot className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-foreground text-base">Your NoteMind Tutor is ready</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Ask anything, test your retention, or pick a prompt below to see how each AI persona teaches!
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="h-8 w-8 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0 mt-1">
                  <Bot className="h-4 w-4" />
                </div>
              )}

              <Card
                className={`max-w-[85%] border shadow-sm rounded-2xl overflow-hidden ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-transparent'
                    : 'bg-card/90 border-border/80'
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      {msg.role === 'assistant' && msg.persona && (
                        <Badge variant="outline" className="text-[10px] px-2 py-0.2 mb-1">
                          {PERSONAS.find((p) => p.id === msg.persona)?.label || 'Tutor'}
                        </Badge>
                      )}
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>

                      {/* Source Citations Badges */}
                      {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                        <div className="pt-2 border-t border-border/40 flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                            <BookOpen className="h-3 w-3 text-purple-400" /> Grounded in:
                          </span>
                          {msg.citations.map((c, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="text-[10px] cursor-pointer hover:bg-accent"
                              onClick={() => setSelectedCitations(msg.citations || [])}
                            >
                              {c.title} · Chunk #{c.chunkIndex}
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
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => handleSpeak(msg.content)}
                          >
                            {isSpeaking ? (
                              <VolumeX className="h-3.5 w-3.5 text-rose-400" />
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
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setSelectedCitations(msg.citations || [])}
                              >
                                <BookOpen className="h-3.5 w-3.5 text-purple-400" />
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

              {msg.role === 'user' && (
                <div className="h-8 w-8 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-1">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Quick Prompts Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
          <Zap className="h-3 w-3 text-amber-400" /> Quick Prompts:
        </span>
        {QUICK_PROMPTS.map((prompt, i) => (
          <button
            key={i}
            onClick={() => handleAsk(prompt)}
            className="text-[11px] px-2.5 py-1 rounded-full bg-card hover:bg-accent border border-border/70 text-muted-foreground hover:text-foreground transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Box with Voice Visualizer */}
      <Card className="border border-border/80 shadow-lg bg-card/90 overflow-hidden">
        <CardContent className="p-3 sm:p-4 space-y-3">
          {/* Animated Waveform when listening */}
          {isListening && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-950/30 border border-purple-500/30 text-purple-300 text-xs animate-pulse">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
              <span className="font-medium">Listening to your voice... Speak now!</span>
              <div className="ml-auto flex items-end gap-1 h-4">
                <span className="w-1 bg-purple-400 rounded animate-[bounce_0.6s_infinite_100ms] h-3" />
                <span className="w-1 bg-purple-400 rounded animate-[bounce_0.6s_infinite_200ms] h-4" />
                <span className="w-1 bg-purple-400 rounded animate-[bounce_0.6s_infinite_300ms] h-2" />
                <span className="w-1 bg-purple-400 rounded animate-[bounce_0.6s_infinite_400ms] h-3.5" />
              </div>
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
            className="min-h-[85px] border-border/60 focus-visible:ring-purple-500/40 text-sm resize-none"
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {voiceSupported && (
                <Button
                  variant={isListening ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={handleVoiceToggle}
                  disabled={isAsking}
                  className="gap-1.5 text-xs h-9"
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
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white gap-2 h-9 px-5 text-xs font-semibold shadow-md shadow-purple-500/20"
            >
              {isAsking ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Reasoning...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Ask Tutor
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
