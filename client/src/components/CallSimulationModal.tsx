import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, Bot } from "lucide-react";

interface CallSimulationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const transcript = [
  { speaker: 'ai', message: "Good afternoon! Thank you for calling Bright Smile Dental. This is your AI assistant. How may I help you today?" },
  { speaker: 'patient', message: "Hi, I have a terrible toothache and need to see someone as soon as possible." },
  { speaker: 'ai', message: "I'm sorry to hear you're in pain. Let me help you schedule an emergency appointment. May I have your name and phone number?" },
  { speaker: 'patient', message: "Yes, it's Michael Chen, and my number is 555-876-5432." },
  { speaker: 'ai', message: "Thank you, Michael. We have availability today at 3:30 PM or tomorrow morning at 9:00 AM. Which works better for you?" },
  { speaker: 'patient', message: "Today at 3:30 would be perfect!" },
  { speaker: 'ai', message: "Excellent! I've scheduled you for today at 3:30 PM for an emergency consultation. You'll receive a confirmation text shortly. Is there anything else I can help you with?" },
  { speaker: 'patient', message: "No, that's all. Thank you!" },
  { speaker: 'ai', message: "You're welcome, Michael! We'll see you at 3:30 PM. Feel better soon!" }
];

export default function CallSimulationModal({ open, onOpenChange }: CallSimulationModalProps) {
  const handleEndDemo = () => {
    console.log('Demo ended - would log call details');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" data-testid="modal-call-simulation">
        <DialogHeader>
          <DialogTitle className="text-2xl">Call Simulation Demo</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {transcript.map((item, index) => (
            <div 
              key={index} 
              className={`flex gap-3 ${item.speaker === 'ai' ? 'justify-start' : 'justify-end'}`}
              data-testid={`message-${index}`}
            >
              {item.speaker === 'ai' && (
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5" />
                </div>
              )}
              
              <div className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                item.speaker === 'ai' 
                  ? 'bg-primary/10 text-foreground' 
                  : 'bg-muted text-foreground'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">
                    {item.speaker === 'ai' ? 'AI Receptionist' : 'Patient'}
                  </Badge>
                </div>
                <p className="text-sm leading-relaxed">{item.message}</p>
              </div>
              
              {item.speaker === 'patient' && (
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5" />
                </div>
              )}
            </div>
          ))}
        </div>
        
        <div className="pt-4 border-t flex justify-end">
          <Button onClick={handleEndDemo} data-testid="button-end-demo">
            End Demo & Log
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
