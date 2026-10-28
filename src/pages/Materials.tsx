import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ingestMaterials, deleteMaterial, clearAllMaterials, type IngestItem } from '@/lib/api';
import { useConversationHistory } from '@/hooks/useConversationHistory';
import { useNavigate } from 'react-router-dom';

export default function Materials() {
  const [files, setFiles] = useState<File[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { addConversation, conversations, setCurrentConversation, deleteConversation, clearAllConversations } = useConversationHistory();
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

  const handleClearAll = async () => {
    if (!window.confirm('Clear all indexed study materials and reset vector database? This cannot be undone.')) {
      return;
    }
    await clearAllMaterials();
    clearAllConversations();
    toast.success('All study materials cleared');
  };

  const handleDeleteItem = async (convId: string) => {
    if (!window.confirm('Remove this material?')) return;
    await deleteMaterial(convId);
    deleteConversation(convId);
    toast.success('Material removed');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Learning Materials
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Upload PDF documents, lecture notes, or YouTube video transcripts
        </p>
      </div>

      {/* Active Knowledge Bases List */}
      {conversations.length > 0 && (
        <Card className="border border-border bg-white shadow-sm">
          <CardHeader className="pb-3 border-b border-border/60">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Indexed Materials ({conversations.length})
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  className="h-6 text-[11px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2 font-normal"
                >
                  Clear All
                </Button>
                <Badge variant="outline" className="text-[10px] text-slate-600 border-slate-200 bg-slate-50 font-normal">
                  ChromaDB Synced
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-3">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="font-medium text-slate-800 truncate">{conv.title}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCurrentConversation(conv.id);
                      navigate('/study-lab');
                    }}
                    className="h-7 text-xs text-slate-700 hover:text-slate-900 hover:bg-slate-200/60"
                  >
                    Study Lab
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCurrentConversation(conv.id);
                      navigate('/ask');
                    }}
                    className="h-7 text-xs text-slate-700 hover:text-slate-900 hover:bg-slate-200/60"
                  >
                    Ask Tutor
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteItem(conv.id)}
                    className="h-7 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Upload Files Card */}
      <Card className="border border-border bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-900">
            PDF & Text Documents
          </CardTitle>
          <CardDescription className="text-xs">
            Select lecture slides, research papers, or syllabus documents
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="border border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-slate-400 transition-colors bg-slate-50/50">
              <Label htmlFor="file-upload" className="cursor-pointer font-medium text-xs sm:text-sm text-slate-800 hover:underline">
                Choose files to upload
              </Label>
              <p className="text-xs text-slate-500 mt-1">Supports PDF & Plain Text (.txt)</p>
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
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Selected Files ({files.length}):
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {files.map((file, idx) => (
                    <div
                      key={idx}
                      className="text-xs p-2.5 rounded-lg bg-slate-50 border border-slate-200 truncate font-mono text-slate-700"
                    >
                      {file.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* YouTube Video Card */}
      <Card className="border border-border bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-900">
            YouTube Video Transcripts
          </CardTitle>
          <CardDescription className="text-xs">
            Paste any lecture or educational video URL to ingest its captions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div>
            <Label htmlFor="youtube-url" className="text-xs font-medium text-slate-700">YouTube URL</Label>
            <Input
              id="youtube-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              className="mt-1.5 text-sm bg-white border-slate-200"
            />
          </div>
        </CardContent>
      </Card>

      {/* Process Button */}
      <Button
        onClick={handleProcess}
        disabled={isProcessing || (files.length === 0 && !youtubeUrl)}
        size="lg"
        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm h-10 text-xs sm:text-sm transition-colors"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Indexing Materials...
          </>
        ) : (
          'Process Materials'
        )}
      </Button>
    </div>
  );
}
