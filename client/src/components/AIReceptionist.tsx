import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { MessageCircle, Send, Bot, User, AlertCircle, Database } from 'lucide-react';
import type { ChatMessage } from '@shared/schema';

export default function AIReceptionist() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest('POST', '/api/assistant', { message });
      return response.json();
    },
    onSuccess: (data) => {
      setIsTyping(false);
      const reply = (data as { reply?: string }).reply || "I apologize, but I couldn't generate a response.";
      
      const assistantMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      };
      
      setMessages(prev => {
        const updated = [...prev, assistantMessage];
        return updated.slice(-10);
      });
    },
    onError: (error: any) => {
      setIsTyping(false);
      const errorMessage = error?.message || 'Failed to get response';
      
      if (errorMessage.includes('API key') || errorMessage.includes('not configured')) {
        toast({
          title: 'API Key Required',
          description: 'Add your OPENAI_API_KEY in environment variables to enable AI replies.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Error',
          description: errorMessage,
          variant: 'destructive',
        });
      }
    },
  });

  const handleSend = () => {
    if (!inputMessage.trim()) return;

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: inputMessage,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => {
      const updated = [...prev, userMessage];
      return updated.slice(-10);
    });

    setInputMessage('');
    setIsTyping(true);
    sendMutation.mutate(inputMessage);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <section id="ai-receptionist" className="py-16 px-4 bg-muted/30">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-4">
            <MessageCircle className="w-8 h-8 text-primary" />
            <h2 className="text-4xl font-bold">AI Receptionist</h2>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Test your AI receptionist. Ask questions about your clinic services, hours, or appointments.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card className="rounded-2xl shadow-lg border-0 bg-card overflow-hidden h-[600px] flex flex-col">
              <CardHeader className="border-b bg-background/50 backdrop-blur-sm sticky top-0 z-10">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-primary" />
                  </div>
                  AI Receptionist
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    Online
                  </span>
                </CardTitle>
              </CardHeader>
              
              <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
                <div
                  data-testid="chat-messages-container"
                  className="flex-1 overflow-y-auto px-6 py-6 space-y-3"
                  style={{ 
                    scrollBehavior: 'smooth',
                    fontFamily: 'system-ui, -apple-system, sans-serif'
                  }}
                >
                  {messages.length === 0 && (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                          <Bot className="w-10 h-10 text-primary" />
                        </div>
                        <p className="text-base font-medium mb-1">Start a conversation</p>
                        <p className="text-sm opacity-70">Try asking about clinic hours or services</p>
                      </div>
                    </div>
                  )}
                  
                  {messages.map((msg, index) => (
                    <div
                      key={msg.id}
                      data-testid={`message-${msg.role}-${msg.id}`}
                      className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      {msg.role === 'assistant' && (
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                          <Bot className="w-4 h-4 text-primary" />
                        </div>
                      )}
                      
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                          msg.role === 'user'
                            ? 'bg-card text-card-foreground border border-border shadow-md'
                            : 'bg-accent text-accent-foreground shadow-sm'
                        }`}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                          {msg.content}
                        </p>
                        <span className="text-[10px] mt-1.5 block opacity-70">
                          {new Date(msg.timestamp).toLocaleTimeString([], { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </span>
                      </div>
                      
                      {msg.role === 'user' && (
                        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-1">
                          <User className="w-4 h-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {isTyping && (
                    <div 
                      className="flex gap-2 justify-start animate-in fade-in slide-in-from-bottom-2 duration-300" 
                      data-testid="typing-indicator"
                    >
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                        <Bot className="w-4 h-4 text-primary" />
                      </div>
                      <div className="bg-accent rounded-2xl px-4 py-3 shadow-sm">
                        <div className="flex gap-1 items-center">
                          <div className="w-2 h-2 bg-accent-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }} />
                          <div className="w-2 h-2 bg-accent-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms', animationDuration: '1s' }} />
                          <div className="w-2 h-2 bg-accent-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms', animationDuration: '1s' }} />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div ref={messagesEndRef} />
                </div>

                <div 
                  className="border-t bg-background/95 backdrop-blur-sm p-4 shadow-lg" 
                  style={{ 
                    boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.05)',
                    position: 'sticky',
                    bottom: 0,
                    zIndex: 10
                  }}
                >
                  <div className="flex gap-2 items-end">
                    <Input
                      data-testid="input-chat-message"
                      placeholder="Type your question..."
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      disabled={sendMutation.isPending}
                      className="rounded-xl border-2 focus:border-primary transition-colors bg-background text-base px-4 py-2.5"
                      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                    />
                    <Button
                      data-testid="button-send-message"
                      onClick={handleSend}
                      disabled={!inputMessage.trim() || sendMutation.isPending}
                      size="icon"
                      className="bg-primary h-10 w-10 rounded-xl flex-shrink-0"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  {isTyping && (
                    <p className="text-xs text-muted-foreground mt-2 ml-1">
                      AI Receptionist is typing...
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="rounded-2xl shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="w-5 h-5" />
                  Knowledge Source
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start gap-2 text-sm">
                    <AlertCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <p className="text-muted-foreground">
                      The AI reads clinic data from <code className="bg-muted px-1 py-0.5 rounded text-xs">knowledge.json</code>
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                    <p className="font-medium mb-1">Tip:</p>
                    <p>Train the AI with your clinic details in the "Train your AI" section above to get accurate responses.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-md">
              <CardHeader>
                <CardTitle className="text-base">Conversation Limit</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Last <span className="font-semibold text-foreground">{messages.length}/10</span> messages displayed
                </p>
                <div className="mt-3 w-full bg-muted rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all duration-500"
                    style={{ width: `${(messages.length / 10) * 100}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
