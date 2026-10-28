import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sparkles,
  RotateCw,
  CheckCircle2,
  XCircle,
  Award,
  Layers,
  FileText,
  Copy,
  Printer,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Brain,
  Zap,
  BookOpen,
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
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header Banner - Clean Crisp White with Purple Accents */}
      <div className="relative overflow-hidden rounded-2xl bg-white p-6 md:p-8 border border-border shadow-sm">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 text-purple-700 text-xs font-semibold border border-purple-200">
              <Sparkles className="h-3.5 w-3.5 text-purple-600" />
              AI Study Lab Suite
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-foreground tracking-tight">
              Interactive Study & Mastery Lab
            </h1>
            <p className="text-muted-foreground max-w-xl text-sm md:text-base">
              Turn your uploaded learning materials into interactive 3D flashcards, active-recall quizzes, and 1-click executive cheat sheets.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {conversations.length > 0 && (
              <div className="flex items-center gap-1.5 bg-muted/60 px-3 py-2 rounded-xl border border-border text-xs">
                <BookOpen className="h-3.5 w-3.5 text-purple-600 shrink-0" />
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
                  className="bg-transparent text-foreground font-medium text-xs focus:outline-none max-w-[180px] truncate"
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
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md shadow-purple-500/15 gap-2 h-10 px-4 text-xs font-semibold"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating AI Pack...
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5" />
                  Generate AI Pack
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="flashcards" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 bg-muted/70 p-1 rounded-xl border border-border">
          <TabsTrigger
            value="flashcards"
            className="gap-2 data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm font-semibold text-xs sm:text-sm"
          >
            <Layers className="h-4 w-4 text-purple-600" />
            <span>3D Flashcards</span>
          </TabsTrigger>
          <TabsTrigger
            value="quiz"
            className="gap-2 data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm font-semibold text-xs sm:text-sm"
          >
            <Award className="h-4 w-4 text-indigo-600" />
            <span>Interactive Quiz</span>
          </TabsTrigger>
          <TabsTrigger
            value="cheatsheet"
            className="gap-2 data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm font-semibold text-xs sm:text-sm"
          >
            <FileText className="h-4 w-4 text-emerald-600" />
            <span>Executive Cheat Sheet</span>
          </TabsTrigger>
        </TabsList>

        {/* ================= TAB 1: FLASHCARDS ================= */}
        <TabsContent value="flashcards" className="space-y-4">
          {studyData && studyData.flashcards.length > 0 && currentCard ? (
            <div className="flex flex-col items-center space-y-6">
              {/* Card Meta Bar */}
              <div className="w-full flex items-center justify-between px-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-purple-200 text-purple-700 bg-purple-50 font-medium">
                    {currentCard.category || 'Core Concept'}
                  </Badge>
                  <span className="text-xs">
                    Card {currentCardIndex + 1} of {studyData.flashcards.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">
                    {masteredCards.size} / {studyData.flashcards.length} Mastered
                  </span>
                  <Button
                    variant={masteredCards.has(currentCard.id) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggleMastered(currentCard.id)}
                    className="h-8 gap-1.5 text-xs font-medium"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {masteredCards.has(currentCard.id) ? 'Mastered!' : 'Mark Mastered'}
                  </Button>
                </div>
              </div>

              {/* 3D Flip Card Container */}
              <div
                onClick={() => setIsFlipped(!isFlipped)}
                className="w-full max-w-2xl h-80 cursor-pointer perspective-1000 group"
              >
                <div
                  className={`relative w-full h-full rounded-2xl transition-transform duration-500 transform-style-3d shadow-md border border-border ${
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
                    className="absolute inset-0 w-full h-full rounded-2xl bg-white p-8 flex flex-col justify-between backface-hidden border border-purple-200 shadow-sm"
                    style={{ backfaceVisibility: 'hidden' }}
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-bold uppercase tracking-wider text-purple-600">Question / Term</span>
                      <span className="text-muted-foreground font-medium">Click to flip ↻</span>
                    </div>
                    <div className="my-auto text-center">
                      <h3 className="text-2xl md:text-3xl font-bold text-foreground leading-relaxed">
                        {currentCard.front}
                      </h3>
                    </div>
                    <div className="text-center text-xs text-muted-foreground font-medium">
                      💡 Click anywhere on card to reveal answer
                    </div>
                  </div>

                  {/* BACK */}
                  <div
                    className="absolute inset-0 w-full h-full rounded-2xl bg-gradient-to-br from-purple-50 via-white to-indigo-50 p-8 flex flex-col justify-between backface-hidden border border-purple-300 shadow-sm"
                    style={{
                      backfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)',
                    }}
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-bold uppercase tracking-wider text-indigo-600">Answer / Explanation</span>
                      <span className="text-muted-foreground font-medium">Click to flip ↻</span>
                    </div>
                    <div className="my-auto text-center overflow-y-auto px-2">
                      <p className="text-lg md:text-xl text-foreground font-medium leading-relaxed">
                        {currentCard.back}
                      </p>
                    </div>
                    <div className="text-center text-xs text-emerald-600 font-semibold">
                      ✓ Active Recall Validated
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
                  className="rounded-full h-10 w-10 border-border bg-white shadow-sm"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setIsFlipped(!isFlipped)}
                  className="gap-2 rounded-full px-5 h-10 font-semibold text-xs bg-white border border-border shadow-sm hover:bg-muted"
                >
                  <RotateCw className="h-3.5 w-3.5" />
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
                  className="rounded-full h-10 w-10 border-border bg-white shadow-sm"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            </div>
          ) : (
            <Card className="p-12 text-center border-dashed bg-white">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Loading interactive flashcards...</p>
            </Card>
          )}
        </TabsContent>

        {/* ================= TAB 2: INTERACTIVE QUIZ ================= */}
        <TabsContent value="quiz" className="space-y-6">
          {studyData && studyData.quiz.length > 0 ? (
            <div className="space-y-6">
              {/* Score Bar */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-white border border-border shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                    <Award className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm text-foreground">Exam Readiness Score</h4>
                    <p className="text-xs text-muted-foreground">
                      Answered: {Object.keys(selectedAnswers).length} of {studyData.quiz.length}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-foreground">
                    {score.correct} / {score.total} Correct
                  </div>
                  <div className="text-xs text-indigo-600 font-semibold">
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
                      className="border border-border bg-white overflow-hidden shadow-sm transition-all duration-300"
                    >
                      <CardHeader className="bg-muted/30 pb-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                            Question {qIdx + 1}
                          </span>
                        </div>
                        <CardTitle className="text-base sm:text-lg font-semibold leading-relaxed text-foreground">
                          {q.question}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-2.5">
                        {q.options.map((opt, optIdx) => {
                          const isSelected = userAnswer === optIdx;
                          const isCorrect = q.correctIndex === optIdx;

                          let btnStyle = 'border-border hover:border-indigo-400 bg-white hover:bg-muted/40 text-foreground';

                          if (hasAnswered) {
                            if (isCorrect) {
                              btnStyle = 'border-emerald-500 bg-emerald-50 text-emerald-800 font-semibold';
                            } else if (isSelected && !isCorrect) {
                              btnStyle = 'border-rose-400 bg-rose-50 text-rose-800';
                            } else {
                              btnStyle = 'opacity-50 border-border bg-white';
                            }
                          }

                          return (
                            <button
                              key={optIdx}
                              disabled={hasAnswered}
                              onClick={() => handleSelectAnswer(qIdx, optIdx)}
                              className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 flex items-center justify-between text-sm ${btnStyle}`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                                  {String.fromCharCode(65 + optIdx)}
                                </span>
                                <span>{opt}</span>
                              </div>
                              {hasAnswered && isCorrect && (
                                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                              )}
                              {hasAnswered && isSelected && !isCorrect && (
                                <XCircle className="h-5 w-5 text-rose-600 shrink-0" />
                              )}
                            </button>
                          );
                        })}

                        {/* Explanation Box */}
                        {showExplanations[qIdx] && (
                          <div className="mt-3 p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs md:text-sm text-foreground space-y-1">
                            <span className="font-bold text-indigo-700 flex items-center gap-1.5">
                              <Brain className="h-4 w-4" /> Why this is correct:
                            </span>
                            <p className="leading-relaxed text-muted-foreground">{q.explanation}</p>
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
                  className="gap-2 bg-white"
                >
                  <RotateCw className="h-4 w-4" />
                  Restart Quiz
                </Button>
              </div>
            </div>
          ) : (
            <Card className="p-12 text-center border-dashed bg-white">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Loading interactive quiz questions...</p>
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
                    ⏱️ {cheatSheet.studyTimeMinutes} min Review
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopyCheatSheet} className="gap-1.5 text-xs bg-white">
                    <Copy className="h-3.5 w-3.5" />
                    Copy Markdown
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.print()}
                    className="gap-1.5 text-xs hidden sm:flex bg-white"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Print / PDF
                  </Button>
                </div>
              </div>

              {/* Executive Summary Card */}
              <Card className="border-purple-200 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-xl flex items-center gap-2 text-foreground font-bold">
                    <Sparkles className="h-5 w-5 text-purple-600" />
                    Executive Summary
                  </CardTitle>
                  <CardDescription>Synthesized key takeaways for rapid assimilation</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-base text-foreground leading-relaxed font-normal">
                    {cheatSheet.summary}
                  </p>
                </CardContent>
              </Card>

              {/* Key Concepts Grid */}
              <div>
                <h3 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
                  <Brain className="h-5 w-5 text-indigo-600" />
                  Key Concepts & High-Yield Definitions
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {cheatSheet.keyConcepts.map((item, idx) => (
                    <Card key={idx} className="border border-border bg-white shadow-sm hover:border-indigo-400 transition-colors">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base font-semibold text-foreground">
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
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {item.definition}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Common Exam Traps */}
              {cheatSheet.examTraps && cheatSheet.examTraps.length > 0 && (
                <Card className="border-amber-200 bg-amber-50/60 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-bold text-amber-900 flex items-center gap-2">
                      Critical Exam Traps & Tricky Pitfalls
                    </CardTitle>
                    <CardDescription className="text-amber-700/80">
                      Mistakes examiners frequently test students on
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-2">
                    {cheatSheet.examTraps.map((trap, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 text-sm text-amber-950 font-medium">
                        <span className="text-amber-600 font-bold shrink-0">⚠️</span>
                        <span>{trap}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Formulas & Mnemonics */}
              {cheatSheet.formulasOrMnemonics && cheatSheet.formulasOrMnemonics.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
                    <Zap className="h-5 w-5 text-emerald-600" />
                    Essential Formulas & Memory Mnemonics
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {cheatSheet.formulasOrMnemonics.map((f, idx) => (
                      <Card key={idx} className="border-emerald-200 bg-emerald-50/60 shadow-sm">
                        <CardHeader className="pb-1">
                          <CardTitle className="text-sm font-bold text-emerald-800">
                            {f.label}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-emerald-950 font-mono font-medium">
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
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Synthesizing executive cheat sheet...</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
