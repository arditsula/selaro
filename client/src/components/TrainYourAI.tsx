import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Brain, Save, Eraser, FileText } from 'lucide-react';

export default function TrainYourAI() {
  const [content, setContent] = useState('');
  const { toast } = useToast();

  const { data: knowledgeData, isLoading } = useQuery({
    queryKey: ['/api/knowledge'],
  });

  useEffect(() => {
    if (knowledgeData && typeof knowledgeData === 'object' && 'content' in knowledgeData) {
      setContent(knowledgeData.content as string || '');
    }
  }, [knowledgeData]);

  const saveMutation = useMutation({
    mutationFn: async (content: string) => {
      return apiRequest('POST', '/api/knowledge', { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
      toast({
        title: 'Knowledge updated',
        description: 'Your AI training data has been saved successfully.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save knowledge. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(content);
  };

  const handleClear = () => {
    setContent('');
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const savedContent = (knowledgeData as { content?: string })?.content || '';

  return (
    <section id="train-ai" className="py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-4">
            <Brain className="w-8 h-8 text-primary" />
            <h2 className="text-4xl font-bold">Train your AI</h2>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Customize your AI receptionist with your clinic's specific information, FAQs, services, and communication style.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Training Input
              </CardTitle>
              <CardDescription>
                Enter your clinic's information to train the AI
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                data-testid="textarea-knowledge-input"
                placeholder="Paste or write here your clinic's FAQs, services, offers, and tone of communication…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[300px] rounded-xl resize-none"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {wordCount} {wordCount === 1 ? 'word' : 'words'}
                </span>
                <div className="flex gap-2">
                  <Button
                    data-testid="button-clear-knowledge"
                    variant="outline"
                    onClick={handleClear}
                    disabled={!content}
                  >
                    <Eraser className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                  <Button
                    data-testid="button-save-knowledge"
                    onClick={handleSave}
                    disabled={saveMutation.isPending || !content}
                    className="bg-primary hover-elevate active-elevate-2"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saveMutation.isPending ? 'Saving...' : 'Save Knowledge'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                Current Knowledge Base
              </CardTitle>
              <CardDescription>
                Currently active training data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                data-testid="text-saved-knowledge"
                className="min-h-[300px] max-h-[400px] overflow-y-auto p-4 rounded-xl bg-muted/50 border"
              >
                {isLoading ? (
                  <p className="text-muted-foreground italic">Loading...</p>
                ) : savedContent ? (
                  <p className="whitespace-pre-wrap text-sm">{savedContent}</p>
                ) : (
                  <p className="text-muted-foreground italic">
                    No training data saved yet. Start by entering your clinic's information on the left.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
