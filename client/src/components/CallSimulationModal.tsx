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
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col bg-white shadow-2xl rounded-3xl border-0" data-testid="modal-call-simulation">
        <DialogHeader className="pb-6 border-b border-[#F3F4F6]">
          <DialogTitle className="text-3xl font-bold text-[#111827]">Call Simulation Demo</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto space-y-5 py-8">
          {transcript.map((item, index) => (
            <div 
              key={index} 
              className={`flex gap-4 ${item.speaker === 'ai' ? 'justify-start' : 'justify-end'}`}
              data-testid={`message-${index}`}
            >
              {item.speaker === 'ai' && (
                <div className="w-12 h-12 rounded-2xl bg-[#D1FAE5] text-[#059669] flex items-center justify-center flex-shrink-0">
                  <Bot className="w-6 h-6" />
                </div>
              )}
              
              <div className={`max-w-[70%] rounded-3xl px-6 py-4 ${
                item.speaker === 'ai' 
                  ? 'bg-[#D1FAE5] text-[#111827]' 
                  : 'bg-[#F3F4F6] text-[#111827]'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className={`text-xs ${
                    item.speaker === 'ai' 
                      ? 'bg-[#A7F3D0] text-[#065F46] border-[#6EE7B7]'
                      : 'bg-white text-[#6B7280] border-[#E5E7EB]'
                  }`}>
                    {item.speaker === 'ai' ? 'AI Receptionist' : 'Patient'}
                  </Badge>
                </div>
                <p className="text-base leading-relaxed">{item.message}</p>
              </div>
              
              {item.speaker === 'patient' && (
                <div className="w-12 h-12 rounded-2xl bg-[#F3F4F6] text-[#6B7280] flex items-center justify-center flex-shrink-0">
                  <User className="w-6 h-6" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="pt-6 pb-2 border-t border-[#F3F4F6]">
          <div className="mb-6 flex items-center justify-center gap-2 text-[#9CA3AF]">
            <div className="flex gap-1">
              {[...Array(20)].map((_, i) => (
                <div key={i} className="w-1 bg-[#D1FAE5] rounded-full" style={{ height: `${Math.random() * 20 + 10}px` }} />
              ))}
            </div>
            <span className="text-sm font-medium">Audio waveform placeholder</span>
          </div>
          
          <Button 
            onClick={handleEndDemo} 
            className="w-full bg-[#00C896] hover:bg-[#00B386] text-white py-6 text-lg shadow-lg"
            data-testid="button-end-demo"
          >
            End Demo & Log
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
