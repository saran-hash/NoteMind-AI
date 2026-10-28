import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  generateCheatSheet,
  generateQuizAndFlashcards,
  type CheatSheetData,
  type StudyQuizData,
} from '@/lib/api';
import { useConversationHistory } from '@/hooks/useConversationHistory';

export default function StudyLab() {
  const { conversations, currentConversationId, setCurrentConversation } = useConversationHistory();
  const [topic, setTopic] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Data states
  const [cheatSheet, setCheatSheet] = useState<CheatSheetData | null>(null);
  const [studyData, setStudyData] = useState<StudyQuizData | null>(null);

  // Flashcards state
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [masteredCards, setMasteredCards] = useState<Set<string>>(new Set());

  // Quiz state
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [showExplanations, setShowExplanations] = useState<Record<number, boolean>>({});

  // Initialize topic from current conversation or default
  useEffect(() => {
    if (conversations.length > 0) {
      const active = currentConversationId
        ? conversations.find((c) => c.id === currentConversationId)
        : conversations[0];
      if (active) {
        setTopic(active.title.replace('Materials: ', ''));
      }
    } else {
      setTopic('Core Study Concepts');
    }
  }, [conversations, currentConversationId]);

  // Load initial content once topic is set
  useEffect(() => {
    handleGenerate('Core Study Concepts');
  }, []);

  const handleGenerate = async (targetTopic?: string) => {
    const activeTopic = targetTopic || topic || 'Core Study Concepts';
    setIsLoading(true);
    setIsFlipped(false);
    setCurrentCardIndex(0);
    setSelectedAnswers({});
    setShowExplanations({});

    try {
      const [cs, qData] = await Promise.all([
        generateCheatSheet(activeTopic, currentConversationId ? [currentConversationId] : undefined),
        generateQuizAndFlashcards(activeTopic, currentConversationId ? [currentConversationId] : undefined),
      ]);
      setCheatSheet(cs);
      setStudyData(qData);
      toast.success(`Generated Study Lab pack for "${activeTopic}"!`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate study materials');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMastered = (cardId: string) => {
    setMasteredCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const handleSelectAnswer = (questionIndex: number, optionIndex: number) => {
    if (selectedAnswers[questionIndex] !== undefined) return;
    setSelectedAnswers((prev) => ({ ...prev, [questionIndex]: optionIndex }));
    setShowExplanations((prev) => ({ ...prev, [questionIndex]: true }));
  };

  const handleCopyCheatSheet = () => {
    if (!cheatSheet) return;
    const text = `# ${cheatSheet.title} - Executive Cheat Sheet
Difficulty: ${cheatSheet.difficulty} | Study Time: ${cheatSheet.studyTimeMinutes} min

## Summary
${cheatSheet.summary}

## Key Concepts
${cheatSheet.keyConcepts.map((k) => `- **${k.term}** (${k.importance}): ${k.definition}`).join('\n')}

## Common Exam Traps
${cheatSheet.examTraps.map((t) => `- ⚠️ ${t}`).join('\n')}

## Formulas & Mnemonics
${cheatSheet.formulasOrMnemonics.map((f) => `- **${f.label}**: ${f.details}`).join('\n')}
`;
    navigator.clipboard.writeText(text);
    toast.success('Cheat sheet copied to clipboard!');
  };

  const calculateScore = () => {
    if (!studyData) return { correct: 0, total: 0 };
    let correct = 0;
    studyData.quiz.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correctIndex) correct++;
    });
    return { correct, total: studyData.quiz.length };
  };

  const score = calculateScore();
  const currentCard = studyData?.flashcards[currentCardIndex];

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Study Lab
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Flashcards, practice quiz questions, and condensed cheat sheets
          </p>
        </div>

        <div className="flex items-center gap-2">
          {conversations.length > 0 && (
            <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-xs">
              <span className="text-slate-500 font-medium">Topic:</span>
              <select
                value={currentConversationId || ''}
                onChange={(e) => {
                  const id = e.target.value;
                  setCurrentConversation(id || null);
                  const selected = conversations.find((c) => c.id === id);
                  if (selected) {
                    const newTopic = selected.title.replace('Materials: ', '');
                    setTopic(newTopic);
                    handleGenerate(newTopic);
                  }
                }}
                className="bg-transparent text-slate-800 font-medium text-xs focus:outline-none max-w-[160px] truncate"
              >
                <option value="">(All Materials)</option>
                {conversations.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title.replace('Materials: ', '')}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button
            onClick={() => handleGenerate()}
            disabled={isLoading}
            className="bg-slate-900 hover:bg-slate-800 text-white h-9 px-4 text-xs font-medium shadow-sm transition-colors"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Generating...
              </>
            ) : (
              'Generate Study Pack'
            )}
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="flashcards" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 bg-slate-100 p-1 rounded-lg border border-slate-200">
          <TabsTrigger
            value="flashcards"
            className="data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm font-medium text-xs sm:text-sm text-slate-600"
          >
            Flashcards
          </TabsTrigger>
          <TabsTrigger
            value="quiz"
            className="data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm font-medium text-xs sm:text-sm text-slate-600"
          >
            Practice Quiz
          </TabsTrigger>
          <TabsTrigger
            value="cheatsheet"
            className="data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm font-medium text-xs sm:text-sm text-slate-600"
          >
            Cheat Sheet
          </TabsTrigger>
        </TabsList>

        {/* ================= TAB 1: FLASHCARDS ================= */}
        <TabsContent value="flashcards" className="space-y-4">
          {studyData && studyData.flashcards.length > 0 && currentCard ? (
            <div className="flex flex-col items-center space-y-6">
              {/* Card Meta Bar */}
              <div className="w-full flex items-center justify-between px-2 text-sm text-slate-500">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-slate-200 text-slate-700 bg-slate-50 font-medium text-xs">
                    {currentCard.category || 'Core Concept'}
                  </Badge>
                  <span className="text-xs">
                    Card {currentCardIndex + 1} of {studyData.flashcards.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    {masteredCards.size} / {studyData.flashcards.length} Mastered
                  </span>
                  <Button
                    variant={masteredCards.has(currentCard.id) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggleMastered(currentCard.id)}
                    className="h-8 text-xs font-medium border-slate-200"
                  >
                    {masteredCards.has(currentCard.id) ? 'Mastered' : 'Mark Mastered'}
                  </Button>
                </div>
              </div>

              {/* 3D Flip Card Container */}
              <div
                onClick={() => setIsFlipped(!isFlipped)}
                className="w-full max-w-2xl h-80 cursor-pointer perspective-1000 group"
              >
                <div
                  className={`relative w-full h-full rounded-xl transition-transform duration-500 transform-style-3d shadow-sm border border-slate-200 ${
                    isFlipped ? 'rotate-y-180' : ''
                  }`}
                  style={{
                    transformStyle: 'preserve-3d',
                    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                    transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  {/* FRONT */}
                  <div
                    className="absolute inset-0 w-full h-full rounded-xl bg-white p-8 flex flex-col justify-between backface-hidden border border-slate-200 shadow-sm"
                    style={{ backfaceVisibility: 'hidden' }}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-medium uppercase tracking-wider text-slate-500 text-[11px]">Question / Concept</span>
                      <span className="text-slate-400">Flip ↻</span>
                    </div>
                    <div className="my-auto text-center">
                      <h3 className="text-xl md:text-2xl font-semibold text-slate-900 leading-relaxed">
                        {currentCard.front}
                      </h3>
                    </div>
                    <div className="text-center text-xs text-slate-400">
                      Click to reveal answer
                    </div>
                  </div>

                  {/* BACK */}
                  <div
                    className="absolute inset-0 w-full h-full rounded-xl bg-slate-50 p-8 flex flex-col justify-between backface-hidden border border-slate-300 shadow-sm"
                    style={{
                      backfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)',
                    }}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-medium uppercase tracking-wider text-slate-600 text-[11px]">Answer</span>
                      <span className="text-slate-400">Flip ↻</span>
                    </div>
                    <div className="my-auto text-center overflow-y-auto px-2">
                      <p className="text-base md:text-lg text-slate-900 font-normal leading-relaxed">
                        {currentCard.back}
                      </p>
                    </div>
                    <div className="text-center text-xs text-slate-500">
                      Active Recall
                    </div>
                  </div>
                </div>
              </div>

              {/* Navigation Controls */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={currentCardIndex === 0}
                  onClick={() => {
                    setIsFlipped(false);
                    setCurrentCardIndex((prev) => Math.max(0, prev - 1));
                  }}
                  className="rounded-full h-9 w-9 border-border bg-white shadow-sm"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setIsFlipped(!isFlipped)}
                  className="rounded-full px-5 h-9 font-medium text-xs bg-white border border-border shadow-sm hover:bg-slate-100"
                >
                  Flip Card
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={currentCardIndex === studyData.flashcards.length - 1}
                  onClick={() => {
                    setIsFlipped(false);
                    setCurrentCardIndex((prev) => Math.min(studyData.flashcards.length - 1, prev + 1));
                  }}
                  className="rounded-full h-9 w-9 border-border bg-white shadow-sm"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Card className="p-12 text-center border-dashed bg-white">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground">Loading flashcards...</p>
            </Card>
          )}
        </TabsContent>

        {/* ================= TAB 2: INTERACTIVE QUIZ ================= */}
        <TabsContent value="quiz" className="space-y-6">
          {studyData && studyData.quiz.length > 0 ? (
            <div className="space-y-6">
              {/* Score Bar */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
                <div>
                  <h4 className="font-semibold text-sm text-slate-900">Score & Progress</h4>
                  <p className="text-xs text-slate-500">
                    Answered: {Object.keys(selectedAnswers).length} of {studyData.quiz.length} questions
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-base font-bold text-slate-900">
                    {score.correct} / {score.total} Correct
                  </div>
                  <div className="text-xs text-slate-500">
                    {score.total > 0 ? `${Math.round((score.correct / score.total) * 100)}% Accuracy` : '0%'}
                  </div>
                </div>
              </div>

              {/* Questions List */}
              <div className="space-y-4">
                {studyData.quiz.map((q, qIdx) => {
                  const userAnswer = selectedAnswers[qIdx];
                  const hasAnswered = userAnswer !== undefined;

                  return (
                    <Card
                      key={q.id || qIdx}
                      className="border border-slate-200 bg-white overflow-hidden shadow-sm"
                    >
                      <CardHeader className="bg-slate-50/70 pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                            Question {qIdx + 1}
                          </span>
                        </div>
                        <CardTitle className="text-sm sm:text-base font-semibold leading-relaxed text-slate-900">
                          {q.question}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-2.5">
                        {q.options.map((opt, optIdx) => {
                          const isSelected = userAnswer === optIdx;
                          const isCorrect = q.correctIndex === optIdx;

                          let btnStyle = 'border-slate-200 hover:border-slate-400 bg-white text-slate-800';

                          if (hasAnswered) {
                            if (isCorrect) {
                              btnStyle = 'border-emerald-500 bg-emerald-50 text-emerald-900 font-medium';
                            } else if (isSelected && !isCorrect) {
                              btnStyle = 'border-rose-400 bg-rose-50 text-rose-900';
                            } else {
                              btnStyle = 'opacity-50 border-slate-200 bg-white';
                            }
                          }

                          return (
                            <button
                              key={optIdx}
                              disabled={hasAnswered}
                              onClick={() => handleSelectAnswer(qIdx, optIdx)}
                              className={`w-full text-left p-3 rounded-lg border transition-colors flex items-center justify-between text-xs sm:text-sm ${btnStyle}`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="h-5 w-5 rounded bg-slate-100 flex items-center justify-center text-[11px] font-semibold text-slate-600 shrink-0">
                                  {String.fromCharCode(65 + optIdx)}
                                </span>
                                <span>{opt}</span>
                              </div>
                              {hasAnswered && isCorrect && (
                                <span className="text-xs font-semibold text-emerald-600 shrink-0">Correct</span>
                              )}
                              {hasAnswered && isSelected && !isCorrect && (
                                <span className="text-xs font-semibold text-rose-600 shrink-0">Incorrect</span>
                              )}
                            </button>
                          );
                        })}

                        {/* Explanation Box */}
                        {showExplanations[qIdx] && (
                          <div className="mt-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 space-y-1">
                            <span className="font-semibold text-slate-900 block">
                              Explanation:
                            </span>
                            <p className="leading-relaxed text-slate-600">{q.explanation}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Reset Quiz Button */}
              <div className="text-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedAnswers({});
                    setShowExplanations({});
                    toast.info('Quiz reset!');
                  }}
                  className="bg-white text-xs"
                >
                  Restart Quiz
                </Button>
              </div>
            </div>
          ) : (
            <Card className="p-12 text-center border-dashed bg-white">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground">Loading quiz questions...</p>
            </Card>
          )}
        </TabsContent>

        {/* ================= TAB 3: EXECUTIVE CHEAT SHEET ================= */}
        <TabsContent value="cheatsheet" className="space-y-6">
          {cheatSheet ? (
            <div className="space-y-6">
              {/* Actions Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-white border border-border shadow-sm">
                <div className="flex items-center gap-2.5">
                  <Badge variant="secondary" className="px-3 py-1 font-semibold text-xs">
                    Difficulty: {cheatSheet.difficulty}
                  </Badge>
                  <Badge variant="outline" className="px-3 py-1 text-xs font-medium">
                    {cheatSheet.studyTimeMinutes} min Review
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopyCheatSheet} className="text-xs bg-white">
                    Copy Markdown
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.print()}
                    className="text-xs hidden sm:flex bg-white"
                  >
                    Print / PDF
                  </Button>
                </div>
              </div>

              {/* Executive Summary Card */}
              <Card className="border border-slate-200 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-semibold text-slate-900">
                    Executive Summary
                  </CardTitle>
                  <CardDescription className="text-xs">Synthesized key takeaways for rapid review</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-800 leading-relaxed font-normal">
                    {cheatSheet.summary}
                  </p>
                </CardContent>
              </Card>

              {/* Key Concepts Grid */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wider">
                  Key Concepts & Definitions
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {cheatSheet.keyConcepts.map((item, idx) => (
                    <Card key={idx} className="border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-colors">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold text-foreground">
                            {item.term}
                          </CardTitle>
                          <Badge
                            variant={item.importance === 'Core' ? 'default' : 'secondary'}
                            className="text-[10px] px-2 py-0.5"
                          >
                            {item.importance}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {item.definition}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Common Exam Traps */}
              {cheatSheet.examTraps && cheatSheet.examTraps.length > 0 && (
                <Card className="border border-slate-200 bg-slate-50/70 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-900">
                      Exam Traps & Pitfalls
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Common misconceptions and frequent test questions
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-2">
                    {cheatSheet.examTraps.map((trap, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-800 font-medium">
                        <span className="text-slate-400 font-bold shrink-0">•</span>
                        <span>{trap}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Formulas & Mnemonics */}
              {cheatSheet.formulasOrMnemonics && cheatSheet.formulasOrMnemonics.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wider">
                    Essential Formulas & Mnemonics
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {cheatSheet.formulasOrMnemonics.map((f, idx) => (
                      <Card key={idx} className="border border-slate-200 bg-white shadow-sm">
                        <CardHeader className="pb-1">
                          <CardTitle className="text-xs sm:text-sm font-semibold text-slate-900">
                            {f.label}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-xs text-slate-700 font-mono">
                            {f.details}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Card className="p-12 text-center border-dashed bg-white">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground">Synthesizing executive cheat sheet...</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
