import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function Settings() {
  const [backendUrl, setBackendUrl] = useState('http://localhost:5000');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('backend_url');
    if (stored) {
      setBackendUrl(stored);
    }
    const key = localStorage.getItem('openrouter_key_3') || '';
    if (key) {
      setOpenRouterKey(key);
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('backend_url', backendUrl);
    toast.success('Settings saved successfully');
  };

  const handleSaveKey = async () => {
    const trimmed = openRouterKey.trim();
    if (!trimmed) {
      toast.error('Please enter an OpenRouter key');
      return;
    }
    if (!trimmed.startsWith('sk-or-v1-')) {
      toast.error('Key must start with sk-or-v1-');
      return;
    }

    setIsSavingKey(true);
    try {
      localStorage.setItem('openrouter_key_3', trimmed);
      const res = await fetch(`${backendUrl}/api/settings/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmed }),
      });
      if (res.ok) {
        toast.success('3rd OpenRouter key saved and active in backend!');
      } else {
        toast.success('Key saved in browser storage');
      }
    } catch (e: any) {
      localStorage.setItem('openrouter_key_3', trimmed);
      toast.success('Key saved in browser storage');
    } finally {
      setIsSavingKey(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
        <p className="text-muted-foreground">Configure your backend connection and AI API keys</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>OpenRouter AI API Key</CardTitle>
          <CardDescription>
            Add your fresh OpenRouter key from another account to bypass daily free limits
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="openrouter-key">OpenRouter Key (sk-or-v1-...)</Label>
            <Input
              id="openrouter-key"
              type="password"
              placeholder="sk-or-v1-xxxxxxxxxxxxxxxx"
              value={openRouterKey}
              onChange={(e) => setOpenRouterKey(e.target.value)}
              className="mt-2 font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Keys are rotated automatically. Adding a key from a fresh account unlocks 50 free requests per day.
            </p>
          </div>
          <Button onClick={handleSaveKey} disabled={isSavingKey}>
            {isSavingKey ? 'Saving...' : 'Save & Activate Key'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Backend Configuration
          </CardTitle>
          <CardDescription>Set the URL for your Flask backend</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="backend-url">Backend URL</Label>
            <Input
              id="backend-url"
              type="url"
              placeholder="http://localhost:5000"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              className="mt-2"
            />
            <p className="text-sm text-muted-foreground mt-2">
              The base URL where your Flask backend is running (e.g., http://localhost:5000)
            </p>
          </div>
          <Button onClick={handleSave}>Save Settings</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Endpoints</CardTitle>
          <CardDescription>Expected backend endpoints</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <code className="bg-muted px-2 py-1 rounded">POST /api/ingest</code>
              <span className="text-muted-foreground">Process and store learning materials</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-2 py-1 rounded">POST /api/ask</code>
              <span className="text-muted-foreground">Ask questions and get RAG-powered answers</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
