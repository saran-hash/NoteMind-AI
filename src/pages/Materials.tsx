import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  Link as LinkIcon,
  Loader2,
  FileText,
  Sparkles,
  Zap,
  ArrowRight,
  Layers,
  BookOpen,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { ingestMaterials, type IngestItem } from '@/lib/api';
import { useConversationHistory } from '@/hooks/useConversationHistory';
import { useNavigate } from 'react-router-dom';

export default function Materials() {
  const [files, setFiles] = useState<File[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { addConversation, conversations, setCurrentConversation } = useConversationHistory();
  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleProcess = async () => {
    if (files.length === 0 && !youtubeUrl) {
      toast.error('Please add at least one file or YouTube URL');
      return;
    }

    setIsProcessing(true);
    try {
      const title = 'Materials: ' + (files.length > 0 ? files.map((f) => f.name).join(', ') : youtubeUrl);
      const convId = addConversation(title);
      const items: IngestItem[] = [];

      for (const file of files) {
        if (file.type === 'application/pdf') {
          const base64 = await fileToBase64(file);
          items.push({
            type: 'pdf',
            name: file.name,
            dataBase64: base64,
          });
        } else if (file.type === 'text/plain') {
          const text = await file.text();
          items.push({
            type: 'text',
            name: file.name,
            text,
          });
        }
      }

      if (youtubeUrl) {
        items.push({
          type: 'youtube',
          name: youtubeUrl,
          url: youtubeUrl,
        });
      }

      await ingestMaterials({ items, conversationId: convId });
      toast.success('Materials ingested and indexed into Vector ChromaDB!');
      setFiles([]);
      setYoutubeUrl('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to process materials');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Hero Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight flex items-center gap-2">
          Upload Learning Materials
          <Sparkles className="h-5 w-5 text-primary" />
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Build your personal RAG knowledge base from PDFs, plain text notes, and YouTube video transcripts
        </p>
      </div>

      {/* Active Knowledge Bases Carousel/List */}
      {conversations.length > 0 && (
        <Card className="border-purple-500/20 bg-gradient-to-r from-card to-purple-950/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <BookOpen className="h-4 w-4 text-purple-400" />
                Indexed Study Materials ({conversations.length})
              </CardTitle>
              <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/40 bg-emerald-500/10">
                ChromaDB Vector Synced
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {conversations.slice(0, 3).map((conv) => (
              <div
                key={conv.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-card/60 border border-border/80 text-xs"
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="font-medium text-foreground truncate">{conv.title}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCurrentConversation(conv.id);
                      navigate('/study-lab');
                    }}
                    className="h-7 text-[11px] gap-1 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                  >
                    <Layers className="h-3 w-3" />
                    Study Lab
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCurrentConversation(conv.id);
                      navigate('/ask');
                    }}
                    className="h-7 text-[11px] gap-1 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                  >
                    <ArrowRight className="h-3 w-3" />
                    Ask Tutor
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Upload Files Card */}
      <Card className="border border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Upload className="h-5 w-5 text-purple-400" />
            Upload PDF & Text Documents
          </CardTitle>
          <CardDescription>
            Select lecture slides, research papers, or syllabus documents
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="border-2 border-dashed border-border/80 rounded-xl p-6 text-center hover:border-purple-500/50 transition-colors bg-card/40">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <Label htmlFor="file-upload" className="cursor-pointer font-semibold text-sm text-foreground">
                Click to browse or drop files here
              </Label>
              <p className="text-xs text-muted-foreground mt-1">Supports PDF & Plain Text (.txt)</p>
              <Input
                id="file-upload"
                type="file"
                accept=".pdf,.txt"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
            {files.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Ready to Ingest ({files.length}):
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 text-xs p-2.5 rounded-lg bg-muted/60 border border-border truncate"
                    >
                      <FileText className="h-4 w-4 text-purple-400 shrink-0" />
                      <span className="truncate">{file.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* YouTube Video Card */}
      <Card className="border border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <LinkIcon className="h-5 w-5 text-rose-400" />
            YouTube Video Transcripts
          </CardTitle>
          <CardDescription>
            Paste any lecture or educational video URL to ingest its captions into your syllabus
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div>
            <Label htmlFor="youtube-url" className="text-xs font-medium">YouTube URL</Label>
            <Input
              id="youtube-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              className="mt-1.5 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Process Button */}
      <Button
        onClick={handleProcess}
        disabled={isProcessing || (files.length === 0 && !youtubeUrl)}
        size="lg"
        className="w-full bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:via-indigo-500 hover:to-blue-500 text-white font-semibold shadow-lg shadow-purple-500/20 h-12 text-sm"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Chunking & Ingesting into Vector DB...
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Process Materials & Generate Vector Index
          </>
        )}
      </Button>
    </div>
  );
}
