import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { User, Bot, Calendar } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface CallSimulationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogCall: () => void;
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

export default function CallSimulationModal({ open, onOpenChange, onLogCall }: CallSimulationModalProps) {
  const getTomorrowDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  const [formData, setFormData] = useState({
    name: "Anna Müller",
    phone: "0176 1234567",
    service: "Zahnreinigung",
    preferredTime: "Morgen 10:00"
  });
  const [createAppointment, setCreateAppointment] = useState(false);
  const [appointmentData, setAppointmentData] = useState({
    date: getTomorrowDate(),
    time: "10:00"
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEndDemo = async () => {
    setIsSubmitting(true);
    try {
      const callResponse = await fetch('/api/calls/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!callResponse.ok) {
        console.error('Failed to log call');
        return;
      }

      if (createAppointment) {
        const appointmentPayload = {
          name: formData.name,
          phone: formData.phone,
          service: formData.service,
          date: appointmentData.date,
          time: appointmentData.time,
          notes: "Created from call simulation demo"
        };

        const aptResponse = await fetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appointmentPayload),
        });

        if (!aptResponse.ok) {
          console.error('Failed to create appointment');
        } else {
          queryClient.invalidateQueries({ queryKey: ['/api/appointments'] });
        }
      }

      onLogCall();
      onOpenChange(false);
    } catch (error) {
      console.error('Error logging call:', error);
    } finally {
      setIsSubmitting(false);
    }
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

        <div className="pt-6 pb-2 border-t border-[#F3F4F6] space-y-6">
          <div className="mb-4 flex items-center justify-center gap-2 text-[#9CA3AF]">
            <div className="flex gap-1">
              {[...Array(20)].map((_, i) => (
                <div key={i} className="w-1 bg-[#D1FAE5] rounded-full" style={{ height: `${Math.random() * 20 + 10}px` }} />
              ))}
            </div>
            <span className="text-sm font-medium">Audio waveform placeholder</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name" className="text-sm font-medium text-[#111827] mb-2 block">Name</Label>
              <Input 
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="border-[#E5E7EB]"
                data-testid="input-name"
              />
            </div>
            <div>
              <Label htmlFor="phone" className="text-sm font-medium text-[#111827] mb-2 block">Phone</Label>
              <Input 
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="border-[#E5E7EB]"
                data-testid="input-phone"
              />
            </div>
            <div>
              <Label htmlFor="service" className="text-sm font-medium text-[#111827] mb-2 block">Service</Label>
              <Input 
                id="service"
                value={formData.service}
                onChange={(e) => setFormData({ ...formData, service: e.target.value })}
                className="border-[#E5E7EB]"
                data-testid="input-service"
              />
            </div>
            <div>
              <Label htmlFor="preferredTime" className="text-sm font-medium text-[#111827] mb-2 block">Preferred Time</Label>
              <Input 
                id="preferredTime"
                value={formData.preferredTime}
                onChange={(e) => setFormData({ ...formData, preferredTime: e.target.value })}
                className="border-[#E5E7EB]"
                data-testid="input-preferred-time"
              />
            </div>
          </div>

          <div className="bg-[#F3F4F6] p-4 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#00C896]" />
                <Label htmlFor="createAppointment" className="text-sm font-medium text-[#111827] cursor-pointer">
                  Create appointment (demo)
                </Label>
              </div>
              <Switch 
                id="createAppointment"
                checked={createAppointment}
                onCheckedChange={setCreateAppointment}
                data-testid="switch-create-appointment"
              />
            </div>
            
            {createAppointment && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <Label htmlFor="appointmentDate" className="text-sm font-medium text-[#6B7280] mb-2 block">
                    Appointment Date
                  </Label>
                  <Input 
                    id="appointmentDate"
                    type="date"
                    value={appointmentData.date}
                    onChange={(e) => setAppointmentData({ ...appointmentData, date: e.target.value })}
                    className="border-[#E5E7EB]"
                    data-testid="input-appointment-date"
                  />
                </div>
                <div>
                  <Label htmlFor="appointmentTime" className="text-sm font-medium text-[#6B7280] mb-2 block">
                    Appointment Time
                  </Label>
                  <Input 
                    id="appointmentTime"
                    type="time"
                    value={appointmentData.time}
                    onChange={(e) => setAppointmentData({ ...appointmentData, time: e.target.value })}
                    className="border-[#E5E7EB]"
                    data-testid="input-appointment-time"
                  />
                </div>
              </div>
            )}
          </div>
          
          <Button 
            onClick={handleEndDemo} 
            disabled={isSubmitting}
            className="w-full bg-[#00C896] hover:bg-[#00B386] text-white py-6 text-lg shadow-lg disabled:opacity-50"
            data-testid="button-end-demo"
          >
            {isSubmitting ? 'Logging...' : 'End Demo & Log'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
